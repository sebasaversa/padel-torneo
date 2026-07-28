import assert from 'node:assert/strict';
import test from 'node:test';

import { createDefaultState, normalizeState } from '../src/state/model.js';

test('normaliza estados de torneos anteriores sin campos nuevos', () => {
    const legacy = {
        players: ['Ana', 'Beto', 'Caro', 'Dani'],
        schedule: [],
        gamesPerSet: '6'
    };
    const state = normalizeState(legacy);
    assert.equal(state.numPlayers, 4);
    assert.equal(state.gamesPerSet, 6);
    assert.deepEqual(state.collapsedRounds, {});
    assert.equal(state.tournamentName, '');
    assert.equal(state.tournamentDate, '');
});

test('crea un estado inicial completo y limita games inválidos', () => {
    const initial = createDefaultState({ numPlayers: 5, gamesPerSet: 3 });
    assert.equal(initial.players.length, 5);
    assert.equal(initial.gamesPerSet, 3);
    assert.equal(normalizeState({ players: ['Ana'], gamesPerSet: 99 }, { maxGamesPerSet: 20 }).gamesPerSet, 20);
});
