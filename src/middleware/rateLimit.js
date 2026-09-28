const { HttpError } = require("./errorHandler");

// Eenvoudige in-memory fixed-window rate limiter, per instance. Genoeg om brute-force op
// login/uitnodigingstokens te vertragen zonder extra (betaalde) Azure-dienst. Bij
// meerdere App Service-instances geldt de limiet per instance.
function rateLimit({ windowMs, max, keyFn, message = "Te veel pogingen, probeer het later opnieuw" }) {
  const hits = new Map();

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (entry.resetAt <= now) hits.delete(key);
    }
  }, windowMs);
  sweep.unref();

  return (req, res, next) => {
    const key = keyFn ? keyFn(req) : req.ip;
    const now = Date.now();
    let entry = hits.get(key);

    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }

    entry.count += 1;
    if (entry.count > max) {
      res.set("Retry-After", String(Math.ceil((entry.resetAt - now) / 1000)));
      next(new HttpError(429, message, undefined, "RATE_LIMITED"));
      return;
    }
    next();
  };
}

module.exports = { rateLimit };
