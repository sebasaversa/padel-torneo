export function getSuperAdminAuthorization(auth) {
    if (!auth) return { allowed: false, code: 'unauthenticated', message: 'Iniciá sesión para continuar.' };
    if (auth.token?.platformRole !== 'superAdmin') {
        return { allowed: false, code: 'permission-denied', message: 'Sólo el super admin puede administrar usuarios.' };
    }
    return { allowed: true, auth };
}

export function isAdminAccount(user) {
    return user?.customClaims?.platformRole === 'admin';
}
