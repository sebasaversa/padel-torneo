function escapeHTML(value) {
    return String(value).replace(/[&<>'"]/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[character]));
}

export function buildTournamentHistoryMarkup(entries, { formatDate, formatLastOpened, canDelete = false, selectedIds = new Set() } = {}) {
    return entries.map(entry => {
        const date = entry.date ? (formatDate?.(entry.date) || entry.date) : 'Fecha no registrada';
        const lastOpened = formatLastOpened?.(entry.updatedAt || entry.lastOpenedAt) || '';
        const canSelect = canDelete;
        const selected = canSelect && selectedIds.has(entry.id);
        return `<div class="tournament-history-row${entry.deletedAt ? ' is-deleted' : ''}">${canSelect ? `<label class="tournament-selection"><input type="checkbox" data-select-tournament="${escapeHTML(entry.id)}"${selected ? ' checked' : ''} aria-label="Seleccionar ${escapeHTML(entry.name)}"><span>Seleccionar</span></label>` : ''}<button class="btn btn-secondary tournament-history-item" type="button" data-open-tournament="${escapeHTML(entry.id)}">
            <strong>${escapeHTML(entry.name)}</strong>
            <span>${escapeHTML(date)}${entry.deletedAt ? ' · Eliminado' : ''}${lastOpened ? ` · ${escapeHTML(lastOpened)}` : ''}</span>
        </button>${entry.deletedAt
            ? `<div class="tournament-history-deleted-actions"><button class="btn btn-secondary" type="button" data-restore-tournament="${escapeHTML(entry.id)}">Restaurar</button>${canDelete ? `<button class="btn btn-danger" type="button" data-permanently-delete-tournament="${escapeHTML(entry.id)}">Eliminar definitivamente</button>` : ''}</div>`
            : canDelete ? `<button class="btn btn-danger" type="button" data-delete-tournament="${escapeHTML(entry.id)}">🗑️ Borrar</button>` : ''}</div>`;
    }).join('');
}

export function renderTournamentHistory(container, entries, formatters = {}) {
    const card = container.closest('.tournament-history-card');
    card.hidden = !entries.length;
    container.innerHTML = entries.length ? buildTournamentHistoryMarkup(entries, formatters) : '';
}
