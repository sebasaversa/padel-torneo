// Datos deterministas para recorrer manualmente la UI contra Emulator Suite.
import { deleteApp, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getDatabase } from 'firebase-admin/database';

const projectId = process.env.GCLOUD_PROJECT || 'padel-torneo-ec30a';
const authOrigin = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099'}`;
const functionsOrigin = `http://127.0.0.1:5001/${projectId}/us-central1`;
const password = 'Clave1234';

if (!process.env.FIREBASE_AUTH_EMULATOR_HOST || !process.env.FIREBASE_DATABASE_EMULATOR_HOST) {
    throw new Error('Este seed sólo se puede ejecutar contra Firebase Emulator Suite.');
}

if (!getApps().length) initializeApp({
    projectId,
    databaseURL: `https://${projectId}-default-rtdb.firebaseio.com`
});

async function call(name, token, data = null) {
    const headers = { 'content-type': 'application/json' };
    if (token) headers.authorization = `Bearer ${token}`;
    const response = await fetch(`${functionsOrigin}/${name}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ data })
    });
    const body = await response.json();
    if (!response.ok || body.error) {
        throw new Error(`${name}: ${JSON.stringify(body.error || body)}`);
    }
    return body.result;
}

async function register(username) {
    await call('registerUserV2', null, { identifier: username, password });
    const resolved = await call('resolveUsernameLoginV2', null, { username });
    const response = await fetch(
        `${authOrigin}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake`,
        {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                email: resolved.authEmail,
                password,
                returnSecureToken: true
            })
        }
    );
    const body = await response.json();
    if (!response.ok) throw new Error(`signIn ${username}: ${JSON.stringify(body)}`);
    return { username, uid: body.localId, token: body.idToken };
}

const users = {};
for (const username of ['qa.platform-admin', 'qa.owner', 'qa.group-admin', 'qa.member', 'qa.pending']) {
    users[username] = await register(username);
}

await getAuth().setCustomUserClaims(users['qa.platform-admin'].uid, { platformRole: 'admin' });
await getDatabase().ref(`userProfiles/${users['qa.platform-admin'].uid}/role`).set('admin');

const owner = users['qa.owner'];
const created = await call('createGroupV1', owner.token, {
    operationId: 'a1000000000000000000000000000001',
    name: 'Grupo QA Roles',
    description: 'Prueba de permisos owner, admin y miembros invitados'
});
const groupId = created.groupId;

const invitations = {};
for (const username of ['qa.group-admin', 'qa.member', 'qa.pending']) {
    invitations[username] = await call('inviteGroupUserV1', owner.token, {
        operationId: `b${Object.keys(invitations).length + 1}000000000000000000000000000001`,
        groupId,
        username
    });
}

for (const username of ['qa.group-admin', 'qa.member']) {
    await call('acceptGroupUserInvitationV1', users[username].token, {
        operationId: username === 'qa.group-admin'
            ? 'c1000000000000000000000000000001'
            : 'c2000000000000000000000000000001',
        groupId,
        invitationId: invitations[username].invitationId
    });
}

await call('setGroupMemberRoleV1', owner.token, {
    operationId: 'd1000000000000000000000000000001',
    groupId,
    targetUid: users['qa.group-admin'].uid,
    role: 'admin'
});

for (const [index, displayName] of ['Provisional Ana', 'Provisional Beto'].entries()) {
    await call('addProvisionalGroupPlayerV1', owner.token, {
        operationId: `e${index + 1}000000000000000000000000000001`,
        groupId,
        displayName
    });
}

const group = await call('getGroupV1', owner.token, { groupId });
const selectedPlayers = [
    group.members.find(member => member.uid === owner.uid).groupPlayerId,
    group.members.find(member => member.uid === users['qa.group-admin'].uid).groupPlayerId,
    group.members.find(member => member.uid === users['qa.member'].uid).groupPlayerId,
    group.players.find(player => player.kind === 'provisional').groupPlayerId
];
const tournament = await call('createTournamentV2', owner.token, {
    creationRequestId: 'f1000000000000000000000000000001',
    groupId,
    groupPlayerIds: selectedPlayers,
    configuration: { numPlayers: 4, numCourts: 1, pairingMode: 'rotating', fixedTeams: [] },
    numRounds: 3,
    gamesPerSet: 4,
    players: selectedPlayers.map(groupPlayerId =>
        group.players.find(player => player.groupPlayerId === groupPlayerId).displayName),
    metadata: { tournamentName: 'Torneo QA del grupo', tournamentDate: '2026-08-08' }
});

console.log(JSON.stringify({
    password,
    groupId,
    tournamentId: tournament.tournamentId,
    users: Object.fromEntries(Object.entries(users).map(([username, user]) => [username, user.uid])),
    pendingInvitationId: invitations['qa.pending'].invitationId
}, null, 2));

await Promise.all(getApps().map(deleteApp));
