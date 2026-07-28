import assert from 'node:assert/strict';
import test from 'node:test';

import { createFirebaseClient } from '../src/services/firebase.js';

test('inicializa Firebase una sola vez y reutiliza la base', async () => {
    let initialized = 0;
    let signedIn = 0;
    const database = { ref: () => ({}) };
    const firebase = {
        apps: [],
        initializeApp: () => { initialized += 1; firebase.apps.push({}); },
        auth: () => ({ signInAnonymously: async () => { signedIn += 1; } }),
        database: () => database
    };
    firebase.database.ServerValue = { TIMESTAMP: 'timestamp' };

    const client = createFirebaseClient({ firebase, config: { projectId: 'test' } });
    assert.equal(await client.getDatabase(), database);
    assert.equal(await client.getDatabase(), database);
    assert.equal(initialized, 1);
    assert.equal(signedIn, 1);
    assert.equal(client.serverTimestamp(), 'timestamp');
});
