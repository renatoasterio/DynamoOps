'use strict';

/** An error whose HTTP status is known (validation, missing params, …). */
class HttpError extends Error {
    constructor(status, message) {
        super(message);
        this.name = 'HttpError';
        this.status = status;
    }
}

const badRequest = (message) => new HttpError(400, message);

// AWS SDK v3 errors carry the service exception name in `err.name`
const AWS_ERROR_STATUS = {
    ValidationException: 400,
    SerializationException: 400,
    AccessDeniedException: 403,
    UnrecognizedClientException: 401,
    InvalidSignatureException: 401,
    ExpiredTokenException: 401,
    CredentialsProviderError: 401,
    UnauthorizedException: 401,
    ResourceNotFoundException: 404,
    ConditionalCheckFailedException: 409,
    ResourceInUseException: 409,
    TransactionConflictException: 409,
    ProvisionedThroughputExceededException: 429,
    ThrottlingException: 429,
    RequestLimitExceeded: 429,
    LimitExceededException: 429,
};

function statusFor(err) {
    if (Number.isInteger(err.status)) return err.status;
    if (AWS_ERROR_STATUS[err.name]) return AWS_ERROR_STATUS[err.name];
    const sdkStatus = err.$metadata?.httpStatusCode;
    if (sdkStatus >= 400 && sdkStatus < 600) return sdkStatus;
    return 500;
}

/** Wraps an async route handler so rejected promises reach the error handler. */
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Express recognises error handlers by their 4-argument signature
function errorHandler(err, _req, res, _next) {
    const status = statusFor(err);
    if (status >= 500) console.error('[api]', err);
    // Only the message goes back (AWS messages are what the user needs to see);
    // stack traces stay in the server log.
    res.status(status).json({ success: false, error: err.message || 'Internal server error', code: err.name });
}

module.exports = { HttpError, badRequest, asyncHandler, errorHandler, statusFor };
