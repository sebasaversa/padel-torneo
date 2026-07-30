import assert from 'node:assert/strict';
import test from 'node:test';
import { createFixtureGeneratorWorker } from '../src/features/fixture/worker-client.js';
import {
    extendScheduleSequentially,
    generateSchedule
} from '../src/features/fixture/generator.js';
import {
    CATALOG_VERSION,
    FIXTURE_GENERATOR_VERSION
} from '../src/features/fixture/canonical.js';

function rotating(numPlayers, numCourts) {
    return {
        numPlayers,
        numCourts,
        pairingMode: 'rotating',
        fixedTeams: [],
        fixtureGeneratorVersion: FIXTURE_GENERATOR_VERSION,
        catalogVersion: CATALOG_VERSION
    };
}

class FakeWorker {
    static instances = [];

    constructor() {
        this.listeners = {};
        this.terminated = false;
        FakeWorker.instances.push(this);
    }

    addEventListener(type, handler) {
        this.listeners[type] = handler;
    }

    postMessage(message) {
        this.message = message;
        queueMicrotask(() => {
            if (this.terminated) return;
            this.listeners.message?.({
                data: {
                    type: 'progress',
                    requestToken: message.requestToken,
                    progress: 0.5
                }
            });
            const result = message.type === 'extend'
                ? extendScheduleSequentially(message.request)
                : generateSchedule(message.request);
            this.listeners.message?.({
                data: {
                    type: 'result',
                    requestToken: message.requestToken,
                    result
                }
            });
        });
    }

    terminate() {
        this.terminated = true;
    }
}

test('usa el Worker sólo para configuraciones sin catálogo y conserva JSON idéntico', async () => {
    FakeWorker.instances = [];
    const progress = [];
    const gateway = createFixtureGeneratorWorker({
        WorkerClass: FakeWorker,
        onProgress: value => progress.push(value)
    });
    const catalogRequest = {
        configuration: rotating(8, 2),
        numRounds: 7,
        fixtureVariant: 0,
        generationContext: { type: 'fresh' }
    };
    assert.deepEqual(await gateway.generate(catalogRequest), generateSchedule(catalogRequest));
    assert.equal(FakeWorker.instances.length, 0);

    const optimizedRequest = {
        configuration: rotating(14, 3),
        numRounds: 5,
        fixtureVariant: 0,
        generationContext: { type: 'fresh' }
    };
    assert.deepEqual(await gateway.generate(optimizedRequest), generateSchedule(optimizedRequest));
    assert.equal(FakeWorker.instances.length, 1);
    assert.deepEqual(progress, [0.5]);
    assert.equal(FakeWorker.instances[0].terminated, true);
});

test('cancela el Worker anterior y ejecuta extensiones fuera del hilo principal', async () => {
    FakeWorker.instances = [];
    const gateway = createFixtureGeneratorWorker({ WorkerClass: FakeWorker });
    const request = {
        configuration: rotating(14, 3),
        numRounds: 4,
        fixtureVariant: 0,
        generationContext: { type: 'fresh' }
    };
    const cancelled = gateway.generate(request);
    const cancelledCheck = assert.rejects(cancelled, { code: 'GENERATION_CANCELLED' });
    const current = gateway.generate({ ...request, numRounds: 5 });
    await cancelledCheck;
    const generated = await current;
    const extensionRequest = {
        immutableHistory: generated.schedule,
        targetCount: 6,
        configuration: request.configuration,
        fixtureVariant: 0,
        sourceRevision: 0,
        sourceScheduleRevision: 0
    };
    assert.deepEqual(
        await gateway.extend(extensionRequest),
        extendScheduleSequentially(extensionRequest)
    );
    assert.equal(FakeWorker.instances.every(instance => instance.terminated), true);
});
