import { extendScheduleSequentially, generateSchedule } from './generator.js';

self.addEventListener('message', event => {
    const { type, requestToken, request } = event.data || {};
    if (!['generate', 'extend'].includes(type)) return;
    try {
        self.postMessage({ type: 'progress', requestToken, progress: 0.1 });
        const result = type === 'generate'
            ? generateSchedule(request)
            : extendScheduleSequentially(request);
        self.postMessage({ type: 'progress', requestToken, progress: 1 });
        self.postMessage({ type: 'result', requestToken, result });
    } catch (error) {
        self.postMessage({
            type: 'error',
            requestToken,
            error: {
                code: error.code || 'GENERATION_RUNTIME_FAILURE',
                message: error.message || 'No se pudo generar el fixture.'
            }
        });
    }
});
