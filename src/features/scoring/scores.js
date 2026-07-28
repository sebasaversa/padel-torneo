export function normalizeScore(value, gamesPerSet) {
    const parsed = parseInt(value, 10);
    if (value === '' || Number.isNaN(parsed)) return '';
    return Math.max(0, Math.min(gamesPerSet, parsed));
}

export function adjustScore(currentScore, amount, gamesPerSet) {
    const current = parseInt(currentScore, 10);
    return Math.max(0, Math.min(gamesPerSet, (Number.isNaN(current) ? 0 : current) + amount));
}
