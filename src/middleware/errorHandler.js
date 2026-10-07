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

// Postgres-fouten die door ongeldige invoer komen (bijv. een niet-numeriek id in de
// URL of een getal buiten het INT-bereik) zijn een 400, geen interne fout. Een
// unieke-sleutelschending (bijv. e-mailadres of slug bestaat al) is een 409.
function fromDatabaseError(err) {
  if (!err || typeof err.code !== "string" || err instanceof HttpError) return err;
  if (["22P02", "22003", "22007", "22008", "22001"].includes(err.code)) {
    return new HttpError(400, "Ongeldige invoer", undefined, "INVALID_INPUT");
  }
  if (err.code === "23505") {
    return new HttpError(409, "Deze waarde bestaat al", undefined, "DUPLICATE");
  }
  return err;
}

// eslint-disable-next-line no-unused-vars
function errorHandler(rawErr, req, res, next) {
  const err = fromDatabaseError(rawErr);
  const isKnownError = err instanceof HttpError;
  const statusCode = isKnownError ? err.statusCode : 500;

  if (!isKnownError) {
    console.error(err);
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
