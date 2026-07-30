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
const tournamentId = 't_012345678901234567890123456789';

async function seed() {
    await testEnv.withSecurityRulesDisabled(async context => {
        await context.database().ref().set({
            tournaments: {
                [tournamentId]: {
                    public: {
                        schemaVersion: 2,
                        configuration: { numPlayers: 8, numCourts: 2, pairingMode: 'rotating' },
                        metadata: { ownerUid: 'owner' },
                        state: { revision: 0 }
                    },
                    _server: {
                        operationReceipts: { secret: { digest: 'privado' } }
                    }
                }
            },
            tournamentAccess: {
                [tournamentId]: {
                    members: {
                        owner: { role: 'admin' },
                        admin: { role: 'admin' },
                        viewer: { role: 'spectator' },
                        player: { role: 'participant' }
                    },
                    claims: { 0: { uid: 'player' } },
                    invitationHashes: { secreto: { role: 'participant' } }
                }
            }
        });
    });
}

test('sólo miembros autorizados pueden leer public', async () => {
    await seed();
    const path = `tournaments/${tournamentId}/public`;
    await assertFails(testEnv.unauthenticatedContext().database().ref(path).once('value'));
    await assertFails(testEnv.authenticatedContext('foreign').database().ref(path).once('value'));
    await assertSucceeds(testEnv.authenticatedContext('viewer').database().ref(path).once('value'));
    await assertSucceeds(testEnv.authenticatedContext('player').database().ref(path).once('value'));
});

test('ni miembros ni administradores pueden leer el nodo privado del torneo', async () => {
    await seed();
    for (const [uid, claims] of [
        ['owner', {}],
        ['admin', {}],
        ['super', { platformRole: 'superAdmin' }]
    ]) {
        const database = testEnv.authenticatedContext(uid, claims).database();
        await assertFails(database.ref(`tournaments/${tournamentId}`).once('value'));
        await assertFails(database.ref(`tournaments/${tournamentId}/_server`).once('value'));
    }
});

test('toda escritura directa del dominio se deniega bajo cualquier rol', async () => {
    await seed();
    const paths = [
        `tournaments/${tournamentId}/state`,
        `tournaments/${tournamentId}/configuration`,
        `tournaments/${tournamentId}/public/configuration/numCourts`,
        `tournaments/${tournamentId}/public/state/revision`,
        `tournaments/${tournamentId}/public/state/schedule`,
        `tournaments/${tournamentId}/public/metadata/tournamentName`
    ];
    for (const [uid, claims] of [
        ['owner', {}],
        ['admin', {}],
        ['player', {}],
        ['super', { platformRole: 'superAdmin' }]
    ]) {
        const database = testEnv.authenticatedContext(uid, claims).database();
        for (const path of paths) await assertFails(database.ref(path).set('alterado'));
    }
});

test('acceso, claims, invitaciones y recibos son privados y write-only del servidor', async () => {
    await seed();
    const database = testEnv.authenticatedContext('owner').database();
    await assertFails(database.ref(`tournamentAccess/${tournamentId}`).once('value'));
    await assertFails(database.ref(`tournamentAccess/${tournamentId}/claims/0`).remove());
    await assertFails(database.ref(`tournamentAccess/${tournamentId}/invitationHashes`).set({}));
    await assertFails(database.ref('creationRequests/owner').once('value'));
});

test('presencia efímera permite sólo el nodo propio de un miembro', async () => {
    await seed();
    const owner = testEnv.authenticatedContext('owner').database();
    const foreign = testEnv.authenticatedContext('foreign').database();
    const payload = { uid: 'owner', updatedAt: 1 };
    await assertSucceeds(owner.ref(`tournamentPresence/${tournamentId}/owner`).set(payload));
    await assertFails(owner.ref(`tournamentPresence/${tournamentId}/other`).set(payload));
    await assertFails(foreign.ref(`tournamentPresence/${tournamentId}/foreign`).set({
        uid: 'foreign',
        updatedAt: 1
    }));
});

after(async () => {
    await testEnv.cleanup();
});
