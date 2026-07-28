import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getDatabase, ServerValue } from 'firebase-admin/database';
import { defineSecret } from 'firebase-functions/params';
import { HttpsError, onCall, onRequest } from 'firebase-functions/v2/https';
import { buildSuperAdminProfile, isConfiguredSuperAdmin } from './super-admin.js';

if (!getApps().length) initializeApp();

const superAdminEmail = defineSecret('SUPER_ADMIN_EMAIL');

// Punto de comprobación sin privilegios. Las Functions administrativas se
// incorporarán en la etapa 4, una vez definido y asignado el super admin.
export const healthcheck = onRequest({ cors: false }, (_request, response) => {
    response.status(200).json({ status: 'ok' });
});

// Sólo la cuenta definida como secreto puede ejecutar esta inicialización.
// Es idempotente: puede repetirse para restaurar la custom claim si fuera necesario.
export const bootstrapSuperAdmin = onCall({ secrets: [superAdminEmail] }, async request => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Iniciá sesión con Google para continuar.');
    const email = request.auth.token.email;
    if (!isConfiguredSuperAdmin({ email }, superAdminEmail.value())) {
        throw new HttpsError('permission-denied', 'Esta cuenta no puede inicializar el super admin.');
    }

    const userRecord = await getAuth().getUser(request.auth.uid);
    await getAuth().setCustomUserClaims(request.auth.uid, {
        ...(userRecord.customClaims || {}),
        platformRole: 'superAdmin'
    });

    const profileRef = getDatabase().ref(`userProfiles/${request.auth.uid}`);
    await profileRef.transaction(current => ({
        ...buildSuperAdminProfile({
            email,
            displayName: request.auth.token.name || userRecord.displayName
        }, current || {}),
        createdAt: current?.createdAt || ServerValue.TIMESTAMP,
        updatedAt: ServerValue.TIMESTAMP
    }));

    return { role: 'superAdmin' };
});
