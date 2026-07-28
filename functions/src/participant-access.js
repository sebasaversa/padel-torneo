const PLAYER_ROLES = ['t1_p1', 't1_p2', 't2_p1', 't2_p2'];

export function normalizePairingRequest(data = {}) {
    const { tournamentId, roundIndex, matchIndex, role, playerId } = data;
    if (typeof tournamentId !== 'string' || !/^[a-zA-Z0-9_-]{8,}$/.test(tournamentId)) throw new Error('El torneo no es válido.');
    if (!Number.isInteger(roundIndex) || !Number.isInteger(matchIndex) || !PLAYER_ROLES.includes(role) || !Number.isInteger(playerId)) {
        throw new Error('El cambio de pareja no es válido.');
    }
    return { tournamentId, roundIndex, matchIndex, role, playerId };
}

export function applyParticipantPairing(state, request, uid, claims = {}) {
    const round = state?.schedule?.[request.roundIndex];
    const target = round?.matches?.[request.matchIndex];
    if (!target) throw new Error('El partido no existe.');
    const targetPlayers = PLAYER_ROLES.map(role => target[role]);
    const playsMatch = targetPlayers.some(playerId => claims?.[playerId]?.uid === uid);
    if (!playsMatch) throw new Error('Sólo podés corregir parejas de tus propios partidos.');
    if (request.playerId < 0 || request.playerId >= state.numPlayers) throw new Error('El jugador no es válido.');
    const previousPlayer = target[request.role];
    if (previousPlayer === request.playerId) return state;
    let replacement = null;
    round.matches.forEach((match, matchIndex) => PLAYER_ROLES.forEach(role => {
        if ((matchIndex !== request.matchIndex || role !== request.role) && match[role] === request.playerId) replacement = { match, role };
    }));
    if (replacement) replacement.match[replacement.role] = previousPlayer;
    target[request.role] = request.playerId;
    const allPlayers = round.matches.flatMap(match => PLAYER_ROLES.map(role => match[role]));
    if (new Set(allPlayers).size !== allPlayers.length) throw new Error('El cambio duplicaría un jugador en la ronda.');
    return state;
}

export function normalizeScoreRequest(data = {}) {
    const { tournamentId, roundIndex, matchIndex, team, score } = data;
    if (typeof tournamentId !== 'string' || !/^[a-zA-Z0-9_-]{8,}$/.test(tournamentId)) throw new Error('El torneo no es válido.');
    if (!Number.isInteger(roundIndex) || !Number.isInteger(matchIndex) || !['score1', 'score2'].includes(team)) {
        throw new Error('El resultado no es válido.');
    }
    if (score !== '' && (!Number.isInteger(score) || score < 0 || score > 20)) throw new Error('El puntaje no es válido.');
    return { tournamentId, roundIndex, matchIndex, team, score };
}

export function applyParticipantScore(state, request, uid, claims = {}) {
    const match = state?.schedule?.[request.roundIndex]?.matches?.[request.matchIndex];
    if (!match) throw new Error('El partido no existe.');
    const playsMatch = PLAYER_ROLES.some(role => claims?.[match[role]]?.uid === uid);
    if (!playsMatch) throw new Error('Sólo podés cargar resultados de tus propios partidos.');
    if (request.score !== '' && request.score > state.gamesPerSet) throw new Error('El puntaje supera los games del set.');
    match[request.team] = request.score;
    return state;
}
