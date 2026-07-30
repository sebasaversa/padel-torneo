import {
    CATALOG_VERSION,
    FIXTURE_GENERATOR_VERSION,
    pairKey,
    scheduleFingerprint,
    validateConfiguration
} from './canonical.js';
import { domainError } from './errors.js';

const PLAYER_FIELDS = ['t1_p1', 't1_p2', 't2_p1', 't2_p2'];

function spread(values) {
    return values.length ? Math.max(...values) - Math.min(...values) : 0;
}

function increment(map, key, amount = 1) {
    map.set(key, (map.get(key) || 0) + amount);
}

export function analyzeFixtureRequest({
    configuration,
    numRounds,
    fixtureVariant = 0,
    generationContext = { type: 'fresh' }
}) {
    const normalizedConfiguration = validateConfiguration(configuration);
    if (!Number.isInteger(numRounds) || numRounds < 1 || numRounds > 100) {
        throw domainError('INVALID_CONFIGURATION', 'La cantidad de rondas debe ser un entero entre 1 y 100.');
    }
    if (!Number.isInteger(fixtureVariant) || fixtureVariant < 0) {
        throw domainError('INVALID_CONFIGURATION', 'La variante del fixture no es válida.');
    }
    if (!generationContext || !['fresh', 'extension'].includes(generationContext.type)) {
        throw domainError('INVALID_CONFIGURATION', 'El contexto de generación no es válido.');
    }
    const { numPlayers: n, numCourts: c, pairingMode, fixedTeams } = normalizedConfiguration;
    const activePlayers = c * 4;
    const restsPerRound = n - activePlayers;
    const partnerSlots = c * 2 * numRounds;
    const possiblePartners = n * (n - 1) / 2;
    const possibleTeamMatchups = pairingMode === 'fixed'
        ? fixedTeams.length * (fixedTeams.length - 1) / 2
        : 0;
    const matchSlots = c * numRounds;
    return {
        configuration: normalizedConfiguration,
        numRounds,
        fixtureVariant,
        generationContext,
        availableCourts: Math.floor(n / 4),
        activePlayers,
        restsPerRound,
        partnerSlots,
        possiblePartners,
        matchSlots,
        possibleTeamMatchups,
        minimumRoundsForPairCapacity: Math.ceil(possiblePartners / (2 * c)),
        minimumRoundsForTeamCoverage: pairingMode === 'fixed'
            ? Math.ceil(possibleTeamMatchups / c)
            : null
    };
}

export function validateSchedule(schedule, { configuration, numRounds }) {
    const config = validateConfiguration(configuration);
    if (!Array.isArray(schedule) || schedule.length !== numRounds) {
        throw domainError('INVALID_STATE', 'El fixture no tiene la cantidad de rondas declarada.');
    }
    const roundIds = new Set();
    const matchIds = new Set();
    const fixedTeamKeys = new Set(config.fixedTeams.map(team => pairKey(...team.playerIds)));
    schedule.forEach((round, roundIndex) => {
        if (!round || typeof round.id !== 'string' || !round.id || roundIds.has(round.id)) {
            throw domainError('INVALID_STATE', `La ronda ${roundIndex + 1} no tiene una identidad válida.`);
        }
        roundIds.add(round.id);
        if (!Array.isArray(round.matches) || round.matches.length !== config.numCourts) {
            throw domainError('INVALID_STATE', `La ronda ${roundIndex + 1} debe tener exactamente ${config.numCourts} partidos.`);
        }
        const players = new Set();
        round.matches.forEach((match, matchIndex) => {
            if (!match || typeof match.id !== 'string' || !match.id || matchIds.has(match.id)) {
                throw domainError('INVALID_STATE', `El partido ${matchIndex + 1} de la ronda ${roundIndex + 1} no tiene identidad válida.`);
            }
            matchIds.add(match.id);
            if (match.court !== matchIndex + 1) {
                throw domainError('INVALID_STATE', `Las canchas de la ronda ${roundIndex + 1} no son correlativas.`);
            }
            const ids = PLAYER_FIELDS.map(field => match[field]);
            if (!ids.every(Number.isInteger) || ids.some(id => id < 0 || id >= config.numPlayers) || new Set(ids).size !== 4) {
                throw domainError('INVALID_STATE', `El partido ${match.id} contiene jugadores inválidos.`);
            }
            ids.forEach(id => {
                if (players.has(id)) throw domainError('INVALID_STATE', `Un jugador aparece dos veces en la ronda ${roundIndex + 1}.`);
                players.add(id);
            });
            for (const field of ['score1', 'score2']) {
                if (match[field] !== '' && (!Number.isInteger(match[field]) || match[field] < 0 || match[field] > 20)) {
                    throw domainError('INVALID_STATE', `El partido ${match.id} contiene un score inválido.`);
                }
            }
            if (config.pairingMode === 'fixed') {
                if (!fixedTeamKeys.has(pairKey(match.t1_p1, match.t1_p2))
                    || !fixedTeamKeys.has(pairKey(match.t2_p1, match.t2_p2))) {
                    throw domainError('INVALID_STATE', 'Una ronda separa una pareja fija.');
                }
            }
        });
    });
    return true;
}

