const cdk = require("aws-cdk-lib");
const iam = require("aws-cdk-lib/aws-iam");

// Deployrol voor GitHub Actions via OIDC: geen langlevende AWS-sleutels in GitHub.
// De rol mag alleen:
// - images naar de ECR-repository van deze omgeving pushen;
// - de CDK-bootstraprollen aannemen (cdk deploy);
// - de eenmalige migratietaak starten en volgen.
// Het vertrouwen is beperkt tot één repository én de GitHub-environment met de naam
// van deze omgeving (daar kun je in GitHub verplichte goedkeuring op zetten).
class VeriPassoCiStack extends cdk.Stack {
  constructor(scope, id, props) {
    super(scope, id, props);
    const { config } = props;

    const provider = new iam.OpenIdConnectProvider(this, "GitHubOidc", {
      url: "https://token.actions.githubusercontent.com",
      clientIds: ["sts.amazonaws.com"]
    });

    const role = new iam.Role(this, "DeployRole", {
      roleName: `veripasso-${config.envName}-github-deploy`,
      maxSessionDuration: cdk.Duration.hours(1),
      assumedBy: new iam.WebIdentityPrincipal(provider.openIdConnectProviderArn, {
        StringEquals: {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          // GitHub levert de "sub" in het nieuwe formaat met vaste ID's
          // (repo:<eigenaar>@<eigenaar-id>/<repo>@<repo-id>:environment:<env>); dat blijft
          // juist ook na hernoemen alleen voor déze repository geldig. Het oude formaat
          // blijft toegestaan voor accounts waar GitHub dat nog stuurt.
          "token.actions.githubusercontent.com:sub": [
            `repo:${config.githubRepository}:environment:${config.envName}`,
            ...(config.githubOwnerId && config.githubRepositoryId
              ? [
                  `repo:${config.githubRepository.split("/")[0]}@${config.githubOwnerId}/${config.githubRepository.split("/")[1]}@${config.githubRepositoryId}:environment:${config.envName}`
                ]
              : [])
          ]
        }
      })
    });

    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["sts:AssumeRole"],
        resources: [`arn:aws:iam::${this.account}:role/cdk-hnb659fds-*-${this.account}-*`]
      })
    );
    role.addToPolicy(new iam.PolicyStatement({ actions: ["ecr:GetAuthorizationToken"], resources: ["*"] }));
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "ecr:BatchCheckLayerAvailability",
          "ecr:InitiateLayerUpload",
          "ecr:UploadLayerPart",
          "ecr:CompleteLayerUpload",
          "ecr:PutImage",
          "ecr:BatchGetImage",
          "ecr:DescribeImages"
        ],
        resources: [`arn:aws:ecr:${config.region}:${this.account}:repository/veripasso-${config.envName}-app`]
      })
    );
    // Eenmalige taken na de uitrol (migraties, versies aanvullen, Platform Owner) via een
    // directe aanroep van de app-functie, en pauzeren/hervatten (aws-pause.yml) via de
    // gelijktijdigheidslimiet. Alleen de app-functie van deze omgeving.
    const appFunctionArn = `arn:aws:lambda:${config.region}:${this.account}:function:veripasso-${config.envName}-app`;
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "lambda:InvokeFunction",
          "lambda:GetFunction",
          "lambda:GetFunctionConfiguration",
          "lambda:PutFunctionConcurrency",
          "lambda:DeleteFunctionConcurrency"
        ],
        resources: [appFunctionArn]
      })
    );
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["cloudformation:DescribeStacks"],
        resources: [`arn:aws:cloudformation:${config.region}:${this.account}:stack/VeriPasso-${config.envName}-*/*`]
      })
    );

    // Pauzeren/hervatten: database stoppen/starten. Alleen databases met het label van
    // deze omgeving.
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["rds:StopDBInstance", "rds:StartDBInstance"],
        resources: [`arn:aws:rds:${config.region}:${this.account}:db:*`],
        conditions: { StringEquals: { "aws:ResourceTag/Environment": config.envName, "aws:ResourceTag/Application": "VeriPasso" } }
      })
    );
    role.addToPolicy(new iam.PolicyStatement({ actions: ["rds:DescribeDBInstances"], resources: ["*"] }));

    new cdk.CfnOutput(this, "DeployRoleArn", { value: role.roleArn });
  }
}

module.exports = { VeriPassoCiStack };
