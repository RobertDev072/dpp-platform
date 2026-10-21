const dppAccess = require("../services/dppAccess.service");
const { HttpError } = require("./errorHandler");

// Authorization: Bearer vpa_… → req.dppAccess = { tokenId, companyId, level }. Zonder
// (of met een ander soort) token gewoon door; een ongeldig vpa-token altijd 401, zodat een
// verkeerd ingestelde koppeling niet stil de publieke weergave krijgt.
function dppAccessAuth() {
  return async (req, res, next) => {
    try {
      const match = /^Bearer\s+(\S+)$/i.exec(req.get("authorization") || "");
      if (!match || !dppAccess.isAccessToken(match[1])) return next();
      const access = await dppAccess.authenticate(match[1]);
      if (!access) {
        res.set("WWW-Authenticate", 'Bearer realm="veripasso", error="invalid_token"');
        return next(new HttpError(401, "Ongeldig, verlopen of ingetrokken toegangstoken", undefined, "ACCESS_TOKEN_INVALID"));
      }
      req.dppAccess = access;
      next();
    } catch (error) {
      next(error);
    }
  };
}

module.exports = { dppAccessAuth };
