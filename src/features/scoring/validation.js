export function isMatchDone(match) {
    return match.score1 !== '' && match.score2 !== '';
}

export function isRoundDone(round) {
    return round.matches.every(isMatchDone);
}

export function getScoreWarning(match, gamesPerSet) {
    if (!isMatchDone(match)) return '';
    const score1 = parseInt(match.score1, 10);
    const score2 = parseInt(match.score2, 10);
    if (score1 === score2) return 'Empate: revisá el resultado antes de cerrar la ronda.';
    if (score1 < gamesPerSet && score2 < gamesPerSet) {
        return `Ningún equipo llegó a ${gamesPerSet} games.`;
    }
    if (score1 === gamesPerSet && score2 === gamesPerSet) {
        return 'Ambos equipos llegaron al objetivo de games.';
    }
    return '';
}
