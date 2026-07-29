import assert from 'node:assert/strict';
import test from 'node:test';

import {
    createTournamentHistoryStore,
    normalizeTournamentHistory,
    upsertTournamentHistory
} from '../src/services/tournament-history.js';
import { filterTournamentCatalog } from '../src/services/tournament-catalog.js';

test('segmenta el catálogo por propiedad, asignación y rol', () => {
    const entries = [
        { id: 'own', ownerUid: 'admin', admins: {}, deletedAt: null },
        { id: 'assigned', ownerUid: 'other', admins: { admin: true }, deletedAt: null },
        { id: 'deleted', ownerUid: 'admin', admins: {}, deletedAt: 1 }
    ];
    assert.deepEqual(filterTournamentCatalog(entries, { uid: 'admin', role: 'admin' }).map(entry => entry.id), ['own', 'assigned']);
    assert.equal(filterTournamentCatalog(entries, { uid: 'super', role: 'superAdmin' }).length, 3);
    assert.equal(filterTournamentCatalog(entries, { role: '' }).length, 0);
});
import { buildTournamentHistoryMarkup } from '../src/ui/components/tournament-history.js';
import { buildTournamentCatalog } from '../src/services/tournament-catalog.js';

test('normaliza y ordena torneos anteriores', () => {
    const history = normalizeTournamentHistory([
        { id: 'old', name: 'Anterior', lastOpenedAt: 10 },
        { id: 'recent', name: 'Reciente', date: '2026-07-28', lastOpenedAt: 20 },
        { name: 'Sin id', lastOpenedAt: 30 }
    ]);
    assert.deepEqual(history.map(entry => entry.id), ['recent', 'old']);
});

test('actualiza un torneo existente sin duplicarlo', () => {
    const history = upsertTournamentHistory([
        { id: 'one', name: 'Viejo', lastOpenedAt: 1 },
        { id: 'two', name: 'Otro', lastOpenedAt: 2 }
    ], { id: 'one', name: 'Actualizado', date: '2026-07-28' }, 3);
    assert.deepEqual(history.map(entry => entry.id), ['one', 'two']);
    assert.equal(history[0].name, 'Actualizado');
});

test('guarda el historial mediante el almacenamiento local', () => {
    let value = null;
    const store = createTournamentHistoryStore({
        load: () => value,
        save: nextValue => { value = nextValue; }
    }, { now: () => 42 });
    store.remember({ id: 'abc', name: 'Viernes', date: '2026-07-28' });
    assert.deepEqual(store.load(), [{ id: 'abc', name: 'Viernes', date: '2026-07-28', lastOpenedAt: 42 }]);
});

test('genera entradas seguras y navegables para el historial', () => {
    const markup = buildTournamentHistoryMarkup([{
        id: 'torneo-1', name: '<Viernes>', date: '2026-07-28', lastOpenedAt: 42
    }], {
        formatDate: () => '28 de julio',
        formatLastOpened: () => 'Abierto recién'
    });
    assert.match(markup, /data-open-tournament="torneo-1"/);
    assert.match(markup, /&lt;Viernes&gt;/);
    assert.match(markup, /28 de julio · Abierto recién/);
});

test('muestra el borrado sólo cuando el super admin puede administrarlo', () => {
    const entry = [{ id: 'torneo-1', name: 'Viernes', date: '2026-07-28' }];
    assert.doesNotMatch(buildTournamentHistoryMarkup(entry), /data-delete-tournament/);
    assert.match(buildTournamentHistoryMarkup(entry, { canDelete: true }), /data-delete-tournament="torneo-1"/);
});

test('permite seleccionar varios torneos activos para borrado en lote', () => {
    const markup = buildTournamentHistoryMarkup([
        { id: 'activo', name: 'Viernes', date: '2026-07-28' },
        { id: 'eliminado', name: 'Sábado', date: '2026-07-29', deletedAt: 1 }
    ], { canDelete: true, selectedIds: new Set(['activo']) });
    assert.match(markup, /data-select-tournament="activo" checked/);
    assert.doesNotMatch(markup, /data-select-tournament="eliminado"/);
});

test('ofrece eliminación definitiva sólo a super admin para torneos ya borrados', () => {
    const entry = [{ id: 'eliminado', name: 'Sábado', deletedAt: 1 }];
    assert.doesNotMatch(buildTournamentHistoryMarkup(entry), /data-permanently-delete-tournament/);
    assert.match(buildTournamentHistoryMarkup(entry, { canDelete: true }), /data-permanently-delete-tournament="eliminado"/);
});

test('incluye todos los torneos compartidos del catálogo global', () => {
    const catalog = buildTournamentCatalog({
        old: { updatedAt: 10, state: { tournamentName: 'Anterior', tournamentDate: '2026-07-01' } },
        current: { updatedAt: 20, state: { tournamentName: 'Actual', tournamentDate: '2026-07-28' } },
        incomplete: { updatedAt: 30 }
    }, [{ id: 'old', lastOpenedAt: 99 }]);
    assert.deepEqual(catalog.map(entry => entry.id), ['current', 'old']);
    assert.equal(catalog[1].lastOpenedAt, 99);
    assert.equal(catalog[0].updatedAt, 20);
});
