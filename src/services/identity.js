import { buildPlayerClaim, canClaimPlayer } from './player-claims.js';

export function createTournamentIdentity({
    tournamentRef,
    presenceId,
    serverTimestamp,
    getPlayerName,
    getDeviceLabel,
    onPresenceCount,
    onClaims,
    onPresence = () => {},
    authUid = '',
    actorRole = 'spectator'
}) {
    let presenceRef = null;
    let presenceUnsubscribe = null;
    let claimsUnsubscribe = null;
    let actorClaimRef = null;
    let presenceRole = actorRole;

    async function connect({ actorName = 'Espectador', actorPlayerId = null } = {}) {
        presenceRef = tournamentRef.child(`presence/${presenceId}`);
        const presenceListRef = tournamentRef.child('presence');
        const presenceListener = snapshot => {
            const presences = snapshot.val() || {};
            onPresenceCount(Object.keys(presences).length);
            onPresence(presences);
        };
        presenceListRef.on('value', presenceListener);
        presenceUnsubscribe = () => presenceListRef.off('value', presenceListener);

        const claimsRef = tournamentRef.child('claims');
        const claimsListener = snapshot => onClaims(snapshot.val() || {});
        claimsRef.on('value', claimsListener);
        claimsUnsubscribe = () => claimsRef.off('value', claimsListener);

        await presenceRef.onDisconnect().remove();
        await presenceRef.set({
            connectedAt: serverTimestamp(),
            uid: authUid || null,
            role: presenceRole,
            actorPlayerId,
            actorName,
            device: getDeviceLabel()
        });
    }

    async function claimPlayer(playerId) {
        const claimRef = tournamentRef.child(`claims/${playerId}`);
        const result = await claimRef.transaction(current => {
            if (canClaimPlayer(current, { uid: authUid, presenceId })) {
                return { ...buildPlayerClaim({ uid: authUid, presenceId, displayName: getPlayerName(playerId), timestamp: serverTimestamp() }), device: getDeviceLabel() };
            }
            return;
        });
        if (!result.committed || !canClaimPlayer(result.snapshot.val(), { uid: authUid, presenceId })) return false;
        if (actorClaimRef && actorClaimRef !== claimRef) actorClaimRef.remove().catch(() => {});
        actorClaimRef = claimRef;
        if (!authUid) await actorClaimRef.onDisconnect().remove();
        if (presenceRole === 'spectator') presenceRole = 'participant';
        await updatePresence({ actorPlayerId: playerId, actorName: getPlayerName(playerId) });
        return true;
    }

    async function restoreClaim(playerId) {
        actorClaimRef = tournamentRef.child(`claims/${playerId}`);
        if (!authUid) await actorClaimRef.onDisconnect().remove();
    }

    async function updatePresence({ actorPlayerId = null, actorName = 'Espectador' } = {}) {
        if (!presenceRef) return;
        await presenceRef.update({ uid: authUid || null, role: presenceRole, actorPlayerId, actorName, device: getDeviceLabel() });
    }

    async function releasePlayer() {
        if (!actorClaimRef) return;
        const claimRef = actorClaimRef;
        await claimRef.transaction(current => canClaimPlayer(current, { uid: authUid, presenceId }) ? null : undefined);
        actorClaimRef = null;
        if (presenceRole === 'participant') presenceRole = 'spectator';
    }

    function disconnect() {
        if (presenceUnsubscribe) presenceUnsubscribe();
        if (claimsUnsubscribe) claimsUnsubscribe();
        if (presenceRef) presenceRef.remove().catch(() => {});
        if (actorClaimRef && !authUid) actorClaimRef.remove().catch(() => {});
        presenceRef = null;
        actorClaimRef = null;
        presenceUnsubscribe = null;
        claimsUnsubscribe = null;
    }

    return { connect, claimPlayer, restoreClaim, releasePlayer, updatePresence, disconnect };
}
