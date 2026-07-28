export function createDefaultState({ numPlayers = 9, gamesPerSet = 4 } = {}) {
    return {
        numPlayers,
        gamesPerSet,
        players: Array.from({ length: numPlayers }, (_, index) => `Jugador ${index + 1}`),
        schedule: [],
        collapsedRounds: {},
        tournamentName: '',
        tournamentDate: ''
    };
}

export function normalizeState(state = {}, {
    minGamesPerSet = 1,
    maxGamesPerSet = 20
} = {}) {
    const players = Array.isArray(state.players) ? state.players : [];
    const parsedGames = parseInt(state.gamesPerSet, 10);
    const gamesPerSet = Number.isNaN(parsedGames)
        ? 4
        : Math.max(minGamesPerSet, Math.min(maxGamesPerSet, parsedGames));

    return {
        numPlayers: state.numPlayers || players.length,
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
