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
import {
    buildInternalUsernameEmail,
    buildMissingUsernameEmail,
    buildUserProfile,
    canReserveUsername,
    normalizeAccountRegistration,
    normalizeUsername,
    usernameDirectoryKey
} from './user-accounts.js';
import { getSuperAdminAuthorization, isAdminAccount } from './authorization.js';
import { buildTournamentDeletion, requireTournamentId } from './tournament-admin.js';
import { buildTournamentCatalogPayload, getTournamentCatalogAuthorization } from './tournament-catalog.js';
import { buildSuperAdminProfile, isConfiguredSuperAdmin } from './super-admin.js';
import {
    applyTournamentMutation,
    buildTournamentV2,
    createOpaqueToken,
    invitationHash,
    normalizeCreationRequest,
    normalizeMutationRequest,
    prepareFixtureMutation,
    preserveAdminRole
} from './domain/tournament-v2.js';
import { sha256 } from './domain/fixture/canonical.js';

if (!getApps().length) initializeApp();

const superAdminEmail = defineSecret('SUPER_ADMIN_EMAIL');

function requireSuperAdmin(request) {
    const authorization = getSuperAdminAuthorization(request.auth);
    if (!authorization.allowed) throw new HttpsError(authorization.code, authorization.message);
    return authorization.auth;
}

function asHttpsError(error) {
    if (error instanceof HttpsError) return error;
    const codeByDomain = {
        FORBIDDEN: 'permission-denied',
        NOT_FOUND: 'not-found',
        REVISION_CONFLICT: 'aborted',
        SCHEDULE_IDENTITY_MISMATCH: 'failed-precondition',
        HAS_RECORDED_SCORES: 'failed-precondition',
        NO_MORE_FIXTURE_VARIANTS: 'failed-precondition',
        IDEMPOTENCY_KEY_REUSED: 'already-exists',
        UNSUPPORTED_SCHEMA_VERSION: 'failed-precondition',
        UNSUPPORTED_GENERATOR_VERSION: 'failed-precondition'
    };
    return new HttpsError(codeByDomain[error?.code] || 'invalid-argument', error?.message || 'La operación no es válida.', {
        domainCode: error?.code || 'INVALID_STATE',
        retryable: error?.retryable === true,
        details: error?.details || {}
    });
}

