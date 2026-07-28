import assert from 'node:assert/strict';
import test from 'node:test';
import { createActivityLog } from '../src/services/activity.js';

test('la actividad conserva rol y UID sin exponer credenciales', async () => {
    let entry;
    const ref = { child: () => ({ push: async value => { entry = value; }, limitToLast: () => ({ on() {}, off() {} }) }) };
    const activity = createActivityLog({
        tournamentRef: ref,
        serverTimestamp: () => 1,
        getActorName: () => 'Ana',
        getActorIdentity: () => ({ actorUid: 'uid-ana', actorRole: 'participant' }),
        getDeviceLabel: () => 'Android · Chrome',
        onEntries: () => {}
    });
    await activity.log('cargó un resultado');
    assert.deepEqual(entry, { message: 'cargó un resultado', actor: 'Ana', actorUid: 'uid-ana', actorRole: 'participant', device: 'Android · Chrome', createdAt: 1 });
});
