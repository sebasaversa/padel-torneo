import { randomBytes, timingSafeEqual } from 'node:crypto';
import { getAuth } from 'firebase-admin/auth';
import { getDatabase } from 'firebase-admin/database';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as functionsV1 from 'firebase-functions/v1';
import { getAuthorizedPlatformRole } from './authorization.js';
import { normalizeUsername, usernameDirectoryKey } from './user-accounts.js';
import { sha256 } from './domain/fixture/canonical.js';
import {
    GROUP_LIMITS,
    buildGroupId,
    buildGroupPlayerId,
    buildInitialGroup,
    buildInvitationId,
    buildSafeGroupView,
    calculateGroupStats,
    countEffectiveMembers,
    createReceipt,
    getEffectiveGroupRole,
    getMembership,
    groupError,
    groupPayloadHash,
    isEffectiveMember,
    normalizeGroupProfile,
    normalizePlayerName,
    requireGroupId,
    requireGroupPlayerId,
    requireGroupRole,
    requireInvitationId,
    requireOperationId,
    requireOperationalGroup
} from './domain/groups-v1.js';

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

async function enforceRateLimit(scope, key, { limit, windowMs }) {
    const bucket = Math.floor(Date.now() / windowMs);
    const ref = getDatabase().ref(`groupRateLimits/${scope}/${sha256(String(key)).slice(0, 32)}/${bucket}`);
    let blocked = false;
    await ref.transaction(current => {
        const count = Number(current?.count || 0);
        if (count >= limit) {
            blocked = true;
            return current;
        }
        return { count: count + 1, expiresAt: (bucket + 2) * windowMs };
    });
    if (blocked) throw new HttpsError('resource-exhausted', 'Se alcanzó el límite temporal de intentos. Probá más tarde.');
}

function requestIp(request) {
    return request.rawRequest?.ip || request.rawRequest?.headers?.['x-forwarded-for'] || 'unknown';
}

function toHttpsError(error) {
    if (error instanceof HttpsError) return error;
    const codes = {
        INVALID_ARGUMENT: 'invalid-argument',
        FORBIDDEN: 'permission-denied',
        NOT_FOUND: 'not-found',
        GROUP_ARCHIVED: 'failed-precondition',
        GROUP_RECOVERY_REQUIRED: 'failed-precondition',
        GROUP_BUSY: 'aborted',
        GROUP_LIMIT_REACHED: 'resource-exhausted',
        IDEMPOTENCY_KEY_REUSED: 'already-exists',
        INVITATION_EXPIRED: 'deadline-exceeded',
        REINVITE_REQUIRED: 'failed-precondition',
        STATS_SOURCE_INCONSISTENT: 'data-loss'
    };
    return new HttpsError(codes[error?.code] || 'invalid-argument', error?.message || 'La operación no es válida.', {
        domainCode: error?.code || 'INVALID_ARGUMENT',
        ...(error?.details || {})
    });
}

async function canonicalSuperAdminUid() {
    return (await getDatabase().ref('platformConfig/superAdminUid').get()).val() || '';
}

async function requireActor(request, { allowAnonymous = false } = {}) {
    if (!request.auth) {
        if (allowAnonymous) return null;
        throw new HttpsError('unauthenticated', 'Iniciá sesión para continuar.');
    }
    if (request.auth.token.firebase?.sign_in_provider === 'anonymous') {
        if (allowAnonymous) return null;
        throw new HttpsError('unauthenticated', 'Necesitás una cuenta registrada.');
    }
    const user = await getAuth().getUser(request.auth.uid);
    if (user.disabled) throw new HttpsError('permission-denied', 'La cuenta está desactivada.');
    const claimedRole = request.auth.token.platformRole || null;
    const platformRole = claimedRole === 'superAdmin'
        ? getAuthorizedPlatformRole(request.auth, await canonicalSuperAdminUid())
        : claimedRole;
    const profile = (await getDatabase().ref(`userProfiles/${user.uid}`).get()).val() || {};
    return {
        uid: user.uid,
        platformRole: platformRole || 'user',
        displayName: profile.displayName || user.displayName || profile.username || user.email?.split('@')[0] || 'Jugador'
    };
}

async function requireSupportActor(request) {
    const actor = await requireActor(request);
    if (actor.platformRole !== 'superAdmin') {
        throw new HttpsError('permission-denied', 'Sólo el super admin puede realizar esta recuperación.');
    }
    return actor;
}

async function ensureOperationalOwner(group) {
    const ownerUid = group?.access?.ownerUid;
    if (!ownerUid) throw groupError('GROUP_RECOVERY_REQUIRED', 'El grupo no tiene owner operativo.');
    try {
        const owner = await getAuth().getUser(ownerUid);
        if (owner.disabled) throw new Error('disabled');
    } catch (error) {
        throw groupError('GROUP_RECOVERY_REQUIRED', 'El owner del grupo no está disponible.');
    }
}

function effectiveGeneralInvitation(invitation, now = Date.now()) {
    return invitation?.type === 'generalMultiuse'
        && invitation.status === 'active'
        && invitation.expiresAt > now
        && invitation.usedCount < invitation.maxUses;
}

function assertNoReservedGrant(group, targetUid = null) {
    const busy = Object.values(group.operationGrants || {}).some(grant =>
        grant?.status === 'reserved' && (!targetUid || grant.actorUid === targetUid || grant.targetUid === targetUid));
    if (busy) throw groupError('GROUP_BUSY', 'Hay una operación de torneo finalizando. Reintentá en unos segundos.');
}

function safeTimestamp(value) {
    return Number.isFinite(value) ? value : 0;
}

function auditId(action, actorUid, operationId) {
    return `ga_${sha256(`${action}:${actorUid}:${operationId}`).slice(0, 30)}`;
}

async function writeAudit(groupId, { action, actorUid, targetUid = null, operationId, details = {} }) {
    const createdAt = Date.now();
    await getDatabase().ref(`groupAudit/${groupId}/${auditId(action, actorUid, operationId)}`).set({
        type: action,
        actorUid,
        targetUid,
        metadataSanitized: details,
        createdAt
    });
}

async function syncUserProjection(uid, groupId, group) {
    const member = getMembership(group, uid);
    if (!member) return;
    const projection = {
        effectiveRole: getEffectiveGroupRole(group, uid),
        membershipStatus: member.status,
        groupStatus: group.metadata?.status || 'active',
        groupNameSnapshot: group.profile?.name || '',
        accessRevision: group.access?.accessRevision || 0,
        groupUpdatedAt: group.metadata?.updatedAt || 0,
        updatedAt: Date.now()
    };
    await getDatabase().ref(`groupsByUser/${uid}/${groupId}`).transaction(current => {
        if ((current?.accessRevision || 0) > projection.accessRevision) return current;
        if ((current?.accessRevision || 0) === projection.accessRevision
            && (current?.groupUpdatedAt || 0) > projection.groupUpdatedAt) return current;
        return projection;
    });
}

async function syncAllGroupProjections(groupId, group) {
    await Promise.all(Object.keys(group?.access?.members || {}).map(uid => syncUserProjection(uid, groupId, group)));
}

async function loadGroup(groupId) {
    requireGroupId(groupId);
    const group = (await getDatabase().ref(`groupDomains/${groupId}`).get()).val();
    if (!group) throw groupError('NOT_FOUND', 'El grupo no existe.');
    return group;
}

