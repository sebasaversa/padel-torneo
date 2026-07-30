import { randomBytes } from 'node:crypto';
import {
    CATALOG_VERSION,
    FIXTURE_GENERATOR_VERSION,
    SCHEMA_VERSION,
    scheduleFingerprint,
    sha256,
    stableSerialize,
    validateConfiguration
} from './fixture/canonical.js';
import { analyzeSchedule, validateSchedule } from './fixture/analysis.js';
import { domainError } from './fixture/errors.js';
import {
    extendScheduleSequentially,
    generateSchedule
} from './fixture/generator.js';

const PLAYER_FIELDS = ['t1_p1', 't1_p2', 't2_p1', 't2_p2'];
const OPERATION_TYPES = new Set([
    'updateScore',
    'updateRotatingPairing',
    'renamePlayer',
    'updateGamesPerSet',
    'updateTournamentMetadata',
    'changeRoundCount',
    'regenerateFixture',
    'clearScores'
]);
const ID_PATTERN = /^[A-Za-z0-9_-]{20,64}$/;
const MAX_OPERATION_RECEIPTS = 200;

function validateOperationId(value, field = 'operationId') {
    if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
        throw domainError('INVALID_STATE', `${field} debe codificar al menos 128 bits aleatorios.`);
    }
    return value;
}

function validatePlayers(players, numPlayers) {
    if (!Array.isArray(players) || players.length !== numPlayers) {
        throw domainError('INVALID_STATE', 'La lista de jugadores no coincide con la configuración.');
    }
    return players.map((name, index) => {
        if (typeof name !== 'string' || name !== name.trim() || !name || name.length > 60) {
            throw domainError('INVALID_STATE', `El nombre del jugador ${index + 1} no es válido.`);
        }
        return name;
    });
}

function validateMetadata(metadata = {}) {
    const tournamentName = metadata.tournamentName;
    const tournamentDate = metadata.tournamentDate || '';
    if (typeof tournamentName !== 'string' || tournamentName !== tournamentName.trim()
        || !tournamentName || tournamentName.length > 100) {
        throw domainError('INVALID_STATE', 'El nombre del torneo no es válido.');
    }
    if (tournamentDate && !/^\d{4}-\d{2}-\d{2}$/.test(tournamentDate)) {
        throw domainError('INVALID_STATE', 'La fecha del torneo no es válida.');
    }
    if (tournamentDate) {
        const [year, month, day] = tournamentDate.split('-').map(Number);
        const parsed = new Date(Date.UTC(year, month - 1, day));
        if (parsed.getUTCFullYear() !== year
            || parsed.getUTCMonth() !== month - 1
            || parsed.getUTCDate() !== day) {
            throw domainError('INVALID_STATE', 'La fecha del torneo no existe.');
        }
    }
    return { tournamentName, tournamentDate };
}

export function normalizeCreationRequest(data = {}) {
    const creationRequestId = validateOperationId(data.creationRequestId, 'creationRequestId');
    const configuration = validateConfiguration({
        ...data.configuration,
        fixtureGeneratorVersion: FIXTURE_GENERATOR_VERSION,
        catalogVersion: CATALOG_VERSION
    });
    if (!Number.isInteger(data.numRounds) || data.numRounds < 1 || data.numRounds > 100) {
        throw domainError('INVALID_CONFIGURATION', 'La cantidad de rondas no es válida.');
    }
    if (!Number.isInteger(data.gamesPerSet) || data.gamesPerSet < 1 || data.gamesPerSet > 20) {
        throw domainError('INVALID_STATE', 'Games por set no es válido.');
    }
    return {
        creationRequestId,
        configuration,
        numRounds: data.numRounds,
        gamesPerSet: data.gamesPerSet,
        players: validatePlayers(data.players, configuration.numPlayers),
        metadata: validateMetadata(data.metadata)
    };
}

