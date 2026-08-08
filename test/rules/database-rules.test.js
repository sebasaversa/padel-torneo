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
const groupTournamentId = 't_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const groupId = 'g_012345678901234567890123456789';

async function seed() {
    await testEnv.withSecurityRulesDisabled(async context => {
        await context.database().ref().set({
            platformConfig: { superAdminUid: 'super' },
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
                },
                [groupTournamentId]: {
                    public: {
                        schemaVersion: 2,
                        configuration: { numPlayers: 8, numCourts: 2, pairingMode: 'rotating' },
                        metadata: { ownerUid: 'former-admin', groupId },
                        state: { revision: 0 }
                    },
                    _server: { operationReceipts: { secret: { digest: 'privado' } } }
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
                },
                [groupTournamentId]: {
                    mode: 'group',
                    groupId,
                    members: { 'former-admin': { role: 'admin' } },
                    claims: { 0: { uid: 'group-member', source: 'group' } }
                }
            },
            groupDomains: {
                [groupId]: {
                    metadata: { status: 'active' },
                    access: {
                        ownerUid: 'group-owner',
                        members: {
                            'group-owner': { role: 'member', status: 'active', accountStatus: 'active' },
                            'group-member': { role: 'member', status: 'active', accountStatus: 'active' },
                            'former-admin': { role: 'member', status: 'removed', accountStatus: 'active' }
                        }
                    },
                    invitations: { secret: { tokenHash: 'privado' } }
                }
            },
            groupsByUser: {
                'group-member': { [groupId]: { effectiveRole: 'member' } }
            },
            groupInvitationInbox: {
                'group-member': { invite: { groupId, status: 'active' } }
            },
            usernameDirectory: {
                hashprivado: {
                    username: 'jugador',
                    uid: 'player',
                    authEmail: 'interno@privado.invalid',
                    status: 'active'
                }
            },
            userProfiles: {
                player: { displayName: 'Jugador', role: 'user' }
            },
            adminActivity: {
                event: { action: 'test', actorUid: 'super' }
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

test('el directorio interno de usernames nunca es accesible desde el cliente', async () => {
    await seed();
    for (const [uid, claims] of [
        ['player', {}],
        ['super', { platformRole: 'superAdmin' }]
    ]) {
        const database = testEnv.authenticatedContext(uid, claims).database();
        await assertFails(database.ref('usernameDirectory/hashprivado').once('value'));
        await assertFails(database.ref('usernameDirectory/hashprivado').set({ authEmail: 'alterado' }));
    }
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

test('una claim superAdmin sólo autoriza al UID canónico', async () => {
    await seed();
    const canonical = testEnv.authenticatedContext('super', { platformRole: 'superAdmin' }).database();
    const stale = testEnv.authenticatedContext('stale', { platformRole: 'superAdmin' }).database();
    await assertSucceeds(canonical.ref(`tournaments/${tournamentId}/public`).once('value'));
    await assertFails(stale.ref(`tournaments/${tournamentId}/public`).once('value'));
    await assertSucceeds(canonical.ref('userProfiles/player').once('value'));
    await assertFails(stale.ref('userProfiles/player').once('value'));
    await assertSucceeds(canonical.ref('adminActivity').once('value'));
    await assertFails(stale.ref('adminActivity').once('value'));
    await assertFails(canonical.ref('platformConfig').once('value'));
});

test('torneo de grupo autoriza por membresía grupal actual y no por acceso estático', async () => {
    await seed();
    const member = testEnv.authenticatedContext('group-member').database();
    const former = testEnv.authenticatedContext('former-admin').database();
    const canonical = testEnv.authenticatedContext('super', { platformRole: 'superAdmin' }).database();
    await assertSucceeds(member.ref(`tournaments/${groupTournamentId}/public`).once('value'));
    await assertFails(former.ref(`tournaments/${groupTournamentId}/public`).once('value'));
    await assertFails(canonical.ref(`tournaments/${groupTournamentId}/public`).once('value'));
    await assertSucceeds(member.ref(`tournamentPresence/${groupTournamentId}/group-member`).set({
        uid: 'group-member', updatedAt: 1
    }));
    await assertFails(former.ref(`tournamentPresence/${groupTournamentId}/former-admin`).set({
        uid: 'former-admin', updatedAt: 1
    }));
});

test('dominio y auditoría de grupos son privados; sólo proyecciones propias son legibles', async () => {
    await seed();
    const member = testEnv.authenticatedContext('group-member').database();
    const foreign = testEnv.authenticatedContext('foreign').database();
    await assertFails(member.ref(`groupDomains/${groupId}`).once('value'));
    await assertFails(member.ref(`groupAudit/${groupId}`).once('value'));
    await assertSucceeds(member.ref(`groupsByUser/group-member/${groupId}`).once('value'));
    await assertSucceeds(member.ref('groupInvitationInbox/group-member').once('value'));
    await assertFails(foreign.ref(`groupsByUser/group-member/${groupId}`).once('value'));
    await assertFails(member.ref(`groupsByUser/group-member/${groupId}`).set({ effectiveRole: 'owner' }));
    await assertFails(member.ref('groupRateLimits').once('value'));
    await assertFails(member.ref('groupRateLimits/test/key/1').set({ count: 1 }));
});

after(async () => {
    await testEnv.cleanup();
});
