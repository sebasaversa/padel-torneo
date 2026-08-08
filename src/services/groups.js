const PENDING_INVITATION_KEY = 'padel-torneo-pending-group-invitation-v1';

export function createOperationId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID().replaceAll('-', '');
    const bytes = globalThis.crypto?.getRandomValues
        ? globalThis.crypto.getRandomValues(new Uint8Array(16))
        : Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
    return Array.from(bytes, byte => Number(byte).toString(16).padStart(2, '0')).join('');
}

export function createGroupsApi(callFunction) {
    const call = (name, data = {}, options) => callFunction(name, data, options);
    const pendingOperations = new Map();
    const mutate = async (name, data = {}) => {
        const key = `${name}:${JSON.stringify(data)}`;
        const operationId = pendingOperations.get(key) || createOperationId();
        pendingOperations.set(key, operationId);
        try {
            const result = await call(name, { ...data, operationId });
            pendingOperations.delete(key);
            return result;
        } catch (error) {
            throw error;
        }
    };
    return {
        create: data => mutate('createGroupV1', data),
        update: data => mutate('updateGroupV1', data),
        archive: groupId => mutate('archiveGroupV1', { groupId }),
        restore: groupId => mutate('restoreGroupV1', { groupId }),
        transferOwnership: (groupId, targetUid) => mutate(
            'transferGroupOwnershipV1', { groupId, targetUid }
        ),
        inviteUsername: (groupId, username) => mutate(
            'inviteGroupUserV1', { groupId, username }
        ),
        acceptInvitation: (groupId, invitationId) => mutate(
            'acceptGroupUserInvitationV1', { groupId, invitationId }
        ),
        rejectInvitation: (groupId, invitationId) => mutate(
            'rejectGroupUserInvitationV1', { groupId, invitationId }
        ),
        revokeInvitation: (groupId, invitationId) => mutate(
            'revokeGroupUserInvitationV1', { groupId, invitationId }
        ),
        createGeneralLink: groupId => mutate('createGeneralGroupLinkV1', { groupId }),
        revokeGeneralLink: groupId => mutate('revokeGeneralGroupLinkV1', { groupId }),
        previewGeneralLink: invitation => call(
            'previewGeneralGroupLinkV1', invitation, { allowAnonymous: true }
        ),
        acceptGeneralLink: invitation => mutate(
            'acceptGeneralGroupLinkV1', invitation
        ),
        addProvisional: (groupId, displayName) => mutate(
            'addProvisionalGroupPlayerV1', { groupId, displayName }
        ),
        updatePlayer: (groupId, groupPlayerId, displayName) => mutate(
            'updateGroupPlayerV1', { groupId, groupPlayerId, displayName }
        ),
        setPlayerStatus: (groupId, groupPlayerId, status) => mutate(
            'setGroupPlayerStatusV1', { groupId, groupPlayerId, status }
        ),
        setMemberRole: (groupId, targetUid, role) => mutate(
            'setGroupMemberRoleV1', { groupId, targetUid, role }
        ),
        removeMember: (groupId, targetUid) => mutate(
            'removeGroupMemberV1', { groupId, targetUid }
        ),
        leave: groupId => mutate('leaveGroupV1', { groupId }),
        list: () => call('listMyGroupsV1'),
        listFormer: () => call('listMyFormerGroupsV1'),
        get: groupId => call('getGroupV1', { groupId }),
        history: groupId => call('getGroupHistoryV1', { groupId }),
        stats: (groupId, playerScope = 'all') => call('getGroupStatsV1', { groupId, playerScope }),
        personalStats: groupId => call('getMyHistoricalGroupStatsV1', { groupId })
    };
}

export function buildGeneralGroupInvitationUrl({ origin, pathname, groupId, invitationId, token }) {
    const url = new URL(pathname, origin);
    url.searchParams.set('grupoInvitacion', groupId);
    url.searchParams.set('invitacionGrupo', invitationId);
    url.hash = `token=${encodeURIComponent(token)}`;
    return url.toString();
}

export function parseGeneralGroupInvitation(locationLike) {
    const params = new URLSearchParams(locationLike.search || '');
    const fragment = new URLSearchParams((locationLike.hash || '').replace(/^#/, ''));
    const groupId = params.get('grupoInvitacion');
    const invitationId = params.get('invitacionGrupo');
    const token = fragment.get('token');
    if (!groupId || !invitationId || !token) return null;
    return { groupId, invitationId, token };
}

export function savePendingGeneralInvitation(invitation, storage = globalThis.sessionStorage) {
    storage.setItem(PENDING_INVITATION_KEY, JSON.stringify(invitation));
}

export function loadPendingGeneralInvitation(storage = globalThis.sessionStorage) {
    try {
        const value = JSON.parse(storage.getItem(PENDING_INVITATION_KEY) || 'null');
        return value?.groupId && value?.invitationId && value?.token ? value : null;
    } catch (error) {
        return null;
    }
}

export function clearPendingGeneralInvitation(storage = globalThis.sessionStorage) {
    storage.removeItem(PENDING_INVITATION_KEY);
}