export function analyzeSchedule(schedule, {
    configuration,
    numRounds = schedule?.length,
    fixtureVariant = 0,
    classification = {}
}) {
    const request = analyzeFixtureRequest({ configuration, numRounds, fixtureVariant });
    validateSchedule(schedule, { configuration: request.configuration, numRounds });
    const n = request.configuration.numPlayers;
    const partnerCounts = new Map();
    const opponentCounts = new Map();
    const gamesPlayed = Array(n).fill(0);
    const rests = Array(n).fill(0);
    const courts = Array.from({ length: n }, () => Array(request.configuration.numCourts).fill(0));
    const sides = Array.from({ length: n }, () => [0, 0]);
    const teamByPlayer = new Map();
    request.configuration.fixedTeams.forEach(team => team.playerIds.forEach(id => teamByPlayer.set(id, team.id)));
    const teamOpponentCounts = new Map();
    schedule.forEach(round => {
        const active = new Set();
        round.matches.forEach(match => {
            const team1 = [match.t1_p1, match.t1_p2];
            const team2 = [match.t2_p1, match.t2_p2];
            increment(partnerCounts, pairKey(...team1));
            increment(partnerCounts, pairKey(...team2));
            for (const left of team1) for (const right of team2) increment(opponentCounts, pairKey(left, right));
            if (request.configuration.pairingMode === 'fixed') {
                increment(teamOpponentCounts, pairKey(teamByPlayer.get(team1[0]), teamByPlayer.get(team2[0])));
            }
            [...team1, ...team2].forEach((id, position) => {
                active.add(id);
                gamesPlayed[id] += 1;
                courts[id][match.court - 1] += 1;
                sides[id][position < 2 ? 0 : 1] += 1;
            });
        });
        for (let id = 0; id < n; id += 1) if (!active.has(id)) rests[id] += 1;
    });
    const universe = [];
    for (let a = 0; a < n; a += 1) for (let b = a + 1; b < n; b += 1) universe.push(pairKey(a, b));
    const partnerFrequencies = universe.map(key => partnerCounts.get(key) || 0);
    const opponentFrequencies = universe.map(key => opponentCounts.get(key) || 0);
    const teamUniverse = [];
    const teams = request.configuration.fixedTeams;
    for (let a = 0; a < teams.length; a += 1) for (let b = a + 1; b < teams.length; b += 1) {
        teamUniverse.push(pairKey(teams[a].id, teams[b].id));
    }
    const teamFrequencies = teamUniverse.map(key => teamOpponentCounts.get(key) || 0);
    const primaryFrequencies = request.configuration.pairingMode === 'fixed' ? teamFrequencies : partnerFrequencies;
    const uniquePrimary = primaryFrequencies.filter(Boolean).length;
    const possiblePrimary = primaryFrequencies.length;
    const repetitions = primaryFrequencies.reduce((total, frequency) => total + Math.max(0, frequency - 1), 0);
    const capacityEnough = request.configuration.pairingMode === 'fixed'
        ? request.matchSlots >= request.possibleTeamMatchups
        : request.partnerSlots >= request.possiblePartners;
    const coverageStatus = uniquePrimary === possiblePrimary
        ? 'complete'
        : capacityEnough ? 'partial' : 'impossible-by-capacity';
    return {
        pairingMode: request.configuration.pairingMode,
        solutionClass: classification.solutionClass || 'optimized',
        coverageStatus,
        proofStatus: classification.proofStatus || 'heuristic-only',
        provenObjectives: classification.provenObjectives || [],
        cycleStatus: classification.cycleStatus || 'not-applicable',
        fallbackUsed: classification.fallbackUsed === true,
        fixtureVariant,
        variantCount: classification.variantCount || MAX_VARIANTS_FALLBACK,
        uniquePartners: partnerFrequencies.filter(Boolean).length,
        possiblePartners: partnerFrequencies.length,
        partnerSlots: request.partnerSlots,
        repeatedPartners: partnerFrequencies.reduce((total, value) => total + Math.max(0, value - 1), 0),
        partnerFrequencyMin: Math.min(...partnerFrequencies),
        partnerFrequencyMax: Math.max(...partnerFrequencies),
        uniqueOpponents: opponentFrequencies.filter(Boolean).length,
        opponentFrequencyMin: Math.min(...opponentFrequencies),
        opponentFrequencyMax: Math.max(...opponentFrequencies),
        uniqueTeamMatchups: teamFrequencies.filter(Boolean).length,
        possibleTeamMatchups: teamFrequencies.length,
        repeatedTeamMatchups: teamFrequencies.reduce((total, value) => total + Math.max(0, value - 1), 0),
        primaryRepetitions: repetitions,
        gamesPlayed,
        rests,
        gamesSpread: spread(gamesPlayed),
        restsSpread: spread(rests),
        courtCount: courts,
        sideCount: sides,
        minimumRoundsForPairCapacity: request.minimumRoundsForPairCapacity,
        minimumRoundsForTeamCoverage: request.minimumRoundsForTeamCoverage,
        scheduleFingerprint: scheduleFingerprint(schedule, request.configuration, fixtureVariant)
    };
}

const MAX_VARIANTS_FALLBACK = 8;

export function assertCertifiedClassification(diagnostic) {
    if (diagnostic.solutionClass === 'exact'
        && !['catalog-verified', 'constructor-verified'].includes(diagnostic.proofStatus)) {
        throw domainError('INVALID_STATE', 'Una solución exacta requiere una construcción verificada.');
    }
    if (diagnostic.solutionClass === 'optimal-known'
        && (diagnostic.proofStatus !== 'lower-bound-certified' || !diagnostic.provenObjectives.length)) {
        throw domainError('INVALID_STATE', 'Una solución optimal-known requiere objetivos certificados.');
    }
    if (diagnostic.solutionClass === 'optimized' && diagnostic.proofStatus !== 'heuristic-only') {
        throw domainError('INVALID_STATE', 'Una solución optimizada sólo puede declarar prueba heurística.');
    }
    return true;
}

export function supportedVersions() {
    return {
        schemaVersion: 2,
        fixtureGeneratorVersion: FIXTURE_GENERATOR_VERSION,
        catalogVersion: CATALOG_VERSION
    };
}
