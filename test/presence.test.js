import test from 'node:test';
import assert from 'node:assert/strict';
import { formatPresenceRole, summarizePresence } from '../src/services/presence.js';

test('agrupa por usuario autenticado y conserva espectadores por dispositivo', () => {
    const summary = summarizePresence({
        phone: { uid: 'user-1', actorName: 'Ana', role: 'participant', device: 'Android' },
        laptop: { uid: 'user-1', actorName: 'Ana', role: 'participant', device: 'macOS' },
        viewer: { actorName: 'Espectador', role: 'spectator', device: 'iOS' }
    });
    assert.equal(summary.devices, 3);
    assert.equal(summary.people.length, 2);
    assert.equal(summary.people[0].devices, 2);
    assert.equal(formatPresenceRole('admin'), 'Admin');
});