export function buildTournamentV2({ request, ownerUid, tournamentId, timestamp }) {
    const generated = generateSchedule({
        configuration: request.configuration,
        numRounds: request.numRounds,
        fixtureVariant: 0,
        generationContext: { type: 'fresh' }
    });
    const publicDocument = {
        schemaVersion: SCHEMA_VERSION,
        configuration: request.configuration,
        metadata: {
            ...request.metadata,
            ownerUid,
            createdAt: timestamp,
            updatedAt: timestamp
        },
        state: {
            players: request.players,
            gamesPerSet: request.gamesPerSet,
            numRounds: request.numRounds,
            schedule: generated.schedule,
            fixtureVariant: 0,
            scheduleRevision: 0,
            scheduleFingerprint: generated.scheduleFingerprint,
            revision: 0,
            diagnostic: generated.diagnostic
        },
        activity: {
            [request.creationRequestId]: {
                type: 'createTournament',
                actorUid: ownerUid,
                createdAt: timestamp
            }
        }
    };
    return {
        tournamentId,
        tournament: {
            public: publicDocument,
            _server: { operationReceipts: {} }
        },
        access: {
            members: {
                [ownerUid]: { role: 'admin', joinedAt: timestamp }
            },
            claims: {},
            invitationHashes: {},
            accessRevision: 0,
            accessActivity: {},
            accessOperationReceipts: {}
        }
    };
}

export function validateTournamentV2(publicDocument) {
    if (publicDocument?.schemaVersion !== SCHEMA_VERSION) {
        throw domainError('UNSUPPORTED_SCHEMA_VERSION', 'El torneo no usa schemaVersion 2.');
    }
    const configuration = validateConfiguration(publicDocument.configuration);
    const metadata = publicDocument.metadata;
    const validatedMetadata = validateMetadata(metadata);
    if (validatedMetadata.tournamentName !== metadata?.tournamentName
        || validatedMetadata.tournamentDate !== metadata?.tournamentDate
        || typeof metadata?.ownerUid !== 'string' || !metadata.ownerUid) {
        throw domainError('INVALID_STATE', 'La metadata del torneo no es válida.');
    }
    const state = publicDocument.state;
    validatePlayers(state?.players, configuration.numPlayers);
    if (!Number.isInteger(state?.gamesPerSet) || state.gamesPerSet < 1 || state.gamesPerSet > 20
        || !Number.isSafeInteger(state?.revision) || state.revision < 0
        || !Number.isSafeInteger(state?.scheduleRevision) || state.scheduleRevision < 0
        || !Number.isSafeInteger(state?.fixtureVariant) || state.fixtureVariant < 0
        || state.numRounds !== state.schedule?.length) {
        throw domainError('INVALID_STATE', 'El estado mutable del torneo no es válido.');
    }
    validateSchedule(state.schedule, { configuration, numRounds: state.numRounds });
    if (state.schedule.some(round => round.matches.some(match =>
        [match.score1, match.score2].some(score =>
            score !== '' && (!Number.isInteger(score) || score > state.gamesPerSet))))) {
        throw domainError('INVALID_STATE', 'Un score supera el objetivo de games del torneo.');
    }
    if (state.diagnostic?.variantCount !== undefined
        && (!Number.isInteger(state.diagnostic.variantCount)
            || state.fixtureVariant >= state.diagnostic.variantCount)) {
        throw domainError('INVALID_STATE', 'La variante del fixture no es válida.');
    }
    const fingerprint = scheduleFingerprint(state.schedule, configuration, state.fixtureVariant);
    if (fingerprint !== state.scheduleFingerprint) {
        throw domainError('SCHEDULE_IDENTITY_MISMATCH', 'El fingerprint del fixture no coincide.');
    }
    return true;
}

function actorCanManage(publicDocument, access, actor) {
    return actor.platformRole === 'superAdmin'
        || publicDocument.metadata.ownerUid === actor.uid
        || access?.members?.[actor.uid]?.role === 'admin';
}

function actorPlayerIds(access, actor) {
    return Object.entries(access?.claims || {})
        .filter(([, claim]) => claim?.uid === actor.uid)
        .map(([playerId]) => Number(playerId));
}

function locateMatch(state, payload) {
    const round = state.schedule.find(item => item.id === payload.roundId);
    const match = round?.matches.find(item => item.id === payload.matchId);
    if (!round || !match) throw domainError('NOT_FOUND', 'El partido ya no existe.');
    const players = PLAYER_FIELDS.map(field => match[field]);
    if (payload.expectedPlayerIds && stableSerialize(payload.expectedPlayerIds) !== stableSerialize(players)) {
        throw domainError('SCHEDULE_IDENTITY_MISMATCH', 'Los jugadores del partido cambiaron.');
    }
    return { round, match, players };
}

