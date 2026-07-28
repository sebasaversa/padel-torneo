export function createTournamentSync({ database, serverTimestamp, getState, getStateSignature, onRemoteState, onStatus }) {
    let tournamentRef = null;
    let unsubscribe = null;
    let saveTimer = null;
    let applyingRemoteState = false;
    let lastSavedStateSignature = null;

    function disconnect() {
        if (unsubscribe) unsubscribe();
        unsubscribe = null;
        clearTimeout(saveTimer);
        saveTimer = null;
        tournamentRef = null;
        lastSavedStateSignature = null;
    }

    function connect(tournamentId) {
        disconnect();
        tournamentRef = database.ref(`tournaments/${tournamentId}`);
        const stateRef = tournamentRef.child('state');
        const listener = stateRef.on('value', snapshot => {
            const remoteState = snapshot.val();
            const changedByAnotherDevice = remoteState
                && getStateSignature(remoteState) !== lastSavedStateSignature;
            applyingRemoteState = true;
            try {
                onRemoteState(remoteState, { changedByAnotherDevice });
            } finally {
                applyingRemoteState = false;
            }
            onStatus(remoteState ? 'Sincronizado en todos los dispositivos' : 'Torneo compartido listo');
        }, () => onStatus('No se pudo actualizar el torneo compartido'));
        unsubscribe = () => stateRef.off('value', listener);
        return tournamentRef;
    }

    function queueSave() {
        if (!tournamentRef || applyingRemoteState) return;
        clearTimeout(saveTimer);
        onStatus('Guardando cambios…');
        saveTimer = setTimeout(() => { saveNow(); }, 350);
    }

    async function saveNow() {
        if (!tournamentRef || applyingRemoteState) return;
        try {
            const state = getState();
            lastSavedStateSignature = getStateSignature(state);
            await tournamentRef.update({
                state,
                updatedAt: serverTimestamp()
            });
            onStatus('Sincronizado en todos los dispositivos');
        } catch (error) {
            console.error(error);
            onStatus('No se pudieron guardar los cambios compartidos');
        }
    }

    return {
        connect,
        disconnect,
        getTournamentRef: () => tournamentRef,
        isApplyingRemoteState: () => applyingRemoteState,
        queueSave,
        saveNow
    };
}
