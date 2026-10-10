const logger = require("../utils/logger");

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

// Fouten van body-parser e.d. (ongeldige JSON, te grote body) dragen zelf een
// 4xx-status; dat zijn clientfouten, geen interne fouten.
function clientErrorStatus(err) {
  const status = Number(err?.status || err?.statusCode);
  return status >= 400 && status < 500 ? status : null;
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const clientStatus = err instanceof HttpError ? null : clientErrorStatus(err);
  if (clientStatus) {
    err = new HttpError(clientStatus, clientStatus === 413 ? "Het verzoek is te groot" : "Ongeldig verzoek");
  }
  const isKnownError = err instanceof HttpError;
  const statusCode = isKnownError ? err.statusCode : 500;

  if (!isKnownError) {
    // Alleen naam/melding/stack, nooit de request-body of headers.
    logger.error("unhandled_error", {
      method: req.method,
      route: req.baseUrl + (req.route?.path || ""),
      errorName: err?.name,
      errorMessage: err?.message,
      stack: typeof err?.stack === "string" ? err.stack.split("\n").slice(0, 6).join("\n") : undefined
    });
  }

  // Voor de monitoring: gesaneerde melding beschikbaar maken voor de
  // telemetrie-middleware (die leest dit bij res 'finish'). Nooit stacks/bodies.
  res.locals.monitoringErrorMessage = isKnownError ? err.message : err.message || "Interne fout";
  res.locals.monitoringErrorCode = isKnownError ? err.code : "UNHANDLED";

  res.status(statusCode).json({
    error: {
      message: isKnownError ? err.message : "Er is een interne fout opgetreden",
      details: isKnownError ? err.details : undefined,
      code: isKnownError ? err.code : undefined
    }
  });
}

module.exports = { HttpError, notFoundHandler, errorHandler };
