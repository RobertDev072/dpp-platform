// Controle van de omgevingsconfiguratie vóór het genereren van de stacks: liever
// een duidelijke fout bij `cdk synth` dan een half uitgerolde omgeving.
const REQUIRED_STRINGS = [
  "account",
  "region",
  "envName",
  "appDomain",
  "qrDomain",
  "originDomain",
  "cloudFrontCertificateArn",
  "originCertificateArn",
  "imageTag",
  "alarmEmail",
  "dbInstanceClass",
  "cpuArchitecture"
];
const REQUIRED_NUMBERS = [
  "cpu",
  "memoryMiB",
  "desiredCount",
  "minTasks",
  "maxTasks",
  "dbAllocatedStorageGiB",
  "dbMaxAllocatedStorageGiB",
  "dbBackupRetentionDays",
  "publicRateLimitPer5Min",
  "logRetentionDays",
  "monthlyBudgetUsd"
];

function validateConfig(config) {
  const errors = [];
  for (const key of REQUIRED_STRINGS) {
    if (typeof config[key] !== "string" || !config[key]) errors.push(`${key} ontbreekt`);
  }
  for (const key of REQUIRED_NUMBERS) {
    if (typeof config[key] !== "number" || !(config[key] >= 0)) errors.push(`${key} moet een getal zijn`);
  }
  if (!/^\d{12}$/.test(config.account || "")) errors.push("account moet een AWS-accountnummer van 12 cijfers zijn");
  if (!/^arn:aws:acm:us-east-1:/.test(config.cloudFrontCertificateArn || "")) {
    errors.push("cloudFrontCertificateArn moet een ACM-certificaat in us-east-1 zijn (eis van CloudFront)");
  }
  if (!String(config.originCertificateArn || "").startsWith(`arn:aws:acm:${config.region}:`)) {
    errors.push(`originCertificateArn moet een ACM-certificaat in ${config.region} zijn`);
  }
  if (!["X86_64", "ARM64"].includes(config.cpuArchitecture)) errors.push("cpuArchitecture: X86_64 of ARM64");
  if (config.minTasks > config.maxTasks) errors.push("minTasks > maxTasks");
  if (config.dbMaxAllocatedStorageGiB < config.dbAllocatedStorageGiB) errors.push("dbMaxAllocatedStorageGiB < dbAllocatedStorageGiB");
  if (config.dbBackupRetentionDays < 1 || config.dbBackupRetentionDays > 35) errors.push("dbBackupRetentionDays: 1-35");
  if (config.envName === "production" && !config.dbDeletionProtection) errors.push("productie vereist dbDeletionProtection");
  if (config.githubRepository && !/^[\w.-]+\/[\w.-]+$/.test(config.githubRepository)) errors.push("githubRepository: eigenaar/naam");
  if (errors.length) {
    throw new Error(`Ongeldige configuratie (${config.envName || "?"}):\n- ${errors.join("\n- ")}`);
  }
  return config;
}

module.exports = { validateConfig };
