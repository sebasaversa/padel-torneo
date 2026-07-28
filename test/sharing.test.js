import assert from 'node:assert/strict';
import test from 'node:test';

import {
    createSharedTournamentUrl,
    createStandaloneShareUrl,
    decodeState,
    exportStateJSON,
    importStateJSON
} from '../src/services/sharing.js';

test('crea links compartidos y conserva el estado en links locales', () => {
    const state = { players: ['Ana', 'Beto'], schedule: [] };
    assert.equal(createSharedTournamentUrl('https://ejemplo.com', '/padel/', 'abc'), 'https://ejemplo.com/padel/?torneo=abc');
    const url = createStandaloneShareUrl('https://ejemplo.com', '/padel/', state);
    assert.deepEqual(decodeState(url.split('#s=')[1]), state);
});

test('exporta e importa JSON del torneo', () => {
    const state = { players: ['Ana'], gamesPerSet: 4 };
    assert.deepEqual(importStateJSON(exportStateJSON(state)), state);
    assert.throws(() => importStateJSON('{invalido}'));
});