function requireAuthenticated(request) {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Ingresá para continuar.');
    return {
        uid: request.auth.uid,
        platformRole: request.auth.token.platformRole || null
    };
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

function asRegistrationHttpsError(error) {
    if (error instanceof HttpsError) return error;
    if (error?.code === 'auth/email-already-exists') {
        return new HttpsError('already-exists', 'Ya existe una cuenta con ese email.');
    }
    if (error?.code === 'auth/invalid-password') {
        return new HttpsError('invalid-argument', 'La contraseña no cumple los requisitos.');
    }
    if (error?.code === 'auth/invalid-email') {
        return new HttpsError('invalid-argument', 'El email no es válido.');
    }
    console.error('Unexpected user registration failure', {
        code: error?.code || null,
        message: error?.message || String(error)
    });
    return new HttpsError('internal', 'No se pudo crear la cuenta. Intentá nuevamente.');
}

async function saveRegularUserProfile(uid, account) {
    const profileRef = getDatabase().ref(`userProfiles/${uid}`);
    await profileRef.transaction(current => ({
        ...buildUserProfile(account, current || {}),
        createdAt: current?.createdAt || ServerValue.TIMESTAMP,
        updatedAt: ServerValue.TIMESTAMP
    }));
}

async function releaseUsernameReservation(ref, registrationId, uid = null) {
    await ref.transaction(current => {
        // Returning undefined would abort from an initially empty local cache
        // before the server can provide the existing reservation. Committing
        // null is a safe no-op when the server is truly empty and forces the
        // normal transaction retry when it is not.
        if (!current) return null;
        const belongsToAttempt = current?.registrationId === registrationId
            && current?.status === 'reserved';
        const belongsToCreatedUser = Boolean(uid) && current?.uid === uid;
        return belongsToAttempt || belongsToCreatedUser ? null : current;
    });
}

// Punto de comprobación sin privilegios para verificar el despliegue.
export const healthcheck = onRequest({ cors: false }, (_request, response) => {
    response.status(200).json({ status: 'ok' });
});

export const registerUserV2 = onCall({ secrets: [superAdminEmail] }, async request => {
    let account;
    try {
        account = normalizeAccountRegistration(request.data);
    } catch (error) {
        throw new HttpsError('invalid-argument', error.message);
    }
    if (account.accountType === 'email'
        && isConfiguredSuperAdmin({ email: account.email }, superAdminEmail.value())) {
        throw new HttpsError('permission-denied', 'Ese email no está disponible para un alta pública.');
    }

    const auth = getAuth();
    if (account.accountType === 'email') {
        let user;
        try {
            user = await auth.createUser({
                email: account.email,
                password: account.password,
                displayName: account.displayName
            });
            await saveRegularUserProfile(user.uid, account);
            return {
                customToken: await auth.createCustomToken(user.uid),
                accountType: account.accountType,
                displayName: account.displayName
            };
        } catch (error) {
            if (user?.uid) {
                await Promise.all([
                    auth.deleteUser(user.uid).catch(() => {}),
                    getDatabase().ref(`userProfiles/${user.uid}`).remove().catch(() => {})
                ]);
            }
            throw asRegistrationHttpsError(error);
        }
    }

    const database = getDatabase();
    const registrationId = createOpaqueToken();
    const directoryRef = database.ref(`usernameDirectory/${usernameDirectoryKey(account.username)}`);
    const reservation = await directoryRef.transaction(current =>
        canReserveUsername(current) ? {
            username: account.username,
            registrationId,
            status: 'reserved',
            createdAt: ServerValue.TIMESTAMP
        } : current);
    if (!reservation.committed || reservation.snapshot.val()?.registrationId !== registrationId) {
        throw new HttpsError('already-exists', 'Ese usuario ya está en uso.');
    }

    let user;
    try {
        const authEmail = buildInternalUsernameEmail(createOpaqueToken());
        user = await auth.createUser({
            email: authEmail,
            password: account.password,
            displayName: account.displayName
        });
        const activation = await directoryRef.transaction(current => {
            // See releaseUsernameReservation: null must be committed as a
            // harmless no-op so the transaction reaches the server value.
            if (!current) return null;
            if (current?.registrationId !== registrationId || current?.status !== 'reserved') return;
            return {
                username: account.username,
                uid: user.uid,
                authEmail,
                status: 'active',
                createdAt: current.createdAt || ServerValue.TIMESTAMP,
                updatedAt: ServerValue.TIMESTAMP
            };
        });
        const activatedEntry = activation.snapshot.val();
        if (!activation.committed || activatedEntry?.uid !== user.uid
            || activatedEntry?.status !== 'active') {
            throw new Error('No se pudo activar el usuario.');
        }
        await saveRegularUserProfile(user.uid, account);
        return {
            customToken: await auth.createCustomToken(user.uid),
            accountType: account.accountType,
            displayName: account.displayName
        };
    } catch (error) {
        if (user?.uid) {
            await Promise.all([
                auth.deleteUser(user.uid).catch(() => {}),
                database.ref(`userProfiles/${user.uid}`).remove().catch(() => {})
            ]);
        }
        await releaseUsernameReservation(directoryRef, registrationId, user?.uid).catch(() => {});
        throw asRegistrationHttpsError(error);
    }
});

export const resolveUsernameLoginV2 = onCall(async request => {
    let username;
    try {
        username = normalizeUsername(request.data?.username);
    } catch (error) {
        throw new HttpsError('invalid-argument', error.message);
    }
    const entry = (await getDatabase()
        .ref(`usernameDirectory/${usernameDirectoryKey(username)}`)
        .get()).val();
    return {
        authEmail: entry?.status === 'active' && entry?.username === username && typeof entry?.authEmail === 'string'
            ? entry.authEmail
            : buildMissingUsernameEmail(username)
    };
});

export const createTournamentV2 = onCall(async request => {
    const actor = requireAuthenticated(request);
    if (!['admin', 'superAdmin'].includes(actor.platformRole)) {
        throw new HttpsError('permission-denied', 'Sólo un administrador puede crear torneos.');
    }
    let normalized;
    try {
        normalized = normalizeCreationRequest(request.data);
    } catch (error) {
        throw asHttpsError(error);
    }
    const digest = sha256(normalized);
    const tournamentId = `t_${sha256(`${actor.uid}:${normalized.creationRequestId}`).slice(0, 30)}`;
    const builtTournament = buildTournamentV2({
        request: normalized,
        ownerUid: actor.uid,
        tournamentId,
        timestamp: ServerValue.TIMESTAMP
    });
    const rootRef = getDatabase().ref();
    let response;
    try {
        const transaction = await rootRef.transaction(root => {
            root ||= {};
            root.creationRequests ||= {};
            root.creationRequests[actor.uid] ||= {};
            const existing = root.creationRequests[actor.uid][normalized.creationRequestId];
            if (existing) {
                if (existing.digest !== digest) {
                    throw Object.assign(new Error('El creationRequestId ya se usó para otra configuración.'), {
                        code: 'IDEMPOTENCY_KEY_REUSED'
                    });
                }
                response = { tournamentId: existing.tournamentId, replayed: true };
                return root;
            }
            root.tournaments ||= {};
            root.tournamentAccess ||= {};
            root.tournaments[tournamentId] = structuredClone(builtTournament.tournament);
            root.tournamentAccess[tournamentId] = structuredClone(builtTournament.access);
            root.creationRequests[actor.uid][normalized.creationRequestId] = {
                tournamentId,
                digest,
                createdAt: ServerValue.TIMESTAMP
            };
            response = { tournamentId, replayed: false };
            return root;
        });
        if (!transaction.committed) throw new Error('No se pudo crear el torneo.');
    } catch (error) {
        throw asHttpsError(error);
    }
    return response;
});

export const mutateTournamentV2 = onCall(async request => {
    const actor = requireAuthenticated(request);
    const tournamentId = request.data?.tournamentId;
    if (typeof tournamentId !== 'string' || !/^t_[a-f0-9]{30}$/.test(tournamentId)) {
        throw new HttpsError('invalid-argument', 'El torneo no es válido.');
    }
    let mutation;
    try {
        mutation = normalizeMutationRequest(request.data);
    } catch (error) {
        throw asHttpsError(error);
    }
    const database = getDatabase();
    const access = (await database.ref(`tournamentAccess/${tournamentId}`).get()).val() || {};
    const tournamentRef = database.ref(`tournaments/${tournamentId}`);
    const tournamentSnapshot = await tournamentRef.get();
    if (!tournamentSnapshot.exists()) {
        throw new HttpsError('not-found', 'El torneo no existe.');
    }
    let preparedFixture;
    try {
        preparedFixture = tournamentSnapshot.child(`_server/operationReceipts/${mutation.operationId}`).exists()
            ? null
            : prepareFixtureMutation(tournamentSnapshot.val().public, mutation);
    } catch (error) {
        throw asHttpsError(error);
    }
    let output;
    try {
        const transaction = await tournamentRef.transaction(tournament => {
            if (!tournament) return tournament;
            const applied = applyTournamentMutation({
                tournament,
                access,
                request: mutation,
                actor,
                timestamp: ServerValue.TIMESTAMP,
                preparedFixture
            });
            output = { ...applied.result, replayed: applied.replayed };
            return applied.tournament;
        });
        if (!transaction.committed || !output) {
            throw Object.assign(new Error('El torneo ya no existe.'), { code: 'NOT_FOUND' });
        }
    } catch (error) {
        throw asHttpsError(error);
    }
    return output;
});

export const createTournamentInvitationV2 = onCall(async request => {
    const actor = requireAuthenticated(request);
    const tournamentId = request.data?.tournamentId;
    const role = request.data?.role === 'participant' ? 'participant' : 'spectator';
    const database = getDatabase();
    const [tournamentSnapshot, accessSnapshot] = await Promise.all([
        database.ref(`tournaments/${tournamentId}/public`).get(),
        database.ref(`tournamentAccess/${tournamentId}`).get()
    ]);
    const tournament = tournamentSnapshot.val();
    const access = accessSnapshot.val() || {};
    const canManage = actor.platformRole === 'superAdmin'
        || tournament?.metadata?.ownerUid === actor.uid
        || access.members?.[actor.uid]?.role === 'admin';
    if (!canManage) throw new HttpsError('permission-denied', 'No podés crear invitaciones.');
    const token = createOpaqueToken();
    const hash = invitationHash(token);
    const accessRef = database.ref(`tournamentAccess/${tournamentId}`);
    let invitationStored = false;
    const transaction = await accessRef.transaction(current => {
        if (!current) return current;
        invitationStored = true;
        return {
            ...current,
            invitationHashes: {
                ...(current.invitationHashes || {}),
                [hash]: {
                    role,
                    createdBy: actor.uid,
                    createdAt: ServerValue.TIMESTAMP,
                    expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000
                }
            },
            accessRevision: (current.accessRevision || 0) + 1
        };
    });
    if (!transaction.committed || !invitationStored) {
        throw new HttpsError('not-found', 'El torneo ya no existe.');
    }
    return { token, role };
});

export const joinTournamentV2 = onCall(async request => {
    const actor = requireAuthenticated(request);
    const tournamentId = request.data?.tournamentId;
    let hash;
    try {
        hash = invitationHash(request.data?.token);
    } catch (error) {
        throw asHttpsError(error);
    }
    let role;
    let rejection = null;
    try {
        const accessRef = getDatabase().ref(`tournamentAccess/${tournamentId}`);
        await accessRef.get();
        const transaction = await accessRef.transaction(current => {
            if (!current) return current;
            const invitation = current.invitationHashes?.[hash];
            if (!invitation || invitation.expiresAt < Date.now()) {
                rejection = Object.assign(new Error('La invitación no existe o venció.'), { code: 'FORBIDDEN' });
                return undefined;
            }
            const currentMember = current.members?.[actor.uid];
            role = preserveAdminRole(currentMember?.role, invitation.role);
            if (currentMember?.joinedInvitationHash === hash) return current;
            return {
                ...current,
                members: {
                    ...(current.members || {}),
                    [actor.uid]: {
                        role,
                        joinedAt: currentMember?.joinedAt || ServerValue.TIMESTAMP,
                        joinedInvitationHash: hash
                    }
                },
                accessRevision: (current.accessRevision || 0) + 1
            };
        });
        if (!transaction.committed || !role) {
            throw rejection || Object.assign(new Error('El torneo no existe.'), { code: 'NOT_FOUND' });
        }
    } catch (error) {
        throw asHttpsError(error);
    }
    return { role };
});

export const claimTournamentPlayerV2 = onCall(async request => {
    const actor = requireAuthenticated(request);
    const tournamentId = request.data?.tournamentId;
    const playerId = request.data?.playerId;
    const database = getDatabase();
    const [configurationSnapshot, accessSnapshot] = await Promise.all([
        database.ref(`tournaments/${tournamentId}/public/configuration`).get(),
        database.ref(`tournamentAccess/${tournamentId}`).get()
    ]);
    const numPlayers = configurationSnapshot.val()?.numPlayers;
    if (!Number.isInteger(playerId) || !Number.isInteger(numPlayers)
        || playerId < 0 || playerId >= numPlayers) {
        throw new HttpsError('invalid-argument', 'El jugador no es válido.');
    }
    let rejection = null;
    let claimStored = false;
    try {
        const accessRef = database.ref(`tournamentAccess/${tournamentId}`);
        if (!accessSnapshot.exists()) {
            throw Object.assign(new Error('El torneo no existe.'), { code: 'NOT_FOUND' });
        }
        const transaction = await accessRef.transaction(current => {
            if (!current) return current;
            if (!current.members?.[actor.uid]) {
                rejection = Object.assign(new Error('No sos miembro de este torneo.'), { code: 'FORBIDDEN' });
                return undefined;
            }
            const claim = current.claims?.[playerId];
            if (claim && claim.uid !== actor.uid) {
                rejection = Object.assign(new Error('Ese jugador ya está ocupado.'), { code: 'FORBIDDEN' });
                return undefined;
            }
            const ownClaimIds = Object.entries(current.claims || {})
                .filter(([, value]) => value?.uid === actor.uid)
                .map(([id]) => Number(id));
            if (claim?.uid === actor.uid
                && ownClaimIds.length === 1
                && ownClaimIds[0] === playerId
                && (current.members[actor.uid].role === 'admin'
                    || current.members[actor.uid].role === 'participant')) {
                claimStored = true;
                return current;
            }
            const claims = { ...(current.claims || {}) };
            Object.keys(claims).forEach(id => {
                if (claims[id]?.uid === actor.uid && Number(id) !== playerId) delete claims[id];
            });
            claims[playerId] = { uid: actor.uid };
            claimStored = true;
            return {
                ...current,
                claims,
                members: {
                    ...current.members,
                    [actor.uid]: {
                        ...current.members[actor.uid],
                        role: preserveAdminRole(current.members[actor.uid].role, 'participant')
                    }
                },
                accessRevision: (current.accessRevision || 0) + 1
            };
        });
        if (!transaction.committed || !claimStored) {
            throw rejection || Object.assign(new Error('El torneo no existe.'), { code: 'NOT_FOUND' });
        }
    } catch (error) {
        throw asHttpsError(error);
    }
    return { playerId };
});

export const getTournamentAccessViewV2 = onCall(async request => {
    const actor = requireAuthenticated(request);
    const tournamentId = request.data?.tournamentId;
    const snapshot = await getDatabase().ref(`tournamentAccess/${tournamentId}`).get();
    const access = snapshot.val();
    if (!access?.members?.[actor.uid] && actor.platformRole !== 'superAdmin') {
        throw new HttpsError('permission-denied', 'No sos miembro de este torneo.');
    }
    const playerId = Object.entries(access?.claims || {})
        .find(([, claim]) => claim?.uid === actor.uid)?.[0];
    return {
        role: access?.members?.[actor.uid]?.role || 'admin',
        playerId: playerId === undefined ? null : Number(playerId),
        claimedPlayerIds: Object.keys(access?.claims || {}).map(Number)
    };
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
    const rootRef = getDatabase().ref();
    if (!(await rootRef.child(`tournaments/${tournamentId}/public`).get()).exists()) {
        throw new HttpsError('not-found', 'El torneo no existe.');
    }
    let adminUpdated = false;
    const transaction = await rootRef.transaction(root => {
        if (!root) return root;
        const tournament = root?.tournaments?.[tournamentId];
        if (!tournament?.public) return root;
        root.tournamentAccess ||= {};
        root.tournamentAccess[tournamentId] ||= { members: {}, accessRevision: 0 };
        const members = { ...(root.tournamentAccess[tournamentId].members || {}) };
        if (enabled) members[uid] = { role: 'admin', joinedAt: ServerValue.TIMESTAMP };
        else if (uid !== tournament.public.metadata.ownerUid) delete members[uid];
        root.tournamentAccess[tournamentId].members = members;
        root.tournamentAccess[tournamentId].accessRevision =
            (root.tournamentAccess[tournamentId].accessRevision || 0) + 1;
        tournament.public.metadata.updatedAt = ServerValue.TIMESTAMP;
        adminUpdated = true;
        return root;
    });
    if (!transaction.committed || !adminUpdated) {
        throw new HttpsError('not-found', 'El torneo ya no existe.');
    }
    await logAdminActivity(auth, enabled ? 'assignTournamentAdmin' : 'removeTournamentAdmin', uid, { tournamentId });
    return { enabled };
});

export const getTournamentAdminViewV2 = onCall(async request => {
    requireSuperAdmin(request);
    let tournamentId;
    try { tournamentId = requireTournamentId(request.data?.tournamentId); } catch (error) {
        throw new HttpsError('invalid-argument', error.message);
    }
    const [tournamentSnapshot, accessSnapshot] = await Promise.all([
        getDatabase().ref(`tournaments/${tournamentId}/public/metadata`).get(),
        getDatabase().ref(`tournamentAccess/${tournamentId}/members`).get()
    ]);
    if (!tournamentSnapshot.exists()) throw new HttpsError('not-found', 'El torneo no existe.');
    const members = accessSnapshot.val() || {};
    return {
        ownerUid: tournamentSnapshot.val()?.ownerUid || null,
        admins: Object.fromEntries(Object.entries(members)
            .filter(([, member]) => member?.role === 'admin')
            .map(([uid]) => [uid, true]))
    };
});

export const setTournamentDeleted = onCall(async request => {
    const auth = requireSuperAdmin(request);
    let tournamentId;
    try { tournamentId = requireTournamentId(request.data?.tournamentId); } catch (error) { throw new HttpsError('invalid-argument', error.message); }
    const deleted = request.data?.deleted === true;
    const ref = getDatabase().ref(`tournaments/${tournamentId}/public/metadata`);
    if (!(await ref.get()).exists()) throw new HttpsError('not-found', 'El torneo no existe.');
    const transaction = await ref.transaction(current => current
        ? buildTournamentDeletion(current, auth.uid, ServerValue.TIMESTAMP, deleted)
        : current);
    if (!transaction.committed || !transaction.snapshot.exists()) {
        throw new HttpsError('not-found', 'El torneo ya no existe.');
    }
    await logAdminActivity(auth, deleted ? 'deleteTournament' : 'restoreTournament', tournamentId);
    return { deleted };
});

export const permanentlyDeleteTournament = onCall(async request => {
    const auth = requireSuperAdmin(request);
    let tournamentId;
    try { tournamentId = requireTournamentId(request.data?.tournamentId); } catch (error) { throw new HttpsError('invalid-argument', error.message); }
    const ref = getDatabase().ref(`tournaments/${tournamentId}`);
    const snapshot = await ref.get();
    if (!snapshot.exists()) throw new HttpsError('not-found', 'El torneo ya no existe.');
    if (!snapshot.child('public/metadata/deletedAt').val()) {
        throw new HttpsError('failed-precondition', 'Primero debés borrar el torneo de forma recuperable.');
    }
    await getDatabase().ref().update({
        [`tournaments/${tournamentId}`]: null,
        [`tournamentAccess/${tournamentId}`]: null,
        [`tournamentPresence/${tournamentId}`]: null
    });
    await logAdminActivity(auth, 'permanentlyDeleteTournament', tournamentId);
    return { deleted: true };
});

export const listTournamentCatalog = onCall(async request => {
    const authorization = getTournamentCatalogAuthorization(request.auth);
    if (!authorization.allowed) throw new HttpsError(authorization.code, authorization.message);
    const database = getDatabase();
    const [snapshot, profilesSnapshot, accessSnapshot] = await Promise.all([
        database.ref('tournaments').get(),
        database.ref('userProfiles').get(),
        database.ref('tournamentAccess').get()
    ]);
    const tournaments = buildTournamentCatalogPayload(snapshot.val(), {
        uid: authorization.auth.uid,
        role: authorization.role,
        profiles: profilesSnapshot.val() || {},
        accessByTournament: accessSnapshot.val() || {}
    });
    console.info('Tournament catalog loaded', {
        role: authorization.role,
        count: Object.keys(tournaments).length
    });
    return {
        tournaments
    };
});
