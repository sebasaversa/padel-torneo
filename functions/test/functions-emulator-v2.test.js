import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { deleteApp, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getDatabase } from 'firebase-admin/database';
import { invitationHash } from '../src/domain/tournament-v2.js';

const hasEmulators = Boolean(
    process.env.FIREBASE_AUTH_EMULATOR_HOST
    && process.env.FIREBASE_DATABASE_EMULATOR_HOST
);
const projectId = process.env.GCLOUD_PROJECT || 'padel-torneo-ec30a';
const authOrigin = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099'}`;
const databaseOrigin = `http://${process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9000'}`;
const databaseNamespace = `${projectId}-default-rtdb`;
const functionsOrigin = `http://127.0.0.1:5001/${projectId}/us-central1`;

async function signIn(email, password) {
    const response = await fetch(
        `${authOrigin}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake`,
        {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ email, password, returnSecureToken: true })
        }
    );
    const text = await response.text();
    assert.equal(response.ok, true, text);
    return JSON.parse(text);
}

async function signUp(email, password) {
    const response = await fetch(
        `${authOrigin}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`,
        {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ email, password, returnSecureToken: true })
        }
    );
    const text = await response.text();
    assert.equal(response.ok, true, text);
    return JSON.parse(text);
}

async function call(name, token, data, { expectError = false } = {}) {
    const headers = { 'content-type': 'application/json' };
    if (token) headers.authorization = `Bearer ${token}`;
    const response = await fetch(`${functionsOrigin}/${name}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ data })
    });
    const body = await response.json();
    if (expectError) {
        assert.ok(body.error, `Se esperaba error de ${name}`);
        return body.error;
    }
    assert.equal(response.ok, true, JSON.stringify(body));
    assert.ok(body.result, `Falta result en ${name}`);
    return body.result;
}

async function readPublic(tournamentId, token) {
    const response = await fetch(
        `${databaseOrigin}/tournaments/${tournamentId}/public.json`
        + `?auth=${encodeURIComponent(token)}&ns=${databaseNamespace}`
    );
    return { response, body: await response.json() };
}

test('smoke v2: creación, roles, score, extensión y barreras directas', {
    skip: !hasEmulators,
    timeout: 30_000
}, async () => {
    if (!getApps().length) initializeApp({
        projectId,
        databaseURL: `https://${projectId}-default-rtdb.firebaseio.com`
    });
    const email = 'owner@example.test';
    const password = 'Clave1234';
    const ownerRecord = await getAuth().createUser({ email, password });
    await getAuth().setCustomUserClaims(ownerRecord.uid, { platformRole: 'admin' });
    const owner = await signIn(email, password);
    const superRecord = await getAuth().createUser({ email: 'super@example.test', password });
    await getAuth().setCustomUserClaims(superRecord.uid, { platformRole: 'superAdmin' });
    await getDatabase().ref('platformConfig/superAdminUid').set(superRecord.uid);
    const superAdmin = await signIn('super@example.test', password);
    const staleRecord = await getAuth().createUser({ email: 'stale-super@example.test', password });
    await getAuth().setCustomUserClaims(staleRecord.uid, { platformRole: 'superAdmin' });
    const staleSuperAdmin = await signIn('stale-super@example.test', password);
    const emailRegistration = await call('registerUserV2', null, {
        identifier: 'outsider@example.test',
        password
    });
    assert.equal(emailRegistration.accountType, 'email');
    assert.equal(typeof emailRegistration.customToken, 'string');
    const outsider = await signIn('outsider@example.test', password);
    const listedUsers = await call('listUsersV2', superAdmin.idToken, null);
    assert.equal(listedUsers.find(user => user.uid === outsider.localId)?.role, 'user');
    await call('setUserPlatformRoleV1', superAdmin.idToken, {
        uid: outsider.localId,
        role: 'admin'
    });
    assert.equal((await getAuth().getUser(outsider.localId)).customClaims.platformRole, 'admin');
    assert.equal((await getDatabase().ref(`userProfiles/${outsider.localId}/role`).get()).val(), 'admin');
    const staleAuthorization = await call('listUsersV2', staleSuperAdmin.idToken, null, { expectError: true });
    assert.equal(staleAuthorization.status, 'PERMISSION_DENIED');

    const usernameRegistration = await call('registerUserV2', null, {
        identifier: 'Jugador.Uno',
        password
    });
    assert.equal(usernameRegistration.accountType, 'username');
    assert.equal(usernameRegistration.displayName, 'jugador.uno');
    assert.equal(typeof usernameRegistration.customToken, 'string');
    const resolvedUsername = await call('resolveUsernameLoginV2', null, {
        username: 'JUGADOR.UNO'
    });
    assert.match(resolvedUsername.authEmail, /@users\.padel-torneo\.invalid$/);
    const participant = await signIn(resolvedUsername.authEmail, password);
    const participantProfile = (await getDatabase()
        .ref(`userProfiles/${participant.localId}`).get()).val();
    assert.equal(participantProfile.accountType, 'username');
    assert.equal(participantProfile.username, 'jugador.uno');
    assert.equal(participantProfile.role, 'user');
    assert.equal(participantProfile.email, undefined);
    const duplicateUsername = await call('registerUserV2', null, {
        identifier: 'jugador.uno',
        password
    }, { expectError: true });
    assert.equal(duplicateUsername.status, 'ALREADY_EXISTS');

    const created = await call('createTournamentV2', owner.idToken, {
        creationRequestId: '0123456789abcdef0123456789abcdef',
        configuration: {
            numPlayers: 8,
            numCourts: 2,
            pairingMode: 'rotating',
            fixedTeams: []
        },
        numRounds: 7,
        gamesPerSet: 4,
        players: Array.from({ length: 8 }, (_, index) => `Jugador ${index + 1}`),
        metadata: { tournamentName: 'Smoke v2', tournamentDate: '2026-07-30' }
    });
    const replay = await call('createTournamentV2', owner.idToken, {
        creationRequestId: '0123456789abcdef0123456789abcdef',
        configuration: {
            numPlayers: 8,
            numCourts: 2,
            pairingMode: 'rotating',
            fixedTeams: []
        },
        numRounds: 7,
        gamesPerSet: 4,
        players: Array.from({ length: 8 }, (_, index) => `Jugador ${index + 1}`),
        metadata: { tournamentName: 'Smoke v2', tournamentDate: '2026-07-30' }
    });
    assert.equal(replay.tournamentId, created.tournamentId);
    assert.equal(replay.replayed, true);

    const invitation = await call('createTournamentInvitationV2', owner.idToken, {
        tournamentId: created.tournamentId,
        role: 'participant'
    });
    const access = (await getDatabase().ref(`tournamentAccess/${created.tournamentId}`).get()).val();
    assert.ok(access?.invitationHashes?.[invitationHash(invitation.token)]);
    await call('joinTournamentV2', participant.idToken, {
        tournamentId: created.tournamentId,
        token: invitation.token
    });
    const revisionAfterJoin = (await getDatabase()
        .ref(`tournamentAccess/${created.tournamentId}/accessRevision`).get()).val();
    await call('joinTournamentV2', participant.idToken, {
        tournamentId: created.tournamentId,
        token: invitation.token
    });
    assert.equal((await getDatabase()
        .ref(`tournamentAccess/${created.tournamentId}/accessRevision`).get()).val(), revisionAfterJoin);
    await call('claimTournamentPlayerV2', participant.idToken, {
        tournamentId: created.tournamentId,
        playerId: 0
    });
    const revisionAfterClaim = (await getDatabase()
        .ref(`tournamentAccess/${created.tournamentId}/accessRevision`).get()).val();
    await call('claimTournamentPlayerV2', participant.idToken, {
        tournamentId: created.tournamentId,
        playerId: 0
    });
    assert.equal((await getDatabase()
        .ref(`tournamentAccess/${created.tournamentId}/accessRevision`).get()).val(), revisionAfterClaim);

    const publicRead = await readPublic(created.tournamentId, participant.idToken);
    assert.equal(publicRead.response.ok, true);
    const match = publicRead.body.state.schedule
        .flatMap(round => round.matches.map(item => ({ round, match: item })))
        .find(item => [
            item.match.t1_p1,
            item.match.t1_p2,
            item.match.t2_p1,
            item.match.t2_p2
        ].includes(0));
    const identity = {
        expectedScheduleRevision: publicRead.body.state.scheduleRevision,
        expectedScheduleFingerprint: publicRead.body.state.scheduleFingerprint,
        roundId: match.round.id,
        matchId: match.match.id,
        expectedPlayerIds: [
            match.match.t1_p1,
            match.match.t1_p2,
            match.match.t2_p1,
            match.match.t2_p2
        ]
    };
    await call('mutateTournamentV2', participant.idToken, {
        tournamentId: created.tournamentId,
        operationId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        expectedRevision: 0,
        type: 'updateScore',
        payload: { ...identity, field: 'score1', value: 4 }
    });
    await call('mutateTournamentV2', owner.idToken, {
        tournamentId: created.tournamentId,
        operationId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        expectedRevision: 1,
        type: 'changeRoundCount',
        payload: { targetCount: 8 }
    });

    const directWrite = await fetch(
        `${databaseOrigin}/tournaments/${created.tournamentId}/public/state/revision.json`
        + `?auth=${encodeURIComponent(owner.idToken)}&ns=${databaseNamespace}`,
        {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: '99'
        }
    );
    assert.equal(directWrite.ok, false);
    const outsiderRead = await readPublic(created.tournamentId, outsider.idToken);
    assert.equal(outsiderRead.response.ok, false);
});

