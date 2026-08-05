import assert from 'node:assert/strict';
import test from 'node:test';

import {
    USERNAME_EMAIL_DOMAIN,
    USERNAME_RESERVATION_TTL_MS,
    buildInternalUsernameEmail,
    buildMissingUsernameEmail,
    buildGoogleUserProfile,
    buildUserProfile,
    canReserveUsername,
    normalizeAccountRegistration,
    normalizeGoogleIdentity,
    normalizeUsername,
    usernameDirectoryKey
} from '../src/user-accounts.js';

test('normaliza usernames sin distinguir mayúsculas', () => {
    assert.equal(normalizeUsername(' Jugador.Uno '), 'jugador.uno');
    assert.equal(usernameDirectoryKey('Jugador.Uno'), usernameDirectoryKey('jugador.uno'));
    assert.throws(() => normalizeUsername('-jugador'), /entre 3 y 24/);
});

test('normaliza altas por email o username y exige contraseña segura', () => {
    assert.deepEqual(normalizeAccountRegistration({
        identifier: ' Persona@Ejemplo.com ',
        password: 'clave123'
    }), {
        accountType: 'email',
        email: 'persona@ejemplo.com',
        displayName: 'persona',
        password: 'clave123'
    });
    assert.deepEqual(normalizeAccountRegistration({
        identifier: ' Jugador_Uno ',
        password: 'clave123'
    }), {
        accountType: 'username',
        username: 'jugador_uno',
        displayName: 'jugador_uno',
        password: 'clave123'
    });
    assert.throws(() => normalizeAccountRegistration({
        identifier: 'jugador',
        password: 'sololetras'
    }), /al menos un número/);
});

test('usa emails internos opacos y no los expone en el perfil', () => {
    const authEmail = buildInternalUsernameEmail('abcdefghijklmnopqrstuvwx');
    assert.equal(authEmail, `u_abcdefghijklmnopqrstuvwx@${USERNAME_EMAIL_DOMAIN}`);
    assert.match(buildMissingUsernameEmail('jugador'), new RegExp(`@${USERNAME_EMAIL_DOMAIN.replace('.', '\\.')}$`));
    assert.deepEqual(buildUserProfile({
        accountType: 'username',
        username: 'jugador',
        displayName: 'jugador'
    }, { email: authEmail }), {
        displayName: 'jugador',
        role: 'user',
        disabled: false,
        accountType: 'username',
        username: 'jugador'
    });
    assert.equal(buildMissingUsernameEmail('jugador').endsWith(`@${USERNAME_EMAIL_DOMAIN}`), true);
});

test('sólo recupera reservas incompletas cuando vencieron', () => {
    const now = 1_000_000;
    assert.equal(canReserveUsername(null, now), true);
    assert.equal(canReserveUsername({ status: 'active', createdAt: 0 }, now), false);
    assert.equal(canReserveUsername({ status: 'reserved', createdAt: now - 1000 }, now), false);
    assert.equal(canReserveUsername({
        status: 'reserved',
        createdAt: now - USERNAME_RESERVATION_TTL_MS
    }, now), true);
});

test('provisiona una identidad Google verificada como usuario común', () => {
    const identity = normalizeGoogleIdentity({
        email: ' Persona@Ejemplo.com ',
        email_verified: true,
        name: ' Persona ',
        firebase: { sign_in_provider: 'google.com' }
    });
    assert.deepEqual(identity, {
        accountType: 'google',
        email: 'persona@ejemplo.com',
        displayName: 'Persona'
    });
    assert.deepEqual(buildGoogleUserProfile(identity), {
        accountType: 'google',
        email: 'persona@ejemplo.com',
        displayName: 'Persona',
        role: 'user',
        disabled: false
    });
});

test('Google no cambia un rol asignado ni sobrescribe el nombre elegido', () => {
    const identity = {
        accountType: 'google', email: 'persona@ejemplo.com', displayName: 'Nombre Google'
    };
    const profile = buildGoogleUserProfile(identity, {
        displayName: 'Nombre elegido', accountType: 'email', disabled: false
    }, 'admin');
    assert.equal(profile.displayName, 'Nombre elegido');
    assert.equal(profile.accountType, 'email');
    assert.equal(profile.role, 'admin');
});

test('rechaza sesiones no Google o sin email verificado', () => {
    assert.throws(() => normalizeGoogleIdentity({
        email: 'persona@ejemplo.com', email_verified: true,
        firebase: { sign_in_provider: 'password' }
    }), /Google/);
    assert.throws(() => normalizeGoogleIdentity({
        email: 'persona@ejemplo.com', email_verified: false,
        firebase: { sign_in_provider: 'google.com' }
    }), /verificado/);
});
