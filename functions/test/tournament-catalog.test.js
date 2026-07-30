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
        own: { public: { metadata: { ownerUid: 'admin', tournamentName: 'Propio', updatedAt: 1 } } },
        assigned: { public: { metadata: { ownerUid: 'other', tournamentName: 'Asignado', updatedAt: 2 } } },
        deleted: { public: { metadata: { ownerUid: 'admin', tournamentName: 'Borrado', updatedAt: 3, deletedAt: 1 } } },
        foreign: { public: { metadata: { ownerUid: 'other', tournamentName: 'Ajeno', updatedAt: 4 } } }
    };
    const accessByTournament = {
        own: { members: { admin: { role: 'admin' } } },
        assigned: { members: { admin: { role: 'admin' } } }
    };
    assert.deepEqual(Object.keys(buildTournamentCatalogPayload(tournaments, {
        uid: 'admin',
        role: 'admin',
        accessByTournament
    })), ['own', 'assigned']);
    assert.deepEqual(Object.keys(buildTournamentCatalogPayload(tournaments, { uid: 'super', role: 'superAdmin' })), ['own', 'assigned', 'deleted', 'foreign']);
});

test('incluye la información del creador para confirmar borrados', () => {
    const payload = buildTournamentCatalogPayload({
        torneo: { public: { metadata: { ownerUid: 'owner', createdAt: 42 } } }
    }, { uid: 'super', role: 'superAdmin', profiles: { owner: { displayName: 'Ana Pérez' } } });
    assert.equal(payload.torneo.metadata.creatorName, 'Ana Pérez');
    assert.equal(payload.torneo.metadata.createdAt, 42);
});
