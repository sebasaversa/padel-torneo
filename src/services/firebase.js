export function createFirebaseClient({ firebase, config }) {
    let database = null;

    return {
        async getDatabase() {
            if (database) return database;
            if (!firebase.apps.length) firebase.initializeApp(config);
            await firebase.auth().signInAnonymously();
            database = firebase.database();
            return database;
        },
        serverTimestamp() {
            return firebase.database.ServerValue.TIMESTAMP;
        }
    };
}
