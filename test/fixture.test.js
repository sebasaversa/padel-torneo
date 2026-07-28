import assert from 'node:assert/strict';
import test from 'node:test';

import { generateSchedule, getCourts, getNumRounds } from '../src/features/fixture/generator.js';
import { resizeRounds } from '../src/features/fixture/rounds.js';
import { applySingleRoundPlayerChange, swapPlayersInRound } from '../src/features/fixture/player-swaps.js';

const playerIdsForRound = round => round.matches.flatMap(match => [
    match.t1_p1, match.t1_p2, match.t2_p1, match.t2_p2
]);

test('genera un fixture válido para 4 a 16 jugadores', () => {
    for (let numPlayers = 4; numPlayers <= 16; numPlayers++) {
        const schedule = generateSchedule(numPlayers);
        assert.equal(schedule.length, getNumRounds(numPlayers));
        schedule.forEach(round => {
            assert.ok(round.matches.length <= 2);
            const playerIds = playerIdsForRound(round);
            assert.equal(new Set(playerIds).size, playerIds.length);
            playerIds.forEach(id => assert.ok(id >= 0 && id < numPlayers));
        });
    }
});

test('agrega y quita rondas sin perder el estado de las rondas existentes', () => {
    const createRound = id => ({ id, matches: [] });
    const expanded = resizeRounds({
        schedule: [createRound(0)],
        collapsedRounds: { 0: true },
        targetCount: 3,
        createRound
    });
    assert.equal(expanded.schedule.length, 3);
    assert.deepEqual(expanded.collapsedRounds, { 0: true, 1: false, 2: false });

    const reduced = resizeRounds({ ...expanded, targetCount: 1, createRound });
    assert.equal(reduced.schedule.length, 1);
    assert.deepEqual(reduced.collapsedRounds, { 0: true });
});

test('respeta la cantidad seleccionada de canchas al generar el fixture', () => {
    const oneCourt = generateSchedule(9, undefined, { maxCourts: 1 });
    assert.equal(getCourts(9, 1), 1);
    assert.equal(oneCourt.length, getNumRounds(9, 1));
    oneCourt.forEach(round => assert.equal(round.matches.length, 1));

    const twoCourts = generateSchedule(9, undefined, { maxCourts: 2 });
    assert.equal(getCourts(9, 2), 2);
    twoCourts.forEach(round => assert.equal(round.matches.length, 2));

    const limitedByPlayers = generateSchedule(7, undefined, { maxCourts: 2 });
    limitedByPlayers.forEach(round => assert.equal(round.matches.length, 1));
});

test('los reemplazos mantienen jugadores únicos dentro de una ronda', () => {
    const round = {
        matches: [{ t1_p1: 0, t1_p2: 1, t2_p1: 2, t2_p2: 3, score1: '', score2: '' }]
    };
    applySingleRoundPlayerChange(round, round.matches[0], 't1_p1', 0, 2, 4);
    swapPlayersInRound(round, 1, 3, 4);
    assert.equal(new Set(playerIdsForRound(round)).size, 4);
});
