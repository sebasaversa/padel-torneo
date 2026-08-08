import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildGeneralGroupInvitationUrl,
    clearPendingGeneralInvitation,
    createGroupsApi,
    loadPendingGeneralInvitation,
    parseGeneralGroupInvitation,
    savePendingGeneralInvitation
} from '../src/services/groups.js';

test('transporta el secreto del enlace general sólo en el fragmento', () => {
    const url = buildGeneralGroupInvitationUrl({
        origin: 'https://example.test',
        pathname: '/torneo/',
        groupId: 'g_0123456789abcdef0123456789abcd',
        invitationId: 'gi_0123456789abcdef0123456789abcd',
        token: 'secreto-sensible'
    });
    const parsedUrl = new URL(url);
    assert.equal(parsedUrl.searchParams.has('token'), false);
    assert.equal(parsedUrl.hash, '#token=secreto-sensible');
    assert.deepEqual(parseGeneralGroupInvitation(parsedUrl), {
        groupId: 'g_0123456789abcdef0123456789abcd',
        invitationId: 'gi_0123456789abcdef0123456789abcd',
        token: 'secreto-sensible'
    });
});

test('conserva una invitación general sólo en el almacenamiento de sesión provisto', () => {
    const values = new Map();
    const storage = {
        setItem: (key, value) => values.set(key, value),
        getItem: key => values.get(key) || null,
        removeItem: key => values.delete(key)
    };
    const invitation = { groupId: 'g_test', invitationId: 'gi_test', token: 'secret' };
    savePendingGeneralInvitation(invitation, storage);
    assert.deepEqual(loadPendingGeneralInvitation(storage), invitation);
    clearPendingGeneralInvitation(storage);
    assert.equal(loadPendingGeneralInvitation(storage), null);
});

test('la API agrega operationId a mutaciones y no a lecturas', async () => {
    const calls = [];
    const api = createGroupsApi(async (name, data) => {
        calls.push({ name, data });
        return {};
    });
    await api.create({ name: 'Viernes', description: '' });
    await api.get('g_0123456789abcdef0123456789abcd');
    assert.match(calls[0].data.operationId, /^[a-f0-9]{32}$/);
    assert.equal(calls[1].data.operationId, undefined);
});

test('reutiliza operationId cuando una mutación falla antes de confirmar respuesta', async () => {
    const calls = [];
    let attempts = 0;
    const api = createGroupsApi(async (name, data) => {
        calls.push({ name, data });
        attempts += 1;
        if (attempts === 1) throw new Error('Conexión interrumpida');
        return { groupId: 'g_ok' };
    });
    await assert.rejects(api.create({ name: 'Viernes', description: '' }));
    await api.create({ name: 'Viernes', description: '' });
    assert.equal(calls[0].data.operationId, calls[1].data.operationId);
});
