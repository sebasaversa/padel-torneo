import assert from 'node:assert/strict';
import test from 'node:test';

import { createFirebaseClient } from '../src/services/firebase.js';
import { createTournamentSync } from '../src/services/tournament-sync.js';

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

test('sincroniza estado remoto y guarda el estado local', async () => {
    let stateListener;
    let savedPayload;
    const stateRef = {
        on: (_event, listener) => { stateListener = listener; return listener; },
        off: () => {}
    };
    const tournamentRef = {
        child: key => key === 'state' ? stateRef : null,
        update: async payload => { savedPayload = payload; }
    };
    const database = { ref: () => tournamentRef };
    const statuses = [];
    const received = [];
    const sync = createTournamentSync({
        database,
        serverTimestamp: () => 'timestamp',
        getState: () => ({ players: ['Ana'] }),
        getStateSignature: state => JSON.stringify(state),
        onRemoteState: (state, meta) => received.push({ state, meta }),
        onStatus: status => statuses.push(status)
    });

    sync.connect('abc');
    stateListener({ val: () => ({ players: ['Beto'] }) });
    assert.equal(received[0].meta.changedByAnotherDevice, true);
    await sync.saveNow();
    assert.deepEqual(savedPayload, { state: { players: ['Ana'] }, updatedAt: 'timestamp' });
    assert.ok(statuses.includes('Sincronizado en todos los dispositivos'));
});
