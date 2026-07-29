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
                lastOpenedAt: localEntry?.lastOpenedAt || 0,
                ownerUid: tournament?.metadata?.ownerUid || null,
                admins: tournament?.metadata?.admins || {},
                deletedAt: tournament?.metadata?.deletedAt || null
            };
        })
        .filter(Boolean)
        .sort((first, second) => second.updatedAt - first.updatedAt || second.lastOpenedAt - first.lastOpenedAt);
}

export function filterTournamentCatalog(entries, { uid = '', role = '' } = {}) {
    if (role === 'superAdmin') return entries;
    if (!uid || role !== 'admin') return [];
    return entries.filter(entry => !entry.deletedAt && (entry.ownerUid === uid || entry.admins?.[uid] === true));
}

export async function loadTournamentCatalog(callFunction, localHistory) {
    const result = await callFunction('listTournamentCatalog');
    return buildTournamentCatalog(result?.tournaments, localHistory);
}
