import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSuperAdminProfile, isConfiguredSuperAdmin } from '../src/super-admin.js';

test('reconoce sólo el email configurado como super admin', () => {
    assert.equal(isConfiguredSuperAdmin({ email: 'SEBA@EJEMPLO.COM' }, 'seba@ejemplo.com'), true);
    assert.equal(isConfiguredSuperAdmin({ email: 'otro@ejemplo.com' }, 'seba@ejemplo.com'), false);
    assert.equal(isConfiguredSuperAdmin({}, 'seba@ejemplo.com'), false);
});

test('crea un perfil de super admin sin incluir credenciales', () => {
    const profile = buildSuperAdminProfile({
        email: 'SEBA@EJEMPLO.COM', displayName: ' Sebastián '
    }, { createdAt: 'existing' });
    assert.deepEqual(profile, {
        createdAt: 'existing',
        displayName: 'Sebastián',
        email: 'seba@ejemplo.com',
        role: 'superAdmin',
        disabled: false
    });
    assert.equal('password' in profile, false);
});
