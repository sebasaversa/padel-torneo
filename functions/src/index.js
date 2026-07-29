import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getDatabase, ServerValue } from 'firebase-admin/database';
import { defineSecret } from 'firebase-functions/params';
import { HttpsError, onCall, onRequest } from 'firebase-functions/v2/https';
import {
    buildAdminProfile,
    normalizeAdminCreation,
    normalizeAdminUpdate,
    serializeUserRecord
} from './admin-users.js';
import { getSuperAdminAuthorization, isAdminAccount } from './authorization.js';
import { buildTournamentDeletion, requireTournamentId } from './tournament-admin.js';
import { buildTournamentCatalogPayload, getTournamentCatalogAuthorization } from './tournament-catalog.js';
import { applyParticipantPairing, applyParticipantScore, normalizePairingRequest, normalizeScoreRequest } from './participant-access.js';
import { buildSuperAdminProfile, isConfiguredSuperAdmin } from './super-admin.js';

if (!getApps().length) initializeApp();

const superAdminEmail = defineSecret('SUPER_ADMIN_EMAIL');

function requireSuperAdmin(request) {
    const authorization = getSuperAdminAuthorization(request.auth);
    if (!authorization.allowed) throw new HttpsError(authorization.code, authorization.message);
    return authorization.auth;
}

async function logAdminActivity(auth, action, targetUid, details = {}) {
    await getDatabase().ref('adminActivity').push({
        action,
        targetUid,
        actorUid: auth.uid,
        actorEmail: auth.token.email || '',
        ...details,
        createdAt: ServerValue.TIMESTAMP
    });
}

async function saveAdminProfile(uid, user, currentProfile = {}) {
    const profileRef = getDatabase().ref(`userProfiles/${uid}`);
    await profileRef.transaction(current => ({
        ...buildAdminProfile(user, current || currentProfile),
        createdAt: current?.createdAt || ServerValue.TIMESTAMP,
        updatedAt: ServerValue.TIMESTAMP
    }));
}

// Punto de comprobación sin privilegios para verificar el despliegue.
export const healthcheck = onRequest({ cors: false }, (_request, response) => {
    response.status(200).json({ status: 'ok' });
});

// Sólo la cuenta definida como secreto puede ejecutar esta inicialización.
// Es idempotente: puede repetirse para restaurar la custom claim si fuera necesario.
export const bootstrapSuperAdmin = onCall({ secrets: [superAdminEmail] }, async request => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Iniciá sesión con Google para continuar.');
    const email = request.auth.token.email;
    if (!isConfiguredSuperAdmin({ email }, superAdminEmail.value())) {
        throw new HttpsError('permission-denied', 'Esta cuenta no puede inicializar el super admin.');
    }

    const userRecord = await getAuth().getUser(request.auth.uid);
    await getAuth().setCustomUserClaims(request.auth.uid, {
        ...(userRecord.customClaims || {}),
        platformRole: 'superAdmin'
    });

    const profileRef = getDatabase().ref(`userProfiles/${request.auth.uid}`);
    await profileRef.transaction(current => ({
        ...buildSuperAdminProfile({
            email,
            displayName: request.auth.token.name || userRecord.displayName
        }, current || {}),
        createdAt: current?.createdAt || ServerValue.TIMESTAMP,
        updatedAt: ServerValue.TIMESTAMP
    }));

    return { role: 'superAdmin' };
});

export const createAdminUser = onCall(async request => {
    const auth = requireSuperAdmin(request);
    let data;
    try {
        data = normalizeAdminCreation(request.data);
    } catch (error) {
        throw new HttpsError('invalid-argument', error.message);
    }
    const user = await getAuth().createUser(data);
    await getAuth().setCustomUserClaims(user.uid, { platformRole: 'admin' });
    await saveAdminProfile(user.uid, data);
    await logAdminActivity(auth, 'createAdmin', user.uid, { email: data.email });
    return serializeUserRecord(await getAuth().getUser(user.uid));
});

export const updateAdminUser = onCall(async request => {
    const auth = requireSuperAdmin(request);
    const uid = typeof request.data?.uid === 'string' ? request.data.uid : '';
    if (!uid) throw new HttpsError('invalid-argument', 'El usuario es obligatorio.');
    let updates;
    try {
        updates = normalizeAdminUpdate(request.data);
    } catch (error) {
        throw new HttpsError('invalid-argument', error.message);
    }
    const user = await getAuth().updateUser(uid, updates);
    await saveAdminProfile(uid, user);
    await logAdminActivity(auth, 'updateAdmin', uid, { fields: Object.keys(updates) });
    return serializeUserRecord(await getAuth().getUser(uid));
});

export const deleteAdminUser = onCall(async request => {
    const auth = requireSuperAdmin(request);
    const uid = typeof request.data?.uid === 'string' ? request.data.uid : '';
    if (!uid) throw new HttpsError('invalid-argument', 'El usuario es obligatorio.');
    if (uid === request.auth.uid) throw new HttpsError('failed-precondition', 'No podés eliminar tu propia cuenta.');
    const user = await getAuth().getUser(uid);
    if (!isAdminAccount(user)) {
        throw new HttpsError('permission-denied', 'Sólo se pueden eliminar cuentas de admin.');
    }
    await getAuth().deleteUser(uid);
    await getDatabase().ref(`userProfiles/${uid}`).remove();
    await logAdminActivity(auth, 'deleteAdmin', uid, { email: user.email || '' });
    return { deleted: true };
});

