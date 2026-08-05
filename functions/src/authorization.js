export function getAuthorizedPlatformRole(auth, superAdminUid = '') {
    const role = auth?.token?.platformRole;
    if (role === 'superAdmin') return auth?.uid === superAdminUid ? 'superAdmin' : null;
    return role === 'admin' ? 'admin' : null;
}

export function getSuperAdminAuthorization(auth, superAdminUid = '') {
    if (!auth) return { allowed: false, code: 'unauthenticated', message: 'Iniciá sesión para continuar.' };
    if (getAuthorizedPlatformRole(auth, superAdminUid) !== 'superAdmin') {
        return { allowed: false, code: 'permission-denied', message: 'Sólo el super admin puede administrar usuarios.' };
    }
    return { allowed: true, auth };
}

export function isAdminAccount(user) {
    return user?.customClaims?.platformRole === 'admin';
}
