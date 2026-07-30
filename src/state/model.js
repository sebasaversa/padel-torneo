import {
    CATALOG_VERSION,
    FIXTURE_GENERATOR_VERSION,
    SCHEMA_VERSION,
    scheduleFingerprint,
    validateConfiguration
} from '../features/fixture/canonical.js';
import { analyzeSchedule, validateSchedule } from '../features/fixture/analysis.js';
import { domainError } from '../features/fixture/errors.js';

function defaultPlayers(numPlayers) {
    return Array.from({ length: numPlayers }, (_, index) => `Jugador ${index + 1}`);
}

export function createDefaultConfiguration({
    numPlayers = 9,
    numCourts = 2,
    pairingMode = 'rotating',
    fixedTeams = []
} = {}) {
    return validateConfiguration({
        numPlayers,
        numCourts,
        pairingMode,
        fixedTeams,
        fixtureGeneratorVersion: FIXTURE_GENERATOR_VERSION,
        catalogVersion: CATALOG_VERSION
    });
}

export function createDefaultState({
    numPlayers = 9,
    numCourts = 2,
    gamesPerSet = 4,
    pairingMode = 'rotating',
    fixedTeams = []
} = {}) {
    const configuration = createDefaultConfiguration({
        numPlayers,
        numCourts,
        pairingMode,
        fixedTeams
    });
    return {
        schemaVersion: SCHEMA_VERSION,
        configuration,
        metadata: {
            tournamentName: '',
            tournamentDate: '',
            ownerUid: '',
            createdAt: null,
            updatedAt: null
        },
        state: {
            players: defaultPlayers(numPlayers),
            gamesPerSet,
            numRounds: 0,
            schedule: [],
            fixtureVariant: 0,
            scheduleRevision: 0,
            scheduleFingerprint: '',
            revision: 0,
            diagnostic: null
        },
        ui: {
            collapsedRounds: {}
        }
    };
}

function validateName(value, field, maxLength, allowEmpty = false) {
    if (typeof value !== 'string' || value !== value.trim()
        || (!allowEmpty && !value) || value.length > maxLength) {
        throw domainError('INVALID_STATE', `${field} no es válido.`);
    }
    return value;
}

function validateDate(value) {
    if (value === '') return value;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw domainError('INVALID_STATE', 'La fecha del torneo no es válida.');
    }
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
        throw domainError('INVALID_STATE', 'La fecha del torneo no existe.');
    }
    return value;
}

function nonNegativeSafeInteger(value, field) {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw domainError('INVALID_STATE', `${field} no es válido.`);
    }
    return value;
}

export function normalizeState(document, { allowDraft = true } = {}) {
    if (!document || document.schemaVersion !== SCHEMA_VERSION) {
        throw domainError('UNSUPPORTED_SCHEMA_VERSION', 'Sólo se admiten torneos y archivos con schemaVersion 2.');
    }
    const configuration = validateConfiguration(document.configuration);
    const sourceState = document.state;
    if (!sourceState || typeof sourceState !== 'object') {
        throw domainError('INVALID_STATE', 'Falta el estado mutable del torneo.');
    }
    if (!Array.isArray(sourceState.players) || sourceState.players.length !== configuration.numPlayers) {
        throw domainError('INVALID_STATE', 'La lista de jugadores no coincide con la configuración.');
    }
    const players = sourceState.players.map((name, index) =>
        validateName(name, `El nombre del jugador ${index + 1}`, 60));
    if (!Number.isInteger(sourceState.gamesPerSet) || sourceState.gamesPerSet < 1 || sourceState.gamesPerSet > 20) {
        throw domainError('INVALID_STATE', 'Games por set debe ser un entero entre 1 y 20.');
    }
    if (!Number.isInteger(sourceState.numRounds) || sourceState.numRounds < 0 || sourceState.numRounds > 100) {
        throw domainError('INVALID_STATE', 'La cantidad de rondas no es válida.');
    }
    const schedule = Array.isArray(sourceState.schedule) ? structuredClone(sourceState.schedule) : null;
    if (!schedule || schedule.length !== sourceState.numRounds) {
        throw domainError('INVALID_STATE', 'La cantidad de rondas no coincide con el fixture.');
    }
    if (schedule.length) validateSchedule(schedule, {
        configuration,
        numRounds: sourceState.numRounds
    });
    if (!allowDraft && !schedule.length) {
        throw domainError('INVALID_STATE', 'Un torneo confirmado debe incluir al menos una ronda.');
    }
    const fixtureVariant = nonNegativeSafeInteger(sourceState.fixtureVariant, 'fixtureVariant');
    const expectedFingerprint = schedule.length
        ? scheduleFingerprint(schedule, configuration, fixtureVariant)
        : '';
    if (sourceState.scheduleFingerprint && sourceState.scheduleFingerprint !== expectedFingerprint) {
        throw domainError('SCHEDULE_IDENTITY_MISMATCH', 'El fingerprint del fixture no coincide con sus partidos.');
    }
    const metadata = document.metadata || {};
    const tournamentName = validateName(
        metadata.tournamentName ?? '',
        'El nombre del torneo',
        100,
        allowDraft
    );
    const tournamentDate = validateDate(metadata.tournamentDate ?? '');
    const normalized = {
        schemaVersion: SCHEMA_VERSION,
        configuration,
        metadata: {
            tournamentName,
            tournamentDate,
            ownerUid: typeof metadata.ownerUid === 'string' ? metadata.ownerUid : '',
            createdAt: metadata.createdAt ?? null,
            updatedAt: metadata.updatedAt ?? null
        },
        state: {
            players,
            gamesPerSet: sourceState.gamesPerSet,
            numRounds: sourceState.numRounds,
            schedule,
            fixtureVariant,
            scheduleRevision: nonNegativeSafeInteger(sourceState.scheduleRevision, 'scheduleRevision'),
            scheduleFingerprint: expectedFingerprint,
            revision: nonNegativeSafeInteger(sourceState.revision, 'revision'),
            diagnostic: schedule.length
                ? analyzeSchedule(schedule, {
                    configuration,
                    numRounds: schedule.length,
                    fixtureVariant,
                    classification: sourceState.diagnostic || {}
                })
                : null
        },
        ui: {
            collapsedRounds: document.ui?.collapsedRounds && typeof document.ui.collapsedRounds === 'object'
                ? { ...document.ui.collapsedRounds }
                : {}
        }
    };
    return normalized;
}

export function toPublicTournament(document) {
    const normalized = normalizeState(document);
    return {
        schemaVersion: normalized.schemaVersion,
        configuration: normalized.configuration,
        metadata: normalized.metadata,
        state: normalized.state
    };
}

export function withGeneratedFixture(document, generated) {
    const next = structuredClone(document);
    next.state.schedule = generated.schedule;
    next.state.numRounds = generated.schedule.length;
    next.state.fixtureVariant = generated.fixtureVariant;
    next.state.scheduleFingerprint = generated.scheduleFingerprint;
    next.state.diagnostic = generated.diagnostic;
    return normalizeState(next);
}

export function hasAnyScore(schedule) {
    return schedule.some(round => round.matches.some(match => match.score1 !== '' || match.score2 !== ''));
}
