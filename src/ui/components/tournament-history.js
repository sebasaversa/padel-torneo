function escapeHTML(value) {
    return String(value).replace(/[&<>'"]/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[character]));
}

export function buildTournamentHistoryMarkup(entries, { formatDate, formatLastOpened } = {}) {
    return entries.map(entry => {
        const date = entry.date ? (formatDate?.(entry.date) || entry.date) : 'Fecha no registrada';
        const lastOpened = formatLastOpened?.(entry.lastOpenedAt) || '';
        return `<button class="btn btn-secondary tournament-history-item" type="button" data-open-tournament="${escapeHTML(entry.id)}">
            <strong>${escapeHTML(entry.name)}</strong>
            <span>${escapeHTML(date)}${lastOpened ? ` · ${escapeHTML(lastOpened)}` : ''}</span>
        </button>`;
    }).join('');
}

export function renderTournamentHistory(container, entries, formatters = {}) {
    const card = container.closest('.tournament-history-card');
    card.hidden = !entries.length;
    container.innerHTML = entries.length ? buildTournamentHistoryMarkup(entries, formatters) : '';
}