export const listAdminUsers = onCall(async request => {
    requireSuperAdmin(request);
    const result = await getAuth().listUsers(1000);
    return result.users
        .filter(user => user.customClaims?.platformRole === 'admin')
        .map(serializeUserRecord);
});

export const generateAdminPasswordResetLink = onCall(async request => {
    const auth = requireSuperAdmin(request);
    const uid = typeof request.data?.uid === 'string' ? request.data.uid : '';
    if (!uid) throw new HttpsError('invalid-argument', 'El usuario es obligatorio.');
    const user = await getAuth().getUser(uid);
    if (!isAdminAccount(user)) {
        throw new HttpsError('permission-denied', 'Sólo se pueden recuperar cuentas de admin.');
    }
    const link = await getAuth().generatePasswordResetLink(user.email);
    await logAdminActivity(auth, 'generatePasswordResetLink', uid, { email: user.email || '' });
    return { email: user.email, link };
});

export const setTournamentAdmin = onCall(async request => {
    const auth = requireSuperAdmin(request);
    let tournamentId;
    try { tournamentId = requireTournamentId(request.data?.tournamentId); } catch (error) { throw new HttpsError('invalid-argument', error.message); }
    const uid = typeof request.data?.uid === 'string' ? request.data.uid : '';
    const enabled = request.data?.enabled === true;
    if (!uid) throw new HttpsError('invalid-argument', 'El usuario es obligatorio.');
    const user = await getAuth().getUser(uid);
    if (!isAdminAccount(user)) throw new HttpsError('permission-denied', 'Sólo se pueden asignar cuentas admin.');
    const ref = getDatabase().ref(`tournaments/${tournamentId}/metadata`);
    await ref.transaction(current => {
        const admins = { ...(current?.admins || {}) };
        if (enabled) admins[uid] = true; else delete admins[uid];
        return { ...(current || {}), admins, updatedAt: ServerValue.TIMESTAMP };
    });
    await logAdminActivity(auth, enabled ? 'assignTournamentAdmin' : 'removeTournamentAdmin', uid, { tournamentId });
    return { enabled };
});

export const setTournamentDeleted = onCall(async request => {
    const auth = requireSuperAdmin(request);
    let tournamentId;
    try { tournamentId = requireTournamentId(request.data?.tournamentId); } catch (error) { throw new HttpsError('invalid-argument', error.message); }
    const deleted = request.data?.deleted === true;
    const ref = getDatabase().ref(`tournaments/${tournamentId}/metadata`);
    await ref.transaction(current => buildTournamentDeletion(current, auth.uid, ServerValue.TIMESTAMP, deleted));
    await logAdminActivity(auth, deleted ? 'deleteTournament' : 'restoreTournament', tournamentId);
    return { deleted };
});

export const listTournamentCatalog = onCall(async request => {
    const authorization = getTournamentCatalogAuthorization(request.auth);
    if (!authorization.allowed) throw new HttpsError(authorization.code, authorization.message);
    const snapshot = await getDatabase().ref('tournaments').get();
    const tournaments = buildTournamentCatalogPayload(snapshot.val(), {
        uid: authorization.auth.uid,
        role: authorization.role
    });
    console.info('Tournament catalog loaded', {
        role: authorization.role,
        count: Object.keys(tournaments).length
    });
    return {
        tournaments
    };
});

export const updateParticipantPairing = onCall(async request => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Ingresá al torneo para continuar.');
    let change;
    try { change = normalizePairingRequest(request.data); } catch (error) { throw new HttpsError('invalid-argument', error.message); }
    const database = getDatabase();
    const claims = (await database.ref(`tournaments/${change.tournamentId}/claims`).get()).val() || {};
    const stateRef = database.ref(`tournaments/${change.tournamentId}/state`);
    try {
        const result = await stateRef.transaction(state => applyParticipantPairing(state, change, request.auth.uid, claims));
        if (!result.committed) throw new Error('No se pudo guardar el cambio.');
    } catch (error) {
        throw new HttpsError('permission-denied', error.message || 'No se pudo corregir la pareja.');
    }
    return { updated: true };
});

export const updateParticipantScore = onCall(async request => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Ingresá al torneo para continuar.');
    let change;
    try { change = normalizeScoreRequest(request.data); } catch (error) { throw new HttpsError('invalid-argument', error.message); }
    const database = getDatabase();
    const claims = (await database.ref(`tournaments/${change.tournamentId}/claims`).get()).val() || {};
    const stateRef = database.ref(`tournaments/${change.tournamentId}/state`);
    try {
        const result = await stateRef.transaction(state => applyParticipantScore(state, change, request.auth.uid, claims));
        if (!result.committed) throw new Error('No se pudo guardar el resultado.');
    } catch (error) {
        throw new HttpsError('permission-denied', error.message || 'No se pudo cargar el resultado.');
    }
    return { updated: true };
});