function verifySchedulePreconditions(state, request) {
    const payload = request.payload || {};
    if (payload.expectedScheduleRevision !== state.scheduleRevision
        || payload.expectedScheduleFingerprint !== state.scheduleFingerprint) {
        throw domainError('SCHEDULE_IDENTITY_MISMATCH', 'El fixture cambió desde que preparaste la operación.');
    }
}

function hasAnyScore(schedule) {
    return schedule.some(round => round.matches.some(match => match.score1 !== '' || match.score2 !== ''));
}

function hasMatchScore(match) {
    return match.score1 !== '' || match.score2 !== '';
}

function applyScore(publicDocument, access, request, actor, canManage) {
    verifySchedulePreconditions(publicDocument.state, request);
    const { match, players } = locateMatch(publicDocument.state, request.payload);
    if (!canManage && !actorPlayerIds(access, actor).some(id => players.includes(id))) {
        throw domainError('FORBIDDEN', 'Sólo podés cargar resultados de tus propios partidos.');
    }
    const { field, value } = request.payload;
    if (!['score1', 'score2'].includes(field)
        || (value !== '' && (!Number.isInteger(value) || value < 0 || value > publicDocument.state.gamesPerSet))) {
        throw domainError('INVALID_STATE', 'El puntaje no es válido.');
    }
    match[field] = value;
}

function applyRotatingPairing(publicDocument, request, canManage) {
    if (!canManage) throw domainError('FORBIDDEN', 'Sólo un administrador puede corregir las parejas.');
    if (publicDocument.configuration.pairingMode !== 'rotating') {
        throw domainError('FORBIDDEN', 'Las parejas fijas no se pueden modificar.');
    }
    verifySchedulePreconditions(publicDocument.state, request);
    const { round, match } = locateMatch(publicDocument.state, request.payload);
    const { role, playerId } = request.payload;
    if (!PLAYER_FIELDS.includes(role) || !Number.isInteger(playerId)
        || playerId < 0 || playerId >= publicDocument.configuration.numPlayers) {
        throw domainError('INVALID_STATE', 'El cambio de pareja no es válido.');
    }
    const previousPlayer = match[role];
    const source = round.matches.flatMap(item => PLAYER_FIELDS.map(field => ({ item, field })))
        .find(slot => slot.item !== match && slot.item[slot.field] === playerId);
    const affected = source ? [match, source.item] : [match];
    if (affected.some(hasMatchScore)) {
        throw domainError('HAS_RECORDED_SCORES', 'Los partidos afectados ya tienen puntajes.');
    }
    if (source) source.item[source.field] = previousPlayer;
    match[role] = playerId;
}

function rebuildScheduleMetadata(publicDocument, classification = {}) {
    const state = publicDocument.state;
    state.numRounds = state.schedule.length;
    state.scheduleFingerprint = scheduleFingerprint(
        state.schedule,
        publicDocument.configuration,
        state.fixtureVariant
    );
    state.diagnostic = analyzeSchedule(state.schedule, {
        configuration: publicDocument.configuration,
        numRounds: state.numRounds,
        fixtureVariant: state.fixtureVariant,
        classification: {
            solutionClass: 'optimized',
            proofStatus: 'heuristic-only',
            provenObjectives: [],
            cycleStatus: 'not-applicable',
            fallbackUsed: false,
            variantCount: 8,
            ...classification
        }
    });
}

function verifyPreparedFixture(state, preparedFixture, requestType) {
    if (!preparedFixture
        || preparedFixture.type !== requestType
        || preparedFixture.sourceRevision !== state.revision
        || preparedFixture.sourceScheduleRevision !== state.scheduleRevision
        || preparedFixture.sourceScheduleFingerprint !== state.scheduleFingerprint) {
        throw domainError('SCHEDULE_IDENTITY_MISMATCH', 'El fixture preparado quedó obsoleto.');
    }
}

