const cdk = require("aws-cdk-lib");
const wafv2 = require("aws-cdk-lib/aws-wafv2");

// WAF voor CloudFront. Een web-ACL met scope CLOUDFRONT moet in us-east-1 staan;
// daarom een aparte stack. Regels:
// - AWS Managed Rules (Common, KnownBadInputs, IP-reputatie) tegen gangbare aanvallen;
// - rate-limit per IP op de publieke paspoort-endpoints (scraping/DDoS-demping);
// - strengere rate-limit op inloggen (credential stuffing).
// EN 18216 bijlage C (informatief) noemt rate limiting en DDoS-bescherming.
class VeriPassoEdgeStack extends cdk.Stack {
  constructor(scope, id, props) {
    super(scope, id, props);
    const { config } = props;

    const managed = (name, priority, vendorName = "AWS") => ({
      name,
      priority,
      overrideAction: { none: {} },
      statement: { managedRuleGroupStatement: { vendorName, name } },
      visibilityConfig: { cloudWatchMetricsEnabled: true, metricName: name, sampledRequestsEnabled: true }
    });

    const rateRule = (name, priority, limit, pathPrefix) => ({
      name,
      priority,
      action: { block: { customResponse: { responseCode: 429 } } },
      statement: {
        rateBasedStatement: {
          limit,
          evaluationWindowSec: 300,
          aggregateKeyType: "IP",
          scopeDownStatement: {
            byteMatchStatement: {
              fieldToMatch: { uriPath: {} },
              positionalConstraint: "STARTS_WITH",
              searchString: pathPrefix,
              textTransformations: [{ priority: 0, type: "LOWERCASE" }]
            }
          }
        }
      },
      visibilityConfig: { cloudWatchMetricsEnabled: true, metricName: name, sampledRequestsEnabled: true }
    });

    const webAcl = new wafv2.CfnWebACL(this, "WebAcl", {
      name: `veripasso-${config.envName}`,
      scope: "CLOUDFRONT",
      defaultAction: { allow: {} },
      visibilityConfig: { cloudWatchMetricsEnabled: true, metricName: `veripasso-${config.envName}`, sampledRequestsEnabled: true },
      rules: [
        managed("AWSManagedRulesAmazonIpReputationList", 0),
        // Common rule set: SizeRestrictions_BODY telt; uploads gaan via presigned S3-
        // POST rechtstreeks naar S3 en API-bodies zijn max. 1 MB / import 4 MB. Het
        // importpad wordt daarom van deze ene regel uitgezonderd.
        {
          ...managed("AWSManagedRulesCommonRuleSet", 1),
          statement: {
            managedRuleGroupStatement: {
              vendorName: "AWS",
              name: "AWSManagedRulesCommonRuleSet",
              ruleActionOverrides: [{ name: "SizeRestrictions_BODY", actionToUse: { count: {} } }]
            }
          }
        },
        managed("AWSManagedRulesKnownBadInputsRuleSet", 2),
        rateRule("RateLimitPassport", 10, config.publicRateLimitPer5Min, "/p/"),
        rateRule("RateLimitPublicApi", 11, config.publicRateLimitPer5Min, "/api/public/"),
        rateRule("RateLimitDppApi", 12, config.publicRateLimitPer5Min, "/api/dpp/"),
        rateRule("RateLimitLogin", 13, 100, "/api/auth/")
      ]
    });

    this.webAclArn = webAcl.attrArn;
    new cdk.CfnOutput(this, "WebAclArn", { value: webAcl.attrArn });
  }
}

module.exports = { VeriPassoEdgeStack };
