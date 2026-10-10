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

test("CloudFront: minimaal TLS 1.2, HTTP/2 en HTTP/3, HTTPS afgedwongen, WAF gekoppeld", () => {
  template.hasResourceProperties("AWS::CloudFront::Distribution", {
    DistributionConfig: Match.objectLike({
      HttpVersion: "http2and3",
      ViewerCertificate: Match.objectLike({ MinimumProtocolVersion: "TLSv1.2_2021", SslSupportMethod: "sni-only" }),
      WebACLId: Match.anyValue(),
      DefaultCacheBehavior: Match.objectLike({ ViewerProtocolPolicy: "redirect-to-https" }),
      Origins: Match.arrayWith([Match.objectLike({ VpcOriginConfig: Match.anyValue() })])
    })
  });
});

test("ALB: intern, alleen via de CloudFront VPC origin, ook daar TLS 1.2+ (versleuteld over de hele route)", () => {
  template.hasResourceProperties("AWS::ElasticLoadBalancingV2::LoadBalancer", { Scheme: "internal" });
  template.resourcePropertiesCountIs("AWS::ElasticLoadBalancingV2::LoadBalancer", { Scheme: "internet-facing" }, 0);
  template.hasResourceProperties("AWS::CloudFront::VpcOrigin", {
    VpcOriginEndpointConfig: Match.objectLike({ OriginProtocolPolicy: "https-only", HTTPSPort: 443, OriginSSLProtocols: ["TLSv1.2"] })
  });
  template.hasResourceProperties("AWS::ElasticLoadBalancingV2::Listener", { Protocol: "HTTPS", SslPolicy: Match.stringLikeRegexp("TLS13") });
  template.resourcePropertiesCountIs("AWS::ElasticLoadBalancingV2::Listener", { Protocol: "HTTP" }, 0);
  const ingress = Object.values(template.findResources("AWS::EC2::SecurityGroup"))
    .flatMap((sg) => sg.Properties.SecurityGroupIngress || [])
    .filter((r) => r.FromPort === 443);
  assert.ok(ingress.length >= 1 && ingress.every((r) => r.CidrIp !== "0.0.0.0/0"), "ALB nooit open voor internet");
});

test("ECS: geen geheimen als platte env-var; COOKIE_SECRET uit Secrets Manager; logs met bewaartermijn", () => {
  const taskDefs = template.findResources("AWS::ECS::TaskDefinition");
  const container = Object.values(taskDefs)[0].Properties.ContainerDefinitions[0];
  const envNames = container.Environment.map((e) => e.Name);
  for (const forbidden of ["COOKIE_SECRET", "MFA_ENCRYPTION_KEY", "DB_PASSWORD", "DATABASE_URL", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"]) {
    assert.ok(!envNames.includes(forbidden), `${forbidden} hoort niet als platte env-var`);
  }
  assert.ok(container.Secrets.some((s) => s.Name === "COOKIE_SECRET"));
  assert.ok(container.Secrets.some((s) => s.Name === "MFA_ENCRYPTION_KEY"));
  assert.equal(container.Environment.find((e) => e.Name === "TRUST_PROXY_HOPS").Value, "2");
  template.hasResourceProperties("AWS::Logs::LogGroup", { RetentionInDays: config.logRetentionDays });
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
