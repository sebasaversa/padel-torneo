import { sha256, stableSerialize } from './fixture/canonical.js';

export const GROUP_LIMITS = Object.freeze({
    maxPlayers: 100,
    maxActiveMembers: 50,
    maxTournamentRefs: 250,
    maxGroupRounds: 40,
    maxPendingInvitations: 100
});

export const GROUP_ID_PATTERN = /^g_[a-f0-9]{30}$/;
export const GROUP_PLAYER_ID_PATTERN = /^gp_[a-f0-9]{30}$/;
export const INVITATION_ID_PATTERN = /^gi_[a-f0-9]{30}$/;
export const OPERATION_ID_PATTERN = /^[A-Za-z0-9_-]{20,64}$/;

export function groupError(code, message, details = {}) {
    return Object.assign(new Error(message), { code, details });
}

function requireOpaque(value, pattern, label) {
    if (typeof value !== 'string' || !pattern.test(value)) {
        throw groupError('INVALID_ARGUMENT', `${label} no es válido.`);
    }
    return value;
}

export function requireGroupId(value) {
    return requireOpaque(value, GROUP_ID_PATTERN, 'El grupo');
}

export function requireGroupPlayerId(value) {
    return requireOpaque(value, GROUP_PLAYER_ID_PATTERN, 'El jugador');
}

export function requireInvitationId(value) {
    return requireOpaque(value, INVITATION_ID_PATTERN, 'La invitación');
}

export function requireOperationId(value) {
    return requireOpaque(value, OPERATION_ID_PATTERN, 'El operationId');
}

function normalizeText(value, { label, maxLength, optional = false }) {
    if (optional && (value === undefined || value === null || value === '')) return '';
    if (typeof value !== 'string' || value !== value.trim() || !value || value.length > maxLength
        || /[\u0000-\u001f\u007f]/.test(value)) {
        throw groupError('INVALID_ARGUMENT', `${label} no es válido.`);
    }
    return value;
}

export function normalizeGroupProfile(data = {}) {
    return {
        name: normalizeText(data.name, { label: 'El nombre del grupo', maxLength: 60 }),
        description: normalizeText(data.description, {
            label: 'La descripción', maxLength: 500, optional: true
        }),
        visibility: 'private'
    };
}

export function normalizePlayerName(value) {
    return normalizeText(value, { label: 'El nombre del jugador', maxLength: 60 });
}

export function buildGroupId(uid, operationId) {
    requireOperationId(operationId);
    return `g_${sha256(`${uid}:${operationId}`).slice(0, 30)}`;
}

export function buildGroupPlayerId(groupId, identity) {
    requireGroupId(groupId);
    return `gp_${sha256(`${groupId}:${identity}`).slice(0, 30)}`;
}

export function buildInvitationId(groupId, actorUid, operationId) {
    requireGroupId(groupId);
    requireOperationId(operationId);
    return `gi_${sha256(`${groupId}:${actorUid}:${operationId}`).slice(0, 30)}`;
}

export function groupPayloadHash(value) {
    return sha256(stableSerialize(value));
}

export function buildInitialGroup({ uid, operationId, profile, displayName, timestamp }) {
    const groupId = buildGroupId(uid, operationId);
    const normalizedProfile = normalizeGroupProfile(profile);
    const playerId = buildGroupPlayerId(groupId, uid);
    const creationPayloadHash = groupPayloadHash(normalizedProfile);
    return {
        groupId,
        group: {
            schemaVersion: 1,
            profile: normalizedProfile,
            metadata: {
                status: 'active',
                statusRevision: 0,
                createdAt: timestamp,
                updatedAt: timestamp,
                creationOperationId: operationId,
                creationPayloadHash
            },
            access: {
                ownerUid: uid,
                accessRevision: 0,
                members: {
                    [uid]: {
                        role: 'member',
                        status: 'active',
                        accountStatus: 'active',
                        groupPlayerId: playerId,
                        membershipRevision: 1,
                        firstJoinedAt: timestamp,
                        activatedAt: timestamp,
                        updatedAt: timestamp
                    }
                }
            },
            players: {
                [playerId]: {
                    displayName: normalizePlayerName(displayName),
                    kind: 'registered',
                    status: 'active',
                    linkedUid: uid,
                    createdAt: timestamp,
                    updatedAt: timestamp
                }
            },
            invitations: {},
            tournamentRefs: {},
            operationGrants: {},
            operationReceipts: {},
            outbox: {}
        }
    };
}

