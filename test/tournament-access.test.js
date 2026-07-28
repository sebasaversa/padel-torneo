import assert from 'node:assert/strict';
import test from 'node:test';

import {
    addTournamentAdmin,
    canManageTournament,
    createTournamentMetadata,
    normalizeTournamentMetadata,
    removeTournamentAdmin
} from '../src/services/tournament-access.js';

test('crea metadata de torneo con el creador como admin', () => {
    assert.deepEqual(createTournamentMetadata({ ownerUid: ' owner-1 ', timestamp: 'created' }), {
        ownerUid: 'owner-1',
        admins: { 'owner-1': true },
        createdAt: 'created',
        updatedAt: 'created'
    });
});

test('normaliza torneos existentes sin metadata sin romper compatibilidad', () => {
    assert.deepEqual(normalizeTournamentMetadata(undefined), {
        ownerUid: null,
        admins: {},
        createdAt: null,
        updatedAt: null,
        deletedAt: null
    });
});

test('reconoce permisos de owner, admin y super admin', () => {
    const metadata = addTournamentAdmin(createTournamentMetadata({ ownerUid: 'owner', timestamp: 1 }), 'admin', 2);
    assert.equal(canManageTournament(metadata, 'owner'), true);
    assert.equal(canManageTournament(metadata, 'admin'), true);
    assert.equal(canManageTournament(metadata, 'guest'), false);
    assert.equal(canManageTournament(metadata, '', 'superAdmin'), true);
});

test('no permite remover al owner y sí puede quitar un admin asignado', () => {
    const withAdmin = addTournamentAdmin(createTournamentMetadata({ ownerUid: 'owner', timestamp: 1 }), 'admin', 2);
    assert.deepEqual(removeTournamentAdmin(withAdmin, 'owner', 3), withAdmin);
    assert.deepEqual(removeTournamentAdmin(withAdmin, 'admin', 3).admins, { owner: true });
});
