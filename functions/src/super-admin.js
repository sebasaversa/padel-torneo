export function isConfiguredSuperAdmin({ email }, configuredEmail) {
    return typeof email === 'string'
        && typeof configuredEmail === 'string'
        && email.trim().toLowerCase() === configuredEmail.trim().toLowerCase();
}

export function buildSuperAdminProfile({ email, displayName }, currentProfile = {}) {
    const normalizedEmail = email.trim().toLowerCase();
    return {
        ...currentProfile,
        displayName: typeof displayName === 'string' && displayName.trim() ? displayName.trim() : normalizedEmail,
        email: normalizedEmail,
        role: 'superAdmin',
        disabled: false
    };
}
