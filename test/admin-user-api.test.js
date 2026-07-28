import assert from 'node:assert/strict';
import test from 'node:test';

import { createAdminUserApi } from '../src/services/admin-user-api.js';

test('centraliza las operaciones protegidas de administradores', async () => {
    const calls = [];
    const api = createAdminUserApi({
        callFunction: async (name, data) => { calls.push({ name, data }); return { ok: true }; }
    });
    await api.list();
    await api.create({ email: 'admin@ejemplo.com', displayName: 'Admin', password: 'secreto123' });
    await api.update(' admin-1 ', { displayName: 'Nuevo nombre', disabled: true });
    await api.generatePasswordResetLink('admin-1');
    await api.remove('admin-1');
    assert.deepEqual(calls, [
        { name: 'listAdminUsers', data: undefined },
        { name: 'createAdminUser', data: { email: 'admin@ejemplo.com', displayName: 'Admin', password: 'secreto123' } },
        { name: 'updateAdminUser', data: { uid: 'admin-1', displayName: 'Nuevo nombre', disabled: true } },
        { name: 'generateAdminPasswordResetLink', data: { uid: 'admin-1' } },
        { name: 'deleteAdminUser', data: { uid: 'admin-1' } }
    ]);
});

test('exige un usuario para editar o eliminar', () => {
    const api = createAdminUserApi({ callFunction: async () => ({}) });
    assert.throws(() => api.update('', {}), /usuario/i);
    assert.throws(() => api.remove(null), /usuario/i);
});
