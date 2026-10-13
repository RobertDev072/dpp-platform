const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const cdk = require("aws-cdk-lib");
const { Template, Match } = require("aws-cdk-lib/assertions");
const { VeriPassoAppStack } = require("../lib/app-stack");
const { VeriPassoEdgeStack } = require("../lib/edge-stack");
const { validateConfig } = require("../lib/config");

// Controleert de beveiligings- en compliance-eigenschappen van de gegenereerde
// CloudFormation, zonder AWS-account en zonder iets aan te maken.

function loadConfig(env) {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "config", `${env}.json`), "utf8"));
  return validateConfig({ ...raw, alarmEmails: ["alarm-test@example.com"] });
}

function synthApp(env) {
  const config = loadConfig(env);
  const app = new cdk.App();
  const stack = new VeriPassoAppStack(app, `Test-${env}`, {
    env: { account: config.account, region: config.region },
    config: { ...config, enableS3CrossRegionReplication: false, enableAwsBackupCopy: false },
    webAclArn: "arn:aws:wafv2:us-east-1:000000000000:global/webacl/test/abc"
  });
  return { template: Template.fromStack(stack), config };
}

const { template, config } = synthApp("production");

test("S3: alle buckets privé, versleuteld, versioning aan, alleen TLS 1.2+, nooit automatisch verwijderd", () => {
  const buckets = template.findResources("AWS::S3::Bucket");
  assert.ok(Object.keys(buckets).length >= 2);
  for (const [id, bucket] of Object.entries(buckets)) {
    const p = bucket.Properties;
    assert.deepEqual(
      p.PublicAccessBlockConfiguration,
      { BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true },
      `${id}: Block Public Access`
    );
    assert.equal(p.VersioningConfiguration?.Status, "Enabled", `${id}: versioning`);
    assert.ok(p.BucketEncryption, `${id}: encryptie`);
    assert.equal(bucket.DeletionPolicy, "Retain", `${id}: RETAIN`);
    const rules = p.LifecycleConfiguration?.Rules || [];
    assert.ok(!rules.some((r) => r.ExpirationInDays || r.NoncurrentVersionExpiration), `${id}: geen automatische verwijdering`);
  }
  template.hasResourceProperties("AWS::S3::BucketPolicy", {
    PolicyDocument: Match.objectLike({
      Statement: Match.arrayWith([
        Match.objectLike({ Effect: "Deny", Condition: Match.objectLike({ Bool: { "aws:SecureTransport": "false" } }) }),
        Match.objectLike({ Effect: "Deny", Condition: Match.objectLike({ NumericLessThan: { "s3:TlsVersion": 1.2 } }) })
      ])
    })
  });
});

test("RDS: PostgreSQL 17, versleuteld, niet publiek, TLS verplicht, back-ups en deletion protection", () => {
  template.hasResourceProperties("AWS::RDS::DBInstance", {
    Engine: "postgres",
    StorageEncrypted: true,
    PubliclyAccessible: false,
    DeletionProtection: true,
    MultiAZ: config.dbMultiAz,
    BackupRetentionPeriod: config.dbBackupRetentionDays
  });
  template.hasResourceProperties("AWS::RDS::DBParameterGroup", {
    Parameters: Match.objectLike({ "rds.force_ssl": "1", ssl_min_protocol_version: "TLSv1.2" })
  });
});

test("Netwerk: geen NAT-gateway; database alleen bereikbaar vanuit de app", () => {
  template.resourceCountIs("AWS::EC2::NatGateway", 0);
  const ingress = template.findResources("AWS::EC2::SecurityGroupIngress");
  const dbIngress = Object.values(ingress).filter((r) => r.Properties.FromPort === 5432);
  assert.equal(dbIngress.length, 1);
  assert.ok(dbIngress[0].Properties.SourceSecurityGroupId, "5432 alleen vanaf een securitygroup, nooit vanaf een CIDR");
});

test("CloudFront: minimaal TLS 1.2, HTTP/2 en HTTP/3, HTTPS afgedwongen, WAF gekoppeld (als aan)", () => {
  template.hasResourceProperties("AWS::CloudFront::Distribution", {
    DistributionConfig: Match.objectLike({
      HttpVersion: "http2and3",
      ViewerCertificate: Match.objectLike({ MinimumProtocolVersion: "TLSv1.2_2021", SslSupportMethod: "sni-only" }),
      // Firewall gekoppeld zodra die in de config aan staat (tijdens ontwikkeling mag hij uit).
      ...(config.enableWaf ? { WebACLId: Match.anyValue() } : {}),
      DefaultCacheBehavior: Match.objectLike({ ViewerProtocolPolicy: "redirect-to-https" })
    })
  });
});

