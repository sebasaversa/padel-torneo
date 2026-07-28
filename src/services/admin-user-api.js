function requireUid(uid) {
    if (typeof uid !== 'string' || !uid.trim()) throw new Error('El usuario es obligatorio.');
    return uid.trim();
}

export function createAdminUserApi({ callFunction }) {
    return {
        list() {
            return callFunction('listAdminUsers');
        },
        create({ email, displayName, password }) {
            return callFunction('createAdminUser', { email, displayName, password });
        },
        update(uid, updates) {
            return callFunction('updateAdminUser', { uid: requireUid(uid), ...updates });
        },
        remove(uid) {
            return callFunction('deleteAdminUser', { uid: requireUid(uid) });
        },
        generatePasswordResetLink(uid) {
            return callFunction('generateAdminPasswordResetLink', { uid: requireUid(uid) });
        }
    };
}
