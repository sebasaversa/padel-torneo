import { buildPlayerClaim, canClaimPlayer } from './player-claims.js';

export function createTournamentIdentity({
    tournamentRef,
    presenceId,
    serverTimestamp,
    getPlayerName,
    getDeviceLabel,
    onPresenceCount,
    onClaims
    , authUid = ''
}) {
    let presenceRef = null;
    let presenceUnsubscribe = null;
    let claimsUnsubscribe = null;
    let actorClaimRef = null;

    async function connect({ actorName = 'Espectador', actorPlayerId = null } = {}) {
        presenceRef = tournamentRef.child(`presence/${presenceId}`);
        const presenceListRef = tournamentRef.child('presence');
        const presenceListener = snapshot => onPresenceCount(snapshot.numChildren());
        presenceListRef.on('value', presenceListener);
        presenceUnsubscribe = () => presenceListRef.off('value', presenceListener);

        const claimsRef = tournamentRef.child('claims');
        const claimsListener = snapshot => onClaims(snapshot.val() || {});
        claimsRef.on('value', claimsListener);
        claimsUnsubscribe = () => claimsRef.off('value', claimsListener);

        await presenceRef.onDisconnect().remove();
        await presenceRef.set({
            connectedAt: serverTimestamp(),
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
        await actorClaimRef.onDisconnect().remove();
        await updatePresence({ actorPlayerId: playerId, actorName: getPlayerName(playerId) });
        return true;
    }

    async function restoreClaim(playerId) {
        actorClaimRef = tournamentRef.child(`claims/${playerId}`);
        await actorClaimRef.onDisconnect().remove();
    }

    async function updatePresence({ actorPlayerId = null, actorName = 'Espectador' } = {}) {
        if (!presenceRef) return;
        await presenceRef.update({ actorPlayerId, actorName, device: getDeviceLabel() });
    }

    function disconnect() {
        if (presenceUnsubscribe) presenceUnsubscribe();
        if (claimsUnsubscribe) claimsUnsubscribe();
        if (presenceRef) presenceRef.remove().catch(() => {});
        if (actorClaimRef) actorClaimRef.remove().catch(() => {});
        presenceRef = null;
        actorClaimRef = null;
        presenceUnsubscribe = null;
        claimsUnsubscribe = null;
    }

    return { connect, claimPlayer, restoreClaim, updatePresence, disconnect };
}