const appFunction = () =>
  Object.values(template.findResources("AWS::Lambda::Function")).find((r) => r.Properties.PackageType === "Image").Properties;
const distributionConfig = () => Object.values(template.findResources("AWS::CloudFront::Distribution"))[0].Properties.DistributionConfig;

test("App op Lambda: geen ECS/load balancer; Function URL alleen via CloudFront (geheime header, TLS 1.2+)", () => {
  template.resourceCountIs("AWS::ECS::Service", 0);
  template.resourceCountIs("AWS::ElasticLoadBalancingV2::LoadBalancer", 0);
  template.resourceCountIs("AWS::EC2::EIP", 0);
  const fn = appFunction();
  assert.ok(fn.VpcConfig, "in de VPC (database privé)");
  assert.equal(fn.Environment.Variables.AWS_LWA_PASS_THROUGH_PATH, "/api/internal/events");
  template.hasResourceProperties("AWS::Lambda::Url", { InvokeMode: "RESPONSE_STREAM" });

  const origin = distributionConfig().Origins.find((o) => o.OriginCustomHeaders);
  const header = origin.OriginCustomHeaders.find((h) => h.HeaderName === "X-Origin-Verify");
  assert.match(JSON.stringify(header.HeaderValue), /resolve:secretsmanager/, "geheim uit Secrets Manager, niet in de code");
  assert.equal(origin.CustomOriginConfig.OriginProtocolPolicy, "https-only");
  assert.deepEqual(origin.CustomOriginConfig.OriginSSLProtocols, ["TLSv1.2"]);
  assert.equal(
    JSON.stringify(fn.Environment.Variables.ORIGIN_VERIFY_SECRET),
    JSON.stringify(header.HeaderValue),
    "app en CloudFront gebruiken hetzelfde geheim"
  );
  template.hasResourceProperties("AWS::Events::Rule", { ScheduleExpression: "rate(1 hour)" });
});

