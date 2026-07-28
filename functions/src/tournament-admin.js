export function requireTournamentId(value) {
    if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{8,}$/.test(value)) throw new Error('El torneo es obligatorio.');
    return value;
}

export function buildTournamentDeletion(metadata, actorUid, timestamp, deleted) {
    const current = metadata && typeof metadata === 'object' ? metadata : {};
    return {
        ...current,
        deletedAt: deleted ? timestamp : null,
        deletedBy: deleted ? actorUid : null,
        updatedAt: timestamp
    };
}
