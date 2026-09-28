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

module.exports = { validateBody };
