import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildGroupPlayerId,
    buildInitialGroup,
    buildSafeGroupView,
    calculateGroupStats,
    createReceipt,
    getEffectiveGroupRole,
    groupError,
    normalizeGroupProfile
} from '../src/domain/groups-v1.js';

const operationId = '0123456789abcdef0123456789abcdef';

function sampleGroup() {
    return buildInitialGroup({
        uid: 'owner-uid',
        operationId,
        profile: { name: 'Viernes', description: 'Grupo habitual' },
        displayName: 'Sebastián',
        timestamp: 100
    });
}

test('crea grupo inicial con owner y jugador registrado estables', () => {
    const first = sampleGroup();
    const second = sampleGroup();
    assert.equal(first.groupId, second.groupId);
    assert.equal(first.group.access.ownerUid, 'owner-uid');
    assert.equal(getEffectiveGroupRole(first.group, 'owner-uid'), 'owner');
    const playerId = first.group.access.members['owner-uid'].groupPlayerId;
    assert.equal(playerId, buildGroupPlayerId(first.groupId, 'owner-uid'));
    assert.equal(first.group.players[playerId].kind, 'registered');
});

test('normaliza textos de grupo y rechaza controles', () => {
    assert.deepEqual(normalizeGroupProfile({ name: 'Padel', description: '' }), {
        name: 'Padel', description: '', visibility: 'private'
    });
    assert.throws(() => normalizeGroupProfile({ name: ' Padel ' }), /no es válido/);
    assert.throws(() => normalizeGroupProfile({ name: 'Padel\nclub' }), /no es válido/);
});

test('receipt es idempotente y rechaza reutilización con otro payload', () => {
    const { group } = sampleGroup();
    const args = {
        actorUid: 'owner-uid', operationName: 'test', operationId,
        payload: { value: 1 }, resultRef: 'ok', timestamp: 200
    };
    assert.equal(createReceipt(group, args).replayed, false);
    assert.equal(createReceipt(group, args).replayed, true);
    assert.throws(() => createReceipt(group, { ...args, payload: { value: 2 } }), error => {
        assert.equal(error.code, 'IDEMPOTENCY_KEY_REUSED');
        return true;
    });
});

test('la vista segura nunca expone hashes, grants, receipts ni outbox', () => {
    const { groupId, group } = sampleGroup();
    group.invitations.link = { type: 'generalMultiuse', status: 'active', tokenHash: 'secret', expiresAt: Date.now() + 1_000, usedCount: 0, maxUses: 10 };
    group.access.activeGeneralInvitationId = 'link';
    group.operationGrants.secret = { status: 'reserved' };
    group.operationReceipts.secret = { payloadHash: 'secret' };
    group.outbox.secret = { type: 'sync' };
    const serialized = JSON.stringify(buildSafeGroupView(groupId, group, 'owner-uid'));
    assert.equal(serialized.includes('tokenHash'), false);
    assert.equal(serialized.includes('operationGrants'), false);
    assert.equal(serialized.includes('operationReceipts'), false);
    assert.equal(serialized.includes('outbox'), false);
    assert.equal(JSON.parse(serialized).generalInvitation.remainingUses, 10);
});

test('estadísticas grupales cuentan 4-vacío como 4-0', () => {
    const { groupId, group } = sampleGroup();
    const ownerPlayerId = group.access.members['owner-uid'].groupPlayerId;
    const ids = [ownerPlayerId];
    for (let index = 1; index < 4; index += 1) {
        const id = buildGroupPlayerId(groupId, `p-${index}`);
        ids.push(id);
        group.players[id] = {
            displayName: `Jugador ${index + 1}`, kind: 'provisional', status: 'active'
        };
    }
    group.tournamentRefs.t_1 = { status: 'active', groupId };
    const participantRefs = Object.fromEntries(ids.map((id, index) => [index, { groupPlayerId: id }]));
    const tournaments = {
        t_1: {
            public: {
                metadata: { groupId },
                state: {
                    gamesPerSet: 4,
                    participantRefs,
                    schedule: [{ matches: [{
                        t1_p1: 0, t1_p2: 1, t2_p1: 2, t2_p2: 3,
                        score1: 4, score2: ''
                    }] }]
                }
            }
        }
    };
    const stats = calculateGroupStats(group, tournaments);
    const owner = stats.find(item => item.groupPlayerId === ownerPlayerId);
    const loser = stats.find(item => item.groupPlayerId === ids[2]);
    assert.equal(owner.wins, 1);
    assert.equal(owner.gamesFor, 4);
    assert.equal(owner.gamesAgainst, 0);
    assert.equal(loser.losses, 1);
    assert.equal(loser.gamesAgainst, 4);
});

test('calcula el límite v1 de 250 torneos por 40 rondas sin respuesta parcial', () => {
    const { groupId, group } = sampleGroup();
    const playerIds = [group.access.members['owner-uid'].groupPlayerId];
    for (let index = 1; index < 4; index += 1) {
        const groupPlayerId = buildGroupPlayerId(groupId, `load-${index}`);
        playerIds.push(groupPlayerId);
        group.players[groupPlayerId] = {
            displayName: `Jugador ${index + 1}`, kind: 'provisional', status: 'active'
        };
    }
    const tournaments = {};
    for (let tournamentIndex = 0; tournamentIndex < 250; tournamentIndex += 1) {
        const tournamentId = `t_${String(tournamentIndex).padStart(30, '0')}`;
        group.tournamentRefs[tournamentId] = { groupId, status: 'active' };
        tournaments[tournamentId] = {
            public: {
                metadata: { groupId },
                state: {
                    gamesPerSet: 4,
                    participantRefs: Object.fromEntries(
                        playerIds.map((groupPlayerId, index) => [index, { groupPlayerId }])
                    ),
                    schedule: Array.from({ length: 40 }, () => ({
                        matches: [{ t1_p1: 0, t1_p2: 1, t2_p1: 2, t2_p2: 3, score1: 4, score2: '' }]
                    }))
                }
            }
        };
    }
    const startedAt = performance.now();
    const stats = calculateGroupStats(group, tournaments);
    assert.equal(stats.reduce((total, player) => total + player.matchesPlayed, 0), 40_000);
    assert.ok(performance.now() - startedAt < 2_000);
});

test('groupError conserva código de dominio', () => {
    const error = groupError('FORBIDDEN', 'No');
    assert.equal(error.code, 'FORBIDDEN');
});
