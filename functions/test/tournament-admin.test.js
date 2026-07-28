import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTournamentDeletion, requireTournamentId } from '../src/tournament-admin.js';

test('valida torneos y aplica borrado lógico recuperable', () => {
    assert.equal(requireTournamentId('torneo_123'), 'torneo_123');
    assert.throws(() => requireTournamentId('corto'), /torneo/i);
    assert.deepEqual(buildTournamentDeletion({ ownerUid: 'owner' }, 'super', 'now', true), { ownerUid: 'owner', deletedAt: 'now', deletedBy: 'super', updatedAt: 'now' });
    assert.equal(buildTournamentDeletion({ deletedAt: 'before' }, 'super', 'now', false).deletedAt, null);
});
