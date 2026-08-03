const USERNAME_EMAIL_DOMAIN = 'users.padel-torneo.invalid';
const USERNAME_PATTERN = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/;

function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}

export function normalizeLoginIdentifier(value) {
    const identifier = normalizeText(value);
    if (!identifier) throw new Error('Ingresá tu email o usuario.');
    if (identifier.includes('@')) {
        const email = identifier.toLowerCase();
        if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
            || email.endsWith(`@${USERNAME_EMAIL_DOMAIN}`)) {
            throw new Error('El email no es válido.');
        }
        return { accountType: 'email', identifier: email };
    }
    const username = identifier.toLowerCase();
    if (username.length < 3 || username.length > 24 || !USERNAME_PATTERN.test(username)) {
        throw new Error('El usuario debe tener entre 3 y 24 caracteres y usar sólo letras, números, punto, guion o guion bajo.');
    }
    return { accountType: 'username', identifier: username };
}

export function validateRegistrationInput({ identifier, password, confirmation }) {
    const account = normalizeLoginIdentifier(identifier);
    if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
        throw new Error('La contraseña debe tener entre 8 y 128 caracteres.');
    }
    if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
        throw new Error('La contraseña debe incluir letras y al menos un número.');
    }
    if (password !== confirmation) throw new Error('Las contraseñas no coinciden.');
    return { ...account, password };
}