async function drainGroupOutbox(groupId, group) {
    const latest = (await getDatabase().ref(`groupDomains/${groupId}`).get()).val() || group;
    const eventIds = Object.keys(latest?.outbox || {});
    if (!eventIds.length) return;
    await syncAllGroupProjections(groupId, latest);
    await Promise.all(Object.entries(latest.invitations || {})
        .filter(([, invitation]) => invitation?.type === 'username' && invitation.targetUid)
        .map(([invitationId, invitation]) => getDatabase()
            .ref(`groupInvitationInbox/${invitation.targetUid}/${invitationId}`)
            .set({
                groupId,
                groupNameSnapshot: latest.profile?.name || '',
                invitedByNameSnapshot: invitation.createdByNameSnapshot || '',
                expiresAt: invitation.expiresAt,
                status: invitation.status
            })));
    await Promise.all(Object.entries(latest.tournamentRefs || {}).map(([tournamentId, ref]) =>
        getDatabase().ref(`groupTournamentIndex/${groupId}/${tournamentId}`).set({
            status: ref.status,
            updatedAt: ref.updatedAt || Date.now()
        })));
    await getDatabase().ref(`groupDomains/${groupId}/outbox`).update(
        Object.fromEntries(eventIds.map(eventId => [eventId, null]))
    );
}

async function groupTransaction(groupId, update, { verifyOwner = true } = {}) {
    const ref = getDatabase().ref(`groupDomains/${groupId}`);
    // RTDB puede ejecutar inicialmente el callback con una caché local vacía,
    // aun cuando el nodo exista en el servidor. Precargar evita confundir ese
    // primer null transitorio con un grupo realmente inexistente.
    const prefetched = (await ref.get()).val();
    if (prefetched && verifyOwner && prefetched.metadata?.status !== 'recoveryRequired') {
        await ensureOperationalOwner(prefetched);
    }
    const outboxEventId = `go_${Date.now().toString(36)}_${randomBytes(8).toString('hex')}`;
    const transaction = await ref.transaction(current => {
        const updated = update(current === null && prefetched !== null ? structuredClone(prefetched) : current);
        if (updated && typeof updated === 'object') {
            updated.outbox ||= {};
            updated.outbox[outboxEventId] = { type: 'syncProjections', createdAt: Date.now() };
        }
        return updated;
    });
    if (transaction.committed && transaction.snapshot.exists()) {
        await drainGroupOutbox(groupId, transaction.snapshot.val());
    }
    return transaction;
}

export const createGroupV1 = onCall(async request => {
    const actor = await requireActor(request);
    try {
        await enforceRateLimit('createGroupByUid', actor.uid, { limit: 10, windowMs: 60 * 60 * 1000 });
        const operationId = requireOperationId(request.data?.operationId);
        const profile = normalizeGroupProfile(request.data || {});
        const { groupId, group: initial } = buildInitialGroup({
            uid: actor.uid,
            operationId,
            profile,
            displayName: actor.displayName,
            timestamp: Date.now()
        });
        const tx = await groupTransaction(groupId, current => {
            if (!current) return initial;
            if (current.metadata?.creationPayloadHash !== initial.metadata.creationPayloadHash) {
                throw groupError('IDEMPOTENCY_KEY_REUSED', 'El operationId ya creó otro grupo.');
            }
            return current;
        });
        const group = tx.snapshot.val();
        await syncUserProjection(actor.uid, groupId, group);
        await writeAudit(groupId, { action: 'createGroup', actorUid: actor.uid, operationId });
        return { groupId, replayed: Boolean(tx.snapshot.val()?.metadata?.createdAt !== initial.metadata.createdAt) };
    } catch (error) {
        throw toHttpsError(error);
    }
});

export const updateGroupV1 = onCall(async request => {
    const actor = await requireActor(request);
    try {
        const groupId = requireGroupId(request.data?.groupId);
        const operationId = requireOperationId(request.data?.operationId);
        const profile = normalizeGroupProfile(request.data || {});
        const current = await loadGroup(groupId);
        await ensureOperationalOwner(current);
        const tx = await groupTransaction(groupId, group => {
            requireOperationalGroup(group);
            requireGroupRole(group, actor.uid, ['owner', 'admin']);
            const receipt = createReceipt(group, {
                actorUid: actor.uid, operationName: 'updateGroup', operationId,
                payload: profile, resultRef: groupId, timestamp: Date.now()
            });
            if (!receipt.replayed) {
                group.profile = profile;
                group.metadata.updatedAt = Date.now();
            }
            return group;
        });
        await syncAllGroupProjections(groupId, tx.snapshot.val());
        await writeAudit(groupId, { action: 'updateGroup', actorUid: actor.uid, operationId });
        return { groupId };
    } catch (error) { throw toHttpsError(error); }
});

export const archiveGroupV1 = onCall(async request => {
    const actor = await requireActor(request);
    try {
        const groupId = requireGroupId(request.data?.groupId);
        const operationId = requireOperationId(request.data?.operationId);
        const current = await loadGroup(groupId);
        await ensureOperationalOwner(current);
        const tx = await groupTransaction(groupId, group => {
            requireOperationalGroup(group);
            requireGroupRole(group, actor.uid, ['owner']);
            assertNoReservedGrant(group);
            if (Object.values(group.tournamentRefs || {}).some(ref => ref?.status === 'provisioning')) {
                throw groupError('GROUP_BUSY', 'Hay un torneo terminando de crearse.');
            }
            createReceipt(group, {
                actorUid: actor.uid, operationName: 'archiveGroup', operationId,
                payload: { groupId }, resultRef: groupId, timestamp: Date.now()
            });
            group.metadata.status = 'archived';
            group.metadata.statusRevision = (group.metadata.statusRevision || 0) + 1;
            group.metadata.archivedAt = Date.now();
            group.metadata.updatedAt = Date.now();
            group.access.activeGeneralInvitationId = null;
            Object.values(group.invitations || {}).forEach(invitation => {
                if (invitation.status === 'active') invitation.status = 'revoked';
            });
            return group;
        });
        const archivedGroup = tx.snapshot.val();
        await syncAllGroupProjections(groupId, archivedGroup);
        await Promise.all(Object.entries(archivedGroup.invitations || {})
            .filter(([, invitation]) => invitation?.type === 'username' && invitation.targetUid)
            .map(([invitationId, invitation]) => getDatabase()
                .ref(`groupInvitationInbox/${invitation.targetUid}/${invitationId}`)
                .update({ status: invitation.status })));
        await writeAudit(groupId, { action: 'archiveGroup', actorUid: actor.uid, operationId });
        return { groupId, status: 'archived' };
    } catch (error) { throw toHttpsError(error); }
});

export const restoreGroupV1 = onCall(async request => {
    const actor = await requireActor(request);
    try {
        const groupId = requireGroupId(request.data?.groupId);
        const operationId = requireOperationId(request.data?.operationId);
        const tx = await groupTransaction(groupId, group => {
            if (!group) throw groupError('NOT_FOUND', 'El grupo no existe.');
            requireGroupRole(group, actor.uid, ['owner']);
            if (group.metadata?.status !== 'archived') throw groupError('INVALID_ARGUMENT', 'El grupo no está archivado.');
            createReceipt(group, {
                actorUid: actor.uid, operationName: 'restoreGroup', operationId,
                payload: { groupId }, resultRef: groupId, timestamp: Date.now()
            });
            group.metadata.status = 'active';
            group.metadata.statusRevision = (group.metadata.statusRevision || 0) + 1;
            group.metadata.archivedAt = null;
            group.metadata.updatedAt = Date.now();
            return group;
        });
        await syncAllGroupProjections(groupId, tx.snapshot.val());
        await writeAudit(groupId, { action: 'restoreGroup', actorUid: actor.uid, operationId });
        return { groupId, status: 'active' };
    } catch (error) { throw toHttpsError(error); }
});

