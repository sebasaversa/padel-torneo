import assert from 'node:assert/strict';
import test from 'node:test';
import { applyParticipantPairing, applyParticipantScore, normalizePairingRequest, normalizeScoreRequest } from '../src/participant-access.js';

test('un participante sólo cambia su partido y mantiene jugadores únicos', () => {
    const request = normalizePairingRequest({ tournamentId: 'abcdefgh', roundIndex: 0, matchIndex: 0, role: 't1_p2', playerId: 2 });
    const state = { numPlayers: 4, schedule: [{ matches: [{ t1_p1: 0, t1_p2: 1, t2_p1: 2, t2_p2: 3 }] }] };
    const changed = applyParticipantPairing(state, request, 'user-0', { 0: { uid: 'user-0' } });
    assert.deepEqual(changed.schedule[0].matches[0], { t1_p1: 0, t1_p2: 2, t2_p1: 1, t2_p2: 3 });
    assert.throws(() => applyParticipantPairing(state, request, 'user-other', {}), /propios partidos/i);
});

test('un participante sólo carga resultados de su partido y dentro del objetivo', () => {
    const state = { gamesPerSet: 4, schedule: [{ matches: [{ t1_p1: 0, t1_p2: 1, t2_p1: 2, t2_p2: 3, score1: '', score2: '' }] }] };
    const request = normalizeScoreRequest({ tournamentId: 'abcdefgh', roundIndex: 0, matchIndex: 0, team: 'score1', score: 4 });
    assert.equal(applyParticipantScore(state, request, 'user-0', { 0: { uid: 'user-0' } }).schedule[0].matches[0].score1, 4);
    assert.throws(() => applyParticipantScore(state, request, 'other', {}), /propios partidos/i);
    assert.throws(() => normalizeScoreRequest({ tournamentId: 'abcdefgh', roundIndex: 0, matchIndex: 0, team: 'score1', score: 21 }), /puntaje/i);
});
