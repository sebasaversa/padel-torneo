function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function stableSignature(value) {
    if (Array.isArray(value)) return `[${value.map(stableSignature).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableSignature(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

export function createStateStore({ read, write, maxUndo = 20 }) {
    let undoStack = [];

    return {
        read,
        write,
        signature: stableSignature,
        remember() {
            undoStack.push(clone(read()));
            if (undoStack.length > maxUndo) undoStack.shift();
        },
        undo() {
            const previous = undoStack.pop();
            if (!previous) return null;
            write(previous);
            return previous;
        },
        clearUndo() {
            undoStack = [];
        },
        hasUndo() {
            return undoStack.length > 0;
        }
    };
}

export function createTournamentState(initialState) {
    let current = clone(initialState);
    const paths = {
        numPlayers: ['configuration', 'numPlayers'],
        numCourts: ['configuration', 'numCourts'],
        pairingMode: ['configuration', 'pairingMode'],
        fixedTeams: ['configuration', 'fixedTeams'],
        tournamentName: ['metadata', 'tournamentName'],
        tournamentDate: ['metadata', 'tournamentDate'],
        players: ['state', 'players'],
        gamesPerSet: ['state', 'gamesPerSet'],
        schedule: ['state', 'schedule'],
        fixtureVariant: ['state', 'fixtureVariant'],
        scheduleRevision: ['state', 'scheduleRevision'],
        scheduleFingerprint: ['state', 'scheduleFingerprint'],
        revision: ['state', 'revision'],
        diagnostic: ['state', 'diagnostic'],
        collapsedRounds: ['ui', 'collapsedRounds']
    };
    const view = new Proxy({}, {
        get(_target, property) {
            const path = paths[property];
            if (!path) return current[property];
            return current[path[0]][path[1]];
        },
        set(_target, property, value) {
            const path = paths[property];
            if (!path) {
                current[property] = value;
                return true;
            }
            current[path[0]][path[1]] = value;
            if (property === 'schedule') current.state.numRounds = value.length;
            return true;
        },
        ownKeys() {
            return Reflect.ownKeys(current);
        },
        getOwnPropertyDescriptor() {
            return { enumerable: true, configurable: true };
        }
    });

    return {
        get value() {
            return view;
        },
        snapshot() {
            return clone(current);
        },
        replace(nextState) {
            current = clone(nextState);
        }
    };
}
