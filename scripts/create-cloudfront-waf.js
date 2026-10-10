// Maakt (of vindt) de CloudFront-WAF (scope CLOUDFRONT, us-east-1) rechtstreeks via de
// AWS-API, met exact dezelfde regels als infra/lib/edge-stack.js. Bedoeld voor accounts
// waar een organisatiebeleid CloudFormation in us-east-1 verbiedt maar WAF wel toestaat.
// Daarna de uitgevoerde ARN als "webAclArn" in infra/config/<env>.json zetten; de
// Edge-stack wordt dan overgeslagen.
//
//   node scripts/create-cloudfront-waf.js production
//
// Vereist AWS-inloggegevens (bijv. `aws login`) en het synthetiseerde Edge-template:
//   cd infra && npx cdk synth VeriPasso-<env>-Edge -c env=<env> -c alarmEmails=...
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const envName = process.argv[2] || "production";
const awsCli = process.env.AWS_CLI || "aws";
const templateFile = path.join(__dirname, "..", "infra", "cdk.out", `VeriPasso-${envName}-Edge.template.json`);
const template = JSON.parse(fs.readFileSync(templateFile, "utf8"));
const acl = Object.values(template.Resources).find((r) => r.Type === "AWS::WAFv2::WebACL").Properties;

function aws(args) {
  return JSON.parse(execFileSync(awsCli, [...args, "--region", "us-east-1", "--output", "json"], { encoding: "utf8" }));
}

const existing = aws(["wafv2", "list-web-acls", "--scope", "CLOUDFRONT"]).WebACLs.find((w) => w.Name === acl.Name);
if (existing) {
  console.log(existing.ARN);
  process.exit(0);
}

// CloudFormation-veldnamen zijn gelijk aan die van de WAF-API, op de hoofdletters na.
// Verschil: SearchString is in CloudFormation platte tekst, in de API (blob) base64.
const pascal = (value) => {
  if (Array.isArray(value)) return value.map(pascal);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => {
        const key = k.charAt(0).toUpperCase() + k.slice(1);
        return [key, key === "SearchString" ? Buffer.from(String(v)).toString("base64") : pascal(v)];
      })
    );
  }
  return value;
};

const input = {
  Name: acl.Name,
  Scope: "CLOUDFRONT",
  DefaultAction: pascal(acl.DefaultAction),
  VisibilityConfig: pascal(acl.VisibilityConfig),
  Rules: pascal(acl.Rules),
  Description: `VeriPasso ${envName} - managed rules en rate limits, zelfde regels als edge-stack.js`
};
const inputFile = path.join(require("os").tmpdir(), `veripasso-waf-${envName}.json`);
fs.writeFileSync(inputFile, JSON.stringify(input));
const created = aws(["wafv2", "create-web-acl", "--cli-input-json", `file://${inputFile}`]);
console.log(created.Summary.ARN);
