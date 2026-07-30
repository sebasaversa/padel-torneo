import assert from 'node:assert/strict';
import test from 'node:test';

import { createFirebaseClient } from '../src/services/firebase.js';
import { createTournamentSync } from '../src/services/tournament-sync.js';
import { createTournamentIdentity } from '../src/services/identity.js';

test('inicializa Firebase una sola vez y reutiliza la base', async () => {
    let initialized = 0;
    let signedIn = 0;
    const database = { ref: () => ({}) };
    const auth = {
        currentUser: null,
        onAuthStateChanged: listener => { listener(null); return () => {}; },
        signInAnonymously: async () => {
            signedIn += 1;
            auth.currentUser = { uid: 'anonymous-user', isAnonymous: true };
        }
    };
    const firebase = {
        apps: [],
        initializeApp: () => { initialized += 1; firebase.apps.push({}); },
        auth: () => auth,
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

test('llama Functions con el token autenticado sin depender de scripts globales', async () => {
    const auth = { currentUser: { isAnonymous: false, getIdToken: async () => 'token-seguro' } };
    let request;
    const client = createFirebaseClient({
        firebase: {
            apps: [{}], auth: () => auth,
            database: Object.assign(() => ({}), { ServerValue: { TIMESTAMP: 'timestamp' } })
        },
        config: { projectId: 'padel-test' },
        fetchFn: async (url, options) => {
            request = { url, options };
            return { ok: true, json: async () => ({ data: { role: 'superAdmin' } }) };
        }
    });
    assert.deepEqual(await client.callFunction('bootstrapSuperAdmin'), { role: 'superAdmin' });
    assert.equal(request.url, 'https://us-central1-padel-test.cloudfunctions.net/bootstrapSuperAdmin');
    assert.equal(request.options.headers.Authorization, 'Bearer token-seguro');
    assert.equal(request.options.body, '{"data":null}');
});

test('lee el campo result del protocolo callable de Firebase', async () => {
    const auth = { currentUser: { isAnonymous: false, getIdToken: async () => 'token-seguro' } };
    const client = createFirebaseClient({
        firebase: {
            apps: [{}], auth: () => auth,
            database: Object.assign(() => ({}), { ServerValue: { TIMESTAMP: 'timestamp' } })
        },
        config: { projectId: 'padel-test' },
        fetchFn: async () => ({ ok: true, json: async () => ({ result: { tournaments: { torneo: {} } } }) })
    });
    assert.deepEqual(await client.callFunction('listTournamentCatalog'), { tournaments: { torneo: {} } });
});

test('mantiene una sesión existente en lugar de reemplazarla por una anónima', async () => {
    let signedInAnonymously = 0;
    const signedInUser = { uid: 'admin-1' };
    const auth = {
        currentUser: signedInUser,
        onAuthStateChanged: listener => { listener(signedInUser); return () => {}; },
        signInAnonymously: async () => { signedInAnonymously += 1; }
    };
    const firebase = {
        apps: [],
        initializeApp: () => { firebase.apps.push({}); },
        auth: () => auth,
        database: () => ({})
    };
    firebase.database.ServerValue = { TIMESTAMP: 'timestamp' };

    const client = createFirebaseClient({ firebase, config: { projectId: 'test' } });
    await client.getDatabase();
    assert.equal(client.getAuth(), auth);
    assert.equal(signedInAnonymously, 0);
});

test('espera la restauración de sesión antes de entrar como invitado', async () => {
    let listener;
    let signedInAnonymously = 0;
    const persistedUser = { uid: 'google-user', isAnonymous: false };
    const auth = {
        currentUser: null,
        onAuthStateChanged: callback => { listener = callback; return () => {}; },
        signInAnonymously: async () => { signedInAnonymously += 1; }
    };
    const firebase = {
        apps: [],
        initializeApp: () => { firebase.apps.push({}); },
        auth: () => auth,
        database: () => ({})
    };
    firebase.database.ServerValue = { TIMESTAMP: 'timestamp' };
    const client = createFirebaseClient({ firebase, config: { projectId: 'test' } });
    const databasePromise = client.getDatabase();
    auth.currentUser = persistedUser;
    listener(persistedUser);
    await databasePromise;
    assert.equal(signedInAnonymously, 0);
});

test('escucha public v2 y confirma mutaciones tipadas sin escribir state directamente', async () => {
    let stateListener;
    let functionCall;
    const publicRef = {
        on: (_event, listener) => { stateListener = listener; return listener; },
        off: () => {}
    };
    const tournamentRef = {
        child: key => key === 'public' ? publicRef : null
    };
    const database = { ref: () => tournamentRef };
    const statuses = [];
    const received = [];
    const sync = createTournamentSync({
        database,
        callFunction: async (name, data) => {
            functionCall = { name, data };
            return { revision: 2 };
        },
        getStateSignature: state => JSON.stringify(state),
        onRemoteState: (state, meta) => received.push({ state, meta }),
        onStatus: status => statuses.push(status)
    });

    sync.connect('abc');
    const publicDocument = { schemaVersion: 2, state: { revision: 1 } };
    stateListener({ val: () => publicDocument });
    assert.equal(received[0].meta.changedByAnotherDevice, false);
    await sync.mutate('renamePlayer', { playerId: 0, name: 'Beto' }, {
        operationId: '12345678901234567890'
    });
    assert.equal(functionCall.name, 'mutateTournamentV2');
    assert.equal(functionCall.data.expectedRevision, 1);
    assert.equal(functionCall.data.type, 'renamePlayer');
    assert.deepEqual(functionCall.data.payload, { playerId: 0, name: 'Beto' });
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
    assert.deepEqual(claimData, { uid: null, presenceId: 'device-1', displayName: 'Ana', claimedAt: 'timestamp', device: 'Android · Chrome' });
    assert.equal(presenceData.actorPlayerId, 0);
});
