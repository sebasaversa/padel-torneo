function createOperationId() {
    if (crypto.randomUUID) return crypto.randomUUID().replace(/-/g, '');
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

export function createTournamentSync({
    database,
    callFunction,
    getStateSignature,
    onRemoteState,
    onStatus
}) {
    let tournamentId = null;
    let tournamentRef = null;
    let unsubscribe = null;
    let applyingRemoteState = false;
    let confirmedPublic = null;
    let pending = Promise.resolve();

    function disconnect() {
        if (unsubscribe) unsubscribe();
        unsubscribe = null;
        tournamentRef = null;
        tournamentId = null;
        confirmedPublic = null;
        pending = Promise.resolve();
    }

    function connect(id) {
        disconnect();
        tournamentId = id;
        tournamentRef = database.ref(`tournaments/${id}`);
        const publicRef = tournamentRef.child('public');
        const listener = publicRef.on('value', snapshot => {
            const remotePublic = snapshot.val();
            const changedByAnotherDevice = Boolean(
                confirmedPublic
                && remotePublic
                && getStateSignature(remotePublic) !== getStateSignature(confirmedPublic)
            );
            if (remotePublic
                && confirmedPublic
                && remotePublic.state?.revision < confirmedPublic.state?.revision) return;
            confirmedPublic = remotePublic;
            applyingRemoteState = true;
            try {
                onRemoteState(remotePublic, { changedByAnotherDevice });
            } finally {
                applyingRemoteState = false;
            }
            onStatus(remotePublic ? 'Sincronizado en todos los dispositivos' : 'Esperando acceso al torneo');
        }, () => onStatus('No se pudo leer el torneo o no tenés acceso'));
        unsubscribe = () => publicRef.off('value', listener);
        return tournamentRef;
    }

    function mutate(type, payload, { operationId = createOperationId() } = {}) {
        const run = async () => {
            if (!tournamentId || !confirmedPublic) throw new Error('El torneo todavía no está sincronizado.');
            onStatus('Confirmando cambio…');
            const expectedRevision = confirmedPublic.state.revision;
            try {
                const result = await callFunction('mutateTournamentV2', {
                    tournamentId,
                    operationId,
                    expectedRevision,
                    type,
                    payload
                }, { allowAnonymous: true });
                onStatus('Cambio confirmado');
                return result;
            } catch (error) {
                onStatus(error?.details?.domainCode === 'REVISION_CONFLICT'
                    ? 'El torneo cambió en otro dispositivo'
                    : 'No se pudo confirmar el cambio');
                throw error;
            }
        };
        pending = pending.then(run, run);
        return pending;
    }

    return {
        connect,
        disconnect,
        getTournamentRef: () => tournamentRef,
        getConfirmedPublic: () => confirmedPublic,
        isApplyingRemoteState: () => applyingRemoteState,
        mutate,
        queueSave() {},
        async saveNow() {
            await pending;
        }
    };
}
