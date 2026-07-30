export function getTournamentCatalogAuthorization(auth) {
    if (!auth) return { allowed: false, code: 'unauthenticated', message: 'Iniciá sesión para ver el historial.' };
    const role = auth.token?.platformRole;
    if (role !== 'superAdmin' && role !== 'admin') {
        return { allowed: false, code: 'permission-denied', message: 'No tenés permiso para ver el historial de torneos.' };
    }
    return { allowed: true, auth, role };
}

export function buildTournamentCatalogPayload(tournaments, {
    uid,
    role,
    profiles = {},
    accessByTournament = {}
}) {
    return Object.fromEntries(Object.entries(tournaments || {})
        .filter(([id, tournament]) => {
            if (role === 'superAdmin') return true;
            const metadata = tournament?.public?.metadata || {};
            return !metadata.deletedAt && (
                metadata.ownerUid === uid
                || accessByTournament?.[id]?.members?.[uid]?.role === 'admin'
            );
        })
        .map(([id, tournament]) => {
            const metadata = tournament?.public?.metadata || {};
            const members = accessByTournament?.[id]?.members || {};
            const admins = Object.fromEntries(Object.entries(members)
                .filter(([, member]) => member?.role === 'admin')
                .map(([memberUid]) => [memberUid, true]));
            const creatorUid = metadata.ownerUid || Object.keys(admins)[0] || null;
            const profile = creatorUid ? profiles[creatorUid] || {} : {};
            return [id, {
            updatedAt: Number.isFinite(metadata.updatedAt) ? metadata.updatedAt : 0,
            state: {
                tournamentName: metadata.tournamentName || '',
                tournamentDate: metadata.tournamentDate || ''
            },
            metadata: {
                ownerUid: metadata.ownerUid || null,
                admins,
                deletedAt: metadata.deletedAt || null,
                creatorName: profile.displayName || profile.email || (creatorUid ? 'Administrador registrado' : 'No registrado'),
                createdAt: metadata.createdAt || metadata.migratedAt || null
            }
        }];
        }));
}
