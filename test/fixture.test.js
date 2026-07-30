import assert from 'node:assert/strict';
import test from 'node:test';
import {
    analyzeSchedule,
    validateSchedule
} from '../src/features/fixture/analysis.js';
import {
    canonicalizeFixedTeams,
    scheduleFingerprint,
    validateConfiguration
} from '../src/features/fixture/canonical.js';
import {
    extendScheduleSequentially,
    generateSchedule,
    recommendNumRounds
} from '../src/features/fixture/generator.js';
import { optimizeSchedule } from '../src/features/fixture/optimizer.js';
import { hasAnyScore } from '../src/state/model.js';

function rotating(numPlayers, numCourts) {
    return {
        numPlayers,
        numCourts,
        pairingMode: 'rotating',
        fixedTeams: [],
        fixtureGeneratorVersion: 1,
        catalogVersion: 1
    };
}

function fixed(numPlayers, numCourts) {
    return {
        numPlayers,
        numCourts,
        pairingMode: 'fixed',
        fixedTeams: Array.from({ length: numPlayers / 2 }, (_, teamIndex) => ({
            id: `team-${teamIndex * 2}-${teamIndex * 2 + 1}`,
            playerIds: [teamIndex * 2, teamIndex * 2 + 1]
        })),
        fixtureGeneratorVersion: 1,
        catalogVersion: 1
    };
}

function generate(configuration, numRounds, fixtureVariant = 0) {
    return generateSchedule({
        configuration,
        numRounds,
        fixtureVariant,
        generationContext: { type: 'fresh' }
    });
}

test('corrige 8×2×7 con las 28 parejas y dos cruces por rival', () => {
    const result = generate(rotating(8, 2), 7);
    assert.equal(result.diagnostic.solutionClass, 'exact');
    assert.equal(result.diagnostic.uniquePartners, 28);
    assert.equal(result.diagnostic.repeatedPartners, 0);
    assert.equal(result.diagnostic.opponentFrequencyMin, 2);
    assert.equal(result.diagnostic.opponentFrequencyMax, 2);
});

test('certifica los ciclos Whist exactos y sus empaquetados físicos', () => {
    const cases = [
        [4, 1, 3], [5, 1, 5], [8, 2, 7], [9, 2, 9],
        [12, 3, 11], [13, 3, 13], [16, 4, 15],
        [8, 1, 14], [9, 1, 18], [12, 1, 33],
        [13, 1, 39], [16, 1, 60], [16, 2, 30]
    ];
    for (const [numPlayers, numCourts, numRounds] of cases) {
        const result = generate(rotating(numPlayers, numCourts), numRounds);
        assert.equal(result.diagnostic.solutionClass, 'exact', `${numPlayers}×${numCourts}×${numRounds}`);
        assert.equal(result.diagnostic.coverageStatus, 'complete');
        assert.equal(result.diagnostic.uniquePartners, result.diagnostic.possiblePartners);
        assert.equal(result.diagnostic.opponentFrequencyMin, 2);
        assert.equal(result.diagnostic.opponentFrequencyMax, 2);
    }
});

test('los prefijos exactos no repiten parejas y los ciclos extendidos quedan balanceados', () => {
    const partial = generate(rotating(8, 2), 5);
    assert.equal(partial.diagnostic.cycleStatus, 'partial');
    assert.equal(partial.diagnostic.uniquePartners, 20);
    assert.equal(partial.diagnostic.repeatedPartners, 0);
    const extended = generate(rotating(8, 2), 9);
    assert.equal(extended.diagnostic.cycleStatus, 'extended');
    assert.equal(extended.diagnostic.partnerFrequencyMax - extended.diagnostic.partnerFrequencyMin, 1);
});

test('alcanza las cotas certificadas de los diseños optimal-known', () => {
    for (const [numPlayers, numCourts, numRounds, lowerBound] of [
        [6, 1, 8, 1],
        [7, 1, 11, 1],
        [10, 2, 12, 3],
        [11, 2, 14, 1]
    ]) {
        const result = generate(rotating(numPlayers, numCourts), numRounds);
        assert.equal(result.diagnostic.solutionClass, 'optimal-known');
        assert.equal(result.diagnostic.proofStatus, 'lower-bound-certified');
        assert.deepEqual(result.diagnostic.provenObjectives, ['partnerRepetitions']);
        assert.equal(result.diagnostic.repeatedPartners, lowerBound);
        assert.equal(result.diagnostic.coverageStatus, 'complete');
    }
});

test('genera round-robin fijo sin separar equipos en 1 a 4 canchas', () => {
    for (const [numPlayers, numCourts, numRounds] of [
        [6, 1, 3], [8, 1, 6], [8, 2, 3], [10, 2, 5],
        [12, 3, 5], [14, 3, 7], [16, 4, 7]
    ]) {
        const configuration = fixed(numPlayers, numCourts);
        const result = generate(configuration, numRounds);
        validateSchedule(result.schedule, { configuration, numRounds });
        assert.equal(result.diagnostic.uniqueTeamMatchups, result.diagnostic.possibleTeamMatchups);
        assert.equal(result.diagnostic.repeatedTeamMatchups, 0);
        assert.equal(result.diagnostic.gamesSpread, 0);
    }
});

