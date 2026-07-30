import assert from 'node:assert/strict';
import test from 'node:test';
import {
    createDefaultState,
    normalizeState,
    toPublicTournament,
    withGeneratedFixture
} from '../src/state/model.js';
import { generateSchedule } from '../src/features/fixture/generator.js';
import { createTournamentState } from '../src/state/store.js';

test('crea un borrador v2 con configuración y estado separados', () => {
    const document = createDefaultState({ numPlayers: 8, numCourts: 2 });
    assert.equal(document.schemaVersion, 2);
    assert.equal(document.configuration.numPlayers, 8);
    assert.equal(document.state.players.length, 8);
    assert.deepEqual(document.ui.collapsedRounds, {});
});

test('rechaza explícitamente estados v1 en vez de completarlos', () => {
    assert.throws(() => normalizeState({
        numPlayers: 8,
        players: Array(8).fill('Jugador'),
        schedule: []
    }), { code: 'UNSUPPORTED_SCHEMA_VERSION' });
});

test('valida un documento generado y excluye preferencias del snapshot público', () => {
    const draft = createDefaultState({ numPlayers: 8, numCourts: 2 });
    const generated = generateSchedule({
        configuration: draft.configuration,
        numRounds: 7,
        fixtureVariant: 0
    });
    const document = withGeneratedFixture(draft, generated);
    document.ui.collapsedRounds[0] = true;
    const normalized = normalizeState(document);
    const publicDocument = toPublicTournament(normalized);
    assert.equal(publicDocument.state.numRounds, 7);
    assert.equal(publicDocument.state.scheduleFingerprint.length, 64);
    assert.equal('ui' in publicDocument, false);
});

test('la vista del store conserva el contrato de UI sobre el esquema anidado', () => {
    const store = createTournamentState(createDefaultState({ numPlayers: 8, numCourts: 2 }));
    assert.equal(store.value.numPlayers, 8);
    store.value.tournamentName = 'Viernes';
    store.value.players[0] = 'Ana';
    assert.equal(store.snapshot().metadata.tournamentName, 'Viernes');
    assert.equal(store.snapshot().state.players[0], 'Ana');
});

test('rechaza nombres, games y fingerprints no canónicos', () => {
    const draft = createDefaultState({ numPlayers: 8, numCourts: 2 });
    draft.state.players[0] = '  Ana  ';
    assert.throws(() => normalizeState(draft), { code: 'INVALID_STATE' });
    const other = createDefaultState({ numPlayers: 8, numCourts: 2 });
    other.state.gamesPerSet = 21;
    assert.throws(() => normalizeState(other), { code: 'INVALID_STATE' });
});
