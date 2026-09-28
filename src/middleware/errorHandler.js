class HttpError extends Error {
  constructor(statusCode, message, details, code) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    this.code = code;
  }
}

function notFoundHandler(req, res, next) {
  next(new HttpError(404, "Niet gevonden"));
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  // body-parser-fouten (ongeldige JSON, te grote body) zijn clientfouten, geen 500.
  if (!(err instanceof HttpError) && err.type && (err.status === 400 || err.status === 413)) {
    err = new HttpError(err.status, err.status === 413 ? "Verzoek is te groot" : "Ongeldige invoer");
  }

  const isKnownError = err instanceof HttpError;
  const statusCode = isKnownError ? err.statusCode : 500;

  if (!isKnownError) {
    console.error(err);
  }

  res.status(statusCode).json({
    error: {
      message: isKnownError ? err.message : "Er is een interne fout opgetreden",
      details: isKnownError ? err.details : undefined,
      code: isKnownError ? err.code : undefined
    }
  });
}

module.exports = { HttpError, notFoundHandler, errorHandler };