export function getMembership(group, uid) {
    return group?.access?.members?.[uid] || null;
}

export function isEffectiveMember(member) {
    return member?.status === 'active' && member?.accountStatus === 'active';
}

export function getEffectiveGroupRole(group, uid) {
    const member = getMembership(group, uid);
    if (!isEffectiveMember(member)) return null;
    if (group?.access?.ownerUid === uid) return 'owner';
    return member.role === 'admin' ? 'admin' : 'member';
}

export function requireOperationalGroup(group) {
    if (!group) throw groupError('NOT_FOUND', 'El grupo no existe.');
    if (group.metadata?.status === 'recoveryRequired') {
        throw groupError('GROUP_RECOVERY_REQUIRED', 'El grupo requiere recuperación de ownership.');
    }
    if (group.metadata?.status !== 'active') {
        throw groupError('GROUP_ARCHIVED', 'El grupo está archivado.');
    }
    return group;
}

export function requireGroupRole(group, uid, roles) {
    const role = getEffectiveGroupRole(group, uid);
    if (!role || !roles.includes(role)) {
        throw groupError('FORBIDDEN', 'No tenés permisos para realizar esta acción.');
    }
    return role;
}

export function countEffectiveMembers(group) {
    return Object.values(group?.access?.members || {}).filter(isEffectiveMember).length;
}

export function createReceipt(group, { actorUid, operationName, operationId, payload, resultRef, timestamp }) {
    requireOperationId(operationId);
    group.operationReceipts ||= {};
    group.operationReceipts[actorUid] ||= {};
    group.operationReceipts[actorUid][operationName] ||= {};
    const receipts = group.operationReceipts[actorUid][operationName];
    const payloadHash = groupPayloadHash(payload);
    const existing = receipts[operationId];
    if (existing) {
        if (existing.payloadHash !== payloadHash) {
            throw groupError('IDEMPOTENCY_KEY_REUSED', 'El operationId ya se usó con otro contenido.');
        }
        return { replayed: true, receipt: existing };
    }
    receipts[operationId] = { payloadHash, resultRef, createdAt: timestamp };
    const ids = Object.keys(receipts);
    while (ids.length > 200) delete receipts[ids.shift()];
    return { replayed: false, receipt: receipts[operationId] };
}

export function buildSafeGroupView(groupId, group, uid) {
    const role = getEffectiveGroupRole(group, uid);
    const ownMember = getMembership(group, uid);
    if (!role && !ownMember) throw groupError('FORBIDDEN', 'No pertenecés a este grupo.');
    const canSeeCurrent = Boolean(role);
    const canAdminister = role === 'owner' || role === 'admin';
    const activeGeneralId = group.access?.activeGeneralInvitationId;
    const activeGeneral = group.invitations?.[activeGeneralId];
    return {
        groupId,
        profile: { ...group.profile },
        status: group.metadata?.status || 'active',
        role,
        ownMembership: ownMember ? {
            role: group.access?.ownerUid === uid ? 'owner' : ownMember.role,
            status: ownMember.status,
            accountStatus: ownMember.accountStatus,
            groupPlayerId: ownMember.groupPlayerId,
            firstJoinedAt: ownMember.firstJoinedAt,
            activatedAt: ownMember.activatedAt
        } : null,
        players: canSeeCurrent ? Object.entries(group.players || {}).map(([groupPlayerId, player]) => ({
            groupPlayerId,
            displayName: player.displayName,
            kind: player.kind,
            status: player.status,
            linkedUid: player.kind === 'registered' ? player.linkedUid : null
        })) : [],
        members: canSeeCurrent ? Object.entries(group.access?.members || {})
            .filter(([, member]) => isEffectiveMember(member))
            .map(([memberUid, member]) => ({
                uid: memberUid,
                role: group.access.ownerUid === memberUid ? 'owner' : member.role,
                groupPlayerId: member.groupPlayerId
            })) : [],
        invitations: canAdminister ? Object.entries(group.invitations || {})
            .filter(([, invitation]) => invitation?.type === 'username' && invitation.status === 'active')
            .map(([invitationId, invitation]) => ({
                invitationId,
                type: invitation.type,
                targetUid: invitation.targetUid,
                targetUsername: invitation.targetUsernameSnapshot || '',
                expiresAt: invitation.expiresAt,
                status: invitation.status
            })) : [],
        generalInvitation: role === 'owner' && activeGeneral?.type === 'generalMultiuse'
            && activeGeneral.status === 'active' && activeGeneral.expiresAt > Date.now()
            && activeGeneral.usedCount < activeGeneral.maxUses
            ? {
                invitationId: activeGeneralId,
                expiresAt: activeGeneral.expiresAt,
                remainingUses: activeGeneral.maxUses - activeGeneral.usedCount
            }
            : null
    };
}

