import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
    buildTournamentV2,
    normalizeCreationRequest
} from '../functions/src/domain/tournament-v2.js';
import { normalizeState } from '../src/state/model.js';

test('el corte rechaza v1 y todo torneo nuevo nace v2 sin resultados', () => {
    assert.throws(() => normalizeState({
        players: ['A', 'B', 'C', 'D'],
        numCourts: 1,
        schedule: []
    }), { code: 'UNSUPPORTED_SCHEMA_VERSION' });

    const request = normalizeCreationRequest({
        creationRequestId: '0123456789abcdef0123456789abcdef',
        configuration: {
            numPlayers: 4,
            numCourts: 1,
            pairingMode: 'rotating',
            fixedTeams: []
        },
        numRounds: 3,
        gamesPerSet: 4,
        players: ['A', 'B', 'C', 'D'],
        metadata: { tournamentName: 'Corte v2', tournamentDate: '2026-07-30' }
    });
    const built = buildTournamentV2({
        request,
        ownerUid: 'owner',
        tournamentId: 't_012345678901234567890123456789',
        timestamp: 1
    });
    assert.equal(built.tournament.public.schemaVersion, 2);
    assert.equal(built.access.members.owner.role, 'admin');
    assert.equal(
        built.tournament.public.state.schedule.every(round =>
            round.matches.every(match => match.score1 === '' && match.score2 === '')),
        true
    );
});

test('no quedan callables v1 y el runbook prohíbe rollback incompatible', async () => {
    const [functionsIndex, runbook] = await Promise.all([
        readFile(new URL('../functions/src/index.js', import.meta.url), 'utf8'),
        readFile(new URL('../CUTOVER-FIXTURE-V2.md', import.meta.url), 'utf8')
    ]);
    assert.doesNotMatch(functionsIndex, /export const updateParticipant(?:Pairing|Score)/);
    assert.match(runbook, /padel-torneo-ec30a/);
    assert.match(runbook, /Después del primer torneo v2/);
    assert.match(runbook, /No restaurar el backup v1 sobre la ruta\s+activa/);
});
