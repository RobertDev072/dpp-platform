const cdk = require("aws-cdk-lib");
const ec2 = require("aws-cdk-lib/aws-ec2");
const ecr = require("aws-cdk-lib/aws-ecr");
const lambda = require("aws-cdk-lib/aws-lambda");
const targets = require("aws-cdk-lib/aws-events-targets");
const acm = require("aws-cdk-lib/aws-certificatemanager");
const cloudfront = require("aws-cdk-lib/aws-cloudfront");
const origins = require("aws-cdk-lib/aws-cloudfront-origins");
const rds = require("aws-cdk-lib/aws-rds");
const s3 = require("aws-cdk-lib/aws-s3");
const secretsmanager = require("aws-cdk-lib/aws-secretsmanager");
const logs = require("aws-cdk-lib/aws-logs");
const iam = require("aws-cdk-lib/aws-iam");
const cloudwatch = require("aws-cdk-lib/aws-cloudwatch");
const cwActions = require("aws-cdk-lib/aws-cloudwatch-actions");
const sns = require("aws-cdk-lib/aws-sns");
const subscriptions = require("aws-cdk-lib/aws-sns-subscriptions");
const budgets = require("aws-cdk-lib/aws-budgets");
const ce = require("aws-cdk-lib/aws-ce");
const backup = require("aws-cdk-lib/aws-backup");
const events = require("aws-cdk-lib/aws-events");
const { buildRouterCode } = require("./domain-router");

// VeriPasso op AWS - één regio, goedkoop bij weinig verkeer, schaalt vanzelf:
//
//   bezoeker ─TLS1.2+/HTTP2-3─> CloudFront (+WAF) ─TLS─> Lambda Function URL ─> Lambda (container-image: Next.js + API)
//                                   │                                             ├─> RDS PostgreSQL 17 (privé subnet, TLS verplicht)
//                                   │                                             └─> S3 (privé buckets, presigned URL's; gateway-endpoint)
//                                   └─ /products/* rechtstreeks uit de fotobucket (Origin Access Control), lang gecachet
//
// Waarom Lambda i.p.v. ECS + load balancer: geen vaste kosten voor een draaiende taak,
// load balancer en publieke IP's; je betaalt per verzoek (bij het huidige verkeer ruim
// binnen de gratis laag). Het image blijft een gewone Next.js-server; de Lambda Web
// Adapter (in het image) vertaalt Lambda-aanroepen naar HTTP-verzoeken op poort 3000.
//
// Afscherming van de Function URL: CloudFront voegt een geheime header (X-Origin-Verify)
// toe; de app (proxy.js) weigert verzoeken zonder die header. Het hele pad is TLS.
//
// Caching (minder aanroepen en dataverkeer): statische Next.js-bestanden en
// productfoto's lang, paspoortpagina's (/p/*) 5 minuten aan de rand. Scans worden per
// weergave geteld via een beacon (POST, nooit gecachet). Zie docs/aws-cost-model.md.
class VeriPassoAppStack extends cdk.Stack {
  // Vaste AZ's voor alle constructs (geen context-lookup, dus synth zonder account).
  get availabilityZones() {
    return [`${this.region}a`, `${this.region}b`];
  }

