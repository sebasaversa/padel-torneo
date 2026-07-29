import assert from 'node:assert/strict';
import test from 'node:test';

import { buildTournamentCatalogPayload, getTournamentCatalogAuthorization } from '../src/tournament-catalog.js';

test('el catálogo permite sólo admins y super admin', () => {
    assert.equal(getTournamentCatalogAuthorization(null).allowed, false);
    assert.equal(getTournamentCatalogAuthorization({ uid: 'guest', token: {} }).allowed, false);
    assert.equal(getTournamentCatalogAuthorization({ uid: 'admin', token: { platformRole: 'admin' } }).allowed, true);
    assert.equal(getTournamentCatalogAuthorization({ uid: 'super', token: { platformRole: 'superAdmin' } }).allowed, true);
});

test('el catálogo limita al admin a sus torneos activos y deja todo al super admin', () => {
    const tournaments = {
        own: { updatedAt: 1, state: { tournamentName: 'Propio' }, metadata: { ownerUid: 'admin' } },
        assigned: { updatedAt: 2, state: { tournamentName: 'Asignado' }, metadata: { ownerUid: 'other', admins: { admin: true } } },
        deleted: { updatedAt: 3, state: { tournamentName: 'Borrado' }, metadata: { ownerUid: 'admin', deletedAt: 1 } },
        foreign: { updatedAt: 4, state: { tournamentName: 'Ajeno' }, metadata: { ownerUid: 'other' } }
    };
    assert.deepEqual(Object.keys(buildTournamentCatalogPayload(tournaments, { uid: 'admin', role: 'admin' })), ['own', 'assigned']);
    assert.deepEqual(Object.keys(buildTournamentCatalogPayload(tournaments, { uid: 'super', role: 'superAdmin' })), ['own', 'assigned', 'deleted', 'foreign']);
});