test('smoke grupos v1: membresía, torneo, score terminal, salida, enlace y archivo', {
    skip: !hasEmulators,
    timeout: 60_000
}, async () => {
    if (!getApps().length) initializeApp({
        projectId,
        databaseURL: `https://${projectId}-default-rtdb.firebaseio.com`
    });
    const password = 'Clave1234';
    const ownerRecord = await getAuth().createUser({ email: 'group-owner@example.test', password });
    const owner = await signIn('group-owner@example.test', password);
    await call('registerUserV2', null, { identifier: 'grupo.invitado', password });
    const invitedLogin = await call('resolveUsernameLoginV2', null, { username: 'grupo.invitado' });
    const invited = await signIn(invitedLogin.authEmail, password);

    const createdGroup = await call('createGroupV1', owner.idToken, {
        operationId: 'groupcreate00000000000000000001',
        name: 'Viernes de pádel',
        description: 'Grupo de prueba'
    });
    const groupId = createdGroup.groupId;
    assert.equal((await getDatabase().ref(`groupDomains/${groupId}`).get()).exists(), true);
    const invitation = await call('inviteGroupUserV1', owner.idToken, {
        operationId: 'groupinvite00000000000000000001',
        groupId,
        username: 'grupo.invitado'
    });
    await call('acceptGroupUserInvitationV1', invited.idToken, {
        operationId: 'groupaccept00000000000000000001',
        groupId,
        invitationId: invitation.invitationId
    });
    for (const [index, displayName] of ['Ana', 'Beto', 'Caro'].entries()) {
        await call('addProvisionalGroupPlayerV1', owner.idToken, {
            operationId: `groupprovisional000000000000000${index}`,
            groupId,
            displayName
        });
    }
    const group = await call('getGroupV1', owner.idToken, { groupId });
    assert.equal(group.role, 'owner');
    assert.equal(group.players.length, 5);
    const invitedMember = group.members.find(member => member.uid === invited.localId);
    const ownerMember = group.members.find(member => member.uid === ownerRecord.uid);
    const provisionalIds = group.players.filter(player => player.kind === 'provisional')
        .slice(0, 2).map(player => player.groupPlayerId);
    const selectedIds = [ownerMember.groupPlayerId, invitedMember.groupPlayerId, ...provisionalIds];
    const tournament = await call('createTournamentV2', owner.idToken, {
        creationRequestId: 'grouptournament000000000000000001',
        groupId,
        groupPlayerIds: selectedIds,
        configuration: { numPlayers: 4, numCourts: 1, pairingMode: 'rotating', fixedTeams: [] },
        numRounds: 3,
        gamesPerSet: 4,
        players: ['Servidor 1', 'Servidor 2', 'Servidor 3', 'Servidor 4'],
        metadata: { tournamentName: 'Torneo del grupo', tournamentDate: '2026-08-08' }
    });
    const access = await call('getTournamentAccessViewV2', invited.idToken, {
        tournamentId: tournament.tournamentId
    });
    assert.equal(access.role, 'participant');
    assert.equal(Number.isInteger(access.playerId), true);
    const publicRead = await readPublic(tournament.tournamentId, invited.idToken);
    assert.equal(publicRead.response.ok, true);
    const located = publicRead.body.state.schedule
        .flatMap(round => round.matches.map(match => ({ round, match })))
        .find(({ match }) => [match.t1_p1, match.t1_p2, match.t2_p1, match.t2_p2].includes(access.playerId));
    await call('mutateTournamentV2', invited.idToken, {
        tournamentId: tournament.tournamentId,
        operationId: 'groupscore00000000000000000000001',
        expectedRevision: 0,
        type: 'updateScore',
        payload: {
            expectedScheduleRevision: publicRead.body.state.scheduleRevision,
            expectedScheduleFingerprint: publicRead.body.state.scheduleFingerprint,
            roundId: located.round.id,
            matchId: located.match.id,
            expectedPlayerIds: [located.match.t1_p1, located.match.t1_p2, located.match.t2_p1, located.match.t2_p2],
            field: 'score1',
            value: 4
        }
    });
    const stats = await call('getGroupStatsV1', owner.idToken, { groupId });
    assert.equal(stats.players.reduce((total, player) => total + player.matchesPlayed, 0), 4);
    assert.equal(stats.players.reduce((total, player) => total + player.gamesFor, 0), 8);

    const generalLink = await call('createGeneralGroupLinkV1', owner.idToken, {
        operationId: 'grouplink00000000000000000000001',
        groupId
    });
    const preview = await call('previewGeneralGroupLinkV1', null, {
        groupId,
        invitationId: generalLink.invitationId,
        token: generalLink.token
    });
    assert.equal(preview.remainingUses, 10);
    await call('registerUserV2', null, { identifier: 'grupo.general', password });
    const generalLogin = await call('resolveUsernameLoginV2', null, { username: 'grupo.general' });
    const generalMember = await signIn(generalLogin.authEmail, password);
    await call('acceptGeneralGroupLinkV1', generalMember.idToken, {
        operationId: 'groupgeneralaccept000000000000001',
        groupId,
        invitationId: generalLink.invitationId,
        token: generalLink.token
    });
    const previewAfter = await call('previewGeneralGroupLinkV1', null, {
        groupId,
        invitationId: generalLink.invitationId,
        token: generalLink.token
    });
    assert.equal(previewAfter.remainingUses, 9);

    await call('leaveGroupV1', invited.idToken, {
        operationId: 'groupleave000000000000000000001',
        groupId
    });
    const readAfterLeave = await readPublic(tournament.tournamentId, invited.idToken);
    assert.equal(readAfterLeave.response.ok, false);
    const mutationAfterLeave = await call('mutateTournamentV2', invited.idToken, {
        tournamentId: tournament.tournamentId,
        operationId: 'groupscoreafterleave000000000001',
        expectedRevision: 1,
        type: 'updateScore',
        payload: {
            expectedScheduleRevision: publicRead.body.state.scheduleRevision,
            expectedScheduleFingerprint: publicRead.body.state.scheduleFingerprint,
            roundId: located.round.id,
            matchId: located.match.id,
            expectedPlayerIds: [located.match.t1_p1, located.match.t1_p2, located.match.t2_p1, located.match.t2_p2],
            field: 'score2',
            value: 1
        }
    }, { expectError: true });
    assert.equal(mutationAfterLeave.status, 'PERMISSION_DENIED');

    await call('archiveGroupV1', owner.idToken, {
        operationId: 'grouparchive0000000000000000001',
        groupId
    });
    const archivedRead = await readPublic(tournament.tournamentId, owner.idToken);
    assert.equal(archivedRead.response.ok, true);
    const archivedMutation = await call('mutateTournamentV2', owner.idToken, {
        tournamentId: tournament.tournamentId,
        operationId: 'groupscorearchived00000000000001',
        expectedRevision: 1,
        type: 'updateScore',
        payload: {
            expectedScheduleRevision: publicRead.body.state.scheduleRevision,
            expectedScheduleFingerprint: publicRead.body.state.scheduleFingerprint,
            roundId: located.round.id,
            matchId: located.match.id,
            expectedPlayerIds: [located.match.t1_p1, located.match.t1_p2, located.match.t2_p1, located.match.t2_p2],
            field: 'score2',
            value: 1
        }
    }, { expectError: true });
    assert.equal(archivedMutation.status, 'FAILED_PRECONDITION');
    await call('restoreGroupV1', owner.idToken, {
        operationId: 'grouprestore0000000000000000001',
        groupId
    });
});

after(async () => {
    await Promise.all(getApps().map(deleteApp));
});
