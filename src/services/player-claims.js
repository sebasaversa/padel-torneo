export function buildPlayerClaim({ uid = '', presenceId, displayName, timestamp }) {
    if (!presenceId) throw new Error('El dispositivo es obligatorio.');
    return { uid: uid || null, presenceId, displayName: displayName || 'Espectador', claimedAt: timestamp };
}

export function canClaimPlayer(currentClaim, { uid = '', presenceId }) {
    if (!currentClaim) return true;
    if (uid && currentClaim.uid) return currentClaim.uid === uid;
    return currentClaim.presenceId === presenceId;
}
