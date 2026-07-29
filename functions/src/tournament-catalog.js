export function getTournamentCatalogAuthorization(auth) {
    if (!auth) return { allowed: false, code: 'unauthenticated', message: 'Iniciá sesión para ver el historial.' };
    const role = auth.token?.platformRole;
    if (role !== 'superAdmin' && role !== 'admin') {
        return { allowed: false, code: 'permission-denied', message: 'No tenés permiso para ver el historial de torneos.' };
    }
    return { allowed: true, auth, role };
}

export function buildTournamentCatalogPayload(tournaments, { uid, role, profiles = {} }) {
    return Object.fromEntries(Object.entries(tournaments || {})
        .filter(([, tournament]) => {
            if (role === 'superAdmin') return true;
            const metadata = tournament?.metadata || {};
            return !metadata.deletedAt && (metadata.ownerUid === uid || metadata.admins?.[uid] === true);
        })
        .map(([id, tournament]) => {
            const metadata = tournament?.metadata || {};
            const creatorUid = metadata.ownerUid || Object.keys(metadata.admins || {})[0] || null;
            const profile = creatorUid ? profiles[creatorUid] || {} : {};
            return [id, {
            updatedAt: Number.isFinite(tournament?.updatedAt) ? tournament.updatedAt : 0,
            state: {
                tournamentName: tournament?.state?.tournamentName || '',
                tournamentDate: tournament?.state?.tournamentDate || ''
            },
            metadata: {
                ownerUid: metadata.ownerUid || null,
                admins: metadata.admins || {},
                deletedAt: metadata.deletedAt || null,
                creatorName: profile.displayName || profile.email || (creatorUid ? 'Administrador registrado' : 'No registrado'),
                createdAt: metadata.createdAt || metadata.migratedAt || null
            }
        }];
        }));
}