function applyMutationBody(publicDocument, access, request, actor, preparedFixture) {
    const state = publicDocument.state;
    const canManage = actorCanManage(publicDocument, access, actor);
    let scheduleChanged = false;
    let scheduleClassification = {};
    switch (request.type) {
    case 'updateScore':
        applyScore(publicDocument, access, request, actor, canManage);
        break;
    case 'updateRotatingPairing':
        applyRotatingPairing(publicDocument, request, canManage);
        scheduleChanged = true;
        break;
    case 'renamePlayer': {
        const { playerId, name } = request.payload;
        const ownsPlayer = actorPlayerIds(access, actor).includes(playerId);
        if (!canManage && !ownsPlayer) throw domainError('FORBIDDEN', 'No podés cambiar ese nombre.');
        if (!Number.isInteger(playerId) || typeof name !== 'string' || name !== name.trim() || !name || name.length > 60) {
            throw domainError('INVALID_STATE', 'El nombre no es válido.');
        }
        state.players[playerId] = name;
        break;
    }
    case 'updateGamesPerSet':
        if (!canManage) throw domainError('FORBIDDEN', 'No podés cambiar los games del torneo.');
        if (hasAnyScore(state.schedule)) throw domainError('HAS_RECORDED_SCORES', 'Ya hay puntajes cargados.');
        if (!Number.isInteger(request.payload.gamesPerSet)
            || request.payload.gamesPerSet < 1 || request.payload.gamesPerSet > 20) {
            throw domainError('INVALID_STATE', 'Games por set no es válido.');
        }
        state.gamesPerSet = request.payload.gamesPerSet;
        break;
    case 'updateTournamentMetadata':
        if (!canManage) throw domainError('FORBIDDEN', 'No podés editar el torneo.');
        Object.assign(publicDocument.metadata, validateMetadata(request.payload));
        break;
    case 'changeRoundCount': {
        if (!canManage) throw domainError('FORBIDDEN', 'No podés cambiar las rondas.');
        const targetCount = request.payload.targetCount;
        if (!Number.isInteger(targetCount) || targetCount < 1 || targetCount > 100) {
            throw domainError('INVALID_STATE', 'La cantidad de rondas no es válida.');
        }
        if (targetCount < state.numRounds) {
            const removed = state.schedule.slice(targetCount);
            if (hasAnyScore(removed) && request.payload.confirmDeleteScores !== true) {
                throw domainError('HAS_RECORDED_SCORES', 'Las rondas eliminadas tienen puntajes.');
            }
            state.schedule = state.schedule.slice(0, targetCount);
        } else if (targetCount > state.numRounds) {
            verifyPreparedFixture(state, preparedFixture, request.type);
            if (preparedFixture.targetCount !== targetCount) {
                throw domainError('SCHEDULE_IDENTITY_MISMATCH', 'La extensión preparada no coincide.');
            }
            state.schedule = structuredClone(preparedFixture.schedule);
            scheduleClassification = preparedFixture.diagnostic;
        }
        scheduleChanged = targetCount !== state.numRounds;
        break;
    }
    case 'regenerateFixture': {
        if (!canManage) throw domainError('FORBIDDEN', 'No podés regenerar el fixture.');
        if (hasAnyScore(state.schedule) && request.payload.confirmDeleteScores !== true) {
            throw domainError('HAS_RECORDED_SCORES', 'El fixture tiene puntajes cargados.');
        }
        verifyPreparedFixture(state, preparedFixture, request.type);
        state.schedule = structuredClone(preparedFixture.schedule);
        state.fixtureVariant = preparedFixture.fixtureVariant;
        scheduleClassification = preparedFixture.diagnostic;
        scheduleChanged = true;
        break;
    }
    case 'clearScores':
        if (!canManage) throw domainError('FORBIDDEN', 'No podés borrar todos los resultados.');
        state.schedule.forEach(round => round.matches.forEach(match => {
            match.score1 = '';
            match.score2 = '';
        }));
        break;
    default:
        throw domainError('INVALID_STATE', 'La operación no está soportada.');
    }
    if (scheduleChanged) {
        state.scheduleRevision += 1;
        rebuildScheduleMetadata(publicDocument, scheduleClassification);
    }
    return { scheduleChanged };
}

export function normalizeMutationRequest(data = {}) {
    const operationId = validateOperationId(data.operationId);
    if (!OPERATION_TYPES.has(data.type) || !Number.isSafeInteger(data.expectedRevision) || data.expectedRevision < 0) {
        throw domainError('INVALID_STATE', 'La mutación no es válida.');
    }
    return {
        operationId,
        expectedRevision: data.expectedRevision,
        type: data.type,
        payload: data.payload && typeof data.payload === 'object' ? structuredClone(data.payload) : {}
    };
}

