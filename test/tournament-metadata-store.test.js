import assert from 'node:assert/strict';
import test from 'node:test';

import { createTournamentMetadataStore } from '../src/services/tournament-metadata-store.js';

test('inicializa metadata sólo una vez y preserva una asignación existente', async () => {
    let value = null;
    const ref = {
        once: async () => ({ val: () => value }),
        transaction: async updater => {
            value = updater(value);
            return { snapshot: { val: () => value } };
        }
    };
    const store = createTournamentMetadataStore({
        database: { ref: path => { assert.equal(path, 'tournaments/torneo-1/metadata'); return ref; } },
        serverTimestamp: () => 'timestamp'
    });

    const created = await store.initialize('torneo-1', 'owner-1');
    const existing = await store.initialize('torneo-1', 'owner-2');

    assert.equal(created.ownerUid, 'owner-1');
    assert.equal(existing.ownerUid, 'owner-1');
    assert.deepEqual(existing.admins, { 'owner-1': true });
});

test('lee metadata faltante como un torneo previo sin propietario', async () => {
    const store = createTournamentMetadataStore({
        database: { ref: () => ({ once: async () => ({ val: () => null }) }) },
        serverTimestamp: () => 'timestamp'
    });
    const metadata = await store.get('anterior');
    assert.equal(metadata.ownerUid, null);
    assert.deepEqual(metadata.admins, {});
});
