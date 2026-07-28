const PLAYER_ROLES = ['t1_p1', 't1_p2', 't2_p1', 't2_p2'];

export function getRoundPlayerSlots(round) {
    return round.matches.flatMap(match => PLAYER_ROLES.map(role => ({ match, role })));
}

export function normalizeRoundPlayers(round, numPlayers) {
    const slots = getRoundPlayerSlots(round);
    const usedPlayers = new Set();

    slots.forEach(slot => {
        const playerId = slot.match[slot.role];
        if (Number.isInteger(playerId) && playerId >= 0 && playerId < numPlayers && !usedPlayers.has(playerId)) {
            usedPlayers.add(playerId);
        } else {
            slot.match[slot.role] = null;
        }
    });

    const availablePlayers = Array.from({ length: numPlayers }, (_, id) => id)
        .filter(id => !usedPlayers.has(id));
    slots.forEach(slot => {
        if (slot.match[slot.role] === null) slot.match[slot.role] = availablePlayers.shift();
    });
}

export function swapPlayersInRound(round, firstPlayer, secondPlayer, numPlayers) {
    getRoundPlayerSlots(round).forEach(slot => {
        if (slot.match[slot.role] === firstPlayer) slot.match[slot.role] = secondPlayer;
        else if (slot.match[slot.role] === secondPlayer) slot.match[slot.role] = firstPlayer;
    });
    normalizeRoundPlayers(round, numPlayers);
}

export function applySingleRoundPlayerChange(round, targetMatch, role, previousPlayer, selectedPlayer, numPlayers) {
    const selectedPlayerSlot = getRoundPlayerSlots(round)
        .find(slot => (slot.match !== targetMatch || slot.role !== role) && slot.match[slot.role] === selectedPlayer);
    if (selectedPlayerSlot) selectedPlayerSlot.match[selectedPlayerSlot.role] = previousPlayer;
    targetMatch[role] = selectedPlayer;
    normalizeRoundPlayers(round, numPlayers);
}

export function hasRecordedScoresFromRound(schedule, roundIndex, isMatchDone) {
    return schedule.slice(roundIndex).some(round => round.matches.some(isMatchDone));
}