  constructor(scope, id, props) {
    super(scope, id, props);
    const { config, webAclArn, drImagesBucketName, drDocumentsBucketName, drBackupVaultArn } = props;
    const name = (suffix) => `veripasso-${config.envName}-${suffix}`;

    // --- netwerk ----------------------------------------------------------------------
    // Vaste AZ's: geen lookup nodig, dus synthetiseren kan zonder AWS-account.
    const vpc = new ec2.Vpc(this, "Vpc", {
      availabilityZones: [`${config.region}a`, `${config.region}b`],
      natGateways: 0,
      subnetConfiguration: [
        { name: "public", subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: "data", subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 }
      ],
      gatewayEndpoints: { S3: { service: ec2.GatewayVpcEndpointAwsService.S3 } }
    });

    // De app (Lambda) draait in de geïsoleerde subnets en heeft geen internettoegang
    // nodig: S3 via het gateway-endpoint, de database binnen de VPC, logs via de
    // Lambda-dienst zelf.
    const appSg = new ec2.SecurityGroup(this, "LambdaSg", { vpc, description: "App (Lambda): alleen uitgaand", allowAllOutbound: true });
    const dbSg = new ec2.SecurityGroup(this, "DbSg", { vpc, description: "RDS: alleen van de app", allowAllOutbound: false });
    dbSg.addIngressRule(appSg, ec2.Port.tcp(5432), "App naar PostgreSQL");

    // --- geheimen ----------------------------------------------------------------------
    const appSecret = new secretsmanager.Secret(this, "AppSecret", {
      secretName: name("app"),
      description: "Applicatiegeheimen (COOKIE_SECRET). Waarde wordt door AWS gegenereerd.",
      generateSecretString: {
        secretStringTemplate: JSON.stringify({}),
        generateStringKey: "cookieSecret",
        passwordLength: 64,
        excludePunctuation: true
      },
      removalPolicy: cdk.RemovalPolicy.RETAIN
    });
    // Sleutel waarmee de app TOTP-geheimen (tweestapsverificatie) versleutelt.
    const mfaKeySecret = new secretsmanager.Secret(this, "MfaKeySecret", {
      secretName: name("mfa-key"),
      description: "Versleutelingssleutel voor MFA-geheimen (AES-256-GCM). Niet roteren zonder herversleuteling.",
      generateSecretString: { secretStringTemplate: JSON.stringify({}), generateStringKey: "value", passwordLength: 64, excludePunctuation: true },
      removalPolicy: cdk.RemovalPolicy.RETAIN
    });

    // Gedeeld geheim tussen CloudFront en de Function URL (zie proxy.js).
    const originVerifySecret = new secretsmanager.Secret(this, "OriginVerifySecret", {
      secretName: name("origin-verify"),
      description: "Gedeeld geheim CloudFront -> Lambda Function URL (X-Origin-Verify).",
      generateSecretString: { secretStringTemplate: JSON.stringify({}), generateStringKey: "value", passwordLength: 48, excludePunctuation: true },
      removalPolicy: cdk.RemovalPolicy.RETAIN
    });

    // Cloudflare vóór het QR-domein (config.cloudflareInFront): gedeeld geheim met de
    // Cloudflare Worker (Bearer-token voor /api/edge/sync) en de Transform Rule
    // (X-Edge-Verify, voor het echte bezoekers-IP). Zie docs/cloudflare.md.
    const edgeSecret = config.cloudflareInFront
      ? new secretsmanager.Secret(this, "EdgeSecret", {
          secretName: name("edge"),
          description: "Gedeeld geheim Cloudflare (Worker en Transform Rule) -> app.",
          generateSecretString: { secretStringTemplate: JSON.stringify({}), generateStringKey: "value", passwordLength: 48, excludePunctuation: true },
          removalPolicy: cdk.RemovalPolicy.RETAIN
        })
      : null;

    // --- database ----------------------------------------------------------------------
    const parameterGroup = new rds.ParameterGroup(this, "DbParams", {
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_17 }),
      parameters: {
        "rds.force_ssl": "1",
        "ssl_min_protocol_version": "TLSv1.2",
        shared_preload_libraries: "pg_stat_statements",
        log_min_duration_statement: "1000",
        idle_in_transaction_session_timeout: "300000"
      }
    });

    const db = new rds.DatabaseInstance(this, "Db", {
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_17 }),
      instanceType: new ec2.InstanceType(config.dbInstanceClass),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [dbSg],
      databaseName: "veripasso",
      credentials: rds.Credentials.fromGeneratedSecret("veripasso_admin", { secretName: name("db-admin") }),
      parameterGroup,
      allocatedStorage: config.dbAllocatedStorageGiB,
      maxAllocatedStorage: config.dbMaxAllocatedStorageGiB,
      storageType: rds.StorageType.GP3,
      storageEncrypted: true,
      multiAz: config.dbMultiAz,
      backupRetention: cdk.Duration.days(config.dbBackupRetentionDays),
      preferredBackupWindow: "01:00-02:00",
      preferredMaintenanceWindow: "sun:02:30-sun:03:30",
      deletionProtection: config.dbDeletionProtection,
      removalPolicy: cdk.RemovalPolicy.SNAPSHOT,
      copyTagsToSnapshot: true,
      autoMinorVersionUpgrade: true,
      cloudwatchLogsExports: ["postgresql"],
      cloudwatchLogsRetention: logs.RetentionDays.ONE_MONTH,
      enablePerformanceInsights: true,
      performanceInsightRetention: rds.PerformanceInsightRetention.DEFAULT,
      publiclyAccessible: false
    });
    if (config.enableDbSecretRotation) {
      // Let op: de app krijgt het wachtwoord als omgevingsvariabele (zie hieronder). Na
      // een rotatie is een nieuwe uitrol nodig; daarom staat rotatie standaard uit.
      // Rotatie via een Lambda in de VPC; die heeft een interface-endpoint naar
      // Secrets Manager nodig (extra kosten, zie kostenmodel). De app leest het
      // wachtwoord bij elke nieuwe verbinding opnieuw (src/config/db.js).
      vpc.addInterfaceEndpoint("SecretsManagerEndpoint", {
        service: ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
        subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED }
      });
      db.addRotationSingleUser({ automaticallyAfter: cdk.Duration.days(30) });
    }

    // --- bestandsopslag ---------------------------------------------------------------
    const corsOrigins = [`https://${config.appDomain}`];
    // Eén replicatierol voor beide buckets (anders maakt CDK twee rollen met dezelfde
    // vaste naam). Rechten worden hieronder per bron/doel expliciet en minimaal toegekend.
    const replicationRole = config.enableS3CrossRegionReplication
      ? new iam.Role(this, "S3ReplicationRole", {
          roleName: name("s3-replication"),
          assumedBy: new iam.ServicePrincipal("s3.amazonaws.com")
        })
      : null;
    const bucket = (logicalId, suffix, replicaBucketName) => {
      const replicationRules = replicaBucketName
        ? [
            {
              destination: s3.Bucket.fromBucketAttributes(this, `${logicalId}ReplicaRef`, {
                bucketName: replicaBucketName,
                region: config.drRegion
              }),
              priority: 1,
              deleteMarkerReplication: false
            }
          ]
        : undefined;
      const created = new s3.Bucket(this, logicalId, {
        bucketName: `veripasso-${config.envName}-${suffix}-${config.account}`,
        blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
        objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
        encryption: s3.BucketEncryption.S3_MANAGED,
        enforceSSL: true,
        minimumTLSVersion: 1.2,
        // Versioning: geen enkele versie gaat verloren, ook niet bij overschrijven of
        // verwijderen (EN 18221 §4.1/§4.2). De app overschrijft nooit en verwijdert
        // niet; versioning is het tweede slot.
        versioned: true,
        removalPolicy: cdk.RemovalPolicy.RETAIN,
        cors: [
          {
            allowedMethods: [s3.HttpMethods.POST],
            allowedOrigins: corsOrigins,
            allowedHeaders: ["*"],
            maxAge: 3000
          }
        ],
        lifecycleRules: [
          // Oude (vervangen) objectversies goedkoper opslaan; nooit automatisch weg.
          { noncurrentVersionTransitions: [{ storageClass: s3.StorageClass.GLACIER_INSTANT_RETRIEVAL, transitionAfter: cdk.Duration.days(90) }] },
          { abortIncompleteMultipartUploadAfter: cdk.Duration.days(7) },
          // Huidige objecten: S3 Intelligent-Tiering zet weinig opgevraagde bestanden
          // automatisch in goedkopere lagen, zonder ophaalkosten of vertraging.
          { transitions: [{ storageClass: s3.StorageClass.INTELLIGENT_TIERING, transitionAfter: cdk.Duration.days(0) }] }
        ],
        ...(replicationRules ? { replicationRules, replicationRole } : {})
      });
      if (replicationRules) {
        replicationRole.addToPrincipalPolicy(
          new iam.PolicyStatement({ actions: ["s3:GetReplicationConfiguration", "s3:ListBucket"], resources: [created.bucketArn] })
        );
        replicationRole.addToPrincipalPolicy(
          new iam.PolicyStatement({
            actions: ["s3:GetObjectVersionForReplication", "s3:GetObjectVersionAcl", "s3:GetObjectVersionTagging"],
            resources: [created.arnForObjects("*")]
          })
        );
        replicationRole.addToPrincipalPolicy(
          new iam.PolicyStatement({
            actions: ["s3:ReplicateObject", "s3:ReplicateTags"],
            resources: [`arn:aws:s3:::${replicaBucketName}/*`]
          })
        );
      }
      return created;
    };
    const imagesBucket = bucket("ImagesBucket", "images", config.enableS3CrossRegionReplication ? drImagesBucketName : null);
    const documentsBucket = bucket(
      "DocumentsBucket",
      "documents",
      config.enableS3CrossRegionReplication ? drDocumentsBucketName : null
    );

    // --- app (Lambda) -----------------------------------------------------------------
    // Het register staat in een eigen stack (registry-stack.js), zodat het image al
    // bestaat vóór deze stack de functie aanmaakt.
    const repository = ecr.Repository.fromRepositoryName(this, "Repository", name("app"));

    const logGroup = new logs.LogGroup(this, "AppLogs", {
      logGroupName: `/veripasso/${config.envName}/app`,
      retention: config.logRetentionDays,
      removalPolicy: cdk.RemovalPolicy.RETAIN
    });

    // Geheimen als omgevingsvariabelen via een CloudFormation-verwijzing naar Secrets
    // Manager (de waarde staat niet in de repo of het template). De functie heeft geen
    // internettoegang, dus geen Secrets Manager-aanroep tijdens het draaien (bespaart een
    // interface-endpoint). Zichtbaar voor wie lambda:GetFunctionConfiguration mag; zie
    // docs/aws-security-checklist.md.
    const secretEnv = (secret, key) => secret.secretValueFromJson(key).unsafeUnwrap();

    const fn = new lambda.DockerImageFunction(this, "App", {
      functionName: name("app"),
      description: "VeriPasso (Next.js + API) via de Lambda Web Adapter",
      code: lambda.DockerImageCode.fromEcr(repository, { tagOrDigest: config.imageTag }),
      architecture: config.cpuArchitecture === "ARM64" ? lambda.Architecture.ARM_64 : lambda.Architecture.X86_64,
      memorySize: config.lambdaMemoryMb,
      timeout: cdk.Duration.seconds(config.lambdaTimeoutSeconds),
      ...(config.lambdaReservedConcurrency ? { reservedConcurrentExecutions: config.lambdaReservedConcurrency } : {}),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [appSg],
      logGroup,
      environment: {
        // Lambda Web Adapter
        AWS_LWA_PORT: "3000",
        AWS_LWA_READINESS_CHECK_PATH: "/api/health",
        AWS_LWA_INVOKE_MODE: "response_stream",
        // Directe aanroepen (EventBridge, uitrol-workflow) gaan als POST naar dit pad.
        AWS_LWA_PASS_THROUGH_PATH: "/api/internal/events",
        INTERNAL_EVENTS_ENABLED: "true",
        NODE_ENV: "production",
        APP_ENV: config.envName,
        PORT: "3000",
        HOSTNAME: "127.0.0.1",
        INTERNAL_API_ORIGIN: "http://127.0.0.1:3000",
        // Echte bezoekers-IP uit CloudFront-Viewer-Address (rate limiting, audit).
        CLIENT_IP_FROM_CLOUDFRONT: "true",
        ORIGIN_VERIFY_SECRET: secretEnv(originVerifySecret, "value"),
        PUBLIC_MEDIA_FROM_CDN: "true",
        APP_BASE_URL: `https://${config.appDomain}`,
        QR_BASE_URL: `https://${config.qrDomain}`,
        DB_HOST: db.dbInstanceEndpointAddress,
        DB_PORT: db.dbInstanceEndpointPort,
        DB_NAME: "veripasso",
        DB_USER: "veripasso_admin",
        DB_PASSWORD: secretEnv(db.secret, "password"),
        // Weinig verbindingen per uitvoeringsomgeving: elke gelijktijdige aanroep heeft
        // een eigen omgeving (lambdaReservedConcurrency begrenst het totaal).
        DB_POOL_MAX: "2",
        DATABASE_MAX_BYTES: String(config.dbMaxAllocatedStorageGiB * 1024 * 1024 * 1024),
        S3_IMAGES_BUCKET: imagesBucket.bucketName,
        S3_DOCUMENTS_BUCKET: documentsBucket.bucketName,
        CONTAINER_MEMORY_MB: String(config.lambdaMemoryMb),
        COOKIE_SECRET: secretEnv(appSecret, "cookieSecret"),
        MFA_ENCRYPTION_KEY: secretEnv(mfaKeySecret, "value"),
        ...(edgeSecret ? { EDGE_SYNC_TOKEN: secretEnv(edgeSecret, "value") } : {})
      }
    });
    // Least privilege: alleen deze twee buckets lezen/schrijven (verwijderen alleen zoals
    // hieronder) en geen andere AWS-rechten.
    imagesBucket.grantRead(fn);
    imagesBucket.grantPut(fn);
    documentsBucket.grantRead(fn);
    documentsBucket.grantPut(fn);
    fn.addToRolePolicy(
      new iam.PolicyStatement({
        // Mislukte/afgekeurde directe uploads opruimen (verifyUploadedObject) mag
        // alleen voor objecten die nog niet aan een product gekoppeld zijn; S3-
        // versioning bewaart ook dan de vorige versie.
        actions: ["s3:DeleteObject"],
        resources: [imagesBucket.arnForObjects("products/*"), documentsBucket.arnForObjects("products/*")]
      })
    );
    fn.addToRolePolicy(new iam.PolicyStatement({ actions: ["s3:ListBucket"], resources: [imagesBucket.bucketArn, documentsBucket.bucketArn] }));

    // Alleen via CloudFront bruikbaar (geheime header, gecontroleerd in proxy.js).
    const functionUrl = fn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      invokeMode: lambda.InvokeMode.RESPONSE_STREAM
    });

    // Onderhoud elk uur (telemetrie, dagelijkse snapshot, opschonen, versies aanvullen);
    // vervangt de timers van het vroegere langlopende proces. Lease-lock in de database.
    new events.Rule(this, "Maintenance", {
      ruleName: name("maintenance"),
      description: "Uurlijks onderhoud van de app",
      schedule: events.Schedule.rate(cdk.Duration.hours(1)),
      targets: [new targets.LambdaFunction(fn, { retryAttempts: 1 })]
    });

    // --- CloudFront -------------------------------------------------------------------
    const origin = new origins.FunctionUrlOrigin(functionUrl, {
      customHeaders: { "X-Origin-Verify": secretEnv(originVerifySecret, "value") },
      originSslProtocols: [cloudfront.OriginSslPolicy.TLS_V1_2],
      readTimeout: cdk.Duration.seconds(60),
      keepaliveTimeout: cdk.Duration.seconds(30)
    });
    // Productfoto's rechtstreeks uit S3 (Origin Access Control: de bucket blijft privé,
    // alleen deze distributie mag lezen). Objectnamen zijn willekeurig en worden nooit
    // overschreven, dus mogen ze een jaar in browser en CDN blijven.
    const mediaOrigin = origins.S3BucketOrigin.withOriginAccessControl(imagesBucket, {
      originAccessLevels: [cloudfront.AccessLevel.READ]
    });
    const securityHeadersBehavior = {
      strictTransportSecurity: { accessControlMaxAge: cdk.Duration.days(730), includeSubdomains: true, override: true },
      contentTypeOptions: { override: true },
      frameOptions: { frameOption: cloudfront.HeadersFrameOption.DENY, override: true },
      referrerPolicy: { referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN, override: true }
    };
    const securityHeaders = new cloudfront.ResponseHeadersPolicy(this, "SecurityHeaders", {
      responseHeadersPolicyName: name("security-headers"),
      securityHeadersBehavior
    });
    // Zelfde beveiligingsheaders, plus een vaste Cache-Control voor de browser.
    const headersWithCache = (id, policyName, cacheControl) =>
      new cloudfront.ResponseHeadersPolicy(this, id, {
        responseHeadersPolicyName: name(policyName),
        securityHeadersBehavior,
        customHeadersBehavior: { customHeaders: [{ header: "Cache-Control", value: cacheControl, override: true }] }
      });
    const mediaHeaders = headersWithCache("MediaHeaders", "media-headers", "public, max-age=31536000, immutable");
    const passportHeaders = headersWithCache("PassportHeaders", "passport-headers", "public, max-age=60");

    // Paspoortpagina's: 5 minuten aan de rand (vast, ongeacht de headers van de app), in
    // de browser 1 minuut. De domeinrouter zet de Accept-header van browsers om naar
    // "text/html", zodat alle browsers dezelfde cache delen; systemen die JSON/JSON-LD/XML
    // vragen (content negotiation) krijgen een eigen cache-ingang.
    const passportCache = new cloudfront.CachePolicy(this, "PassportCache", {
      cachePolicyName: name("passport"),
      comment: "Publieke paspoorten: 5 minuten, sleutel op Accept",
      minTtl: cdk.Duration.minutes(5),
      defaultTtl: cdk.Duration.minutes(5),
      maxTtl: cdk.Duration.minutes(5),
      headerBehavior: cloudfront.CacheHeaderBehavior.allowList("Accept"),
      queryStringBehavior: cloudfront.CacheQueryStringBehavior.all(),
      cookieBehavior: cloudfront.CacheCookieBehavior.none(),
      enableAcceptEncodingGzip: true,
      enableAcceptEncodingBrotli: true
    });

    // Domeinverdeling (landingspagina / SaaS / QR) en afscherming van interne paden aan
    // de rand; zie domain-router.js.
    const allDomains = config.cloudFrontDomains || [config.appDomain, config.qrDomain];
    const siteDomains = allDomains.filter((d) => d !== config.appDomain && d !== config.qrDomain);
    const domainRouter = new cloudfront.Function(this, "DomainRouter", {
      functionName: name("domain-router"),
      comment: "Domeinverdeling: landingspagina, app en QR",
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      code: cloudfront.FunctionCode.fromInline(
        buildRouterCode({
          siteDomains,
          canonicalSiteDomain: config.siteDomain || siteDomains.find((d) => d.startsWith("www.")) || siteDomains[0] || null,
          appDomain: config.appDomain,
          qrDomain: config.qrDomain
        })
      )
    });
    const routed = { functionAssociations: [{ function: domainRouter, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST }] };
    const staticBehavior = {
      origin,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      responseHeadersPolicy: securityHeaders,
      compress: true,
      allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD
    };

    const distribution = new cloudfront.Distribution(this, "Cdn", {
      comment: name("cdn"),
      // Alle publieke domeinen; het certificaat (us-east-1) moet ze allemaal dekken.
      domainNames: allDomains,
      certificate: acm.Certificate.fromCertificateArn(this, "CdnCert", config.cloudFrontCertificateArn),
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      webAclId: config.enableWaf ? webAclArn : undefined,
      defaultBehavior: {
        origin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        // Alle headers, cookies en query's behalve Host (de Function URL heeft een eigen
        // hostnaam), plus CloudFront-Viewer-Address voor het echte bezoekers-IP.
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        responseHeadersPolicy: securityHeaders,
        compress: true,
        ...routed
      },
      additionalBehaviors: {
        "/_next/static/*": staticBehavior,
        "/brand/*": staticBehavior,
        "/products/*": {
          origin: mediaOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          responseHeadersPolicy: mediaHeaders,
          compress: true,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD
        },
        // Bedrijfslogo's: de app geeft max-age=86400 mee; CloudFront volgt die.
        "/api/public/products/*/logo": staticBehavior,
        // Met Cloudflare ervoor cachet alleen Cloudflare de paspoorten (één cache, die
        // de app na een wijziging laat verversen); CloudFront stuurt dan alles door,
        // anders zou Cloudflare na een purge nog een verouderde kopie van CloudFront halen.
        "/p/*": {
          origin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
          ...(config.cloudflareInFront
            ? { cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED, originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER }
            : { cachePolicy: passportCache }),
          responseHeadersPolicy: passportHeaders,
          compress: true,
          ...routed
        }
      }
    });

    // --- monitoring en alarmen ----------------------------------------------------------
    const alarmTopic = new sns.Topic(this, "Alarms", { topicName: name("alarms") });
    for (const address of config.alarmEmails) {
      alarmTopic.addSubscription(new subscriptions.EmailSubscription(address));
    }
    const alarmAction = new cwActions.SnsAction(alarmTopic);
    const alarm = (id, metric, threshold, description, comparisonOperator, evaluationPeriods = 3) => {
      const created = new cloudwatch.Alarm(this, id, {
        alarmName: name(id),
        metric,
        threshold,
        evaluationPeriods,
        comparisonOperator: comparisonOperator || cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        alarmDescription: description
      });
      created.addAlarmAction(alarmAction);
      created.addOkAction(alarmAction);
      return created;
    };
    const fiveMin = cdk.Duration.minutes(5);
    alarm("AppErrors", fn.metricErrors({ period: fiveMin, statistic: "Sum" }), 10, "Lambda-fouten (crashes/time-outs) van de app");
    alarm("AppThrottles", fn.metricThrottles({ period: fiveMin, statistic: "Sum" }), 5, "Lambda wordt afgeknepen (gelijktijdigheidslimiet)");
    alarm("AppDuration", fn.metricDuration({ period: fiveMin, statistic: "p95" }), 3000, "P95-verwerkingstijd > 3 s");
    alarm("DbCpu", db.metricCPUUtilization({ period: fiveMin }), 80, "Database-CPU > 80%");
    alarm("DbFreeStorage", db.metricFreeStorageSpace({ period: fiveMin }), 5 * 1024 * 1024 * 1024, "Minder dan 5 GB vrije databaseopslag", cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD);
    alarm("DbConnections", db.metricDatabaseConnections({ period: fiveMin }), 80, "Veel databaseverbindingen");

    // Applicatiefouten uit de gestructureerde logs (src/utils/logger.js).
    const logAlarm = (id, msg, threshold, description) => {
      const metricFilter = new logs.MetricFilter(this, `${id}Filter`, {
        logGroup,
        metricNamespace: `VeriPasso/${config.envName}`,
        metricName: id,
        filterPattern: logs.FilterPattern.stringValue("$.msg", "=", msg),
        metricValue: "1",
        defaultValue: 0
      });
      alarm(id, metricFilter.metric({ period: fiveMin, statistic: "Sum" }), threshold, description, undefined, 1);
    };
    logAlarm("PassportArchiveFailed", "passport_archive_failed", 1, "Paspoortversie kon niet worden gearchiveerd (compliance)");
    logAlarm("UnhandledErrors", "unhandled_error", 10, "Onverwachte serverfouten");
    logAlarm("DbPoolErrors", "db_pool_error", 5, "Databaseverbindingsfouten");

    // --- kostenbewaking -------------------------------------------------------------
    // Let op: AWS Budgets waarschuwt, maar begrenst de uitgaven NIET.
    new budgets.CfnBudget(this, "MonthlyBudget", {
      budget: {
        budgetName: name("monthly"),
        budgetType: "COST",
        timeUnit: "MONTHLY",
        budgetLimit: { amount: config.monthlyBudgetUsd, unit: "USD" }
      },
      notificationsWithSubscribers: [50, 80, 100].map((threshold) => ({
        notification: { notificationType: "ACTUAL", comparisonOperator: "GREATER_THAN", threshold, thresholdType: "PERCENTAGE" },
        subscribers: config.alarmEmails.map((address) => ({ subscriptionType: "EMAIL", address }))
      })).concat([
        {
          notification: { notificationType: "FORECASTED", comparisonOperator: "GREATER_THAN", threshold: 100, thresholdType: "PERCENTAGE" },
          subscribers: config.alarmEmails.map((address) => ({ subscriptionType: "EMAIL", address }))
        }
      ])
    });
    const anomalyMonitor = new ce.CfnAnomalyMonitor(this, "CostAnomalyMonitor", {
      monitorName: name("services"),
      monitorType: "DIMENSIONAL",
      monitorDimension: "SERVICE"
    });
    new ce.CfnAnomalySubscription(this, "CostAnomalySubscription", {
      subscriptionName: name("anomalies"),
      frequency: "DAILY",
      monitorArnList: [anomalyMonitor.attrMonitorArn],
      subscribers: config.alarmEmails.map((address) => ({ type: "EMAIL", address })),
      thresholdExpression: JSON.stringify({
        Dimensions: { Key: "ANOMALY_TOTAL_IMPACT_ABSOLUTE", MatchOptions: ["GREATER_THAN_OR_EQUAL"], Values: ["20"] }
      })
    });

    // --- back-ups -----------------------------------------------------------------------
    // RDS: automatische back-ups met point-in-time-recovery (dbBackupRetentionDays).
    // Daarnaast een AWS Backup-plan: maandelijkse back-up met lange bewaartermijn
    // (archivering) en optioneel een kopie naar de DR-regio.
    if (config.longTermBackupRetentionDays > 0 || drBackupVaultArn) {
      const vault = new backup.BackupVault(this, "Vault", { backupVaultName: name("vault"), removalPolicy: cdk.RemovalPolicy.RETAIN });
      const copyActions = drBackupVaultArn
        ? [{ destinationBackupVault: backup.BackupVault.fromBackupVaultArn(this, "DrVaultRef", drBackupVaultArn), deleteAfter: cdk.Duration.days(35) }]
        : undefined;
      const plan = new backup.BackupPlan(this, "BackupPlan", { backupPlanName: name("plan"), backupVault: vault });
      plan.addRule(
        new backup.BackupPlanRule({
          ruleName: "daily",
          scheduleExpression: events.Schedule.cron({ hour: "3", minute: "30" }),
          deleteAfter: cdk.Duration.days(35),
          copyActions
        })
      );
      if (config.longTermBackupRetentionDays > 0) {
        plan.addRule(
          new backup.BackupPlanRule({
            ruleName: "monthly-archive",
            scheduleExpression: events.Schedule.cron({ day: "1", hour: "4", minute: "0" }),
            // Geen cold storage: AWS Backup ondersteunt die overgang niet voor RDS.
            deleteAfter: cdk.Duration.days(config.longTermBackupRetentionDays)
          })
        );
      }
      plan.addSelection("Database", { resources: [backup.BackupResource.fromRdsDatabaseInstance(db)] });
    }

    // --- outputs ------------------------------------------------------------------------
    new cdk.CfnOutput(this, "CloudFrontDomain", { value: distribution.distributionDomainName, description: "CNAME-doel voor alle domeinen (DNS bij TransIP)" });

    new cdk.CfnOutput(this, "EcrRepositoryUri", { value: repository.repositoryUri });
    new cdk.CfnOutput(this, "FunctionName", { value: fn.functionName });
    new cdk.CfnOutput(this, "DistributionId", { value: distribution.distributionId });
    new cdk.CfnOutput(this, "DbEndpoint", { value: db.dbInstanceEndpointAddress });
    new cdk.CfnOutput(this, "DbSecretArn", { value: db.secret.secretArn });
    new cdk.CfnOutput(this, "ImagesBucketName", { value: imagesBucket.bucketName });
    new cdk.CfnOutput(this, "DocumentsBucketName", { value: documentsBucket.bucketName });
    new cdk.CfnOutput(this, "LogGroup", { value: logGroup.logGroupName });

    this.repository = repository;
    this.fn = fn;
  }
}

module.exports = { VeriPassoAppStack };