test('canonicaliza fixedTeams de forma idempotente y basada sólo en IDs', () => {
    const source = [
        { playerIds: [5, 2], label: 'nombres ignorados' },
        { playerIds: [3, 0] },
        { playerIds: [4, 1] }
    ];
    const once = canonicalizeFixedTeams(source, 6);
    const twice = canonicalizeFixedTeams(once, 6);
    assert.deepEqual(twice, once);
    assert.deepEqual(once, [
        { id: 'team-0-3', playerIds: [0, 3] },
        { id: 'team-1-4', playerIds: [1, 4] },
        { id: 'team-2-5', playerIds: [2, 5] }
    ]);
});

test('rechaza límites inválidos sin coerción ni clamping', () => {
    assert.throws(() => validateConfiguration({ ...rotating(8, 2), numCourts: 3 }), { code: 'INVALID_CONFIGURATION' });
    assert.throws(() => validateConfiguration({ ...rotating(8, 2), numPlayers: '8' }), { code: 'INVALID_CONFIGURATION' });
    assert.throws(() => validateConfiguration({ ...fixed(8, 2), fixedTeams: [{ playerIds: [0, 1] }] }), {
        code: 'INVALID_CONFIGURATION'
    });
    assert.throws(() => generate(rotating(8, 2), 0), { code: 'INVALID_CONFIGURATION' });
});

test('toda configuración de dominio produce rondas estructuralmente válidas', () => {
    for (let numPlayers = 4; numPlayers <= 16; numPlayers += 1) {
        for (let numCourts = 1; numCourts <= Math.floor(numPlayers / 4); numCourts += 1) {
            const rotatingConfiguration = rotating(numPlayers, numCourts);
            const rotatingResult = generate(rotatingConfiguration, 3);
            validateSchedule(rotatingResult.schedule, { configuration: rotatingConfiguration, numRounds: 3 });
            if (numPlayers % 2 === 0) {
                const fixedConfiguration = fixed(numPlayers, numCourts);
                const fixedResult = generate(fixedConfiguration, 3);
                validateSchedule(fixedResult.schedule, { configuration: fixedConfiguration, numRounds: 3 });
            }
        }
    }
});

test('la extensión directa es idéntica a agregar una ronda por vez y preserva el prefijo', () => {
    const configuration = rotating(10, 2);
    const initial = generate(configuration, 4).schedule;
    const direct = extendScheduleSequentially({
        immutableHistory: initial,
        targetCount: 8,
        configuration,
        fixtureVariant: 0
    });
    let incremental = { schedule: initial };
    for (let targetCount = 5; targetCount <= 8; targetCount += 1) {
        incremental = extendScheduleSequentially({
            immutableHistory: incremental.schedule,
            targetCount,
            configuration,
            fixtureVariant: 0
        });
    }
    assert.deepEqual(direct.schedule, incremental.schedule);
    assert.deepEqual(direct.schedule.slice(0, 4), initial);
});

test('el candidato seguro sobrevive al agotamiento del presupuesto', () => {
    const configuration = rotating(15, 3);
    const result = optimizeSchedule({
        configuration,
        numRounds: 5,
        fixtureVariant: 0,
        budget: { beamWidth: 1, maxOperations: 0 }
    });
    validateSchedule(result.schedule, { configuration, numRounds: 5 });
    assert.equal(result.classification.fallbackUsed, true);
});

test('fingerprint ignora scores y cambia al modificar una asignación', () => {
    const configuration = rotating(8, 2);
    const result = generate(configuration, 7);
    const original = scheduleFingerprint(result.schedule, configuration, 0);
    const scored = structuredClone(result.schedule);
    scored[0].matches[0].score1 = 4;
    assert.equal(scheduleFingerprint(scored, configuration, 0), original);
    const edited = structuredClone(result.schedule);
    [edited[0].matches[0].t1_p1, edited[0].matches[0].t2_p1] =
        [edited[0].matches[0].t2_p1, edited[0].matches[0].t1_p1];
    assert.notEqual(scheduleFingerprint(edited, configuration, 0), original);
});

test('las variantes son finitas, determinísticas y diferentes', () => {
    const first = generate(rotating(8, 2), 7, 0);
    const repeat = generate(rotating(8, 2), 7, 0);
    const second = generate(rotating(8, 2), 7, 1);
    assert.deepEqual(first, repeat);
    assert.notDeepEqual(first.schedule, second.schedule);
    assert.throws(() => generate(rotating(8, 2), 7, 2), { code: 'NO_MORE_FIXTURE_VARIANTS' });
});

test('recomienda rondas según modo y detecta cualquier score parcial', () => {
    assert.equal(recommendNumRounds(rotating(8, 2)), 7);
    assert.equal(recommendNumRounds(fixed(8, 2)), 3);
    const schedule = generate(rotating(8, 2), 1).schedule;
    assert.equal(hasAnyScore(schedule), false);
    schedule[0].matches[0].score1 = 1;
    assert.equal(hasAnyScore(schedule), true);
    const diagnostic = analyzeSchedule(schedule, {
        configuration: rotating(8, 2),
        numRounds: 1,
        fixtureVariant: 0
    });
    assert.equal(diagnostic.scheduleFingerprint.length, 64);
});
