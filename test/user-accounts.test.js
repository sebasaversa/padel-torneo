import assert from 'node:assert/strict';
import test from 'node:test';

import {
    normalizeLoginIdentifier,
    validateRegistrationInput
} from '../src/services/user-accounts.js';

test('normaliza email y username para iniciar sesión', () => {
    assert.deepEqual(normalizeLoginIdentifier(' Persona@Ejemplo.com '), {
        accountType: 'email',
        identifier: 'persona@ejemplo.com'
    });
    assert.deepEqual(normalizeLoginIdentifier(' Jugador.Uno '), {
        accountType: 'username',
        identifier: 'jugador.uno'
    });
});

test('valida el formato del username', () => {
    assert.throws(() => normalizeLoginIdentifier('ab'), /entre 3 y 24/);
    assert.throws(() => normalizeLoginIdentifier('_jugador'), /entre 3 y 24/);
    assert.throws(() => normalizeLoginIdentifier('jugador con espacio'), /entre 3 y 24/);
});

test('exige contraseña segura y confirmación coincidente', () => {
    assert.throws(() => validateRegistrationInput({
        identifier: 'jugador',
        password: 'sololetras',
        confirmation: 'sololetras'
    }), /letras y al menos un número/);
    assert.throws(() => validateRegistrationInput({
        identifier: 'jugador',
        password: 'clave123',
        confirmation: 'otra123'
    }), /no coinciden/);
    assert.deepEqual(validateRegistrationInput({
        identifier: 'jugador',
        password: 'clave123',
        confirmation: 'clave123'
    }), {
        accountType: 'username',
        identifier: 'jugador',
        password: 'clave123'
    });
});
