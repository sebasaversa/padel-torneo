import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPlayerClaim, canClaimPlayer } from '../src/services/player-claims.js';

test('vincula claims de jugador al UID sin perder el dispositivo', () => {
    const claim = buildPlayerClaim({ uid: 'user-1', presenceId: 'device-1', displayName: 'Ana', timestamp: 1 });
    assert.deepEqual(claim, { uid: 'user-1', presenceId: 'device-1', displayName: 'Ana', claimedAt: 1 });
    assert.equal(canClaimPlayer(claim, { uid: 'user-1', presenceId: 'device-2' }), true);
    assert.equal(canClaimPlayer(claim, { uid: 'user-2', presenceId: 'device-1' }), false);
});
