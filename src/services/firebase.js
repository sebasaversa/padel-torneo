export function createFirebaseClient({ firebase, config }) {
    let database = null;
    let authInstance = null;
    let functionsInstance = null;

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
        getFunctions() {
            initialize();
            if (!functionsInstance) functionsInstance = firebase.functions('us-central1');
            return functionsInstance;
        },
        serverTimestamp() {
            return firebase.database.ServerValue.TIMESTAMP;
        }
    };
}
