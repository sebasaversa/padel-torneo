import assert from 'node:assert/strict';
import test from 'node:test';

import { getSuperAdminAuthorization, isAdminAccount } from '../src/authorization.js';

const protectedOperations = [
    'createAdminUser', 'updateAdminUser', 'deleteAdminUser',
    'listAdminUsers', 'generateAdminPasswordResetLink'
];

test('cada operación administrativa exige autenticación de super admin', () => {
    protectedOperations.forEach(operation => {
        const guest = getSuperAdminAuthorization(null);
        const admin = getSuperAdminAuthorization({ uid: 'admin', token: { platformRole: 'admin' } });
        const superAdmin = getSuperAdminAuthorization({ uid: 'super', token: { platformRole: 'superAdmin' } });
        assert.equal(guest.allowed, false, `${operation} debe rechazar invitados`);
        assert.equal(guest.code, 'unauthenticated');
        assert.equal(admin.allowed, false, `${operation} debe rechazar admins comunes`);
        assert.equal(admin.code, 'permission-denied');
        assert.equal(superAdmin.allowed, true, `${operation} debe permitir al super admin`);
    });
});

test('eliminación y recuperación se limitan a cuentas admin', () => {
    assert.equal(isAdminAccount({ customClaims: { platformRole: 'admin' } }), true);
    assert.equal(isAdminAccount({ customClaims: { platformRole: 'superAdmin' } }), false);
    assert.equal(isAdminAccount({}), false);
});
