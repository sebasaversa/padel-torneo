import assert from 'node:assert/strict';
import test from 'node:test';

import {
    buildAdminProfile,
    normalizeAdminCreation,
    normalizeAdminUpdate,
    serializeUserRecord
} from '../src/admin-users.js';

test('normaliza la creación de un admin y exige una contraseña fuerte', () => {
    assert.deepEqual(normalizeAdminCreation({
        email: ' ANA@EJEMPLO.COM ', displayName: ' Ana ', password: 'secreta8'
    }), { email: 'ana@ejemplo.com', displayName: 'Ana', password: 'secreta8' });
    assert.throws(() => normalizeAdminCreation({ email: 'ana@ejemplo.com', password: 'corta' }), /8 caracteres/);
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
        createdAt: 'created', lastSignInAt: null, role: 'admin'
    });
    assert.equal('password' in serialized, false);
});
