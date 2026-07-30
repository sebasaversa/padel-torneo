import assert from 'node:assert/strict';
import test from 'node:test';
import {
    applyTournamentMutation,
    buildTournamentV2,
    normalizeCreationRequest,
    normalizeMutationRequest,
    prepareFixtureMutation,
    preserveAdminRole,
    validateTournamentV2
} from '../src/domain/tournament-v2.js';

function creation(pairingMode = 'rotating') {
    const numPlayers = 8;
    return normalizeCreationRequest({
        creationRequestId: '0123456789abcdef0123456789abcdef',
        configuration: {
            numPlayers,
            numCourts: 2,
            pairingMode,
            fixedTeams: pairingMode === 'fixed'
                ? Array.from({ length: 4 }, (_, index) => ({ playerIds: [index * 2, index * 2 + 1] }))
                : []
        },
        numRounds: pairingMode === 'fixed' ? 3 : 7,
        gamesPerSet: 4,
        players: Array.from({ length: numPlayers }, (_, index) => `Jugador ${index + 1}`),
        metadata: { tournamentName: 'Viernes', tournamentDate: '2026-07-30' }
    });
}

function setup(pairingMode = 'rotating') {
    return buildTournamentV2({
        request: creation(pairingMode),
        ownerUid: 'owner',
        tournamentId: 't_012345678901234567890123456789',
        timestamp: 1
    });
}

function mutation(document, type, payload, operationId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa') {
    return normalizeMutationRequest({
        operationId,
        expectedRevision: document.public.state.revision,
        type,
        payload
    });
}

function matchIdentity(document) {
    const round = document.public.state.schedule[0];
    const match = round.matches[0];
    return {
        expectedScheduleRevision: document.public.state.scheduleRevision,
        expectedScheduleFingerprint: document.public.state.scheduleFingerprint,
        roundId: round.id,
        matchId: match.id,
        expectedPlayerIds: [match.t1_p1, match.t1_p2, match.t2_p1, match.t2_p2]
    };
}

test('crea atómicamente un torneo v2 con configuración separada e IDs estables', () => {
    const built = setup();
    assert.equal(built.tournament.public.schemaVersion, 2);
    assert.equal(built.tournament.public.configuration.numPlayers, 8);
    assert.equal(built.tournament.public.state.revision, 0);
    assert.equal(built.tournament.public.state.scheduleRevision, 0);
    assert.equal(built.tournament.public.state.scheduleFingerprint.length, 64);
    assert.equal(built.access.members.owner.role, 'admin');
    assert.equal(validateTournamentV2(built.tournament.public), true);
});

test('una mutación idempotente incrementa revisión una sola vez y rechaza reuso distinto', () => {
    const built = setup();
    const request = mutation(built.tournament, 'renamePlayer', { playerId: 0, name: 'Ana' });
    const first = applyTournamentMutation({
        tournament: built.tournament,
        access: built.access,
        request,
        actor: { uid: 'owner' },
        timestamp: 2
    });
    assert.equal(first.tournament.public.state.revision, 1);
    const replay = applyTournamentMutation({
        tournament: first.tournament,
        access: built.access,
        request,
        actor: { uid: 'owner' },
        timestamp: 3
    });
    assert.equal(replay.replayed, true);
    assert.equal(replay.tournament.public.state.revision, 1);
    const reused = normalizeMutationRequest({
        operationId: request.operationId,
        expectedRevision: 1,
        type: 'renamePlayer',
        payload: { playerId: 0, name: 'Beto' }
    });
    assert.throws(() => applyTournamentMutation({
        tournament: first.tournament,
        access: built.access,
        request: reused,
        actor: { uid: 'owner' },
        timestamp: 4
    }), { code: 'IDEMPOTENCY_KEY_REUSED' });
});

test('dos scores concurrentes contra la misma revisión producen un commit y un conflicto', () => {
    const built = setup();
    const identity = matchIdentity(built.tournament);
    const firstRequest = mutation(built.tournament, 'updateScore', {
        ...identity,
        field: 'score1',
        value: 4
    });
    const secondRequest = normalizeMutationRequest({
        operationId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        expectedRevision: 0,
        type: 'updateScore',
        payload: { ...identity, field: 'score2', value: 3 }
    });
    const first = applyTournamentMutation({
        tournament: built.tournament,
        access: built.access,
        request: firstRequest,
        actor: { uid: 'owner' },
        timestamp: 2
    });
    assert.throws(() => applyTournamentMutation({
        tournament: first.tournament,
        access: built.access,
        request: secondRequest,
        actor: { uid: 'owner' },
        timestamp: 3
    }), { code: 'REVISION_CONFLICT' });
});