export function prepareFixtureMutation(publicDocument, request) {
    validateTournamentV2(publicDocument);
    const state = publicDocument.state;
    if (state.revision !== request.expectedRevision) {
        throw domainError('REVISION_CONFLICT', 'El torneo cambió en otro dispositivo.');
    }
    const base = {
        type: request.type,
        sourceRevision: state.revision,
        sourceScheduleRevision: state.scheduleRevision,
        sourceScheduleFingerprint: state.scheduleFingerprint
    };
    if (request.type === 'changeRoundCount' && request.payload.targetCount > state.numRounds) {
        const extended = extendScheduleSequentially({
            immutableHistory: state.schedule,
            targetCount: request.payload.targetCount,
            configuration: publicDocument.configuration,
            fixtureVariant: state.fixtureVariant,
            sourceRevision: state.revision,
            sourceScheduleRevision: state.scheduleRevision
        });
        return {
            ...base,
            targetCount: request.payload.targetCount,
            schedule: extended.schedule,
            diagnostic: extended.diagnostic,
            fixtureVariant: state.fixtureVariant
        };
    }
    if (request.type === 'regenerateFixture') {
        const generated = generateSchedule({
            configuration: publicDocument.configuration,
            numRounds: state.numRounds,
            fixtureVariant: state.fixtureVariant + 1,
            generationContext: { type: 'fresh' }
        });
        return {
            ...base,
            schedule: generated.schedule,
            diagnostic: generated.diagnostic,
            fixtureVariant: generated.fixtureVariant
        };
    }
    return null;
}

export function applyTournamentMutation({
    tournament,
    access,
    request,
    actor,
    timestamp,
    preparedFixture = undefined
}) {
    const publicDocument = structuredClone(tournament?.public);
    validateTournamentV2(publicDocument);
    const receipt = tournament?._server?.operationReceipts?.[request.operationId];
    const digest = sha256({ type: request.type, payload: request.payload });
    if (receipt) {
        if (receipt.digest !== digest) {
            throw domainError('IDEMPOTENCY_KEY_REUSED', 'El operationId ya se usó para otro contenido.');
        }
        return { tournament, result: receipt.result, replayed: true };
    }
    if (publicDocument.state.revision !== request.expectedRevision) {
        throw domainError('REVISION_CONFLICT', 'El torneo cambió en otro dispositivo.');
    }
    if (publicDocument.metadata.deletedAt) {
        throw domainError('NOT_FOUND', 'El torneo está eliminado.');
    }
    const effectivePreparedFixture = preparedFixture === undefined
        ? prepareFixtureMutation(publicDocument, request)
        : preparedFixture;
    applyMutationBody(publicDocument, access, request, actor, effectivePreparedFixture);
    publicDocument.state.revision += 1;
    publicDocument.metadata.updatedAt = timestamp;
    publicDocument.activity ||= {};
    publicDocument.activity[request.operationId] = {
        type: request.type,
        actorUid: actor.uid,
        createdAt: timestamp
    };
    validateTournamentV2(publicDocument);
    const result = {
        revision: publicDocument.state.revision,
        scheduleRevision: publicDocument.state.scheduleRevision,
        scheduleFingerprint: publicDocument.state.scheduleFingerprint
    };
    const nextTournament = structuredClone(tournament);
    nextTournament.public = publicDocument;
    nextTournament._server ||= {};
    nextTournament._server.operationReceipts ||= {};
    nextTournament._server.operationReceipts[request.operationId] = {
        digest,
        result,
        createdAt: timestamp
    };
    const receiptIds = Object.keys(nextTournament._server.operationReceipts);
    while (receiptIds.length > MAX_OPERATION_RECEIPTS) {
        delete nextTournament._server.operationReceipts[receiptIds.shift()];
    }
    return { tournament: nextTournament, result, replayed: false };
}

export function createOpaqueToken() {
    return randomBytes(24).toString('base64url');
}

export function invitationHash(token) {
    if (typeof token !== 'string' || !ID_PATTERN.test(token)) {
        throw domainError('FORBIDDEN', 'La invitación no es válida.');
    }
    return sha256(token);
}

export function preserveAdminRole(existingRole, requestedRole) {
    return existingRole === 'admin' ? 'admin' : requestedRole;
}
