const cdk = require("aws-cdk-lib");
const ecr = require("aws-cdk-lib/aws-ecr");

// Container-register (ECR) als aparte, kleine stack: bij de allereerste uitrol moet het
// image al bestaan vóórdat de app-stack een ECS-service kan starten. Volgorde:
// Registry-stack → image bouwen en pushen → App-stack.
class VeriPassoRegistryStack extends cdk.Stack {
  constructor(scope, id, props) {
    super(scope, id, props);
    const { config } = props;

    const repository = new ecr.Repository(this, "Repository", {
      repositoryName: `veripasso-${config.envName}-app`,
      imageScanOnPush: true,
      imageTagMutability: ecr.TagMutability.IMMUTABLE,
      encryption: ecr.RepositoryEncryption.AES_256,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [{ maxImageCount: 30, description: "Bewaar de laatste 30 images (rollback)" }]
    });

    this.repository = repository;
    new cdk.CfnOutput(this, "EcrRepositoryUri", { value: repository.repositoryUri });
  }
}

module.exports = { VeriPassoRegistryStack };
