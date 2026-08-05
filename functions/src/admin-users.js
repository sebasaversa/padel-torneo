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
    const profile = {
        ...currentProfile,
        displayName: normalizeText(displayName) || normalizedEmail,
        email: normalizedEmail,
        role: 'admin',
        disabled: disabled === true
    };
    if (currentProfile.accountType === 'username') delete profile.email;
    return profile;
}

export function normalizeAssignedPlatformRole(value) {
    if (value !== 'user' && value !== 'admin') {
        throw new Error('El rol debe ser user o admin.');
    }
    return value;
}

export function buildAssignedRoleProfile(user, role, currentProfile = {}) {
    const assignedRole = normalizeAssignedPlatformRole(role);
    const usernameAccount = currentProfile.accountType === 'username';
    const email = usernameAccount ? '' : normalizeEmail(currentProfile.email || user?.email);
    const profile = {
        ...currentProfile,
        displayName: normalizeText(currentProfile.displayName || user?.displayName) || email || 'Usuario',
        ...(email ? { email } : {}),
        role: assignedRole,
        disabled: user?.disabled === true
    };
    if (usernameAccount) delete profile.email;
    return profile;
}

export function buildCustomClaimsForRole(customClaims = {}, role) {
    const assignedRole = normalizeAssignedPlatformRole(role);
    const claims = { ...(customClaims || {}) };
    if (assignedRole === 'admin') claims.platformRole = 'admin';
    else delete claims.platformRole;
    return claims;
}

export function serializeUserRecord(user, profile = {}) {
    const accountType = profile.accountType || '';
    const email = accountType === 'username' ? '' : (profile.email || user.email || '');
    const providers = (user.providerData || []).map(provider => provider.providerId).filter(Boolean);
    if (!providers.length && user.email) providers.push('password');
    return {
        uid: user.uid,
        email,
        username: profile.username || '',
        displayName: profile.displayName || user.displayName || email || profile.username || 'Usuario',
        disabled: user.disabled === true,
        createdAt: user.metadata?.creationTime || null,
        lastSignInAt: user.metadata?.lastSignInTime || null,
        role: user.customClaims?.platformRole === 'superAdmin'
            ? 'superAdmin'
            : user.customClaims?.platformRole === 'admin' ? 'admin' : 'user',
        providers
    };
}
