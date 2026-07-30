import assert from 'node:assert/strict';
import test from 'node:test';
import { createActivityLog } from '../src/services/activity.js';

test('la actividad v2 se lee de public y no realiza escrituras directas', async () => {
    let path;
    let pushed = false;
    const ref = { child: value => {
        path = value;
        return {
            push: async () => { pushed = true; },
            limitToLast: () => ({ on() {}, off() {} })
        };
    } };
    const activity = createActivityLog({
        tournamentRef: ref,
        serverTimestamp: () => 1,
        getActorName: () => 'Ana',
        getActorIdentity: () => ({ actorUid: 'uid-ana', actorRole: 'participant' }),
        getDeviceLabel: () => 'Android · Chrome',
        onEntries: () => {}
    });
    activity.connect();
    const local = await activity.log('cargó un resultado');
    assert.equal(path, 'public/activity');
    assert.equal(pushed, false);
    assert.deepEqual(local, {
        message: 'cargó un resultado',
        actor: 'Ana',
        actorUid: 'uid-ana',
        actorRole: 'participant',
        device: 'Android · Chrome'
    });
});
