export function createFirebaseClient({ firebase, config, fetchFn = globalThis.fetch }) {
    let database = null;
    let authInstance = null;
    let initialAuthState = null;

    function initialize() {
        if (!firebase.apps.length) firebase.initializeApp(config);
    }

    function getAuth() {
        initialize();
        if (!authInstance) authInstance = firebase.auth();
        return authInstance;
    }

    function waitForInitialAuthState() {
        const auth = getAuth();
        if (auth.currentUser) return Promise.resolve(auth.currentUser);
        if (!initialAuthState) {
            initialAuthState = new Promise(resolve => {
                let unsubscribe;
                let resolved = false;
                const finish = user => {
                    if (resolved) return;
                    resolved = true;
                    if (typeof unsubscribe === 'function') unsubscribe();
                    resolve(user);
                };
                unsubscribe = auth.onAuthStateChanged(finish);
                if (resolved && typeof unsubscribe === 'function') unsubscribe();
            });
        }
        return initialAuthState;
    }

    return {
        async getDatabase() {
            const auth = getAuth();
            await waitForInitialAuthState();
            if (!auth.currentUser) await auth.signInAnonymously();
            if (!database) database = firebase.database();
            return database;
        },
        getAuth,
        async callFunction(name, data = null, { allowAnonymous = false } = {}) {
            const auth = getAuth();
            if (!auth.currentUser || (auth.currentUser.isAnonymous && !allowAnonymous)) throw new Error('Necesitás iniciar sesión para continuar.');
            const token = await auth.currentUser.getIdToken();
            const response = await fetchFn(`https://us-central1-${config.projectId}.cloudfunctions.net/${name}`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ data })
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(payload.error?.message || 'No se pudo completar la operación.');
            // Las callable Functions de Firebase usan el campo `result` en
            // su protocolo HTTP. Conservamos `data` para compatibilidad con
            // respuestas anteriores y pruebas ya existentes.
            return payload.result ?? payload.data;
        },
        serverTimestamp() {
            return firebase.database.ServerValue.TIMESTAMP;
        }
    };
}
