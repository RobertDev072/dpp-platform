const test = require("node:test");
const assert = require("node:assert/strict");
const { sql } = require("../src/config/db");
const { startTestServer, stopTestServer, request } = require("./helpers/testServer");
const logger = require("../src/utils/logger");

test("logging: wachtwoorden, tokens, cookies en presigned URL's worden nooit gelogd", () => {
  const redacted = logger.redact({
    email: "a@example.com",
    password: "geheim",
    sessionToken: "abc",
    headers: { authorization: "Bearer x", cookie: "veripasso_session=y" },
    url: "https://bucket.s3.eu-west-1.amazonaws.com/x.pdf?X-Amz-Signature=deadbeef",
    nested: { apiKey: "k", ok: "zichtbaar" }
  });
  assert.equal(redacted.password, "[redacted]");
  assert.equal(redacted.sessionToken, "[redacted]");
  assert.equal(redacted.headers.authorization, "[redacted]");
  assert.equal(redacted.headers.cookie, "[redacted]");
  assert.equal(redacted.url, "[presigned-url]");
  assert.equal(redacted.nested.apiKey, "[redacted]");
  assert.equal(redacted.nested.ok, "zichtbaar");
  assert.equal(redacted.email, "a@example.com");
});

test("health: liveness zonder afhankelijkheden, readiness met database, geen details", async (t) => {
  const { server, baseUrl } = await startTestServer();
  t.after(async () => {
    await stopTestServer(server);
    await sql.close();
  });

  const live = await request(baseUrl, "GET", "/api/health");
  assert.equal(live.status, 200);
  assert.equal(live.data, "OK");

  const ready = await request(baseUrl, "GET", "/api/health/ready");
  assert.equal(ready.status, 200);
  assert.equal(ready.data, "READY");
});

test("API: ongeldige of te grote JSON is een 4xx, geen interne fout", async (t) => {
  const { server, baseUrl } = await startTestServer();
  t.after(async () => {
    await stopTestServer(server);
    await sql.close();
  });

  const invalid = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{niet-json"
  });
  assert.equal(invalid.status, 400);

  const tooLarge = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "x@example.com", password: "a".repeat(2 * 1024 * 1024) })
  });
  assert.equal(tooLarge.status, 413);
  const body = await tooLarge.json();
  assert.ok(!JSON.stringify(body).includes("stack"), "geen stacktrace naar de client");

  const poweredBy = (await fetch(`${baseUrl}/api/health`)).headers.get("x-powered-by");
  assert.equal(poweredBy, null);
});

test("publieke API: rate limit per IP geeft 429; interne loopback-aanroepen zijn uitgezonderd", async (t) => {
  const express = require("express");
  const http = require("http");
  // Verse instantie van de limiter met een lage limiet voor deze test.
  const modulePath = require.resolve("../src/middleware/rateLimit");
  delete require.cache[modulePath];
  process.env.PUBLIC_RATE_LIMIT_PER_MINUTE = "3";
  const { publicApiLimiter } = require("../src/middleware/rateLimit");
  delete process.env.PUBLIC_RATE_LIMIT_PER_MINUTE;
  delete require.cache[modulePath];

  const app = express();
  app.set("trust proxy", 1);
  app.get("/x", publicApiLimiter, (req, res) => res.send("ok"));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/x`;

  const visitor = { "X-Forwarded-For": "203.0.113.7" };
  const statuses = [];
  for (let i = 0; i < 4; i += 1) statuses.push((await fetch(url, { headers: visitor })).status);
  assert.deepEqual(statuses, [200, 200, 200, 429]);
  const limited = await fetch(url, { headers: visitor });
  assert.equal((await limited.json()).error.code, "RATE_LIMITED");

  // Een andere bezoeker heeft een eigen teller.
  assert.equal((await fetch(url, { headers: { "X-Forwarded-For": "203.0.113.8" } })).status, 200);
  // Loopback (de server-side paspoortpagina) telt niet mee.
  for (let i = 0; i < 5; i += 1) assert.equal((await fetch(url)).status, 200);
});