function completedScore(match, gamesPerSet) {
    const aBlank = match.score1 === '' || match.score1 === null || match.score1 === undefined;
    const bBlank = match.score2 === '' || match.score2 === null || match.score2 === undefined;
    const a = aBlank ? null : Number(match.score1);
    const b = bBlank ? null : Number(match.score2);
    if (!aBlank && !bBlank && Number.isInteger(a) && Number.isInteger(b) && a !== b) return [a, b];
    if (!aBlank && bBlank && a === gamesPerSet) return [a, 0];
    if (aBlank && !bBlank && b === gamesPerSet) return [0, b];
    return null;
}

export function calculateGroupStats(group, tournamentsById) {
    const stats = {};
    Object.keys(group.players || {}).forEach(groupPlayerId => {
        stats[groupPlayerId] = {
            groupPlayerId,
            displayName: group.players[groupPlayerId].displayName,
            playerStatus: group.players[groupPlayerId].status,
            tournamentAppearances: 0,
            tournamentsWithCompletedMatch: 0,
            matchesPlayed: 0,
            wins: 0,
            losses: 0,
            gamesFor: 0,
            gamesAgainst: 0
        };
    });
    for (const [tournamentId, ref] of Object.entries(group.tournamentRefs || {})) {
        if (ref?.status !== 'active') continue;
        const tournament = tournamentsById[tournamentId]?.public || tournamentsById[tournamentId];
        if (!tournament || !ref.groupId || tournament.metadata?.groupId !== ref.groupId) {
            throw groupError('STATS_SOURCE_INCONSISTENT', 'Una fuente estadística del grupo es inconsistente.', { tournamentId });
        }
        const participantRefs = tournament.state?.participantRefs || {};
        const appeared = new Set();
        Object.values(participantRefs).forEach(value => {
            if (value?.groupPlayerId && stats[value.groupPlayerId]) appeared.add(value.groupPlayerId);
        });
        appeared.forEach(id => { stats[id].tournamentAppearances += 1; });
        const completedByPlayer = new Set();
        for (const round of tournament.state?.schedule || []) {
            for (const match of round.matches || []) {
                const score = completedScore(match, tournament.state.gamesPerSet);
                if (!score) continue;
                const [score1, score2] = score;
                const team1 = [match.t1_p1, match.t1_p2].map(id => participantRefs[id]?.groupPlayerId);
                const team2 = [match.t2_p1, match.t2_p2].map(id => participantRefs[id]?.groupPlayerId);
                for (const id of team1) {
                    if (!stats[id]) continue;
                    completedByPlayer.add(id);
                    stats[id].matchesPlayed += 1;
                    stats[id].gamesFor += score1;
                    stats[id].gamesAgainst += score2;
                    if (score1 > score2) stats[id].wins += 1;
                    else stats[id].losses += 1;
                }
                for (const id of team2) {
                    if (!stats[id]) continue;
                    completedByPlayer.add(id);
                    stats[id].matchesPlayed += 1;
                    stats[id].gamesFor += score2;
                    stats[id].gamesAgainst += score1;
                    if (score2 > score1) stats[id].wins += 1;
                    else stats[id].losses += 1;
                }
            }
        }
        completedByPlayer.forEach(id => { stats[id].tournamentsWithCompletedMatch += 1; });
    }
    return Object.values(stats).map(item => ({
        ...item,
        gameDifference: item.gamesFor - item.gamesAgainst,
        winPercentage: item.matchesPlayed ? item.wins / item.matchesPlayed : 0
    })).sort((a, b) => b.wins - a.wins
        || b.gameDifference - a.gameDifference
        || b.gamesFor - a.gamesFor
        || b.winPercentage - a.winPercentage
        || a.displayName.localeCompare(b.displayName, 'es'));
}