export const transferGroupOwnershipV1 = onCall(async request => {
    const actor = await requireActor(request);
    try {
        const groupId = requireGroupId(request.data?.groupId);
        const operationId = requireOperationId(request.data?.operationId);
        const targetUid = typeof request.data?.targetUid === 'string' ? request.data.targetUid : '';
        const previousOwnerRole = request.data?.previousOwnerRole === 'member' ? 'member' : 'admin';
        const targetUser = await getAuth().getUser(targetUid);
        if (targetUser.disabled) throw groupError('FORBIDDEN', 'La cuenta destino está desactivada.');
        const tx = await groupTransaction(groupId, group => {
            requireOperationalGroup(group);
            requireGroupRole(group, actor.uid, ['owner']);
            assertNoReservedGrant(group);
            const target = getMembership(group, targetUid);
            if (!isEffectiveMember(target)) throw groupError('FORBIDDEN', 'El destino no es miembro activo.');
            createReceipt(group, {
                actorUid: actor.uid, operationName: 'transferOwnership', operationId,
                payload: { targetUid, previousOwnerRole }, resultRef: targetUid, timestamp: Date.now()
            });
            group.access.ownerUid = targetUid;
            group.access.members[actor.uid].role = previousOwnerRole;
            target.role = 'member';
            group.access.accessRevision = (group.access.accessRevision || 0) + 1;
            group.metadata.updatedAt = Date.now();
            return group;
        });
        await syncAllGroupProjections(groupId, tx.snapshot.val());
        await writeAudit(groupId, {
            action: 'transferOwnership', actorUid: actor.uid, targetUid, operationId,
            details: { previousOwnerRole }
        });
        return { groupId, ownerUid: targetUid };
    } catch (error) { throw toHttpsError(error); }
});

export const inviteGroupUserV1 = onCall(async request => {
    const actor = await requireActor(request);
    try {
        await enforceRateLimit('inviteByUid', actor.uid, { limit: 50, windowMs: 60 * 60 * 1000 });
        const groupId = requireGroupId(request.data?.groupId);
        const operationId = requireOperationId(request.data?.operationId);
        const username = normalizeUsername(request.data?.username);
        const directory = (await getDatabase().ref(`usernameDirectory/${usernameDirectoryKey(username)}`).get()).val();
        if (directory?.status !== 'active' || !directory.uid) throw groupError('NOT_FOUND', 'No se pudo crear la invitación.');
        const targetUid = directory.uid;
        const target = await getAuth().getUser(targetUid);
        if (target.disabled) throw groupError('NOT_FOUND', 'No se pudo crear la invitación.');
        const invitationId = buildInvitationId(groupId, actor.uid, operationId);
        const tx = await groupTransaction(groupId, group => {
            requireOperationalGroup(group);
            requireGroupRole(group, actor.uid, ['owner', 'admin']);
            if (isEffectiveMember(getMembership(group, targetUid))) throw groupError('INVALID_ARGUMENT', 'La cuenta ya pertenece al grupo.');
            const existing = group.invitations?.[invitationId];
            if (existing) return group;
            if (Object.values(group.invitations || {}).some(invitation =>
                invitation?.type === 'username'
                && invitation.targetUid === targetUid
                && invitation.status === 'active'
                && invitation.expiresAt > Date.now())) {
                throw groupError('INVALID_ARGUMENT', 'Ya existe una invitación pendiente para esa cuenta.');
            }
            const pending = Object.values(group.invitations || {}).filter(inv => inv?.status === 'active').length;
            if (pending >= GROUP_LIMITS.maxPendingInvitations) throw groupError('GROUP_LIMIT_REACHED', 'Se alcanzó el límite de invitaciones pendientes.');
            group.invitations ||= {};
            group.invitations[invitationId] = {
                type: 'username', targetUid, status: 'active', maxUses: 1, usedCount: 0,
                expiresAt: Date.now() + INVITATION_TTL_MS,
                targetUsernameSnapshot: username,
                createdByUid: actor.uid, createdByNameSnapshot: actor.displayName, createdAt: Date.now()
            };
            createReceipt(group, {
                actorUid: actor.uid, operationName: 'inviteUser', operationId,
                payload: { targetUid }, resultRef: invitationId, timestamp: Date.now()
            });
            return group;
        });
        const group = tx.snapshot.val();
        await getDatabase().ref(`groupInvitationInbox/${targetUid}/${invitationId}`).set({
            groupId, groupNameSnapshot: group.profile.name, invitedByNameSnapshot: actor.displayName,
            expiresAt: group.invitations[invitationId].expiresAt, status: 'active'
        });
        await writeAudit(groupId, { action: 'inviteUser', actorUid: actor.uid, targetUid, operationId });
        return { groupId, invitationId };
    } catch (error) { throw toHttpsError(error); }
});

function acceptMembership(group, uid, displayName, timestamp) {
    let member = getMembership(group, uid);
    if (isEffectiveMember(member)) return { groupPlayerId: member.groupPlayerId, alreadyMember: true };
    if (countEffectiveMembers(group) >= GROUP_LIMITS.maxActiveMembers) {
        throw groupError('GROUP_LIMIT_REACHED', 'El grupo alcanzó el límite de miembros activos.');
    }
    if (!member && Object.keys(group.players || {}).length >= GROUP_LIMITS.maxPlayers) {
        throw groupError('GROUP_LIMIT_REACHED', 'El grupo alcanzó el límite de jugadores.');
    }
    const groupId = group.__groupId;
    const groupPlayerId = member?.groupPlayerId || buildGroupPlayerId(groupId, uid);
    if (!member) {
        member = {
            role: 'member', status: 'active', accountStatus: 'active', groupPlayerId,
            membershipRevision: 1, firstJoinedAt: timestamp, activatedAt: timestamp, updatedAt: timestamp
        };
        group.access.members[uid] = member;
        group.players[groupPlayerId] = {
            displayName: normalizePlayerName(displayName), kind: 'registered', status: 'active',
            linkedUid: uid, createdAt: timestamp, updatedAt: timestamp
        };
    } else {
        member.role = 'member';
        member.status = 'active';
        member.accountStatus = 'active';
        member.membershipRevision = (member.membershipRevision || 0) + 1;
        member.activatedAt = timestamp;
        member.updatedAt = timestamp;
        group.players[groupPlayerId].status = 'active';
        group.players[groupPlayerId].updatedAt = timestamp;
    }
    group.access.accessRevision = (group.access.accessRevision || 0) + 1;
    return { groupPlayerId, alreadyMember: false };
}

export const acceptGroupUserInvitationV1 = onCall(async request => {
    const actor = await requireActor(request);
    try {
        const groupId = requireGroupId(request.data?.groupId);
        const invitationId = requireInvitationId(request.data?.invitationId);
        const operationId = requireOperationId(request.data?.operationId);
        const tx = await groupTransaction(groupId, group => {
            requireOperationalGroup(group);
            group.__groupId = groupId;
            const invitation = group.invitations?.[invitationId];
            if (!invitation || invitation.type !== 'username' || invitation.targetUid !== actor.uid) {
                throw groupError('FORBIDDEN', 'La invitación no es válida.');
            }
            if (invitation.status === 'accepted') return group;
            if (invitation.status !== 'active' || invitation.expiresAt <= Date.now()) {
                throw groupError('INVITATION_EXPIRED', 'La invitación venció o fue revocada.');
            }
            const joined = acceptMembership(group, actor.uid, actor.displayName, Date.now());
            invitation.status = 'accepted';
            invitation.usedCount = 1;
            invitation.acceptedUids = { [actor.uid]: { acceptedAt: Date.now(), membershipRevision: group.access.members[actor.uid].membershipRevision } };
            Object.entries(group.invitations || {}).forEach(([id, other]) => {
                if (id !== invitationId && other?.type === 'username' && other.targetUid === actor.uid && other.status === 'active') {
                    other.status = 'revoked';
                }
            });
            createReceipt(group, {
                actorUid: actor.uid, operationName: 'acceptUserInvitation', operationId,
                payload: { invitationId }, resultRef: joined.groupPlayerId, timestamp: Date.now()
            });
            delete group.__groupId;
            return group;
        });
        const group = tx.snapshot.val();
        await syncUserProjection(actor.uid, groupId, group);
        await getDatabase().ref(`groupInvitationInbox/${actor.uid}/${invitationId}`).update({ status: 'accepted' });
        await writeAudit(groupId, { action: 'acceptInvitation', actorUid: actor.uid, targetUid: actor.uid, operationId });
        return { groupId, groupPlayerId: group.access.members[actor.uid].groupPlayerId };
    } catch (error) { throw toHttpsError(error); }
});

