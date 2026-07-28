export function createDefaultState({ numPlayers = 9, numCourts = 2, gamesPerSet = 4 } = {}) {
    return {
        numPlayers,
        numCourts,
        gamesPerSet,
        players: Array.from({ length: numPlayers }, (_, index) => `Jugador ${index + 1}`),
        schedule: [],
        collapsedRounds: {},
        tournamentName: '',
        tournamentDate: ''
    };
}

export function normalizeState(state = {}, {
    minCourts = 1,
    maxCourts = 2,
    minGamesPerSet = 1,
    maxGamesPerSet = 20
} = {}) {
    const players = Array.isArray(state.players) ? state.players : [];
    const numPlayers = state.numPlayers || players.length;
    const parsedCourts = parseInt(state.numCourts, 10);
    const availableCourts = Math.max(minCourts, Math.min(maxCourts, Math.floor(numPlayers / 4)));
    const numCourts = Number.isNaN(parsedCourts)
        ? availableCourts
        : Math.max(minCourts, Math.min(availableCourts, parsedCourts));
    const parsedGames = parseInt(state.gamesPerSet, 10);
    const gamesPerSet = Number.isNaN(parsedGames)
        ? 4
        : Math.max(minGamesPerSet, Math.min(maxGamesPerSet, parsedGames));

    return {
        numPlayers,
        numCourts,
        gamesPerSet,
        players,
        schedule: Array.isArray(state.schedule) ? state.schedule : [],
        collapsedRounds: state.collapsedRounds && typeof state.collapsedRounds === 'object'
            ? state.collapsedRounds
            : {},
        tournamentName: typeof state.tournamentName === 'string' ? state.tournamentName : '',
        tournamentDate: typeof state.tournamentDate === 'string' ? state.tournamentDate : ''
    };
}
