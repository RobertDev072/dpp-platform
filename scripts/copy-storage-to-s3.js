// Eenmalige kopie van alle bestaande bestanden uit de huidige opslag (Supabase Storage,
// via het S3-compatibele endpoint) naar de AWS S3-buckets, met integriteitscontrole.
// Bronobjecten worden alleen gelezen, nooit gewijzigd of verwijderd. Objectnamen
// blijven exact gelijk, zodat photo_blob_name/blob_name in de database ongewijzigd
// blijven kloppen.
//
// Werkwijze per object: bron lezen -> SHA-256 berekenen -> naar doel schrijven met
// x-amz-checksum-sha256 (S3 weigert de upload als de bytes onderweg veranderd zijn)
// -> HeadObject op het doel: grootte + checksum vergelijken. Objecten die al met
// dezelfde checksum aanwezig zijn, worden overgeslagen (hervatbaar).
// Uitvoer: een CSV-manifest met per object grootte, sha256 en resultaat (bewijs voor
// de migratie-checklist).
//
// Configuratie via env-vars (nooit in de code):
//   SOURCE_S3_ENDPOINT        bijv. https://<project-ref>.supabase.co/storage/v1/s3
//   SOURCE_S3_REGION          regio van het bronproject (bijv. eu-west-1)
//   SOURCE_S3_ACCESS_KEY_ID / SOURCE_S3_SECRET_ACCESS_KEY  (S3-sleutels van de bron)
//   TARGET_REGION             bijv. eu-west-1 (doel: standaard AWS-credentialketen)
//   BUCKET_MAP                bijv. "product-images=veripasso-prod-images,product-documents=veripasso-prod-documents"
//   DRY_RUN=true              alleen tellen en het manifest maken, niets schrijven
//
//   node scripts/copy-storage-to-s3.js > manifest.csv
const crypto = require("crypto");
const {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
  HeadObjectCommand
} = require("@aws-sdk/client-s3");

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Env-var ${name} ontbreekt`);
  return value;
}

function parseBucketMap(value) {
  return value.split(",").map((pair) => {
    const [source, target] = pair.split("=").map((s) => s.trim());
    if (!source || !target) throw new Error(`Ongeldige BUCKET_MAP-regel: ${pair}`);
    return { source, target };
  });
}

async function streamToBuffer(body) {
  const chunks = [];
  for await (const chunk of body) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function csv(values) {
  return values.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",");
}

async function main() {
  const dryRun = process.env.DRY_RUN === "true";
  const source = new S3Client({
    endpoint: required("SOURCE_S3_ENDPOINT"),
    region: required("SOURCE_S3_REGION"),
    forcePathStyle: true,
    credentials: {
      accessKeyId: required("SOURCE_S3_ACCESS_KEY_ID"),
      secretAccessKey: required("SOURCE_S3_SECRET_ACCESS_KEY")
    }
  });
  const target = new S3Client({ region: required("TARGET_REGION") });
  const mapping = parseBucketMap(required("BUCKET_MAP"));

  console.log(csv(["source_bucket", "target_bucket", "key", "bytes", "sha256", "result"]));
  const totals = { copied: 0, skipped: 0, failed: 0, bytes: 0 };

  for (const { source: sourceBucket, target: targetBucket } of mapping) {
    let token;
    do {
      const page = await source.send(new ListObjectsV2Command({ Bucket: sourceBucket, ContinuationToken: token }));
      for (const object of page.Contents || []) {
        const key = object.Key;
        try {
          const got = await source.send(new GetObjectCommand({ Bucket: sourceBucket, Key: key }));
          const body = await streamToBuffer(got.Body);
          const sha256 = crypto.createHash("sha256").update(body).digest("hex");
          const sha256b64 = Buffer.from(sha256, "hex").toString("base64");

          let existing = null;
          try {
            existing = await target.send(new HeadObjectCommand({ Bucket: targetBucket, Key: key, ChecksumMode: "ENABLED" }));
          } catch {
            existing = null;
          }
          if (existing && existing.ChecksumSHA256 === sha256b64 && Number(existing.ContentLength) === body.length) {
            totals.skipped += 1;
            console.log(csv([sourceBucket, targetBucket, key, body.length, sha256, "al aanwezig"]));
            continue;
          }
          if (dryRun) {
            console.log(csv([sourceBucket, targetBucket, key, body.length, sha256, "dry-run"]));
            continue;
          }

          await target.send(
            new PutObjectCommand({
              Bucket: targetBucket,
              Key: key,
              Body: body,
              ContentType: got.ContentType || "application/octet-stream",
              ChecksumSHA256: sha256b64
            })
          );
          const head = await target.send(new HeadObjectCommand({ Bucket: targetBucket, Key: key, ChecksumMode: "ENABLED" }));
          if (head.ChecksumSHA256 !== sha256b64 || Number(head.ContentLength) !== body.length) {
            throw new Error("controle na upload mislukt (grootte/checksum)");
          }
          totals.copied += 1;
          totals.bytes += body.length;
          console.log(csv([sourceBucket, targetBucket, key, body.length, sha256, "gekopieerd en geverifieerd"]));
        } catch (error) {
          totals.failed += 1;
          console.log(csv([sourceBucket, targetBucket, key, object.Size, "", `MISLUKT: ${error.message}`]));
        }
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
  }

  console.error(
    `Klaar: ${totals.copied} gekopieerd (${totals.bytes} bytes), ${totals.skipped} al aanwezig, ${totals.failed} mislukt${
      dryRun ? " (DRY RUN)" : ""
    }`
  );
  if (totals.failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error("Kopiëren mislukt:", error.message);
  process.exitCode = 1;
});
