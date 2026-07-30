const EVEN_STARTERS = Object.freeze({
    4: [[[1, 2], [3, 0]]],
    8: [
        [[2, 3], [4, 6]],
        [[5, 1], [7, 0]]
    ],
    12: [
        [[2, 3], [1, 6]],
        [[8, 10], [4, 7]],
        [[5, 9], [11, 0]]
    ],
    16: [
        [[6, 7], [1, 5]],
        [[10, 12], [9, 2]],
        [[11, 14], [3, 8]],
        [[13, 4], [15, 0]]
    ]
});

const ODD_STARTERS = Object.freeze({
    5: [[[2, 3], [4, 1]]],
    13: [
        [[3, 4], [2, 8]],
        [[5, 7], [10, 1]],
        [[9, 12], [6, 11]]
    ]
});

const NINE_PLAYER_CYCLE = Object.freeze([
    [[[1, 2], [3, 6]], [[4, 8], [5, 7]]],
    [[[2, 0], [4, 7]], [[5, 6], [3, 8]]],
    [[[0, 1], [5, 8]], [[3, 7], [4, 6]]],
    [[[4, 5], [6, 0]], [[7, 2], [8, 1]]],
    [[[5, 3], [7, 1]], [[8, 0], [6, 2]]],
    [[[3, 4], [8, 2]], [[6, 1], [7, 0]]],
    [[[7, 8], [0, 3]], [[1, 5], [2, 4]]],
    [[[8, 6], [1, 4]], [[2, 3], [0, 5]]],
    [[[6, 7], [2, 5]], [[0, 4], [1, 3]]]
]);

const OPTIMAL_KNOWN_PARTNERSHIPS = Object.freeze({
    '6x1x8': [
        [[0, 1], [2, 5]], [[3, 4], [0, 1]], [[1, 3], [0, 5]], [[2, 4], [1, 5]],
        [[2, 3], [0, 4]], [[1, 2], [0, 3]], [[4, 5], [0, 2]], [[3, 5], [1, 4]]
    ],
    '7x1x11': [
        [[0, 1], [3, 4]], [[0, 1], [5, 6]], [[2, 3], [4, 6]], [[0, 2], [1, 5]],
        [[2, 5], [1, 6]], [[0, 4], [3, 6]], [[1, 4], [0, 5]], [[2, 6], [3, 5]],
        [[1, 3], [2, 4]], [[0, 6], [4, 5]], [[0, 3], [1, 2]]
    ],
    '10x2x12': [
        [[0, 3], [4, 5], [1, 2], [8, 9]], [[0, 1], [4, 7], [3, 6], [2, 5]],
        [[0, 7], [4, 5], [2, 3], [1, 6]], [[2, 8], [4, 9], [5, 7], [0, 6]],
        [[1, 8], [3, 9], [2, 7], [5, 6]], [[1, 3], [4, 8], [0, 9], [2, 6]],
        [[3, 5], [0, 4], [7, 9], [6, 8]], [[1, 7], [2, 4], [5, 8], [6, 9]],
        [[0, 1], [3, 7], [5, 9], [4, 6]], [[2, 3], [0, 8], [1, 9], [6, 7]],
        [[0, 2], [1, 5], [3, 4], [7, 8]], [[2, 9], [3, 8], [0, 5], [1, 4]]
    ],
    '11x2x14': [
        [[0, 1], [7, 10], [5, 6], [3, 8]], [[0, 1], [2, 4], [3, 9], [6, 7]],
        [[1, 4], [0, 2], [5, 10], [8, 9]], [[2, 9], [3, 4], [1, 8], [6, 10]],
        [[0, 5], [7, 9], [3, 6], [1, 10]], [[5, 7], [0, 8], [1, 2], [4, 6]],
        [[4, 5], [0, 9], [2, 10], [7, 8]], [[3, 7], [6, 8], [1, 9], [4, 10]],
        [[2, 3], [0, 6], [5, 9], [1, 7]], [[4, 8], [3, 5], [0, 10], [2, 6]],
        [[4, 9], [5, 8], [0, 3], [2, 7]], [[1, 3], [8, 10], [0, 7], [2, 5]],
        [[1, 6], [9, 10], [0, 4], [2, 8]], [[6, 9], [3, 10], [4, 7], [1, 5]]
    ]
});

function incrementCyclicPosition(position, round, numPlayers, even) {
    if (even && position === 0) return 0;
    if (even) return ((position - 1 + round) % (numPlayers - 1)) + 1;
    return (position + round) % numPlayers;
}

function relabel(playerId, numPlayers, variant, even) {
    if (variant % 2 === 0) return playerId;
    if (even && playerId === 0) return 0;
    if (even) return numPlayers - playerId;
    return (numPlayers - playerId) % numPlayers;
}

function buildCyclicCycle(numPlayers, variant) {
    if (numPlayers === 9) {
        return NINE_PLAYER_CYCLE.map(round => round.map(match =>
            match.map(team => team.map(id => relabel(id, numPlayers, variant, false)))));
    }
    const even = numPlayers % 2 === 0;
    const starter = (even ? EVEN_STARTERS : ODD_STARTERS)[numPlayers];
    if (!starter) return null;
    const roundCount = even ? numPlayers - 1 : numPlayers;
    return Array.from({ length: roundCount }, (_, round) => starter.map(match =>
        match.map(team => team.map(position =>
            relabel(incrementCyclicPosition(position, round, numPlayers, even), numPlayers, variant, even)))));
}

