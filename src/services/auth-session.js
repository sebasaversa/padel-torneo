function toSessionUser(user) {
    if (!user) return null;
    return {
        uid: user.uid,
        email: user.email || '',
        displayName: user.displayName || user.email || 'Usuario',
        isAnonymous: user.isAnonymous === true
    };
}

export function createAuthSession({ firebase, auth }) {
    return {
        currentUser() {
            return toSessionUser(auth.currentUser);
        },
        subscribe(listener) {
            return auth.onAuthStateChanged(user => listener(toSessionUser(user)));
        },
        async signInWithGoogle() {
            const provider = new firebase.auth.GoogleAuthProvider();
            const result = await auth.signInWithPopup(provider);
            return toSessionUser(result.user);
        },
        async signInWithEmailAndPassword(email, password) {
            const result = await auth.signInWithEmailAndPassword(email.trim(), password);
            return toSessionUser(result.user);
        },
        sendPasswordReset(email) {
            return auth.sendPasswordResetEmail(email.trim());
        },
        signOut() {
            return auth.signOut();
        }
    };
}
