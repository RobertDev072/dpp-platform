class HttpError extends Error {
  constructor(statusCode, message, details) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
  }
}

function notFoundHandler(req, res, next) {
  next(new HttpError(404, "Niet gevonden"));
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const isKnownError = err instanceof HttpError;
  const statusCode = isKnownError ? err.statusCode : 500;

  if (!isKnownError) {
    console.error(err);
  }

  res.status(statusCode).json({
    error: {
      message: isKnownError ? err.message : "Er is een interne fout opgetreden",
      details: isKnownError ? err.details : undefined
    }
  });
}

module.exports = { HttpError, notFoundHandler, errorHandler };
