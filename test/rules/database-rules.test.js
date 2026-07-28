import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { readFile } from 'node:fs/promises';
import {
    assertFails,
    assertSucceeds,
    initializeTestEnvironment
} from '@firebase/rules-unit-testing';

const rules = await readFile(new URL('../../database.rules.json', import.meta.url), 'utf8');
const testEnv = await initializeTestEnvironment({
    projectId: 'padel-rules-test',
    database: { rules }
});
const tournamentId = 'abcdefgh';
const tournament = {
    metadata: { ownerUid: 'owner', admins: { owner: true, admin: true } },
    claims: { 0: { uid: 'player', presenceId: 'phone' } },
    state: {
        gamesPerSet: 4,
        schedule: [{ matches: [{ t1_p1: 0, t1_p2: 1, t2_p1: 2, t2_p2: 3, score1: '', score2: '' }] }]
    }
};

async function seed() {
    await testEnv.withSecurityRulesDisabled(async context => {
        await context.database().ref(`tournaments/${tournamentId}`).set(tournament);
    });
}

test('lectura requiere una sesión, incluso para espectadores', async () => {
    await seed();
    await assertFails(testEnv.unauthenticatedContext().database().ref(`tournaments/${tournamentId}`).once('value'));
    await assertSucceeds(testEnv.authenticatedContext('viewer').database().ref(`tournaments/${tournamentId}`).once('value'));
});

test('un participante no puede escribir resultados directamente', async () => {
    await seed();
    const playerDb = testEnv.authenticatedContext('player').database();
    const otherDb = testEnv.authenticatedContext('other').database();
    const score = `tournaments/${tournamentId}/state/schedule/0/matches/0/score1`;
    await assertFails(playerDb.ref(score).set(4));
    await assertFails(otherDb.ref(score).set(4));
    await assertFails(playerDb.ref(`tournaments/${tournamentId}/state/gamesPerSet`).set(8));
});

test('metadata, presencia y claims quedan acotados a su usuario', async () => {
    await seed();
    const playerDb = testEnv.authenticatedContext('player').database();
    const otherDb = testEnv.authenticatedContext('other').database();
    await assertSucceeds(playerDb.ref(`tournaments/${tournamentId}/presence/phone`).set({ uid: 'player', presenceId: 'phone' }));
    await assertFails(otherDb.ref(`tournaments/${tournamentId}/presence/phone`).set({ uid: 'player' }));
    await assertFails(otherDb.ref(`tournaments/${tournamentId}/claims/0`).remove());
    await assertFails(playerDb.ref(`tournaments/${tournamentId}/metadata/admins/other`).set(true));
});

test('owner, admin asignado y super admin pueden administrar el estado', async () => {
    await seed();
    const path = `tournaments/${tournamentId}/state/gamesPerSet`;
    await assertSucceeds(testEnv.authenticatedContext('owner').database().ref(path).set(6));
    await assertSucceeds(testEnv.authenticatedContext('admin').database().ref(path).set(6));
    await assertSucceeds(testEnv.authenticatedContext('super', { platformRole: 'superAdmin' }).database().ref(path).set(6));
});

after(async () => {
    await testEnv.cleanup();
});
