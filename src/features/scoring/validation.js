export function getCompletedScore(match, gamesPerSet) {
    const score1Blank = match.score1 === '';
    const score2Blank = match.score2 === '';
    if (!score1Blank && !score2Blank) {
        return [parseInt(match.score1, 10), parseInt(match.score2, 10)];
    }
    if (score1Blank && !score2Blank && parseInt(match.score2, 10) === gamesPerSet) {
        return [0, gamesPerSet];
    }
    if (!score1Blank && score2Blank && parseInt(match.score1, 10) === gamesPerSet) {
        return [gamesPerSet, 0];
    }
    return null;
}

export function isMatchDone(match, gamesPerSet) {
    return getCompletedScore(match, gamesPerSet) !== null;
}

export function isRoundDone(round, gamesPerSet) {
    return round.matches.every(match => isMatchDone(match, gamesPerSet));
}

export function getScoreWarning(match, gamesPerSet) {
    const score = getCompletedScore(match, gamesPerSet);
    if (!score) return '';
    const [score1, score2] = score;
    if (score1 === score2) return 'Empate: revisá el resultado antes de cerrar la ronda.';
    if (score1 < gamesPerSet && score2 < gamesPerSet) {
        return `Ningún equipo llegó a ${gamesPerSet} games.`;
    }
    if (score1 === gamesPerSet && score2 === gamesPerSet) {
        return 'Ambos equipos llegaron al objetivo de games.';
    }
    return '';
}
