export function buildTournamentCatalog(tournaments, localHistory = []) {
    const localEntries = new Map(localHistory.map(entry => [entry.id, entry]));
    return Object.entries(tournaments || {})
        .map(([id, tournament]) => {
            const state = tournament?.state;
            if (!state || typeof state !== 'object') return null;
            const localEntry = localEntries.get(id);
            return {
                id,
                name: typeof state.tournamentName === 'string' && state.tournamentName.trim()
                    ? state.tournamentName.trim()
                    : 'Torneo compartido',
                date: typeof state.tournamentDate === 'string' ? state.tournamentDate : '',
                updatedAt: Number.isFinite(tournament.updatedAt) ? tournament.updatedAt : 0,
                lastOpenedAt: localEntry?.lastOpenedAt || 0
            };
        })
        .filter(Boolean)
        .sort((first, second) => second.updatedAt - first.updatedAt || second.lastOpenedAt - first.lastOpenedAt);
}

export async function loadTournamentCatalog(database, localHistory) {
    const snapshot = await database.ref('tournaments').orderByChild('updatedAt').once('value');
    return buildTournamentCatalog(snapshot.val(), localHistory);
}
