export function encodeState(state) {
    return btoa(unescape(encodeURIComponent(JSON.stringify(state))));
}

export function decodeState(encoded) {
    return JSON.parse(decodeURIComponent(escape(atob(encoded))));
}

export function createSharedTournamentUrl(origin, pathname, tournamentId) {
    return `${origin}${pathname}?torneo=${tournamentId}`;
}

export function createStandaloneShareUrl(origin, pathname, state) {
    return `${origin}${pathname}#s=${encodeState(state)}`;
}

export function exportStateJSON(state) {
    return JSON.stringify(state, null, 2);
}

export function importStateJSON(json) {
    return JSON.parse(json);
}
