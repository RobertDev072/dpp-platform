const apiKeys = require("../services/apiKeys.service");
const { HttpError } = require("./errorHandler");

// Authorization: Bearer vp_xxxxxxxx_… → req.apiClient = { keyId, companyId, scopes }.
// optional: zonder header gewoon door (publieke leesroutes); met een ongeldige sleutel
// altijd 401, zodat een fout geconfigureerde koppeling niet stil als anoniem doorloopt.
function apiKeyAuth({ optional = false, scope = null } = {}) {
  return async (req, res, next) => {
    try {
      const header = req.get("authorization") || "";
      const match = /^Bearer\s+(\S+)$/i.exec(header);
      if (!match) {
        if (optional) return next();
        res.set("WWW-Authenticate", 'Bearer realm="veripasso"');
        return next(new HttpError(401, "API-sleutel ontbreekt (Authorization: Bearer vp_…)", undefined, "API_KEY_MISSING"));
      }
      const client = await apiKeys.authenticate(match[1]);
      if (!client) {
        res.set("WWW-Authenticate", 'Bearer realm="veripasso", error="invalid_token"');
        return next(new HttpError(401, "Ongeldige, verlopen of ingetrokken API-sleutel", undefined, "API_KEY_INVALID"));
      }
      if (scope && !client.scopes.includes(scope)) {
        return next(new HttpError(403, `Deze API-sleutel heeft geen ${scope}-recht`, undefined, "API_KEY_SCOPE"));
      }
      req.apiClient = client;
      next();
    } catch (error) {
      next(error);
    }
  };
}

module.exports = { apiKeyAuth };
