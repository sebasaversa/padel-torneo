import { onRequest } from 'firebase-functions/v2/https';

// Punto de comprobación sin privilegios. Las Functions administrativas se
// incorporarán en la etapa 4, una vez definido y asignado el super admin.
export const healthcheck = onRequest({ cors: false }, (_request, response) => {
    response.status(200).json({ status: 'ok' });
});
