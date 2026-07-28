const PLATFORM_ROLES = new Set(['superAdmin', 'admin']);

function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeRole(value) {
    return PLATFORM_ROLES.has(value) ? value : 'admin';
}

export function createUserProfile({ uid, displayName, email, role = 'admin', timestamp }) {
    const normalizedUid = normalizeText(uid);
    if (!normalizedUid) throw new Error('A user UID is required');
    const normalizedEmail = normalizeText(email).toLowerCase();
    if (!normalizedEmail) throw new Error('A user email is required');
    return {
        displayName: normalizeText(displayName) || normalizedEmail,
        email: normalizedEmail,
        role: normalizeRole(role),
        disabled: false,
        createdAt: timestamp,
        updatedAt: timestamp
    };
}

export function normalizeUserProfile(profile) {
    const source = profile && typeof profile === 'object' ? profile : {};
    const email = normalizeText(source.email).toLowerCase();
    return {
        displayName: normalizeText(source.displayName) || email || 'Usuario',
        email,
        role: normalizeRole(source.role),
        disabled: source.disabled === true,
        createdAt: source.createdAt ?? null,
        updatedAt: source.updatedAt ?? null
    };
}

export function updateUserProfile(profile, changes, timestamp) {
    const current = normalizeUserProfile(profile);
    const next = normalizeUserProfile({ ...current, ...changes });
    return {
        ...next,
        createdAt: current.createdAt,
        updatedAt: timestamp
    };
}
