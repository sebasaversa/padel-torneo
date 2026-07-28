import assert from 'node:assert/strict';
import test from 'node:test';

import {
    createUserProfile,
    normalizeUserProfile,
    updateUserProfile
} from '../src/services/user-profile.js';

test('crea un perfil de admin sin guardar contraseña', () => {
    const profile = createUserProfile({
        uid: 'admin-1',
        displayName: ' Ana ',
        email: ' ANA@EJEMPLO.COM ',
        timestamp: 1
    });
    assert.deepEqual(profile, {
        displayName: 'Ana',
        email: 'ana@ejemplo.com',
        role: 'admin',
        disabled: false,
        createdAt: 1,
        updatedAt: 1
    });
    assert.equal('password' in profile, false);
});

test('normaliza perfiles incompletos y roles no permitidos', () => {
    assert.deepEqual(normalizeUserProfile({ displayName: ' ', email: 'admin@ejemplo.com', role: 'participant' }), {
        displayName: 'admin@ejemplo.com',
        email: 'admin@ejemplo.com',
        role: 'admin',
        disabled: false,
        createdAt: null,
        updatedAt: null
    });
});

test('actualiza un perfil sin alterar su fecha de creación', () => {
    const profile = updateUserProfile({
        displayName: 'Ana', email: 'ana@ejemplo.com', role: 'admin', createdAt: 1, updatedAt: 1
    }, { displayName: 'Ana María', disabled: true }, 2);
    assert.equal(profile.displayName, 'Ana María');
    assert.equal(profile.disabled, true);
    assert.equal(profile.createdAt, 1);
    assert.equal(profile.updatedAt, 2);
});
