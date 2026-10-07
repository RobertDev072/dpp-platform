const crypto = require("crypto");
const { query, queryOne } = require("../config/db");

// Store voor express-rate-limit in Postgres, zodat de limieten gelden over álle
// Vercel Function-instances heen (de standaard MemoryStore telt per instance en
// begint bij elke koude start opnieuw - dan zou brute-force-bescherming in de
// praktijk niet werken).
class PostgresRateLimitStore {
  constructor(prefix) {
    this.prefix = prefix;
    // Tellers zijn gedeeld; express-rate-limit hoeft niets lokaal bij te houden.
    this.localKeys = false;
  }

  init(options) {
    this.windowSeconds = options.windowMs / 1000;
  }

  hashKey(key) {
    return crypto.createHash("sha256").update(`${this.prefix}:${key}`).digest("hex");
  }

  async increment(key) {
    const row = await queryOne(
      `
      INSERT INTO rate_limits (key, hits, reset_at)
      VALUES ($1, 1, now() + make_interval(secs => $2))
      ON CONFLICT (key) DO UPDATE SET
        hits = CASE WHEN rate_limits.reset_at <= now() THEN 1 ELSE rate_limits.hits + 1 END,
        reset_at = CASE WHEN rate_limits.reset_at <= now() THEN now() + make_interval(secs => $2) ELSE rate_limits.reset_at END
      RETURNING hits, reset_at
    `,
      [this.hashKey(key), this.windowSeconds]
    );
    return { totalHits: row.hits, resetTime: row.reset_at };
  }

  async decrement(key) {
    await query("UPDATE rate_limits SET hits = GREATEST(hits - 1, 0) WHERE key = $1", [this.hashKey(key)]);
  }

  async resetKey(key) {
    await query("DELETE FROM rate_limits WHERE key = $1", [this.hashKey(key)]);
  }
}

async function pruneExpiredRateLimits() {
  await query("DELETE FROM rate_limits WHERE reset_at < now()");
}

module.exports = { PostgresRateLimitStore, pruneExpiredRateLimits };
