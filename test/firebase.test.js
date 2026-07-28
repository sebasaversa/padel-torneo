import assert from 'node:assert/strict';
import test from 'node:test';

import { createFirebaseClient } from '../src/services/firebase.js';
import { createTournamentSync } from '../src/services/tournament-sync.js';
import { createTournamentIdentity } from '../src/services/identity.js';

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

test('registra presencia y reclama un jugador de forma exclusiva', async () => {
    let presenceData;
    let claimData;
    const disconnect = { remove: async () => {} };
    const presenceRef = {
        onDisconnect: () => disconnect,
        set: async value => { presenceData = value; },
        update: async value => { presenceData = { ...presenceData, ...value }; },
        remove: async () => {}
    };
    const presenceListRef = { on: () => {}, off: () => {} };
    const claimsRef = { on: () => {}, off: () => {} };
    const claimRef = {
        transaction: async updater => {
            claimData = updater(null);
            return { committed: true, snapshot: { val: () => claimData } };
        },
        onDisconnect: () => disconnect,
        remove: async () => {}
    };
    const tournamentRef = {
        child: path => ({
            'presence/device-1': presenceRef,
            presence: presenceListRef,
            claims: claimsRef,
            'claims/0': claimRef
        })[path]
    };
    const identity = createTournamentIdentity({
        tournamentRef,
        presenceId: 'device-1',
        serverTimestamp: () => 'timestamp',
        getPlayerName: () => 'Ana',
        getDeviceLabel: () => 'Android · Chrome',
        onPresenceCount: () => {},
        onClaims: () => {}
    });

    await identity.connect();
    assert.equal(presenceData.connectedAt, 'timestamp');
    assert.equal(await identity.claimPlayer(0), true);
    assert.deepEqual(claimData, { presenceId: 'device-1', actorName: 'Ana', device: 'Android · Chrome' });
    assert.equal(presenceData.actorPlayerId, 0);
});
