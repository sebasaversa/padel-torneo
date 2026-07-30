export function createActivityLog({ tournamentRef, serverTimestamp, getActorName, getActorIdentity = () => ({}), getDeviceLabel, onEntries }) {
    let unsubscribe = null;
    let entries = [];

    function connect() {
        const historyRef = tournamentRef.child('public/activity').limitToLast(50);
        const listener = snapshot => {
            entries = Object.values(snapshot.val() || {}).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
            onEntries(entries);
        };
        historyRef.on('value', listener);
        unsubscribe = () => historyRef.off('value', listener);
    }

    function log(message) {
        // En v2 la actividad se crea junto con la mutación autoritativa.
        return Promise.resolve({ message, actor: getActorName(), ...getActorIdentity(), device: getDeviceLabel() });
    }

    function disconnect() {
        if (unsubscribe) unsubscribe();
        unsubscribe = null;
        entries = [];
    }

    return { connect, disconnect, getEntries: () => entries, log };
}
