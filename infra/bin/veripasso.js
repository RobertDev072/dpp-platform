#!/usr/bin/env node
// CDK-entrypoint. Kies de omgeving met -c env=staging|production (standaard staging).
//   npx cdk synth -c env=staging        (lokaal, zonder AWS-account: alleen genereren)
//   npx cdk deploy --all -c env=staging (pas na expliciete goedkeuring, zie runbook)
const path = require("path");
const fs = require("fs");
const cdk = require("aws-cdk-lib");
const { VeriPassoEdgeStack } = require("../lib/edge-stack");
const { VeriPassoDrStack } = require("../lib/dr-stack");
const { VeriPassoAppStack } = require("../lib/app-stack");
const { VeriPassoCiStack } = require("../lib/ci-stack");
const { VeriPassoRegistryStack } = require("../lib/registry-stack");
const { validateConfig } = require("../lib/config");

const app = new cdk.App();
const envName = app.node.tryGetContext("env") || "staging";
const configFile = path.join(__dirname, "..", "config", `${envName}.json`);
if (!fs.existsSync(configFile)) {
  throw new Error(`Onbekende omgeving "${envName}": ${configFile} bestaat niet`);
}
const config = validateConfig(JSON.parse(fs.readFileSync(configFile, "utf8")));
// imageTag kan bij een deploy worden overschreven: -c imageTag=<git-sha>
config.imageTag = app.node.tryGetContext("imageTag") || config.imageTag;

const stackName = (part) => `VeriPasso-${config.envName}-${part}`;
const tags = { Application: "VeriPasso", Environment: config.envName };

const edge = config.enableWaf
  ? new VeriPassoEdgeStack(app, stackName("Edge"), {
      env: { account: config.account, region: "us-east-1" },
      crossRegionReferences: true,
      config,
      tags
    })
  : null;

const dr =
  config.enableAwsBackupCopy || config.enableS3CrossRegionReplication
    ? new VeriPassoDrStack(app, stackName("Dr"), {
        env: { account: config.account, region: config.drRegion },
        crossRegionReferences: true,
        config,
        tags
      })
    : null;

const registry = new VeriPassoRegistryStack(app, stackName("Registry"), {
  env: { account: config.account, region: config.region },
  config,
  tags
});

const appStack = new VeriPassoAppStack(app, stackName("App"), {
  env: { account: config.account, region: config.region },
  crossRegionReferences: true,
  config,
  tags,
  webAclArn: edge ? edge.webAclArn : undefined,
  drImagesBucketName: dr ? dr.imagesReplicaBucketName : undefined,
  drDocumentsBucketName: dr ? dr.documentsReplicaBucketName : undefined,
  drBackupVaultArn: dr ? dr.backupVaultArn : undefined
});
appStack.addStackDependency(registry);
if (edge) appStack.addStackDependency(edge);
if (dr) appStack.addStackDependency(dr);

if (config.githubRepository) {
  new VeriPassoCiStack(app, stackName("Ci"), {
    env: { account: config.account, region: config.region },
    config,
    tags
  });
}

app.synth();
