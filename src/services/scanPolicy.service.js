// Welke scanmelding telt? (zelfde regels in de Cloudflare Worker, edge/cloudflare/src/index.js)
//
// Een webbezoek is technisch niet te onderscheiden van een camera-scan. De paspoortpagina
// meldt daarom alleen wat waarschijnlijk een scan is (components/passport/ScanBeacon.js),
// en hier worden meldingen geweigerd die aantoonbaar niet van een gewone browser op de
// paspoortpagina komen:
//   - bots, crawlers, linkpreviews en HTTP-bibliotheken (user-agent);
//   - verzoeken die niet van dezelfde site komen: browsers sturen bij een beacon
//     "Sec-Fetch-Site: same-origin"; scripts en andere sites niet (of iets anders).
// Daarna telt één scan per apparaat per paspoort per 30 minuten (scanDedup.service.js).
// Zie docs/scans.md voor het volledige beleid en de bekende beperkingen.

const BOT_PATTERN =
  /bot\b|bot\/|crawler|spider|slurp|preview|facebookexternalhit|embedly|whatsapp|telegram|discord|slack|skype|linkedin|pinterest|vkshare|quora|outbrain|headless|phantom|puppeteer|playwright|selenium|lighthouse|pagespeed|curl\/|wget\/|python-|python\/|go-http|java\/|okhttp|axios|node-fetch|undici|postman|insomnia|httpclient|libwww|scrapy/i;

function isBot(userAgent) {
  return !userAgent || BOT_PATTERN.test(userAgent);
}

// true = deze melding mag (na ontdubbelen) meetellen als scan.
function isCountableBeacon(headers) {
  const get = (name) => (typeof headers.get === "function" ? headers.get(name) : headers[name]) || "";
  if (isBot(get("user-agent"))) return false;
  if (get("sec-fetch-site") !== "same-origin") return false;
  return true;
}

module.exports = { isBot, isCountableBeacon, BOT_PATTERN };
