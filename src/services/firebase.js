export function createFirebaseClient({ firebase, config }) {
    let database = null;

    function initialize() {
        if (!firebase.apps.length) firebase.initializeApp(config);
    }

    function getAuth() {
        initialize();
        return firebase.auth();
    }

    return {
        async getDatabase() {
            if (database) return database;
            const auth = getAuth();
            if (!auth.currentUser) await auth.signInAnonymously();
            database = firebase.database();
            return database;
        },
        getAuth,
        serverTimestamp() {
            return firebase.database.ServerValue.TIMESTAMP;
        }
    };
}