test("Geheimen: nooit als platte waarde in het template; logs met bewaartermijn", () => {
  const env = appFunction().Environment.Variables;
  for (const secret of ["COOKIE_SECRET", "MFA_ENCRYPTION_KEY", "DB_PASSWORD", "ORIGIN_VERIFY_SECRET"]) {
    assert.match(JSON.stringify(env[secret]), /\{\{resolve:secretsmanager:/, `${secret} via Secrets Manager-verwijzing`);
  }
  for (const forbidden of ["DATABASE_URL", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"]) {
    assert.ok(!(forbidden in env), `${forbidden} hoort niet in de omgeving`);
  }
  template.hasResourceProperties("AWS::Logs::LogGroup", { RetentionInDays: config.logRetentionDays });
});

test("Caching: paspoorten 5 min (sleutel op Accept, geen cookies), foto's via OAC lang, interne paden nooit gecachet", () => {
  const behaviors = Object.fromEntries(distributionConfig().CacheBehaviors.map((b) => [b.PathPattern, b]));
  for (const p of ["/_next/static/*", "/products/*", "/p/*", "/api/public/products/*/logo"]) assert.ok(behaviors[p], `gedrag voor ${p}`);
  assert.deepEqual(behaviors["/p/*"].AllowedMethods, ["GET", "HEAD"]);

  template.hasResourceProperties("AWS::CloudFront::CachePolicy", {
    CachePolicyConfig: Match.objectLike({
      MinTTL: 300,
      DefaultTTL: 300,
      MaxTTL: 300,
      ParametersInCacheKeyAndForwardedToOrigin: Match.objectLike({
        HeadersConfig: { HeaderBehavior: "whitelist", Headers: ["Accept"] },
        CookiesConfig: { CookieBehavior: "none" }
      })
    })
  });
  template.resourceCountIs("AWS::CloudFront::OriginAccessControl", 1);
  const mediaOrigin = distributionConfig().Origins.find((o) => o.OriginAccessControlId);
  assert.ok(mediaOrigin, "fotobucket via Origin Access Control (bucket blijft privé)");
  template.hasResourceProperties("AWS::CloudFront::ResponseHeadersPolicy", {
    ResponseHeadersPolicyConfig: Match.objectLike({
      CustomHeadersConfig: { Items: [{ Header: "Cache-Control", Value: "public, max-age=31536000, immutable", Override: true }] }
    })
  });
  // Standaardgedrag (API, inloggen, beheer): nooit cachen.
  assert.equal(distributionConfig().DefaultCacheBehavior.CachePolicyId, "4135ea2d-6df8-44a3-9df3-4b5a84be39ad");
});

test("Cloudflare vóór het QR-domein: één paspoortcache (Cloudflare), gedeeld geheim via Secrets Manager", () => {
  const CACHING_DISABLED = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad";
  const ALL_VIEWER_EXCEPT_HOST = "b689b0a8-53d0-40ab-baf2-68738e2966ac";
  const passportBehavior = (cfg) => Object.fromEntries(cfg.CacheBehaviors.map((b) => [b.PathPattern, b]))["/p/*"];

  // Met Cloudflare (productie): CloudFront cachet /p/* niet en stuurt Accept door.
  assert.equal(config.cloudflareInFront, true);
  const withCf = passportBehavior(distributionConfig());
  assert.equal(withCf.CachePolicyId, CACHING_DISABLED);
  assert.equal(withCf.OriginRequestPolicyId, ALL_VIEWER_EXCEPT_HOST);
  assert.ok(withCf.FunctionAssociations, "domeinrouter (Accept-normalisatie) blijft actief");
  assert.match(JSON.stringify(appFunction().Environment.Variables.EDGE_SYNC_TOKEN), /\{\{resolve:secretsmanager:/);
  template.hasResourceProperties("AWS::SecretsManager::Secret", { Name: "veripasso-production-edge" });

  // Zonder Cloudflare (staging): CloudFront cachet zelf 5 minuten, geen edge-geheim.
  const staging = synthApp("staging");
  assert.ok(!staging.config.cloudflareInFront);
  const stagingDist = Object.values(staging.template.findResources("AWS::CloudFront::Distribution"))[0].Properties.DistributionConfig;
  assert.notEqual(passportBehavior(stagingDist).CachePolicyId, CACHING_DISABLED);
  const stagingEnv = Object.values(staging.template.findResources("AWS::Lambda::Function")).find((r) => r.Properties.PackageType === "Image").Properties.Environment.Variables;
  assert.ok(!("EDGE_SYNC_TOKEN" in stagingEnv));
  assert.throws(() => validateConfig({ ...staging.config, cloudflareInFront: "ja" }), /cloudflareInFront/);
});

test("S3: Intelligent-Tiering voor huidige objecten", () => {
  for (const bucket of Object.values(template.findResources("AWS::S3::Bucket"))) {
    const rules = bucket.Properties.LifecycleConfiguration.Rules;
    assert.ok(rules.some((r) => (r.Transitions || []).some((t) => t.StorageClass === "INTELLIGENT_TIERING")));
  }
});

test("IAM: de app-rol mag niets verwijderen buiten products/* en heeft geen wildcard-rechten", () => {
  const policies = template.findResources("AWS::IAM::Policy");
  for (const policy of Object.values(policies)) {
    for (const statement of policy.Properties.PolicyDocument.Statement) {
      const actions = [].concat(statement.Action);
      assert.ok(!actions.includes("*") && !actions.includes("s3:*"), "geen wildcard-acties");
      if (actions.includes("s3:DeleteObject")) {
        const resources = JSON.stringify(statement.Resource);
        assert.ok(resources.includes("/products/*"), "DeleteObject alleen op products/*");
      }
    }
  }
});

test("Kosten en alarmen: budget met e-mailmelding, kostenanomalie-detectie, compliance-alarm", () => {
  template.hasResourceProperties("AWS::Budgets::Budget", {
    Budget: Match.objectLike({ BudgetLimit: { Amount: config.monthlyBudgetUsd, Unit: "USD" }, TimeUnit: "MONTHLY" })
  });
  template.resourceCountIs("AWS::CE::AnomalyMonitor", 1);
  template.hasResourceProperties("AWS::Logs::MetricFilter", { FilterPattern: Match.stringLikeRegexp("passport_archive_failed") });
});

test("Back-up: lange bewaartermijn (archivering) als die is ingesteld", { skip: !(config.longTermBackupRetentionDays > 0) && "longTermBackupRetentionDays staat op 0 in deze config" }, () => {
  template.hasResourceProperties("AWS::Backup::BackupPlan", {
    BackupPlan: Match.objectLike({
      BackupPlanRule: Match.arrayWith([Match.objectLike({ RuleName: "monthly-archive", Lifecycle: Match.objectLike({ DeleteAfterDays: config.longTermBackupRetentionDays }) })])
    })
  });
});

test("WAF: managed rules en rate limits op paspoort-, API- en loginpaden", () => {
  const app = new cdk.App();
  const edge = new VeriPassoEdgeStack(app, "TestEdge", { env: { account: config.account, region: "us-east-1" }, config });
  const t = Template.fromStack(edge);
  t.hasResourceProperties("AWS::WAFv2::WebACL", {
    Scope: "CLOUDFRONT",
    Rules: Match.arrayWith([
      Match.objectLike({ Name: "AWSManagedRulesCommonRuleSet" }),
      Match.objectLike({ Name: "RateLimitPassport" }),
      Match.objectLike({ Name: "RateLimitLogin" })
    ])
  });
});

test("Config-validatie: ontbrekende of ongeldige waarden stoppen de synth", () => {
  const good = loadConfig("staging");
  assert.throws(() => validateConfig({ ...good, account: "123" }), /12 cijfers/);
  assert.throws(() => validateConfig({ ...good, cloudFrontCertificateArn: "arn:aws:acm:eu-west-1:000000000000:certificate/x" }), /us-east-1/);
  assert.throws(() => validateConfig({ ...good, cloudFrontDomains: ["app.example.com"] }), /qrDomain/);
  assert.throws(() => validateConfig({ ...good, alarmEmails: [] }), /alarmEmails/);
  assert.throws(() => validateConfig({ ...good, envName: "production", dbDeletionProtection: false }), /dbDeletionProtection/);
});

test("Domeinverdeling: CloudFront Function op het standaardgedrag (landingspagina / app / QR)", () => {
  const { buildRouterCode } = require("../lib/domain-router");
  const code = buildRouterCode({
    siteDomains: ["veripasso.com", "www.veripasso.com"],
    canonicalSiteDomain: "www.veripasso.com",
    appDomain: "app.veripasso.com",
    qrDomain: "qr.veripasso.com"
  });
  const handler = new Function(`${code}; return handler;`)();
  const route = (host, uri) => {
    const r = handler({ request: { headers: { host: { value: host } }, uri, querystring: {} } });
    return r.statusCode ? `${r.statusCode} ${r.headers.location.value}` : "pass";
  };
  assert.equal(route("veripasso.com", "/"), "301 https://www.veripasso.com/");
  assert.equal(route("www.veripasso.com", "/"), "pass");
  assert.equal(route("www.veripasso.com", "/login"), "302 https://app.veripasso.com/login");
  assert.equal(route("app.veripasso.com", "/"), "302 https://app.veripasso.com/login");
  assert.equal(route("app.veripasso.com", "/p/X"), "301 https://qr.veripasso.com/p/X");
  assert.equal(route("qr.veripasso.com", "/p/X"), "pass", "gedrukte QR-codes blijven werken");
  assert.equal(route("qr.veripasso.com", "/api/dpp/X"), "pass");
  assert.equal(route("qr.veripasso.com", "/products/1/a.jpg.w800.webp"), "pass", "productfoto's op elk domein");
  for (const host of ["qr.veripasso.com", "app.veripasso.com", "www.veripasso.com"]) {
    assert.equal(handler({ request: { headers: { host: { value: host } }, uri: "/api/internal/events", querystring: {} } }).statusCode, 404);
  }

  // Accept-normalisatie voor de paspoortcache.
  const accept = (value) => {
    const request = { headers: { host: { value: "qr.veripasso.com" }, accept: { value } }, uri: "/p/X", querystring: {} };
    return handler({ request }).headers.accept.value;
  };
  assert.equal(accept("text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"), "text/html", "browser");
  assert.equal(accept("*/*"), "text/html");
  assert.equal(accept("application/ld+json"), "application/ld+json", "systeem behoudt eigen Accept");
  assert.equal(accept("application/json"), "application/json");
  if ((config.cloudFrontDomains || []).includes("www.veripasso.com")) {
    template.resourceCountIs("AWS::CloudFront::Function", 1);
  }
});
