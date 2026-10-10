const cdk = require("aws-cdk-lib");
const ec2 = require("aws-cdk-lib/aws-ec2");
const ecs = require("aws-cdk-lib/aws-ecs");
const ecr = require("aws-cdk-lib/aws-ecr");
const elbv2 = require("aws-cdk-lib/aws-elasticloadbalancingv2");
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

// VeriPasso op AWS - één regio, eenvoudig en goedkoop te beginnen, schaalbaar:
//
//   bezoeker ─TLS1.2+/HTTP2-3─> CloudFront (+WAF) ─TLS1.2+, VPC origin (privé AWS-netwerk)─> interne ALB ─> ECS Fargate
//                                                                                                 ├─> RDS PostgreSQL 17 (privé subnet, TLS verplicht)
//                                                                                                 └─> S3 (privé buckets, presigned URL's)
//   De ALB is intern (geen publiek adres): alleen CloudFront bereikt hem, via een
//   CloudFront VPC origin. Ook dat laatste stuk is versleuteld (TLS, certificaat voor
//   originDomain in de regio van de app), zodat de hele route TLS heeft (EN 18216 §4).
//
// Bewuste kostenkeuzes: geen NAT-gateway (taken in publieke subnets met een publiek
// IP, maar inkomend alleen via de ALB-securitygroup), geen interface-endpoints, S3 via
// een gratis gateway-endpoint. Zie docs/aws-cost-model.md.
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

    // Interne ALB: alleen bereikbaar binnen de VPC. De CloudFront VPC origin maakt
    // netwerkinterfaces in de VPC aan; die verkeer komt dus uit het VPC-adresbereik.
    const albSg = new ec2.SecurityGroup(this, "AlbSg", { vpc, description: "Interne ALB: alleen CloudFront VPC origin", allowAllOutbound: true });
    albSg.addIngressRule(ec2.Peer.ipv4(vpc.vpcCidrBlock), ec2.Port.tcp(443), "CloudFront VPC origin (binnen de VPC)");
    const appSg = new ec2.SecurityGroup(this, "AppSg", { vpc, description: "ECS-taken: alleen van de ALB", allowAllOutbound: true });
    appSg.addIngressRule(albSg, ec2.Port.tcp(3000), "ALB naar app");
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
          { abortIncompleteMultipartUploadAfter: cdk.Duration.days(7) }
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

    // --- container --------------------------------------------------------------------
    // Het register staat in een eigen stack (registry-stack.js), zodat het image al
    // bestaat vóór deze stack de service start.
    const repository = ecr.Repository.fromRepositoryName(this, "Repository", name("app"));

    const cluster = new ecs.Cluster(this, "Cluster", {
      vpc,
      clusterName: name("cluster"),
      containerInsightsV2: config.containerInsights ? ecs.ContainerInsights.ENHANCED : ecs.ContainerInsights.DISABLED
    });

    const logGroup = new logs.LogGroup(this, "AppLogs", {
      logGroupName: `/veripasso/${config.envName}/app`,
      retention: config.logRetentionDays,
      removalPolicy: cdk.RemovalPolicy.RETAIN
    });

    const taskDefinition = new ecs.FargateTaskDefinition(this, "TaskDef", {
      family: name("app"),
      cpu: config.cpu,
      memoryLimitMiB: config.memoryMiB,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture[config.cpuArchitecture],
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX
      }
    });
    // Least privilege: de taak mag alleen deze twee buckets lezen/schrijven (geen
    // delete) en alleen het eigen database-geheim lezen.
    imagesBucket.grantRead(taskDefinition.taskRole);
    imagesBucket.grantPut(taskDefinition.taskRole);
    documentsBucket.grantRead(taskDefinition.taskRole);
    documentsBucket.grantPut(taskDefinition.taskRole);
    taskDefinition.taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        // Mislukte/afgekeurde directe uploads opruimen (verifyUploadedObject) mag
        // alleen voor objecten die nog niet aan een product gekoppeld zijn; S3-
        // versioning bewaart ook dan de vorige versie.
        actions: ["s3:DeleteObject"],
        resources: [imagesBucket.arnForObjects("products/*"), documentsBucket.arnForObjects("products/*")]
      })
    );
    taskDefinition.taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({ actions: ["s3:ListBucket"], resources: [imagesBucket.bucketArn, documentsBucket.bucketArn] })
    );
    db.secret.grantRead(taskDefinition.taskRole);

    const container = taskDefinition.addContainer("app", {
      containerName: "app",
      image: ecs.ContainerImage.fromEcrRepository(repository, config.imageTag),
      logging: ecs.LogDrivers.awsLogs({ logGroup, streamPrefix: "app" }),
      environment: {
        NODE_ENV: "production",
        APP_ENV: config.envName,
        AWS_REGION: config.region,
        PORT: "3000",
        HOSTNAME: "0.0.0.0",
        TRUST_PROXY_HOPS: "2",
        INTERNAL_API_ORIGIN: "http://127.0.0.1:3000",
        APP_BASE_URL: `https://${config.appDomain}`,
        QR_BASE_URL: `https://${config.qrDomain}`,
        DB_HOST: db.dbInstanceEndpointAddress,
        DB_PORT: db.dbInstanceEndpointPort,
        DB_NAME: "veripasso",
        DB_USER: "veripasso_admin",
        DB_SECRET_ARN: db.secret.secretArn,
        DB_POOL_MAX: "10",
        DATABASE_MAX_BYTES: String(config.dbMaxAllocatedStorageGiB * 1024 * 1024 * 1024),
        S3_IMAGES_BUCKET: imagesBucket.bucketName,
        S3_DOCUMENTS_BUCKET: documentsBucket.bucketName,
        CONTAINER_MEMORY_MB: String(config.memoryMiB)
      },
      secrets: {
        COOKIE_SECRET: ecs.Secret.fromSecretsManager(appSecret, "cookieSecret"),
        MFA_ENCRYPTION_KEY: ecs.Secret.fromSecretsManager(mfaKeySecret, "value")
      },
      portMappings: [{ containerPort: 3000 }],
      healthCheck: {
        command: [
          "CMD",
          "node",
          "-e",
          "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
        ],
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        retries: 3,
        startPeriod: cdk.Duration.seconds(60)
      },
      stopTimeout: cdk.Duration.seconds(30),
      readonlyRootFilesystem: false
    });

    const service = new ecs.FargateService(this, "Service", {
      cluster,
      serviceName: name("app"),
      taskDefinition,
      desiredCount: config.desiredCount,
      assignPublicIp: true,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroups: [appSg],
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
      circuitBreaker: { enable: true, rollback: true },
      healthCheckGracePeriod: cdk.Duration.seconds(90),
      enableExecuteCommand: false
    });

    const scaling = service.autoScaleTaskCount({ minCapacity: config.minTasks, maxCapacity: config.maxTasks });
    scaling.scaleOnCpuUtilization("Cpu", { targetUtilizationPercent: 60 });
    scaling.scaleOnMemoryUtilization("Memory", { targetUtilizationPercent: 75 });

    // --- load balancer ----------------------------------------------------------------
    const alb = new elbv2.ApplicationLoadBalancer(this, "Alb", {
      vpc,
      internetFacing: false,
      securityGroup: albSg,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      idleTimeout: cdk.Duration.seconds(120),
      dropInvalidHeaderFields: true,
      http2Enabled: true
    });
    const originCertificate = acm.Certificate.fromCertificateArn(this, "OriginCert", config.originCertificateArn);
    const listener = alb.addListener("Https", {
      port: 443,
      protocol: elbv2.ApplicationProtocol.HTTPS,
      certificates: [originCertificate],
      sslPolicy: elbv2.SslPolicy.RECOMMENDED_TLS,
      open: false,
      defaultAction: elbv2.ListenerAction.fixedResponse(404, { contentType: "text/plain", messageBody: "Not found" })
    });
    const targetGroup = new elbv2.ApplicationTargetGroup(this, "Targets", {
      vpc,
      port: 3000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      targets: [service],
      deregistrationDelay: cdk.Duration.seconds(30),
      healthCheck: { path: "/api/health", healthyHttpCodes: "200", interval: cdk.Duration.seconds(15), healthyThresholdCount: 2 }
    });
    listener.addAction("App", {
      priority: 10,
      conditions: [elbv2.ListenerCondition.pathPatterns(["/*"])],
      action: elbv2.ListenerAction.forward([targetGroup])
    });
    scaling.scaleOnRequestCount("Requests", { requestsPerTarget: 600, targetGroup });

    // --- CloudFront -------------------------------------------------------------------
    // Geen caching van dynamische pagina's en API's: paspoorten zijn altijd actueel en
    // elke scan wordt geteld (de app cachet zelf waar het veilig is). Wel caching van
    // de onveranderlijke Next.js-assets.
    const origin = origins.VpcOrigin.withApplicationLoadBalancer(alb, {
      vpcOriginName: name("alb"),
      // CloudFront controleert het ALB-certificaat tegen deze naam (SNI). Er is geen
      // publiek DNS-record nodig: het verkeer gaat via de VPC origin, niet via DNS.
      domainName: config.originDomain,
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
      httpsPort: 443,
      originSslProtocols: [cloudfront.OriginSslPolicy.TLS_V1_2],
      readTimeout: cdk.Duration.seconds(60),
      keepaliveTimeout: cdk.Duration.seconds(30)
    });
    const staticBehavior = {
      origin,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      compress: true,
      allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD
    };
    const securityHeaders = new cloudfront.ResponseHeadersPolicy(this, "SecurityHeaders", {
      responseHeadersPolicyName: name("security-headers"),
      securityHeadersBehavior: {
        strictTransportSecurity: { accessControlMaxAge: cdk.Duration.days(730), includeSubdomains: true, override: true },
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: cloudfront.HeadersFrameOption.DENY, override: true },
        referrerPolicy: { referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN, override: true }
      }
    });
    const distribution = new cloudfront.Distribution(this, "Cdn", {
      comment: name("cdn"),
      // Alle publieke domeinen; het certificaat (us-east-1) moet ze allemaal dekken.
      domainNames: config.cloudFrontDomains || [config.appDomain, config.qrDomain],
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
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        responseHeadersPolicy: securityHeaders,
        compress: true
      },
      additionalBehaviors: {
        "/_next/static/*": { ...staticBehavior, responseHeadersPolicy: securityHeaders },
        "/brand/*": { ...staticBehavior, responseHeadersPolicy: securityHeaders }
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
    alarm("Alb5xx", alb.metrics.httpCodeTarget(elbv2.HttpCodeTarget.TARGET_5XX_COUNT, { period: fiveMin, statistic: "Sum" }), 20, "Veel 5xx-fouten van de app");
    alarm("UnhealthyTargets", targetGroup.metrics.unhealthyHostCount({ period: cdk.Duration.minutes(1), statistic: "Maximum" }), 1, "Er is een ongezonde app-taak", undefined, 5);
    alarm("TargetLatency", targetGroup.metrics.targetResponseTime({ period: fiveMin, statistic: "p95" }), 2, "P95-responstijd > 2 s");
    alarm("DbCpu", db.metricCPUUtilization({ period: fiveMin }), 80, "Database-CPU > 80%");
    alarm("DbFreeStorage", db.metricFreeStorageSpace({ period: fiveMin }), 5 * 1024 * 1024 * 1024, "Minder dan 5 GB vrije databaseopslag", cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD);
    alarm("DbConnections", db.metricDatabaseConnections({ period: fiveMin }), 80, "Veel databaseverbindingen");
    alarm("ServiceCpu", service.metricCpuUtilization({ period: fiveMin }), 85, "App-CPU > 85%");

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
    new cdk.CfnOutput(this, "CloudFrontDomain", { value: distribution.distributionDomainName, description: "CNAME-doel voor app- en QR-domein (DNS bij TransIP)" });

    new cdk.CfnOutput(this, "AlbDnsName", {
      value: alb.loadBalancerDnsName,
      description: "Intern adres van de load balancer: CNAME-doel voor originDomain bij TransIP (privé-IP's, van buitenaf onbereikbaar)"
    });
    new cdk.CfnOutput(this, "EcrRepositoryUri", { value: repository.repositoryUri });
    new cdk.CfnOutput(this, "ClusterName", { value: cluster.clusterName });
    new cdk.CfnOutput(this, "ServiceName", { value: service.serviceName });
    new cdk.CfnOutput(this, "TaskDefinitionFamily", { value: taskDefinition.family });
    new cdk.CfnOutput(this, "AppSubnets", { value: vpc.publicSubnets.map((s) => s.subnetId).join(",") });
    new cdk.CfnOutput(this, "AppSecurityGroup", { value: appSg.securityGroupId });
    new cdk.CfnOutput(this, "DbEndpoint", { value: db.dbInstanceEndpointAddress });
    new cdk.CfnOutput(this, "DbSecretArn", { value: db.secret.secretArn });
    new cdk.CfnOutput(this, "ImagesBucketName", { value: imagesBucket.bucketName });
    new cdk.CfnOutput(this, "DocumentsBucketName", { value: documentsBucket.bucketName });
    new cdk.CfnOutput(this, "LogGroup", { value: logGroup.logGroupName });

    this.repository = repository;
    this.service = service;
    this.container = container;
  }
}

module.exports = { VeriPassoAppStack };
