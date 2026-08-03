import assert from 'node:assert/strict';
import test from 'node:test';

import { createAuthSession } from '../src/services/auth-session.js';

test('normaliza la sesión y usa Google para iniciar sesión', async () => {
    const user = {
        uid: 'admin-1',
        email: 'ana@ejemplo.com',
        displayName: 'Ana',
        isAnonymous: false,
        providerData: [{ providerId: 'google.com' }],
        getIdTokenResult: async force => ({ claims: { platformRole: force ? 'superAdmin' : 'admin' } })
    };
    let receivedProvider;
    class GoogleAuthProvider {}
    const session = createAuthSession({
        firebase: { auth: { GoogleAuthProvider } },
        auth: {
            currentUser: user,
            onAuthStateChanged: listener => { listener(user); return () => {}; },
            signInWithPopup: async provider => { receivedProvider = provider; return { user }; },
            signInWithEmailAndPassword: async () => ({ user }),
            signInWithCustomToken: async () => ({ user }),
            sendPasswordResetEmail: async () => {},
            signOut: async () => {}
        }
    });

    assert.deepEqual(session.currentUser(), { uid: 'admin-1', email: 'ana@ejemplo.com', displayName: 'Ana', isAnonymous: false });
    assert.equal(session.isGoogleUser(), true);
    assert.equal((await session.signInWithGoogle()).uid, 'admin-1');
    assert.ok(receivedProvider instanceof GoogleAuthProvider);
    assert.deepEqual(await session.getClaims(true), { platformRole: 'superAdmin' });
});

test('permite escuchar, iniciar con contraseña y recuperar acceso', async () => {
    const calls = [];
    const user = { uid: 'admin-2', email: 'admin@ejemplo.com', isAnonymous: false, getIdTokenResult: async () => ({ claims: { platformRole: 'admin' } }) };
    const session = createAuthSession({
        firebase: { auth: { GoogleAuthProvider: class {} } },
        auth: {
            currentUser: null,
            onAuthStateChanged: listener => { listener(null); return () => {}; },
            signInWithPopup: async () => ({ user }),
            signInWithEmailAndPassword: async (email, password) => { calls.push([email, password]); return { user }; },
            signInWithCustomToken: async token => { calls.push(['token', token]); return { user }; },
            sendPasswordResetEmail: async email => { calls.push(['reset', email]); },
            signOut: async () => { calls.push(['signOut']); }
        }
    });

    let observed;
    session.subscribe(userSession => { observed = userSession; });
    await session.signInWithEmailAndPassword(' admin@ejemplo.com ', 'secreto');
    await session.signInWithCustomToken('custom-token');
    await session.sendPasswordReset(' admin@ejemplo.com ');
    await session.signOut();
    assert.equal(observed, null);
    assert.equal(session.isGoogleUser(), false);
    assert.deepEqual(calls, [
        ['admin@ejemplo.com', 'secreto'],
        ['token', 'custom-token'],
        ['reset', 'admin@ejemplo.com'],
        ['signOut']
    ]);
    assert.deepEqual(await session.getClaims(), {});
});
