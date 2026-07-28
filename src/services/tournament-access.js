function normalizeUid(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function normalizeAdmins(admins, ownerUid) {
    const normalized = {};
    if (admins && typeof admins === 'object') {
        Object.entries(admins).forEach(([uid, enabled]) => {
            const normalizedUid = normalizeUid(uid);
            if (normalizedUid && enabled === true) normalized[normalizedUid] = true;
        });
    }
    if (ownerUid) normalized[ownerUid] = true;
    return normalized;
}

export function createTournamentMetadata({ ownerUid, timestamp }) {
    const normalizedOwnerUid = normalizeUid(ownerUid);
    if (!normalizedOwnerUid) throw new Error('A tournament owner UID is required');
    return {
        ownerUid: normalizedOwnerUid,
        admins: { [normalizedOwnerUid]: true },
        createdAt: timestamp,
        updatedAt: timestamp
    };
}

export function normalizeTournamentMetadata(metadata) {
    const source = metadata && typeof metadata === 'object' ? metadata : {};
    const ownerUid = normalizeUid(source.ownerUid);
    return {
        ownerUid: ownerUid || null,
        admins: normalizeAdmins(source.admins, ownerUid),
        createdAt: source.createdAt ?? null,
        updatedAt: source.updatedAt ?? null,
        deletedAt: source.deletedAt ?? null
    };
}

export function canManageTournament(metadata, uid, platformRole = '') {
    const normalizedUid = normalizeUid(uid);
    if (platformRole === 'superAdmin') return true;
    if (!normalizedUid) return false;
    const normalized = normalizeTournamentMetadata(metadata);
    return normalized.ownerUid === normalizedUid || normalized.admins[normalizedUid] === true;
}

export function addTournamentAdmin(metadata, uid, timestamp) {
    const normalizedUid = normalizeUid(uid);
    if (!normalizedUid) throw new Error('An admin UID is required');
    const normalized = normalizeTournamentMetadata(metadata);
    return {
        ...normalized,
        admins: { ...normalized.admins, [normalizedUid]: true },
        updatedAt: timestamp
    };
}

export function removeTournamentAdmin(metadata, uid, timestamp) {
    const normalizedUid = normalizeUid(uid);
    const normalized = normalizeTournamentMetadata(metadata);
    if (!normalizedUid || normalizedUid === normalized.ownerUid) return normalized;
    const admins = { ...normalized.admins };
    delete admins[normalizedUid];
    return { ...normalized, admins, updatedAt: timestamp };
}
