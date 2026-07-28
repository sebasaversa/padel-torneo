export function createFirebaseClient({ firebase, config, fetchFn = globalThis.fetch }) {
    let database = null;
    let authInstance = null;

    function initialize() {
        if (!firebase.apps.length) firebase.initializeApp(config);
    }

    function getAuth() {
        initialize();
        if (!authInstance) authInstance = firebase.auth();
        return authInstance;
    }

    return {
        async getDatabase() {
            const auth = getAuth();
            if (!auth.currentUser) await auth.signInAnonymously();
            if (!database) database = firebase.database();
            return database;
        },
        getAuth,
        async callFunction(name, data = null) {
            const auth = getAuth();
            if (!auth.currentUser || auth.currentUser.isAnonymous) throw new Error('Necesitás iniciar sesión para continuar.');
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
            return payload.data;
        },
        serverTimestamp() {
            return firebase.database.ServerValue.TIMESTAMP;
        }
    };
}
