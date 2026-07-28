export function setModalOpen(modalId, open) {
    const modal = document.getElementById(modalId);
    if (modal) modal.hidden = !open;
}

export function renderSummaryModal(container, { leader, positions, streak, progress, escapeHTML }) {
    container.innerHTML = `
        <div class="summary-highlight">🏆 MVP actual: ${escapeHTML(leader.name)} · ${leader.v} victorias · Dif ${leader.dif >= 0 ? '+' : ''}${leader.dif}</div>
        <p>${progress.completed} de ${progress.total} partidos anotados.</p>
        <h3>Posiciones</h3>
        <ol class="summary-list">${positions}</ol>
        <h3>Racha</h3>
        <p>${streak.longest ? `🔥 ${escapeHTML(streak.players.join(', '))} lleva la mejor racha: ${streak.longest} victoria${streak.longest > 1 ? 's' : ''}.` : '🔥 Cargá resultados para calcular la mejor racha.'}</p>`;
}
