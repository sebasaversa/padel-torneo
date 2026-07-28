export function createActivityLog({ tournamentRef, serverTimestamp, getActorName, getActorIdentity = () => ({}), getDeviceLabel, onEntries }) {
    let unsubscribe = null;
    let entries = [];

    function connect() {
        const historyRef = tournamentRef.child('history').limitToLast(50);
        const listener = snapshot => {
            entries = Object.values(snapshot.val() || {}).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
            onEntries(entries);
        };
        historyRef.on('value', listener);
        unsubscribe = () => historyRef.off('value', listener);
    }

    function log(message) {
        return tournamentRef.child('history').push({
            message,
            actor: getActorName(),
            ...getActorIdentity(),
            device: getDeviceLabel(),
            createdAt: serverTimestamp()
        });
    }

    function disconnect() {
        if (unsubscribe) unsubscribe();
        unsubscribe = null;
        entries = [];
    }

    return { connect, disconnect, getEntries: () => entries, log };
}
