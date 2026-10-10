// Gestructureerde logging: één JSON-regel per gebeurtenis op stdout/stderr. Op AWS
// komen die via de awslogs-driver van ECS in CloudWatch Logs terecht, waar ze met
// Logs Insights op velden doorzoekbaar zijn. Lokaal (development) leesbare tekst.
//
// Nooit loggen: wachtwoorden, sessietokens, presigned URL's, cookies, request-bodies
// of volledige documenten. Velden met zo'n naam worden hier altijd gemaskeerd, als
// tweede slot naast de discipline in de aanroepende code.

const SENSITIVE_KEY = /pass(word)?|token|secret|authorization|cookie|signature|credential|api[-_]?key|x-amz/i;
const MAX_STRING = 500;

function redact(value, depth = 0) {
  if (value == null || depth > 4) return value;
  if (typeof value === "string") {
    // Presigned URL's bevatten een tijdelijke handtekening; nooit volledig loggen.
    if (/X-Amz-Signature=/i.test(value)) return "[presigned-url]";
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  }
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  if (typeof value === "object") {
    if (value instanceof Error) return { name: value.name, message: redact(value.message, depth + 1) };
    const out = {};
    for (const [key, v] of Object.entries(value)) {
      out[key] = SENSITIVE_KEY.test(key) ? "[redacted]" : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

function write(level, message, fields) {
  const entry = { level, msg: message, time: new Date().toISOString(), ...redact(fields || {}) };
  const stream = level === "error" || level === "warn" ? process.stderr : process.stdout;
  if (process.env.NODE_ENV === "production" || process.env.LOG_FORMAT === "json") {
    stream.write(`${JSON.stringify(entry)}\n`);
  } else if (process.env.NODE_ENV !== "test" || process.env.LOG_IN_TESTS === "true") {
    const extra = fields && Object.keys(fields).length ? ` ${JSON.stringify(redact(fields))}` : "";
    stream.write(`[${level}] ${message}${extra}\n`);
  }
}

module.exports = {
  info: (message, fields) => write("info", message, fields),
  warn: (message, fields) => write("warn", message, fields),
  error: (message, fields) => write("error", message, fields),
  redact
};
