import { sha256 } from './domain/fixture/canonical.js';

export const USERNAME_EMAIL_DOMAIN = 'users.padel-torneo.invalid';
export const USERNAME_RESERVATION_TTL_MS = 5 * 60 * 1000;

function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}

export function normalizeUsername(value) {
    const username = normalizeText(value).toLowerCase();
    if (username.length < 3 || username.length > 24
        || !/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/.test(username)) {
        throw new Error('El usuario debe tener entre 3 y 24 caracteres y usar sólo letras, números, punto, guion o guion bajo.');
    }
    return username;
}

export function normalizeAccountPassword(password) {
    if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
        throw new Error('La contraseña debe tener entre 8 y 128 caracteres.');
    }
    if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
        throw new Error('La contraseña debe incluir letras y al menos un número.');
    }
    return password;
}

export function normalizeAccountRegistration(data = {}) {
    const identifier = normalizeText(data.identifier);
    const password = normalizeAccountPassword(data.password);
    if (identifier.includes('@')) {
        const email = identifier.toLowerCase();
        if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
            || email.endsWith(`@${USERNAME_EMAIL_DOMAIN}`)) {
            throw new Error('El email no es válido.');
        }
        return {
            accountType: 'email',
            email,
            displayName: email.split('@')[0],
            password
        };
    }
    const username = normalizeUsername(identifier);
    return {
        accountType: 'username',
        username,
        displayName: username,
        password
    };
}

export function usernameDirectoryKey(username) {
    return sha256(normalizeUsername(username));
}

export function canReserveUsername(entry, now = Date.now()) {
    if (!entry) return true;
    return entry.status === 'reserved'
        && Number.isFinite(entry.createdAt)
        && now - entry.createdAt >= USERNAME_RESERVATION_TTL_MS;
}

export function buildInternalUsernameEmail(opaqueId) {
    if (typeof opaqueId !== 'string' || !/^[A-Za-z0-9_-]{20,64}$/.test(opaqueId)) {
        throw new Error('No se pudo generar la cuenta interna.');
    }
    return `u_${opaqueId.toLowerCase()}@${USERNAME_EMAIL_DOMAIN}`;
}

export function buildMissingUsernameEmail(username) {
    return `u_${usernameDirectoryKey(username).slice(0, 32)}@${USERNAME_EMAIL_DOMAIN}`;
}

export function buildUserProfile(account, current = {}) {
    const base = {
        ...current,
        displayName: account.displayName,
        role: 'user',
        disabled: false,
        accountType: account.accountType
    };
    if (account.accountType === 'username') {
        base.username = account.username;
        delete base.email;
    } else {
        base.email = account.email;
        delete base.username;
    }
    return base;
}

export function normalizeGoogleIdentity(token = {}) {
    if (token?.firebase?.sign_in_provider !== 'google.com') {
        throw new Error('La sesión debe haberse iniciado con Google.');
    }
    const email = normalizeText(token.email).toLowerCase();
    if (!email || token.email_verified !== true) {
        throw new Error('Google no proporcionó un email verificado.');
    }
    return {
        accountType: 'google',
        email,
        displayName: normalizeText(token.name) || email.split('@')[0]
    };
}

export function buildGoogleUserProfile(identity, current = {}, platformRole = null) {
    const role = platformRole === 'superAdmin' || platformRole === 'admin'
        ? platformRole
        : 'user';
    return {
        ...current,
        displayName: normalizeText(current.displayName) || identity.displayName,
        email: identity.email,
        role,
        disabled: current.disabled === true,
        accountType: current.accountType || 'google'
    };
}
