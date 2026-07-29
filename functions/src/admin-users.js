function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeEmail(value) {
    return normalizeText(value).toLowerCase();
}

function validatePassword(password) {
    if (typeof password !== 'string' || password.length < 8) {
        throw new Error('La contraseña debe tener al menos 8 caracteres.');
    }
    if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
        throw new Error('La contraseña debe incluir letras y al menos un número.');
    }
    return password;
}

export function normalizeAdminCreation(data) {
    const email = normalizeEmail(data?.email);
    if (!email) throw new Error('El email es obligatorio.');
    return {
        email,
        displayName: normalizeText(data?.displayName) || email,
        password: validatePassword(data?.password)
    };
}

export function normalizeAdminUpdate(data) {
    const updates = {};
    if (data?.email !== undefined) {
        const email = normalizeEmail(data.email);
        if (!email) throw new Error('El email no puede estar vacío.');
        updates.email = email;
    }
    if (data?.displayName !== undefined) {
        const displayName = normalizeText(data.displayName);
        if (!displayName) throw new Error('El nombre no puede estar vacío.');
        updates.displayName = displayName;
    }
    if (data?.password !== undefined) updates.password = validatePassword(data.password);
    if (data?.disabled !== undefined) updates.disabled = data.disabled === true;
    return updates;
}

export function buildAdminProfile({ email, displayName, disabled = false }, currentProfile = {}) {
    const normalizedEmail = normalizeEmail(email);
    return {
        ...currentProfile,
        displayName: normalizeText(displayName) || normalizedEmail,
        email: normalizedEmail,
        role: 'admin',
        disabled: disabled === true
    };
}

export function serializeUserRecord(user) {
    return {
        uid: user.uid,
        email: user.email || '',
        displayName: user.displayName || user.email || 'Usuario',
        disabled: user.disabled === true,
        createdAt: user.metadata?.creationTime || null,
        lastSignInAt: user.metadata?.lastSignInTime || null,
        role: user.customClaims?.platformRole || 'admin'
    };
}
