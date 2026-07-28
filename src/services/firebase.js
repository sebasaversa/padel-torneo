export function createFirebaseClient({ firebase, config }) {
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
        serverTimestamp() {
            return firebase.database.ServerValue.TIMESTAMP;
        }
    };
}
