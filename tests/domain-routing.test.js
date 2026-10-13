const test = require("node:test");
const assert = require("node:assert/strict");
const { readDomainConfig, routeDomain } = require("../src/utils/domainRouting");

// Domeinverdeling (vroeger een CloudFront Function, nu in de app): zelfde regels.
const config = readDomainConfig({
  SITE_DOMAINS: "veripasso.com, www.veripasso.com",
  APP_DOMAIN: "app.veripasso.com",
  QR_DOMAIN: "qr.veripasso.com"
});

const route = (host, path, search = "") => {
  const r = routeDomain({ host, path, search }, config);
  return r ? `${r.status} ${r.location}` : "pass";
};

test("Domeinverdeling: elk domein zijn rol, gedrukte QR-codes blijven werken", () => {
  assert.equal(config.canonicalSiteDomain, "www.veripasso.com");
  assert.equal(route("veripasso.com", "/"), "301 https://www.veripasso.com/");
  assert.equal(route("www.veripasso.com", "/"), "pass");
  assert.equal(route("www.veripasso.com", "/login"), "302 https://app.veripasso.com/login");
  assert.equal(route("app.veripasso.com", "/"), "302 https://app.veripasso.com/login");
  assert.equal(route("app.veripasso.com", "/admin"), "pass");
  assert.equal(route("app.veripasso.com", "/p/X"), "301 https://qr.veripasso.com/p/X");
  assert.equal(route("qr.veripasso.com", "/p/ABC"), "pass", "gedrukte QR-codes");
  assert.equal(route("qr.veripasso.com", "/company/products"), "302 https://app.veripasso.com/company/products");
  assert.equal(route("qr.veripasso.com", "/"), "302 https://www.veripasso.com/");
  assert.equal(route("veripasso.com", "/p/X", "?a=1"), "301 https://www.veripasso.com/p/X?a=1", "query blijft behouden");
});

test("Domeinverdeling: gedeelde paden overal, poort en hoofdletters genegeerd", () => {
  for (const host of ["qr.veripasso.com", "app.veripasso.com", "www.veripasso.com"]) {
    assert.equal(route(host, "/api/dpp/X"), "pass");
    assert.equal(route(host, "/_next/static/a.js"), "pass");
    assert.equal(route(host, "/favicon.ico"), "pass");
  }
  assert.equal(route("APP.veripasso.com:443", "/"), "302 https://app.veripasso.com/login");
  assert.equal(route("203.0.113.5", "/login"), "pass", "onbekende host (IP) wordt niet doorgestuurd");
});

test("Domeinverdeling: lokaal (zonder domeinen) of zonder landingspagina", () => {
  assert.equal(routeDomain({ host: "localhost:3000", path: "/p/X" }, readDomainConfig({})), null);
  const noSite = readDomainConfig({ APP_DOMAIN: "app.veripasso.com", QR_DOMAIN: "qr.veripasso.com" });
  assert.deepEqual(routeDomain({ host: "qr.veripasso.com", path: "/" }, noSite), {
    status: 302,
    location: "https://app.veripasso.com/login"
  });
});
