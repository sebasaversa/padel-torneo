import assert from 'node:assert/strict';
import test from 'node:test';

import {
    buildAssignedRoleProfile,
    buildAdminProfile,
    buildCustomClaimsForRole,
    normalizeAdminCreation,
    normalizeAdminUpdate,
    normalizeAssignedPlatformRole,
    serializeUserRecord
} from '../src/admin-users.js';

test('normaliza la creación de un admin y exige letras y número en la contraseña', () => {
    assert.deepEqual(normalizeAdminCreation({
        email: ' ANA@EJEMPLO.COM ', displayName: ' Ana ', password: 'secreta8'
    }), { email: 'ana@ejemplo.com', displayName: 'Ana', password: 'secreta8' });
    assert.throws(() => normalizeAdminCreation({ email: 'ana@ejemplo.com', password: 'corta' }), /8 caracteres/);
    assert.throws(() => normalizeAdminCreation({ email: 'ana@ejemplo.com', password: 'sololetras' }), /letras.*número/i);
});

test('limita las actualizaciones de administradores a campos seguros', () => {
    assert.deepEqual(normalizeAdminUpdate({ displayName: ' Ana ', disabled: true }), {
        displayName: 'Ana', disabled: true
    });
    assert.throws(() => normalizeAdminUpdate({ email: ' ' }), /email no puede/);
});

test('crea perfiles y respuestas públicas sin contraseñas', () => {
    const profile = buildAdminProfile({ email: 'ANA@EJEMPLO.COM', displayName: 'Ana' });
    assert.equal(profile.role, 'admin');
    const serialized = serializeUserRecord({
        uid: 'admin-1', email: 'ana@ejemplo.com', displayName: 'Ana', disabled: false,
        metadata: { creationTime: 'created', lastSignInTime: null }, customClaims: { platformRole: 'admin' }
    });
    assert.deepEqual(serialized, {
        uid: 'admin-1', email: 'ana@ejemplo.com', displayName: 'Ana', disabled: false,
        username: '', createdAt: 'created', lastSignInAt: null, role: 'admin', providers: ['password']
    });
    assert.equal('password' in serialized, false);
});

test('asigna y quita el rol admin sin depender del proveedor de acceso', () => {
    const googleUser = {
        uid: 'google-1', email: 'ana@ejemplo.com', displayName: 'Ana', disabled: false,
        customClaims: { preference: 'compact' }, providerData: [{ providerId: 'google.com' }]
    };
    assert.equal(normalizeAssignedPlatformRole('admin'), 'admin');
    assert.throws(() => normalizeAssignedPlatformRole('superAdmin'), /user o admin/);
    assert.deepEqual(buildCustomClaimsForRole(googleUser.customClaims, 'admin'), {
        preference: 'compact', platformRole: 'admin'
    });
    assert.deepEqual(buildCustomClaimsForRole({ preference: 'compact', platformRole: 'admin' }, 'user'), {
        preference: 'compact'
    });
    assert.equal(buildAssignedRoleProfile(googleUser, 'admin', { accountType: 'google' }).role, 'admin');
    assert.equal(serializeUserRecord(googleUser, { accountType: 'google' }).role, 'user');
});

test('no expone el email interno de una cuenta por username', () => {
    const authUser = {
        uid: 'username-1', email: 'interno@users.padel-torneo.invalid', metadata: {}, providerData: []
    };
    const serialized = serializeUserRecord({
        ...authUser
    }, { accountType: 'username', username: 'jugador.uno', displayName: 'Jugador' });
    assert.equal(serialized.email, '');
    assert.equal(serialized.username, 'jugador.uno');
    assert.equal('email' in buildAssignedRoleProfile(authUser, 'admin', {
        accountType: 'username', username: 'jugador.uno', displayName: 'Jugador'
    }), false);
});
