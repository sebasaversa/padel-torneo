import { MAX_OPTIMIZED_VARIANTS_V1, scheduleFingerprint } from './canonical.js';
import {
    analyzeFixtureRequest,
    analyzeSchedule,
    assertCertifiedClassification,
    validateSchedule
} from './analysis.js';
import { domainError } from './errors.js';
import { optimizeSchedule } from './optimizer.js';
import { getFixedRoundRobinDesign } from './team-round-robin.js';
import {
    getCatalogDescriptor,
    getOptimalKnownDesign,
    getRotatingExactDesign
} from './validated-designs.js';

function selectConstructor(request) {
    if (request.configuration.pairingMode === 'fixed') {
        return getFixedRoundRobinDesign(request);
    }
    return getRotatingExactDesign(request) || getOptimalKnownDesign(request);
}

function classifyCatalogOptimum(result, descriptor, request) {
    if (descriptor?.solutionClass !== 'optimal-known') return result;
    const diagnostic = analyzeSchedule(result.schedule, {
        configuration: request.configuration,
        numRounds: request.numRounds,
        fixtureVariant: request.fixtureVariant,
        classification: result.classification
    });
    if (diagnostic.coverageStatus !== 'complete' || diagnostic.primaryRepetitions !== descriptor.lowerBound) return result;
    return {
        ...result,
        classification: {
            ...result.classification,
            solutionClass: 'optimal-known',
            proofStatus: 'lower-bound-certified',
            provenObjectives: descriptor.provenObjectives,
            cycleStatus: 'complete',
            fallbackUsed: false,
            variantCount: descriptor.variantCount,
            certificate: descriptor.certificate,
            lowerBound: descriptor.lowerBound
        }
    };
}

export function generateSchedule(input) {
    const request = analyzeFixtureRequest(input);
    const descriptor = request.configuration.pairingMode === 'rotating'
        ? getCatalogDescriptor(request.configuration, request.numRounds)
        : null;
    const declaredVariantCount = descriptor?.variantCount || (
        request.configuration.pairingMode === 'fixed' ? 2 : MAX_OPTIMIZED_VARIANTS_V1
    );
    if (request.fixtureVariant >= declaredVariantCount) {
        throw domainError('NO_MORE_FIXTURE_VARIANTS', 'No quedan variantes diferentes para esta configuración.');
    }
    let generated = selectConstructor(request);
    if (!generated) {
        generated = optimizeSchedule({
            configuration: request.configuration,
            numRounds: request.numRounds,
            fixtureVariant: request.fixtureVariant,
            immutableHistory: request.generationContext.type === 'extension'
                ? request.generationContext.immutableHistory || []
                : []
        });
        generated = classifyCatalogOptimum(generated, descriptor, request);
    }
    validateSchedule(generated.schedule, {
        configuration: request.configuration,
        numRounds: request.numRounds
    });
    const diagnostic = analyzeSchedule(generated.schedule, {
        configuration: request.configuration,
        numRounds: request.numRounds,
        fixtureVariant: request.fixtureVariant,
        classification: generated.classification
    });
    assertCertifiedClassification(diagnostic);
    if (diagnostic.solutionClass === 'exact'
        && diagnostic.cycleStatus === 'complete'
        && request.configuration.pairingMode === 'rotating'
        && (diagnostic.uniquePartners !== diagnostic.possiblePartners
            || diagnostic.partnerFrequencyMin !== diagnostic.partnerFrequencyMax
            || diagnostic.opponentFrequencyMin !== 2
            || diagnostic.opponentFrequencyMax !== 2)) {
        throw domainError('GENERATION_RUNTIME_FAILURE', 'El catálogo exacto no alcanzó su certificado.');
    }
    return {
        schedule: generated.schedule,
        diagnostic,
        scheduleFingerprint: scheduleFingerprint(
            generated.schedule,
            request.configuration,
            request.fixtureVariant
        ),
        fixtureVariant: request.fixtureVariant,
        variantCount: diagnostic.variantCount
    };
}

export function extendScheduleSequentially({
    immutableHistory,
    targetCount,
    configuration,
    fixtureVariant = 0,
    sourceRevision = 0,
    sourceScheduleRevision = 0
}) {
    if (!Array.isArray(immutableHistory) || !Number.isInteger(targetCount)
        || targetCount < immutableHistory.length || targetCount > 100) {
        throw domainError('INVALID_CONFIGURATION', 'La extensión solicitada no es válida.');
    }
    let schedule = structuredClone(immutableHistory);
    while (schedule.length < targetCount) {
        const next = optimizeSchedule({
            configuration: analyzeFixtureRequest({
                configuration,
                numRounds: schedule.length + 1,
                fixtureVariant,
                generationContext: { type: 'extension', immutableHistory: schedule }
            }).configuration,
            numRounds: schedule.length + 1,
            fixtureVariant,
            immutableHistory: schedule
        });
        schedule = next.schedule;
    }
    validateSchedule(schedule, { configuration, numRounds: targetCount });
    const diagnostic = analyzeSchedule(schedule, {
        configuration,
        numRounds: targetCount,
        fixtureVariant,
        classification: {
            solutionClass: 'optimized',
            proofStatus: 'heuristic-only',
            provenObjectives: [],
            cycleStatus: 'not-applicable',
            fallbackUsed: false,
            variantCount: MAX_OPTIMIZED_VARIANTS_V1
        }
    });
    return {
        schedule,
        diagnostic,
        scheduleFingerprint: diagnostic.scheduleFingerprint,
        fixtureVariant,
        sourceRevision,
        sourceScheduleRevision
    };
}

export function recommendNumRounds(configuration) {
    const request = analyzeFixtureRequest({ configuration, numRounds: 1, fixtureVariant: 0 });
    if (request.configuration.pairingMode === 'fixed') {
        const teams = request.configuration.fixedTeams.length;
        const edgeRounds = teams % 2 === 0 ? teams - 1 : teams;
        return Math.max(edgeRounds, request.minimumRoundsForTeamCoverage);
    }
    const n = request.configuration.numPlayers;
    if ([4, 5, 8, 9, 12, 13, 16].includes(n)
        && Math.floor(n / 4) % request.configuration.numCourts === 0) {
        return (n % 2 === 0 ? n - 1 : n) * (Math.floor(n / 4) / request.configuration.numCourts);
    }
    return Math.max(request.minimumRoundsForPairCapacity, Math.ceil(n / Math.max(1, n - request.activePlayers)));
}

export function getCourts(numPlayers, requestedCourts) {
    if (!Number.isInteger(numPlayers) || !Number.isInteger(requestedCourts)
        || requestedCourts < 1 || requestedCourts > Math.floor(numPlayers / 4)) {
        throw domainError('INVALID_CONFIGURATION', 'La cantidad de canchas no es válida.');
    }
    return requestedCourts;
}

export function getPlayingCount(numPlayers, requestedCourts) {
    return getCourts(numPlayers, requestedCourts) * 4;
}

export function getRestCount(numPlayers, requestedCourts) {
    return numPlayers - getPlayingCount(numPlayers, requestedCourts);
}