test('un score obsoleto falla por fingerprint, IDs y firma de jugadores', () => {
    const built = setup();
    const identity = matchIdentity(built.tournament);
    const request = mutation(built.tournament, 'updateScore', {
        ...identity,
        expectedPlayerIds: [...identity.expectedPlayerIds].reverse(),
        field: 'score1',
        value: 4
    });
    assert.throws(() => applyTournamentMutation({
        tournament: built.tournament,
        access: built.access,
        request,
        actor: { uid: 'owner' },
        timestamp: 2
    }), { code: 'SCHEDULE_IDENTITY_MISMATCH' });
});

test('modo fijo bloquea pairing pero conserva edición de scores', () => {
    const built = setup('fixed');
    const identity = matchIdentity(built.tournament);
    const pairing = mutation(built.tournament, 'updateRotatingPairing', {
        ...identity,
        role: 't1_p1',
        playerId: 7
    });
    assert.throws(() => applyTournamentMutation({
        tournament: built.tournament,
        access: built.access,
        request: pairing,
        actor: { uid: 'owner' },
        timestamp: 2
    }), { code: 'FORBIDDEN' });
    const score = mutation(built.tournament, 'updateScore', {
        ...identity,
        field: 'score1',
        value: 4
    });
    const changed = applyTournamentMutation({
        tournament: built.tournament,
        access: built.access,
        request: score,
        actor: { uid: 'owner' },
        timestamp: 2
    });
    assert.equal(changed.tournament.public.state.schedule[0].matches[0].score1, 4);
});

test('extender preserva el prefijo y sólo incrementa scheduleRevision una vez', () => {
    const built = setup();
    const prefix = structuredClone(built.tournament.public.state.schedule);
    const request = mutation(built.tournament, 'changeRoundCount', { targetCount: 9 });
    const changed = applyTournamentMutation({
        tournament: built.tournament,
        access: built.access,
        request,
        actor: { uid: 'owner' },
        timestamp: 2
    });
    assert.deepEqual(changed.tournament.public.state.schedule.slice(0, 7), prefix);
    assert.equal(changed.tournament.public.state.scheduleRevision, 1);
    assert.equal(changed.tournament.public.state.revision, 1);
    assert.equal(changed.tournament.public.state.diagnostic.solutionClass, 'optimized');
    assert.equal(changed.tournament.public.state.diagnostic.proofStatus, 'heuristic-only');
});

test('precalcula fixtures fuera de la transacción y descarta preparados obsoletos', () => {
    const built = setup();
    const extension = mutation(built.tournament, 'changeRoundCount', { targetCount: 9 });
    const prepared = prepareFixtureMutation(built.tournament.public, extension);
    assert.equal(prepared.schedule.length, 9);
    const changed = applyTournamentMutation({
        tournament: built.tournament,
        access: built.access,
        request: extension,
        actor: { uid: 'owner' },
        timestamp: 2,
        preparedFixture: prepared
    });
    assert.equal(changed.tournament.public.state.numRounds, 9);

    const staleTournament = structuredClone(built.tournament);
    staleTournament.public.state.revision = 1;
    assert.throws(() => applyTournamentMutation({
        tournament: staleTournament,
        access: built.access,
        request: extension,
        actor: { uid: 'owner' },
        timestamp: 3,
        preparedFixture: prepared
    }), { code: 'REVISION_CONFLICT' });
});

test('un tombstone bloquea nuevas mutaciones de dominio', () => {
    const built = setup();
    built.tournament.public.metadata.deletedAt = 2;
    const request = mutation(built.tournament, 'renamePlayer', { playerId: 0, name: 'Ana' });
    assert.throws(() => applyTournamentMutation({
        tournament: built.tournament,
        access: built.access,
        request,
        actor: { uid: 'owner' },
        timestamp: 3
    }), { code: 'NOT_FOUND' });
});

test('una invitación o un claim nunca degrada un miembro administrador', () => {
    assert.equal(preserveAdminRole('admin', 'participant'), 'admin');
    assert.equal(preserveAdminRole('admin', 'spectator'), 'admin');
    assert.equal(preserveAdminRole('spectator', 'participant'), 'participant');
});

test('rechaza fechas de calendario inexistentes', () => {
    const invalid = {
        ...creation(),
        creationRequestId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        metadata: { tournamentName: 'Viernes', tournamentDate: '2026-02-30' }
    };
    assert.throws(() => normalizeCreationRequest(invalid), { code: 'INVALID_STATE' });
});
