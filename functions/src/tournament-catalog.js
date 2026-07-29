export function getTournamentCatalogAuthorization(auth) {
    if (!auth) return { allowed: false, code: 'unauthenticated', message: 'Iniciá sesión para ver el historial.' };
    const role = auth.token?.platformRole;
    if (role !== 'superAdmin' && role !== 'admin') {
        return { allowed: false, code: 'permission-denied', message: 'No tenés permiso para ver el historial de torneos.' };
    }
    return { allowed: true, auth, role };
}

export function buildTournamentCatalogPayload(tournaments, { uid, role }) {
    return Object.fromEntries(Object.entries(tournaments || {})
        .filter(([, tournament]) => {
            if (role === 'superAdmin') return true;
            const metadata = tournament?.metadata || {};
            return !metadata.deletedAt && (metadata.ownerUid === uid || metadata.admins?.[uid] === true);
        })
        .map(([id, tournament]) => [id, {
            updatedAt: Number.isFinite(tournament?.updatedAt) ? tournament.updatedAt : 0,
            state: {
                tournamentName: tournament?.state?.tournamentName || '',
                tournamentDate: tournament?.state?.tournamentDate || ''
            },
            metadata: {
                ownerUid: tournament?.metadata?.ownerUid || null,
                admins: tournament?.metadata?.admins || {},
                deletedAt: tournament?.metadata?.deletedAt || null
            }
        }]));
}