export const rejectGroupUserInvitationV1 = onCall(async request => {
    const actor = await requireActor(request);
    try {
        const groupId = requireGroupId(request.data?.groupId);
        const invitationId = requireInvitationId(request.data?.invitationId);
        const operationId = requireOperationId(request.data?.operationId);
        await groupTransaction(groupId, group => {
            const invitation = group?.invitations?.[invitationId];
            if (!invitation || invitation.targetUid !== actor.uid || invitation.status !== 'active') {
                throw groupError('FORBIDDEN', 'La invitación no es válida.');
            }
            invitation.status = 'rejected';
            createReceipt(group, {
                actorUid: actor.uid, operationName: 'rejectInvitation', operationId,
                payload: { invitationId }, resultRef: invitationId, timestamp: Date.now()
            });
            return group;
        });
        await getDatabase().ref(`groupInvitationInbox/${actor.uid}/${invitationId}`).update({ status: 'rejected' });
        return { groupId, invitationId, status: 'rejected' };
    } catch (error) { throw toHttpsError(error); }
});

export const revokeGroupUserInvitationV1 = onCall(async request => {
    const actor = await requireActor(request);
    try {
        const groupId = requireGroupId(request.data?.groupId);
        const invitationId = requireInvitationId(request.data?.invitationId);
        const operationId = requireOperationId(request.data?.operationId);
        let targetUid;
        await groupTransaction(groupId, group => {
            requireOperationalGroup(group);
            requireGroupRole(group, actor.uid, ['owner', 'admin']);
            const invitation = group.invitations?.[invitationId];
            if (!invitation || invitation.type !== 'username' || invitation.status !== 'active') {
                throw groupError('NOT_FOUND', 'La invitación no está pendiente.');
            }
            targetUid = invitation.targetUid;
            invitation.status = 'revoked';
            createReceipt(group, {
                actorUid: actor.uid, operationName: 'revokeInvitation', operationId,
                payload: { invitationId }, resultRef: invitationId, timestamp: Date.now()
            });
            return group;
        });
        await getDatabase().ref(`groupInvitationInbox/${targetUid}/${invitationId}`).update({ status: 'revoked' });
        await writeAudit(groupId, { action: 'revokeInvitation', actorUid: actor.uid, targetUid, operationId });
        return { groupId, invitationId, status: 'revoked' };
    } catch (error) { throw toHttpsError(error); }
});

export const createGeneralGroupLinkV1 = onCall(async request => {
    const actor = await requireActor(request);
    try {
        const groupId = requireGroupId(request.data?.groupId);
        const operationId = requireOperationId(request.data?.operationId);
        const invitationId = buildInvitationId(groupId, actor.uid, operationId);
        const token = randomBytes(32).toString('base64url');
        const tokenHash = sha256(token);
        const tx = await groupTransaction(groupId, group => {
            requireOperationalGroup(group);
            requireGroupRole(group, actor.uid, ['owner']);
            const currentId = group.access.activeGeneralInvitationId;
            if (effectiveGeneralInvitation(group.invitations?.[currentId])) {
                throw groupError('INVALID_ARGUMENT', 'Ya existe un enlace general utilizable.');
            }
            const receiptState = group.operationReceipts?.[actor.uid]?.createGeneralLink?.[operationId];
            if (receiptState) {
                throw groupError('IDEMPOTENCY_KEY_REUSED', 'El enlace ya fue creado y el secreto no puede volver a mostrarse.');
            }
            group.invitations ||= {};
            group.invitations[invitationId] = {
                type: 'generalMultiuse', tokenHash, status: 'active', maxUses: 10, usedCount: 0,
                expiresAt: Date.now() + INVITATION_TTL_MS, createdByUid: actor.uid,
                createdByNameSnapshot: actor.displayName, createdAt: Date.now(), acceptedUids: {}
            };
            group.access.activeGeneralInvitationId = invitationId;
            createReceipt(group, {
                actorUid: actor.uid, operationName: 'createGeneralLink', operationId,
                payload: { invitationId }, resultRef: invitationId, timestamp: Date.now()
            });
            return group;
        });
        const invitation = tx.snapshot.val().invitations[invitationId];
        await writeAudit(groupId, { action: 'createGeneralLink', actorUid: actor.uid, operationId });
        return { groupId, invitationId, token, expiresAt: invitation.expiresAt, maxUses: 10 };
    } catch (error) { throw toHttpsError(error); }
});

export const revokeGeneralGroupLinkV1 = onCall(async request => {
    const actor = await requireActor(request);
    try {
        const groupId = requireGroupId(request.data?.groupId);
        const operationId = requireOperationId(request.data?.operationId);
        let invitationId;
        await groupTransaction(groupId, group => {
            requireOperationalGroup(group);
            requireGroupRole(group, actor.uid, ['owner']);
            invitationId = group.access.activeGeneralInvitationId;
            const invitation = group.invitations?.[invitationId];
            if (!invitation) throw groupError('NOT_FOUND', 'No hay enlace general.');
            invitation.status = 'revoked';
            group.access.activeGeneralInvitationId = null;
            createReceipt(group, {
                actorUid: actor.uid, operationName: 'revokeGeneralLink', operationId,
                payload: { invitationId }, resultRef: invitationId, timestamp: Date.now()
            });
            return group;
        });
        await writeAudit(groupId, { action: 'revokeGeneralLink', actorUid: actor.uid, operationId });
        return { groupId, invitationId, status: 'revoked' };
    } catch (error) { throw toHttpsError(error); }
});

