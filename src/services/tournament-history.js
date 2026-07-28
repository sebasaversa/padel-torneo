const MAX_HISTORY_ENTRIES = 20;

export function normalizeTournamentHistory(entries, maxEntries = MAX_HISTORY_ENTRIES) {
    if (!Array.isArray(entries)) return [];
    return entries
        .filter(entry => entry && typeof entry.id === 'string' && entry.id)
        .map(entry => ({
            id: entry.id,
            name: typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : 'Torneo compartido',
            date: typeof entry.date === 'string' ? entry.date : '',
            lastOpenedAt: Number.isFinite(entry.lastOpenedAt) ? entry.lastOpenedAt : 0
        }))
        .sort((first, second) => second.lastOpenedAt - first.lastOpenedAt)
        .slice(0, maxEntries);
}

export function upsertTournamentHistory(entries, tournament, now = Date.now(), maxEntries = MAX_HISTORY_ENTRIES) {
    const normalized = normalizeTournamentHistory(entries, maxEntries)
        .filter(entry => entry.id !== tournament.id);
    return normalizeTournamentHistory([{
        id: tournament.id,
        name: tournament.name,
        date: tournament.date,
        lastOpenedAt: now
    }, ...normalized], maxEntries);
}

export function createTournamentHistoryStore(storage, { now = () => Date.now(), maxEntries = MAX_HISTORY_ENTRIES } = {}) {
    return {
        load() {
            return normalizeTournamentHistory(storage.load(), maxEntries);
        },
        remember(tournament) {
            const nextHistory = upsertTournamentHistory(storage.load(), tournament, now(), maxEntries);
            storage.save(nextHistory);
            return nextHistory;
        }
    };
}
