import assert from 'node:assert/strict';
import test from 'node:test';
import { validateSchedule } from '../src/features/fixture/analysis.js';
import {
    CATALOG_VERSION,
    FIXTURE_GENERATOR_VERSION,
    canonicalizeFixedTeams
} from '../src/features/fixture/canonical.js';
import { generateSchedule } from '../src/features/fixture/generator.js';

function random(seed) {
    let state = seed >>> 0;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 0x100000000;
    };
}

function configuration(numPlayers, numCourts, pairingMode) {
    return {
        numPlayers,
        numCourts,
        pairingMode,
        fixedTeams: pairingMode === 'fixed'
            ? Array.from({ length: numPlayers / 2 }, (_, index) => ({
                playerIds: [index * 2, index * 2 + 1]
            }))
            : [],
        fixtureGeneratorVersion: FIXTURE_GENERATOR_VERSION,
        catalogVersion: CATALOG_VERSION
    };
}

test('propiedad reproducible: la misma semilla genera JSON idéntico y válido', () => {
    for (const seed of [0x8badf00d, 0x10203040, 0xdecafbad]) {
        const rng = random(seed);
        for (let sample = 0; sample < 4; sample += 1) {
            const numPlayers = 4 + Math.floor(rng() * 13);
            const numCourts = 1 + Math.floor(rng() * Math.floor(numPlayers / 4));
            const pairingMode = numPlayers % 2 === 0 && rng() > 0.5 ? 'fixed' : 'rotating';
            const numRounds = 1 + Math.floor(rng() * 12);
            const request = {
                configuration: configuration(numPlayers, numCourts, pairingMode),
                numRounds,
                fixtureVariant: 0,
                generationContext: { type: 'fresh' }
            };
            const first = generateSchedule(request);
            const second = generateSchedule(request);
            assert.deepEqual(second, first, `semilla=${seed} muestra=${sample}`);
            validateSchedule(first.schedule, {
                configuration: request.configuration,
                numRounds
            });
        }
    }
});

test('los bordes de 100 rondas siguen siendo válidos en exact, fixed y optimized', () => {
    for (const [numPlayers, numCourts, pairingMode] of [
        [16, 4, 'rotating'],
        [14, 3, 'fixed'],
        [14, 3, 'rotating']
    ]) {
        const config = configuration(numPlayers, numCourts, pairingMode);
        const result = generateSchedule({
            configuration: config,
            numRounds: 100,
            fixtureVariant: 0,
            generationContext: { type: 'fresh' }
        });
        validateSchedule(result.schedule, { configuration: config, numRounds: 100 });
        assert.equal(result.schedule.length, 100);
    }
});

test('permutaciones equivalentes de equipos producen una única forma canónica', () => {
    const variants = [
        [[0, 5], [1, 4], [2, 3]],
        [[3, 2], [5, 0], [4, 1]],
        [[1, 4], [3, 2], [0, 5]]
    ];
    const canonical = variants.map(teams =>
        canonicalizeFixedTeams(teams.map(playerIds => ({ playerIds })), 6));
    canonical.slice(1).forEach(value => assert.deepEqual(value, canonical[0]));
});

test('valores generados alrededor de cada límite se rechazan sin coerción', () => {
    const base = configuration(8, 2, 'rotating');
    for (const invalid of [
        { ...base, numPlayers: 3 },
        { ...base, numPlayers: 17 },
        { ...base, numPlayers: '8' },
        { ...base, numCourts: 0 },
        { ...base, numCourts: 3 },
        { ...base, pairingMode: 'mixto' }
    ]) {
        assert.throws(() => generateSchedule({
            configuration: invalid,
            numRounds: 1,
            fixtureVariant: 0,
            generationContext: { type: 'fresh' }
        }));
    }
});
