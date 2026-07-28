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