function rotateCycle(cycle, variant) {
    if (!cycle.length || variant % 2 === 0) return cycle;
    return cycle.slice(1).concat([cycle[0]]);
}

function createRound(roundIndex, matches, fixtureVariant, generatorVersion) {
    return {
        id: `round-g${generatorVersion}-v${fixtureVariant}-r${roundIndex}`,
        matches: matches.map((match, matchIndex) => ({
            id: `match-g${generatorVersion}-v${fixtureVariant}-r${roundIndex}-c${matchIndex + 1}`,
            court: matchIndex + 1,
            t1_p1: match[0][0],
            t1_p2: match[0][1],
            t2_p1: match[1][0],
            t2_p2: match[1][1],
            score1: '',
            score2: ''
        }))
    };
}

export function getRotatingExactDesign({
    configuration,
    numRounds,
    fixtureVariant
}) {
    const baseCycle = buildCyclicCycle(configuration.numPlayers, fixtureVariant);
    if (!baseCycle) return null;
    const baseCourts = Math.floor(configuration.numPlayers / 4);
    if (baseCourts % configuration.numCourts !== 0) return null;
    const physicalCycle = rotateCycle(baseCycle, fixtureVariant).flatMap(round => {
        const chunks = [];
        for (let index = 0; index < round.length; index += configuration.numCourts) {
            chunks.push(round.slice(index, index + configuration.numCourts));
        }
        return chunks;
    });
    const schedule = Array.from({ length: numRounds }, (_, roundIndex) => {
        const cycleIndex = Math.floor(roundIndex / physicalCycle.length);
        const sourceIndex = roundIndex % physicalCycle.length;
        const source = physicalCycle[(sourceIndex + cycleIndex) % physicalCycle.length];
        const matches = cycleIndex % 2 === 0
            ? source
            : source.map(match => [match[1], match[0]]);
        return createRound(roundIndex, matches, fixtureVariant, configuration.fixtureGeneratorVersion);
    });
    const cycleStatus = numRounds < physicalCycle.length
        ? 'partial'
        : numRounds === physicalCycle.length ? 'complete' : 'extended';
    return {
        schedule,
        classification: {
            solutionClass: 'exact',
            proofStatus: 'catalog-verified',
            provenObjectives: ['partnerCoverage', 'partnerRepetitions', 'opponentBalance'],
            cycleStatus,
            fallbackUsed: false,
            variantCount: 2,
            cycleLength: physicalCycle.length
        }
    };
}

export function getOptimalKnownDesign({
    configuration,
    numRounds,
    fixtureVariant
}) {
    const key = `${configuration.numPlayers}x${configuration.numCourts}x${numRounds}`;
    const partnerships = OPTIMAL_KNOWN_PARTNERSHIPS[key];
    if (!partnerships) return null;
    const remap = playerId => fixtureVariant % 2 === 0
        ? playerId
        : configuration.numPlayers - 1 - playerId;
    const schedule = partnerships.map((round, roundIndex) => {
        const teams = round.map(team => team.map(remap));
        const matches = [];
        for (let index = 0; index < teams.length; index += 2) matches.push([teams[index], teams[index + 1]]);
        return buildRound(roundIndex, matches, fixtureVariant, configuration.fixtureGeneratorVersion);
    });
    const lowerBound = configuration.numCourts * 2 * numRounds
        - configuration.numPlayers * (configuration.numPlayers - 1) / 2;
    return {
        schedule,
        classification: {
            solutionClass: 'optimal-known',
            proofStatus: 'lower-bound-certified',
            provenObjectives: ['partnerRepetitions'],
            cycleStatus: 'complete',
            fallbackUsed: false,
            variantCount: 2,
            lowerBound,
            certificate: `partnerSlots - possiblePartners = ${lowerBound}`
        }
    };
}

export function getCatalogDescriptor(configuration, numRounds) {
    const exact = getRotatingExactDesign({ configuration, numRounds, fixtureVariant: 0 });
    if (exact) return {
        solutionClass: 'exact',
        variantCount: exact.classification.variantCount,
        cycleLength: exact.classification.cycleLength
    };
    const key = `${configuration.numPlayers}x${configuration.numCourts}x${numRounds}`;
    const lowerBounds = {
        '6x1x8': 1,
        '7x1x11': 1,
        '10x2x12': 3,
        '11x2x14': 1
    };
    return lowerBounds[key] === undefined ? null : {
        solutionClass: 'optimal-known',
        variantCount: 2,
        lowerBound: lowerBounds[key],
        provenObjectives: ['partnerRepetitions'],
        certificate: `partnerSlots - possiblePartners = ${lowerBounds[key]}`
    };
}

export function buildRound(roundIndex, matches, fixtureVariant, generatorVersion) {
    return createRound(roundIndex, matches, fixtureVariant, generatorVersion);
}
