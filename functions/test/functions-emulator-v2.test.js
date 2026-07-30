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
    const response = await fetch(`${functionsOrigin}/${name}`, {
        method: 'POST',
        headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json'
        },
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
    const participant = await signUp('player@example.test', password);
    const outsider = await signUp('outsider@example.test', password);

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

after(async () => {
    await Promise.all(getApps().map(deleteApp));
});
