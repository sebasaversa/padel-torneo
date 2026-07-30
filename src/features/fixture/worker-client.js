import { getCatalogDescriptor } from './validated-designs.js';
import { analyzeFixtureRequest } from './analysis.js';
import { extendScheduleSequentially, generateSchedule } from './generator.js';

export function createFixtureGeneratorWorker({
    onProgress = () => {},
    WorkerClass = globalThis.Worker
} = {}) {
    let worker = null;
    let active = null;
    let sequence = 0;

    function cancel() {
        if (worker) worker.terminate();
        worker = null;
        if (active) {
            active.reject(Object.assign(new Error('La generación fue cancelada.'), {
                code: 'GENERATION_CANCELLED'
            }));
        }
        active = null;
    }

    function run(type, request, fallback) {
        cancel();
        if (typeof WorkerClass !== 'function') return Promise.resolve(fallback());
        const requestToken = `${++sequence}`;
        worker = new WorkerClass(new URL('./worker.js', import.meta.url), { type: 'module' });
        return new Promise((resolve, reject) => {
            active = { requestToken, resolve, reject };
            worker.addEventListener('message', event => {
                if (!active || event.data.requestToken !== active.requestToken) return;
                if (event.data.type === 'progress') {
                    onProgress(event.data.progress);
                    return;
                }
                const pending = active;
                active = null;
                worker.terminate();
                worker = null;
                if (event.data.type === 'result') pending.resolve(event.data.result);
                else pending.reject(Object.assign(new Error(event.data.error.message), {
                    code: event.data.error.code
                }));
            });
            worker.addEventListener('error', error => {
                const pending = active;
                active = null;
                worker?.terminate();
                worker = null;
                pending?.reject(Object.assign(error, { code: 'GENERATION_RUNTIME_FAILURE' }));
            });
            worker.postMessage({ type, requestToken, request });
        });
    }

    function generate(request) {
        const analyzed = analyzeFixtureRequest(request);
        const catalog = analyzed.configuration.pairingMode === 'rotating'
            ? getCatalogDescriptor(analyzed.configuration, analyzed.numRounds)
            : null;
        if (catalog || analyzed.configuration.pairingMode === 'fixed') {
            cancel();
            return Promise.resolve(generateSchedule(request));
        }
        return run('generate', request, () => generateSchedule(request));
    }

    function extend(request) {
        return run('extend', request, () => extendScheduleSequentially(request));
    }

    return { generate, extend, cancel };
}
