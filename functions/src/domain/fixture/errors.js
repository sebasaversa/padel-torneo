export const FIXTURE_ERROR_CODES = Object.freeze([
    'INVALID_CONFIGURATION',
    'INVALID_STATE',
    'UNSUPPORTED_SCHEMA_VERSION',
    'UNSUPPORTED_GENERATOR_VERSION',
    'GENERATOR_VERSION_MISMATCH',
    'FORBIDDEN',
    'NOT_FOUND',
    'REVISION_CONFLICT',
    'SCHEDULE_IDENTITY_MISMATCH',
    'HAS_RECORDED_SCORES',
    'NO_MORE_FIXTURE_VARIANTS',
    'IDEMPOTENCY_KEY_REUSED',
    'GENERATION_CANCELLED',
    'GENERATION_RUNTIME_FAILURE'
]);

const RETRYABLE_CODES = new Set(['GENERATION_RUNTIME_FAILURE']);

export class FixtureDomainError extends Error {
    constructor(code, message, details = {}) {
        if (!FIXTURE_ERROR_CODES.includes(code)) throw new TypeError(`Código de dominio desconocido: ${code}`);
        super(message);
        this.name = 'FixtureDomainError';
        this.code = code;
        this.retryable = RETRYABLE_CODES.has(code);
        this.details = details;
    }
}

export function domainError(code, message, details) {
    return new FixtureDomainError(code, message, details);
}
