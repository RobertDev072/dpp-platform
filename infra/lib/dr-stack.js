const cdk = require("aws-cdk-lib");
const s3 = require("aws-cdk-lib/aws-s3");
const backup = require("aws-cdk-lib/aws-backup");

// Disaster recovery in een tweede regio (standaard eu-central-1):
// - een AWS Backup-kluis waarnaar de RDS-back-ups worden gekopieerd;
// - optioneel replicatiebuckets voor productfoto's en -documenten.
// Let op: dit is een back-up/herstelvoorziening, géén hoge beschikbaarheid. De
// applicatie draait in één regio; herstel in de DR-regio is een handmatige procedure
// (zie docs/aws-deployment-runbook.md).
class VeriPassoDrStack extends cdk.Stack {
  constructor(scope, id, props) {
    super(scope, id, props);
    const { config } = props;

    if (config.enableAwsBackupCopy) {
      const vault = new backup.BackupVault(this, "DrVault", {
        backupVaultName: `veripasso-${config.envName}-dr`,
        removalPolicy: cdk.RemovalPolicy.RETAIN
      });
      this.backupVaultArn = vault.backupVaultArn;
    }

    if (config.enableS3CrossRegionReplication) {
      const replica = (name) =>
        new s3.Bucket(this, `${name}Replica`, {
          bucketName: `veripasso-${config.envName}-${name.toLowerCase()}-replica-${config.account}`,
          blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
          encryption: s3.BucketEncryption.S3_MANAGED,
          enforceSSL: true,
          versioned: true,
          objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
          removalPolicy: cdk.RemovalPolicy.RETAIN,
          lifecycleRules: [
            // Replica's mogen goedkoper opgeslagen worden; nooit automatisch verwijderen.
            { transitions: [{ storageClass: s3.StorageClass.GLACIER_INSTANT_RETRIEVAL, transitionAfter: cdk.Duration.days(30) }] },
            { abortIncompleteMultipartUploadAfter: cdk.Duration.days(7) }
          ]
        });
      this.imagesReplicaBucketName = replica("Images").bucketName;
      this.documentsReplicaBucketName = replica("Documents").bucketName;
    }
  }
}

module.exports = { VeriPassoDrStack };
