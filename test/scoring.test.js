import assert from 'node:assert/strict';
import test from 'node:test';

import { adjustScore, normalizeScore } from '../src/features/scoring/scores.js';
import { getScoreWarning, isMatchDone, isRoundDone } from '../src/features/scoring/validation.js';

test('normaliza resultados dentro del objetivo de games', () => {
    assert.equal(normalizeScore('', 4), '');
    assert.equal(normalizeScore('invalido', 4), '');
    assert.equal(normalizeScore(-2, 4), 0);
    assert.equal(normalizeScore(7, 4), 4);
    assert.equal(adjustScore('', 1, 4), 1);
    assert.equal(adjustScore(4, 1, 4), 4);
    assert.equal(adjustScore(0, -1, 4), 0);
});

test('detecta partidos, rondas y advertencias de resultados', () => {
    const incomplete = { score1: '', score2: 2 };
    const draw = { score1: 4, score2: 4 };
    const unfinished = { score1: 2, score2: 1 };
    const valid = { score1: 4, score2: 2 };

    assert.equal(isMatchDone(incomplete), false);
    assert.equal(isMatchDone(valid), true);
    assert.match(getScoreWarning(draw, 4), /Empate/);
    assert.match(getScoreWarning(unfinished, 4), /Ningún equipo/);
    assert.equal(getScoreWarning(valid, 4), '');
    assert.equal(isRoundDone({ matches: [valid, incomplete] }), false);
    assert.equal(isRoundDone({ matches: [valid, draw] }), true);
});