function tokenMatches(expectedHash, token) {
    if (typeof token !== 'string' || token.length < 32 || token.length > 128) return false;
    const actualHash = sha256(token);
    const expected = Buffer.from(expectedHash || '', 'hex');
    const actual = Buffer.from(actualHash, 'hex');
    return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export const previewGeneralGroupLinkV1 = onCall(async request => {
    await requireActor(request, { allowAnonymous: true });
    try {
        await enforceRateLimit('previewGeneralByIp', requestIp(request), { limit: 60, windowMs: 10 * 60 * 1000 });
        const groupId = requireGroupId(request.data?.groupId);
        const invitationId = requireInvitationId(request.data?.invitationId);
        const group = await loadGroup(groupId);
        const invitation = group.invitations?.[invitationId];
        if (group.metadata?.status !== 'active' || !effectiveGeneralInvitation(invitation)
            || !tokenMatches(invitation.tokenHash, request.data?.token)) {
            throw groupError('FORBIDDEN', 'El enlace no existe, venció o fue revocado.');
        }
        return {
            groupName: group.profile.name,
            invitedByName: invitation.createdByNameSnapshot || 'Owner del grupo',
            expiresAt: invitation.expiresAt,
            remainingUses: invitation.maxUses - invitation.usedCount
        };
    } catch (error) { throw toHttpsError(error); }
});

export const acceptGeneralGroupLinkV1 = onCall(async request => {
    const actor = await requireActor(request);
    try {
        await enforceRateLimit('acceptGeneralByUid', actor.uid, { limit: 20, windowMs: 60 * 60 * 1000 });
        const groupId = requireGroupId(request.data?.groupId);
        const invitationId = requireInvitationId(request.data?.invitationId);
        const operationId = requireOperationId(request.data?.operationId);
        const token = request.data?.token;
        const tx = await groupTransaction(groupId, group => {
            requireOperationalGroup(group);
            group.__groupId = groupId;
            const invitation = group.invitations?.[invitationId];
            if (!effectiveGeneralInvitation(invitation) || !tokenMatches(invitation?.tokenHash, token)) {
                throw groupError('FORBIDDEN', 'El enlace no existe, venció o fue revocado.');
            }
            const member = getMembership(group, actor.uid);
            if (member && !isEffectiveMember(member)) {
                throw groupError('REINVITE_REQUIRED', 'Necesitás una invitación dirigida para volver.');
            }
            const joined = acceptMembership(group, actor.uid, actor.displayName, Date.now());
            if (!joined.alreadyMember) {
                invitation.usedCount += 1;
                invitation.acceptedUids ||= {};
                invitation.acceptedUids[actor.uid] = {
                    acceptedAt: Date.now(), membershipRevision: group.access.members[actor.uid].membershipRevision
                };
            }
            createReceipt(group, {
                actorUid: actor.uid, operationName: 'acceptGeneralLink', operationId,
                payload: { invitationId }, resultRef: joined.groupPlayerId, timestamp: Date.now()
            });
            delete group.__groupId;
            return group;
        });
        const group = tx.snapshot.val();
        await syncUserProjection(actor.uid, groupId, group);
        await writeAudit(groupId, { action: 'acceptGeneralLink', actorUid: actor.uid, targetUid: actor.uid, operationId });
        return { groupId, groupPlayerId: group.access.members[actor.uid].groupPlayerId };
    } catch (error) { throw toHttpsError(error); }
});

export const addProvisionalGroupPlayerV1 = onCall(async request => {
    const actor = await requireActor(request);
    try {
        const groupId = requireGroupId(request.data?.groupId);
        const operationId = requireOperationId(request.data?.operationId);
        const displayName = normalizePlayerName(request.data?.displayName);
        const groupPlayerId = buildGroupPlayerId(groupId, `provisional:${operationId}`);
        await groupTransaction(groupId, group => {
            requireOperationalGroup(group);
            requireGroupRole(group, actor.uid, ['owner', 'admin']);
            if (Object.keys(group.players || {}).length >= GROUP_LIMITS.maxPlayers && !group.players?.[groupPlayerId]) {
                throw groupError('GROUP_LIMIT_REACHED', 'El grupo alcanzó el límite de jugadores.');
            }
            group.players ||= {};
            group.players[groupPlayerId] ||= {
                displayName, kind: 'provisional', status: 'active', createdAt: Date.now(), updatedAt: Date.now()
            };
            createReceipt(group, {
                actorUid: actor.uid, operationName: 'addProvisional', operationId,
                payload: { displayName }, resultRef: groupPlayerId, timestamp: Date.now()
            });
            return group;
        });
        await writeAudit(groupId, { action: 'addProvisional', actorUid: actor.uid, operationId, details: { groupPlayerId } });
        return { groupId, groupPlayerId };
    } catch (error) { throw toHttpsError(error); }
});

export const updateGroupPlayerV1 = onCall(async request => {
    const actor = await requireActor(request);
    try {
        const groupId = requireGroupId(request.data?.groupId);
        const groupPlayerId = requireGroupPlayerId(request.data?.groupPlayerId);
        const operationId = requireOperationId(request.data?.operationId);
        const displayName = normalizePlayerName(request.data?.displayName);
        await groupTransaction(groupId, group => {
            requireOperationalGroup(group);
            requireGroupRole(group, actor.uid, ['owner', 'admin']);
            const player = group.players?.[groupPlayerId];
            if (!player) throw groupError('NOT_FOUND', 'El jugador no existe.');
            player.displayName = displayName;
            player.updatedAt = Date.now();
            createReceipt(group, {
                actorUid: actor.uid, operationName: 'updatePlayer', operationId,
                payload: { groupPlayerId, displayName }, resultRef: groupPlayerId, timestamp: Date.now()
            });
            return group;
        });
        return { groupId, groupPlayerId, displayName };
    } catch (error) { throw toHttpsError(error); }
});

export const setGroupPlayerStatusV1 = onCall(async request => {
    const actor = await requireActor(request);
    try {
        const groupId = requireGroupId(request.data?.groupId);
        const groupPlayerId = requireGroupPlayerId(request.data?.groupPlayerId);
        const operationId = requireOperationId(request.data?.operationId);
        const status = request.data?.status;
        if (!['active', 'inactive'].includes(status)) throw groupError('INVALID_ARGUMENT', 'El estado no es válido.');
        await groupTransaction(groupId, group => {
            requireOperationalGroup(group);
            requireGroupRole(group, actor.uid, ['owner', 'admin']);
            const player = group.players?.[groupPlayerId];
            if (!player) throw groupError('NOT_FOUND', 'El jugador no existe.');
            if (player.kind !== 'provisional') throw groupError('FORBIDDEN', 'El estado de un miembro deriva de su membresía.');
            player.status = status;
            player.updatedAt = Date.now();
            createReceipt(group, {
                actorUid: actor.uid, operationName: 'setPlayerStatus', operationId,
                payload: { groupPlayerId, status }, resultRef: groupPlayerId, timestamp: Date.now()
            });
            return group;
        });
        return { groupId, groupPlayerId, status };
    } catch (error) { throw toHttpsError(error); }
});

export const setGroupMemberRoleV1 = onCall(async request => {
    const actor = await requireActor(request);
    try {
        const groupId = requireGroupId(request.data?.groupId);
        const operationId = requireOperationId(request.data?.operationId);
        const targetUid = typeof request.data?.targetUid === 'string' ? request.data.targetUid : '';
        const role = request.data?.role;
        if (!['admin', 'member'].includes(role)) throw groupError('INVALID_ARGUMENT', 'El rol no es válido.');
        const tx = await groupTransaction(groupId, group => {
            requireOperationalGroup(group);
            requireGroupRole(group, actor.uid, ['owner']);
            if (group.access.ownerUid === targetUid) throw groupError('FORBIDDEN', 'El owner se cambia mediante transferencia.');
            assertNoReservedGrant(group, targetUid);
            const member = getMembership(group, targetUid);
            if (!isEffectiveMember(member)) throw groupError('NOT_FOUND', 'El miembro no está activo.');
            member.role = role;
            member.membershipRevision = (member.membershipRevision || 0) + 1;
            member.updatedAt = Date.now();
            group.access.accessRevision = (group.access.accessRevision || 0) + 1;
            createReceipt(group, {
                actorUid: actor.uid, operationName: 'setMemberRole', operationId,
                payload: { targetUid, role }, resultRef: targetUid, timestamp: Date.now()
            });
            return group;
        });
        await syncUserProjection(targetUid, groupId, tx.snapshot.val());
        await writeAudit(groupId, { action: 'setMemberRole', actorUid: actor.uid, targetUid, operationId, details: { role } });
        return { groupId, targetUid, role };
    } catch (error) { throw toHttpsError(error); }
});

export const removeGroupMemberV1 = onCall(async request => {
    const actor = await requireActor(request);
    try {
        const groupId = requireGroupId(request.data?.groupId);
        const operationId = requireOperationId(request.data?.operationId);
        const targetUid = typeof request.data?.targetUid === 'string' ? request.data.targetUid : '';
        const tx = await groupTransaction(groupId, group => {
            requireOperationalGroup(group);
            const actorRole = requireGroupRole(group, actor.uid, ['owner', 'admin']);
            if (group.access.ownerUid === targetUid) throw groupError('FORBIDDEN', 'No se puede remover al owner.');
            const member = getMembership(group, targetUid);
            if (!isEffectiveMember(member)) throw groupError('NOT_FOUND', 'El miembro no está activo.');
            if (member.role === 'admin' && actorRole !== 'owner') throw groupError('FORBIDDEN', 'Sólo el owner puede remover admins.');
            assertNoReservedGrant(group, targetUid);
            member.status = 'removed';
            member.role = 'member';
            member.membershipRevision = (member.membershipRevision || 0) + 1;
            member.updatedAt = Date.now();
            group.players[member.groupPlayerId].status = 'inactive';
            group.players[member.groupPlayerId].updatedAt = Date.now();
            group.access.accessRevision = (group.access.accessRevision || 0) + 1;
            createReceipt(group, {
                actorUid: actor.uid, operationName: 'removeMember', operationId,
                payload: { targetUid }, resultRef: targetUid, timestamp: Date.now()
            });
            return group;
        });
        await syncUserProjection(targetUid, groupId, tx.snapshot.val());
        await writeAudit(groupId, { action: 'removeMember', actorUid: actor.uid, targetUid, operationId });
        return { groupId, targetUid, status: 'removed' };
    } catch (error) { throw toHttpsError(error); }
});

export const leaveGroupV1 = onCall(async request => {
    const actor = await requireActor(request);
    try {
        const groupId = requireGroupId(request.data?.groupId);
        const operationId = requireOperationId(request.data?.operationId);
        const tx = await groupTransaction(groupId, group => {
            requireOperationalGroup(group);
            const role = requireGroupRole(group, actor.uid, ['admin', 'member']);
            if (role === 'owner') throw groupError('FORBIDDEN', 'Transferí la propiedad antes de salir.');
            assertNoReservedGrant(group, actor.uid);
            const member = group.access.members[actor.uid];
            member.status = 'left';
            member.role = 'member';
            member.membershipRevision = (member.membershipRevision || 0) + 1;
            member.updatedAt = Date.now();
            group.players[member.groupPlayerId].status = 'inactive';
            group.players[member.groupPlayerId].updatedAt = Date.now();
            group.access.accessRevision = (group.access.accessRevision || 0) + 1;
            createReceipt(group, {
                actorUid: actor.uid, operationName: 'leaveGroup', operationId,
                payload: { groupId }, resultRef: actor.uid, timestamp: Date.now()
            });
            return group;
        });
        await syncUserProjection(actor.uid, groupId, tx.snapshot.val());
        await writeAudit(groupId, { action: 'leaveGroup', actorUid: actor.uid, targetUid: actor.uid, operationId });
        return { groupId, status: 'left' };
    } catch (error) { throw toHttpsError(error); }
});

export const listMyGroupsV1 = onCall(async request => {
    const actor = await requireActor(request);
    const projections = (await getDatabase().ref(`groupsByUser/${actor.uid}`).get()).val() || {};
    const invitations = (await getDatabase().ref(`groupInvitationInbox/${actor.uid}`).get()).val() || {};
    return {
        groups: Object.entries(projections).filter(([, item]) => item.membershipStatus === 'active')
            .map(([groupId, item]) => ({ groupId, ...item })),
        invitations: Object.entries(invitations).filter(([, item]) => item.status === 'active' && item.expiresAt > Date.now())
            .map(([invitationId, item]) => ({ invitationId, ...item }))
    };
});

export const listMyFormerGroupsV1 = onCall(async request => {
    const actor = await requireActor(request);
    const projections = (await getDatabase().ref(`groupsByUser/${actor.uid}`).get()).val() || {};
    return Object.entries(projections)
        .filter(([, item]) => ['left', 'removed'].includes(item.membershipStatus))
        .map(([groupId, item]) => ({ groupId, ...item }));
});

export const getGroupV1 = onCall(async request => {
    const actor = await requireActor(request);
    try {
        const groupId = requireGroupId(request.data?.groupId);
        return buildSafeGroupView(groupId, await loadGroup(groupId), actor.uid);
    } catch (error) { throw toHttpsError(error); }
});

async function readGroupTournaments(groupId, group) {
    const result = {};
    const activeRefs = Object.entries(group.tournamentRefs || {}).filter(([, ref]) => ref?.status === 'active');
    for (let offset = 0; offset < activeRefs.length; offset += 25) {
        await Promise.all(activeRefs.slice(offset, offset + 25).map(async ([tournamentId]) => {
            result[tournamentId] = (await getDatabase().ref(`tournaments/${tournamentId}`).get()).val();
        }));
    }
    return result;
}

export const getGroupHistoryV1 = onCall(async request => {
    const actor = await requireActor(request);
    try {
        const groupId = requireGroupId(request.data?.groupId);
        const group = await loadGroup(groupId);
        if (!getEffectiveGroupRole(group, actor.uid)) throw groupError('FORBIDDEN', 'No tenés acceso al historial actual.');
        const tournaments = await readGroupTournaments(groupId, group);
        return Object.entries(group.tournamentRefs || {}).filter(([, ref]) => ref?.status === 'active')
            .map(([tournamentId, ref]) => ({
                tournamentId,
                status: ref.status,
                tournamentName: tournaments[tournamentId]?.public?.metadata?.tournamentName || '',
                tournamentDate: tournaments[tournamentId]?.public?.metadata?.tournamentDate || '',
                updatedAt: tournaments[tournamentId]?.public?.metadata?.updatedAt || ref.updatedAt
            })).sort((a, b) => safeTimestamp(b.updatedAt) - safeTimestamp(a.updatedAt));
    } catch (error) { throw toHttpsError(error); }
});

export const getGroupStatsV1 = onCall(async request => {
    const actor = await requireActor(request);
    try {
        const groupId = requireGroupId(request.data?.groupId);
        const group = await loadGroup(groupId);
        if (!getEffectiveGroupRole(group, actor.uid)) throw groupError('FORBIDDEN', 'No tenés acceso a estas estadísticas.');
        const tournaments = await readGroupTournaments(groupId, group);
        const playerScope = request.data?.playerScope === 'active' ? 'active' : 'all';
        const players = calculateGroupStats(group, tournaments)
            .filter(player => playerScope === 'all' || player.playerStatus === 'active');
        return { groupId, playerScope, players };
    } catch (error) { throw toHttpsError(error); }
});

export const getMyHistoricalGroupStatsV1 = onCall(async request => {
    const actor = await requireActor(request);
    try {
        const groupId = requireGroupId(request.data?.groupId);
        const group = await loadGroup(groupId);
        const member = getMembership(group, actor.uid);
        if (!member) throw groupError('FORBIDDEN', 'No perteneciste a este grupo.');
        const tournaments = await readGroupTournaments(groupId, group);
        const own = calculateGroupStats(group, tournaments).find(item => item.groupPlayerId === member.groupPlayerId) || null;
        return { groupId, groupName: group.profile.name, player: own };
    } catch (error) { throw toHttpsError(error); }
});

export const listGroupAuditV1 = onCall(async request => {
    const actor = await requireActor(request);
    try {
        const groupId = requireGroupId(request.data?.groupId);
        const group = await loadGroup(groupId);
        if (actor.platformRole !== 'superAdmin') requireGroupRole(group, actor.uid, ['owner', 'admin']);
        const snapshot = await getDatabase().ref(`groupAudit/${groupId}`).orderByChild('createdAt').limitToLast(50).get();
        return Object.entries(snapshot.val() || {}).map(([eventId, event]) => ({ eventId, ...event }))
            .sort((a, b) => b.createdAt - a.createdAt);
    } catch (error) { throw toHttpsError(error); }
});

export const recoverGroupOwnershipV1 = onCall(async request => {
    const actor = await requireSupportActor(request);
    try {
        const groupId = requireGroupId(request.data?.groupId);
        const operationId = requireOperationId(request.data?.operationId);
        const targetUid = typeof request.data?.targetUid === 'string' ? request.data.targetUid : '';
        const reason = typeof request.data?.reason === 'string' ? request.data.reason.trim() : '';
        if (!reason || reason.length > 500) throw groupError('INVALID_ARGUMENT', 'El motivo es obligatorio.');
        const user = await getAuth().getUser(targetUid);
        if (user.disabled) throw groupError('FORBIDDEN', 'La cuenta destino está desactivada.');
        const tx = await groupTransaction(groupId, group => {
            if (!group || group.metadata?.status !== 'recoveryRequired') throw groupError('INVALID_ARGUMENT', 'El grupo no requiere recuperación.');
            const target = getMembership(group, targetUid);
            if (!isEffectiveMember(target)) throw groupError('FORBIDDEN', 'El destino no es miembro activo.');
            group.access.ownerUid = targetUid;
            target.role = 'member';
            group.metadata.status = group.metadata.recoveryPreviousStatus || 'archived';
            delete group.metadata.orphanedOwnerUid;
            delete group.metadata.recoveryPreviousStatus;
            group.metadata.statusRevision = (group.metadata.statusRevision || 0) + 1;
            group.access.accessRevision = (group.access.accessRevision || 0) + 1;
            createReceipt(group, {
                actorUid: actor.uid, operationName: 'recoverOwnership', operationId,
                payload: { targetUid, reason }, resultRef: targetUid, timestamp: Date.now()
            });
            return group;
        }, { verifyOwner: false });
        await syncAllGroupProjections(groupId, tx.snapshot.val());
        await writeAudit(groupId, { action: 'recoverOwnership', actorUid: actor.uid, targetUid, operationId, details: { reason } });
        return { groupId, ownerUid: targetUid, status: tx.snapshot.val().metadata.status };
    } catch (error) { throw toHttpsError(error); }
});

async function reconcileDeletedUid(uid) {
    const snapshot = await getDatabase().ref('groupDomains').get();
    const groups = snapshot.val() || {};
    for (const [groupId, group] of Object.entries(groups)) {
        const member = getMembership(group, uid);
        if (!member) continue;
        await groupTransaction(groupId, current => {
            const currentMember = getMembership(current, uid);
            if (!currentMember) return current;
            currentMember.accountStatus = 'deleted';
            currentMember.role = 'member';
            currentMember.updatedAt = Date.now();
            if (current.players?.[currentMember.groupPlayerId]) {
                current.players[currentMember.groupPlayerId].status = 'inactive';
                current.players[currentMember.groupPlayerId].updatedAt = Date.now();
            }
            if (current.access?.ownerUid === uid) {
                current.metadata.recoveryPreviousStatus = current.metadata.status === 'archived' ? 'archived' : 'active';
                current.metadata.status = 'recoveryRequired';
                current.metadata.orphanedOwnerUid = uid;
                current.access.activeGeneralInvitationId = null;
                Object.values(current.invitations || {}).forEach(inv => {
                    if (inv.status === 'active') inv.status = 'revoked';
                });
            }
            current.access.accessRevision = (current.access.accessRevision || 0) + 1;
            return current;
        }, { verifyOwner: false });
    }
}

export const reconcileDeletedGroupUserV1 = functionsV1.auth.user().onDelete(async user => {
    await reconcileDeletedUid(user.uid);
});

export const reconcileGroupDomainsV1 = onSchedule('every 24 hours', async () => {
    const snapshot = await getDatabase().ref('groupDomains').get();
    for (const [groupId, group] of Object.entries(snapshot.val() || {})) {
        const ownerUid = group.access?.ownerUid;
        if (ownerUid) {
            try {
                const owner = await getAuth().getUser(ownerUid);
                if (owner.disabled) await reconcileDeletedUid(ownerUid);
            } catch (error) {
                if (error?.code === 'auth/user-not-found') await reconcileDeletedUid(ownerUid);
                else throw error;
            }
        }
        const now = Date.now();
        const grantResults = {};
        await Promise.all(Object.entries(group.operationGrants || {})
            .filter(([, grant]) => grant?.status === 'reserved' && grant.expiresAt < now)
            .map(async ([grantId, grant]) => {
                const receiptExists = grant.tournamentId && grant.operationId
                    ? (await getDatabase().ref(
                        `tournaments/${grant.tournamentId}/_server/operationReceipts/${grant.operationId}`
                    ).get()).exists()
                    : false;
                grantResults[grantId] = receiptExists ? 'completed' : 'failed';
            }));
        const provisioningResults = {};
        await Promise.all(Object.entries(group.tournamentRefs || {})
            .filter(([, ref]) => ref?.status === 'provisioning' && ref.createdAt < now - 15 * 60 * 1000)
            .map(async ([tournamentId]) => {
                const metadata = (await getDatabase().ref(`tournaments/${tournamentId}/public/metadata`).get()).val();
                provisioningResults[tournamentId] = metadata?.groupId === groupId ? 'active' : 'remove';
            }));
        const repaired = await groupTransaction(groupId, current => {
            if (!current) return current;
            Object.entries(grantResults).forEach(([grantId, status]) => {
                const grant = current.operationGrants?.[grantId];
                if (grant?.status === 'reserved' && grant.expiresAt < now) {
                    grant.status = status;
                    grant.completedAt = now;
                }
            });
            Object.entries(provisioningResults).forEach(([tournamentId, status]) => {
                const ref = current.tournamentRefs?.[tournamentId];
                if (ref?.status !== 'provisioning') return;
                if (status === 'active') {
                    ref.status = 'active';
                    ref.activatedAt ||= now;
                    ref.updatedAt = now;
                } else {
                    delete current.tournamentRefs[tournamentId];
                }
            });
            Object.entries(current.operationGrants || {}).forEach(([grantId, grant]) => {
                if (grant?.status !== 'reserved' && grant.completedAt < now - 7 * 24 * 60 * 60 * 1000) {
                    delete current.operationGrants[grantId];
                }
            });
            Object.entries(current.invitations || {}).forEach(([invitationId, invitation]) => {
                if (invitation?.status !== 'active'
                    && invitation.expiresAt < now - 30 * 24 * 60 * 60 * 1000) {
                    delete current.invitations[invitationId];
                }
            });
            return current;
        }, { verifyOwner: false });
        const latest = repaired.snapshot.val();
        if (!latest) continue;
        await syncAllGroupProjections(groupId, latest);
        await Promise.all(Object.entries(latest.invitations || {})
            .filter(([, invitation]) => invitation?.type === 'username' && invitation.targetUid)
            .map(([invitationId, invitation]) => getDatabase()
                .ref(`groupInvitationInbox/${invitation.targetUid}/${invitationId}`)
                .update({ status: invitation.status })));
        await Promise.all(Object.entries(latest.tournamentRefs || {}).map(([tournamentId, ref]) =>
            getDatabase().ref(`groupTournamentIndex/${groupId}/${tournamentId}`).set({
                status: ref.status,
                updatedAt: ref.updatedAt || now
            })));
    }
    const rateLimits = (await getDatabase().ref('groupRateLimits').get()).val() || {};
    const expiredUpdates = {};
    const now = Date.now();
    Object.entries(rateLimits).forEach(([scope, keys]) => {
        Object.entries(keys || {}).forEach(([key, buckets]) => {
            Object.entries(buckets || {}).forEach(([bucket, value]) => {
                if (value?.expiresAt < now) expiredUpdates[`${scope}/${key}/${bucket}`] = null;
            });
        });
    });
    if (Object.keys(expiredUpdates).length) {
        await getDatabase().ref('groupRateLimits').update(expiredUpdates);
    }
});

export async function reserveGroupTournamentMutation({ groupId, actor, tournamentId, operationId, payloadHash }) {
    requireGroupId(groupId);
    requireOperationId(operationId);
    const grantId = sha256(`${groupId}:${actor.uid}:tournamentMutation:${operationId}`).slice(0, 40);
    let authorization;
    const tx = await groupTransaction(groupId, group => {
        requireOperationalGroup(group);
        const role = getEffectiveGroupRole(group, actor.uid);
        if (!role && actor.platformRole !== 'superAdmin') throw groupError('FORBIDDEN', 'No pertenecés al grupo.');
        const member = getMembership(group, actor.uid);
        const playerId = member?.groupPlayerId;
        const playerBinding = playerId
            ? Object.entries(group.tournamentRefs?.[tournamentId]?.participantBindings || {})
                .find(([, value]) => value?.groupPlayerId === playerId && value?.uid === actor.uid)?.[0]
            : null;
        authorization = {
            canManage: actor.platformRole === 'superAdmin' || role === 'owner' || role === 'admin',
            localPlayerIds: playerBinding === undefined || playerBinding === null ? [] : [Number(playerBinding)],
            role
        };
        if (!authorization.canManage && !authorization.localPlayerIds.length) {
            throw groupError('FORBIDDEN', 'No podés modificar este torneo.');
        }
        group.operationGrants ||= {};
        const existing = group.operationGrants[grantId];
        if (existing && existing.payloadHash !== payloadHash) {
            throw groupError('IDEMPOTENCY_KEY_REUSED', 'El operationId ya se usó con otro contenido.');
        }
        group.operationGrants[grantId] ||= {
            type: 'tournamentMutation', actorUid: actor.uid, tournamentId, operationId,
            accessRevision: group.access.accessRevision || 0,
            membershipRevision: member?.membershipRevision || 0,
            payloadHash, expiresAt: Date.now() + 15 * 60 * 1000, status: 'reserved'
        };
        return group;
    });
    return { grantId, authorization, group: tx.snapshot.val() };
}

export async function closeGroupTournamentGrant({ groupId, grantId, status = 'completed' }) {
    await getDatabase().ref(`groupDomains/${groupId}/operationGrants/${grantId}`).transaction(current => current ? {
        ...current, status, completedAt: Date.now()
    } : current);
}

export async function getGroupForTournamentCreation({ groupId, actor, groupPlayerIds, operationId }) {
    requireGroupId(groupId);
    requireOperationId(operationId);
    const group = await loadGroup(groupId);
    requireOperationalGroup(group);
    requireGroupRole(group, actor.uid, ['owner', 'admin']);
    if (!Array.isArray(groupPlayerIds) || groupPlayerIds.length < 4 || groupPlayerIds.length > 16
        || new Set(groupPlayerIds).size !== groupPlayerIds.length) {
        throw groupError('INVALID_ARGUMENT', 'La selección de jugadores no es válida.');
    }
    const players = groupPlayerIds.map(requireGroupPlayerId).map(id => group.players?.[id]);
    if (players.some(player => !player || player.status !== 'active')) {
        throw groupError('INVALID_ARGUMENT', 'Todos los participantes deben estar activos.');
    }
    if (Object.keys(group.tournamentRefs || {}).length >= GROUP_LIMITS.maxTournamentRefs) {
        throw groupError('GROUP_LIMIT_REACHED', 'El grupo alcanzó el límite de torneos.');
    }
    return { group, players };
}

export async function registerGroupTournament({ groupId, actor, tournamentId, operationId, groupPlayerIds }) {
    const tx = await groupTransaction(groupId, group => {
        requireOperationalGroup(group);
        requireGroupRole(group, actor.uid, ['owner', 'admin']);
        const participantBindings = {};
        groupPlayerIds.forEach((groupPlayerId, localPlayerId) => {
            const player = group.players[groupPlayerId];
            participantBindings[localPlayerId] = {
                groupPlayerId,
                uid: player.kind === 'registered' ? player.linkedUid : null
            };
        });
        group.tournamentRefs ||= {};
        group.tournamentRefs[tournamentId] = {
            status: 'active', groupId, creationOperationId: operationId,
            participantBindings, createdAt: Date.now(), activatedAt: Date.now(), updatedAt: Date.now()
        };
        return group;
    });
    await getDatabase().ref(`groupTournamentIndex/${groupId}/${tournamentId}`).set({
        status: 'active', updatedAt: Date.now()
    });
    return tx.snapshot.val();
}

export async function provisionGroupTournament({ groupId, actor, tournamentId, operationId, groupPlayerIds }) {
    const tx = await groupTransaction(groupId, group => {
        requireOperationalGroup(group);
        requireGroupRole(group, actor.uid, ['owner', 'admin']);
        if (Object.keys(group.tournamentRefs || {}).length >= GROUP_LIMITS.maxTournamentRefs
            && !group.tournamentRefs?.[tournamentId]) {
            throw groupError('GROUP_LIMIT_REACHED', 'El grupo alcanzó el límite de torneos.');
        }
        const participantBindings = {};
        groupPlayerIds.forEach((groupPlayerId, localPlayerId) => {
            const player = group.players[groupPlayerId];
            participantBindings[localPlayerId] = {
                groupPlayerId,
                uid: player.kind === 'registered' ? player.linkedUid : null
            };
        });
        group.tournamentRefs ||= {};
        const existing = group.tournamentRefs[tournamentId];
        if (existing && existing.creationOperationId !== operationId) {
            throw groupError('IDEMPOTENCY_KEY_REUSED', 'El torneo ya está reservado por otra operación.');
        }
        group.tournamentRefs[tournamentId] ||= {
            status: 'provisioning', groupId, creationOperationId: operationId,
            participantBindings, createdAt: Date.now(), updatedAt: Date.now()
        };
        return group;
    });
    return tx.snapshot.val();
}

export async function confirmGroupTournament({ groupId, tournamentId, operationId, metadata = {} }) {
    const tx = await groupTransaction(groupId, group => {
        const ref = group?.tournamentRefs?.[tournamentId];
        if (!ref || ref.creationOperationId !== operationId) {
            throw groupError('NOT_FOUND', 'No existe el provisioning del torneo.');
        }
        ref.status = 'active';
        ref.activatedAt ||= Date.now();
        ref.updatedAt = Date.now();
        return group;
    });
    await getDatabase().ref(`groupTournamentIndex/${groupId}/${tournamentId}`).set({
        status: 'active',
        tournamentNameSnapshot: metadata.tournamentName || '',
        tournamentDate: metadata.tournamentDate || '',
        updatedAt: Date.now()
    });
    return tx.snapshot.val();
}

export { toHttpsError as asGroupHttpsError, requireActor as requireGroupActor };
