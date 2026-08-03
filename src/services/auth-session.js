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
        isGoogleUser() {
            return auth.currentUser?.providerData?.some(provider => provider.providerId === 'google.com') === true;
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
        async signInWithCustomToken(token) {
            const result = await auth.signInWithCustomToken(token);
            return toSessionUser(result.user);
        },
        sendPasswordReset(email) {
            return auth.sendPasswordResetEmail(email.trim());
        },
        async getClaims(forceRefresh = false) {
            if (!auth.currentUser || auth.currentUser.isAnonymous) return {};
            const token = await auth.currentUser.getIdTokenResult(forceRefresh);
            return token.claims || {};
        },
        signOut() {
            return auth.signOut();
        }
    };
}
