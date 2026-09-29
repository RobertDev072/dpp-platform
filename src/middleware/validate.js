const { HttpError } = require("./errorHandler");

function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      next(new HttpError(400, "Ongeldige invoer", result.error.flatten()));
      return;
    }

    req.body = result.data;
    next();
  };
}

// Express 5 maakt req.query read-only; het gevalideerde resultaat komt daarom op
// req.validatedQuery te staan.
function validateQuery(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.query);

    if (!result.success) {
      next(new HttpError(400, "Ongeldige invoer", result.error.flatten()));
      return;
    }

    req.validatedQuery = result.data;
    next();
  };
}

module.exports = { validateBody, validateQuery };
