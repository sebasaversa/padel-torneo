import { pairKey } from './canonical.js';
import { buildRound } from './validated-designs.js';

const DEFAULT_BUDGET = Object.freeze({
    beamWidth: 32,
    maxOperations: 400_000
});

function combinations(values, count, start = 0, prefix = [], result = []) {
    if (prefix.length === count) {
        result.push(prefix);
        return result;
    }
    for (let index = start; index <= values.length - (count - prefix.length); index += 1) {
        combinations(values, count, index + 1, [...prefix, values[index]], result);
    }
    return result;
}

function matchPartitions([a, b, c, d]) {
    return [
        [[a, b], [c, d]],
        [[a, c], [b, d]],
        [[a, d], [b, c]]
    ];
}

function increment(map, key, amount = 1) {
    map.set(key, (map.get(key) || 0) + amount);
}

function cloneCounts(source) {
    return {
        partners: new Map(source.partners),
        opponents: new Map(source.opponents),
        teamOpponents: new Map(source.teamOpponents),
        games: [...source.games],
        teamGames: [...source.teamGames],
        courts: source.courts.map(values => [...values]),
        sides: source.sides.map(values => [...values]),
        lastPlayed: [...source.lastPlayed]
    };
}

function createCounts(configuration) {
    return {
        partners: new Map(),
        opponents: new Map(),
        teamOpponents: new Map(),
        games: Array(configuration.numPlayers).fill(0),
        teamGames: Array(configuration.fixedTeams.length).fill(0),
        courts: Array.from({ length: configuration.numPlayers }, () => Array(configuration.numCourts).fill(0)),
        sides: Array.from({ length: configuration.numPlayers }, () => [0, 0]),
        lastPlayed: Array(configuration.numPlayers).fill(-1)
    };
}

function applyMatch(counts, match, court, roundIndex, teamIndexByPlayer) {
    increment(counts.partners, pairKey(...match[0]));
    increment(counts.partners, pairKey(...match[1]));
    for (const left of match[0]) for (const right of match[1]) increment(counts.opponents, pairKey(left, right));
    if (teamIndexByPlayer) {
        const leftTeam = teamIndexByPlayer.get(match[0][0]);
        const rightTeam = teamIndexByPlayer.get(match[1][0]);
        increment(counts.teamOpponents, pairKey(leftTeam, rightTeam));
        counts.teamGames[leftTeam] += 1;
        counts.teamGames[rightTeam] += 1;
    }
    match.forEach((team, side) => team.forEach(playerId => {
        counts.games[playerId] += 1;
        counts.courts[playerId][court] += 1;
        counts.sides[playerId][side] += 1;
        counts.lastPlayed[playerId] = roundIndex;
    }));
}

function seedHistory(counts, schedule, configuration) {
    const teamIndexByPlayer = configuration.pairingMode === 'fixed' ? new Map() : null;
    configuration.fixedTeams.forEach((team, teamIndex) =>
        team.playerIds.forEach(playerId => teamIndexByPlayer.set(playerId, teamIndex)));
    schedule.forEach((round, roundIndex) => round.matches.forEach((match, court) => {
        applyMatch(counts, [
            [match.t1_p1, match.t1_p2],
            [match.t2_p1, match.t2_p2]
        ], court, roundIndex, teamIndexByPlayer);
    }));
    return teamIndexByPlayer;
}

function compareTuple(left, right) {
    for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
        if ((left[index] || 0) !== (right[index] || 0)) return (left[index] || 0) - (right[index] || 0);
    }
    return 0;
}

function permutations(values) {
    if (values.length <= 1) return [values];
    return values.flatMap((value, index) =>
        permutations(values.filter((_, candidateIndex) => candidateIndex !== index))
            .map(rest => [value, ...rest]));
}

function candidateCost(counts, match, court, mode, teamIndexByPlayer, variant) {
    const partnerValues = match.map(team => counts.partners.get(pairKey(...team)) || 0);
    const opponentValues = match[0].flatMap(left => match[1].map(right => counts.opponents.get(pairKey(left, right)) || 0));
    const teamValue = teamIndexByPlayer
        ? counts.teamOpponents.get(pairKey(teamIndexByPlayer.get(match[0][0]), teamIndexByPlayer.get(match[1][0]))) || 0
        : 0;
    const players = match.flat();
    const courtLoad = players.reduce((total, playerId) => total + counts.courts[playerId][court], 0);
    const sideSpread = Math.abs(
        match[0].reduce((total, id) => total + counts.sides[id][0], 0)
        - match[1].reduce((total, id) => total + counts.sides[id][1], 0)
    );
    const stable = players.reduce((value, id, index) => value + id * (17 ** (3 - index)), variant);
    return mode === 'fixed'
        ? [teamValue > 0 ? 1 : 0, teamValue, Math.max(...opponentValues), opponentValues.reduce((a, b) => a + b, 0), courtLoad, sideSpread, stable]
        : [partnerValues.filter(Boolean).length, Math.max(...partnerValues), partnerValues.reduce((a, b) => a + b, 0),
            Math.max(...opponentValues), opponentValues.reduce((a, b) => a + b, 0), courtLoad, sideSpread, stable];
}

function improveCourtAndSides({
    matches,
    counts,
    configuration,
    roundIndex,
    variant,
    teamIndexByPlayer,
    budget,
    operations
}) {
    let best = matches;
    let bestCost = null;
    for (const ordered of permutations(matches)) {
        for (let sideMask = 0; sideMask < 2 ** ordered.length; sideMask += 1) {
            const candidateCounts = cloneCounts(counts);
            const candidate = ordered.map((match, court) => {
                const oriented = sideMask & (1 << court) ? [match[1], match[0]] : match;
                return oriented.map(team => [...team]);
            });
            const cost = [];
            for (let court = 0; court < candidate.length; court += 1) {
                operations.value += 1;
                if (operations.value > budget.maxOperations) return best;
                cost.push(...candidateCost(
                    candidateCounts,
                    candidate[court],
                    court,
                    configuration.pairingMode,
                    teamIndexByPlayer,
                    variant
                ));
                applyMatch(candidateCounts, candidate[court], court, roundIndex, teamIndexByPlayer);
            }
            if (bestCost === null || compareTuple(cost, bestCost) < 0) {
                best = candidate;
                bestCost = cost;
            }
        }
    }
    return best;
}

function chooseRotatingActive(counts, configuration, roundIndex, variant) {
    return Array.from({ length: configuration.numPlayers }, (_, id) => id)
        .sort((left, right) =>
            counts.games[left] - counts.games[right]
            || counts.lastPlayed[left] - counts.lastPlayed[right]
            || ((left + variant + roundIndex) % configuration.numPlayers)
                - ((right + variant + roundIndex) % configuration.numPlayers))
        .slice(0, configuration.numCourts * 4);
}

function chooseFixedActive(counts, configuration, roundIndex, variant) {
    return configuration.fixedTeams.map((team, teamIndex) => ({ team, teamIndex }))
        .sort((left, right) =>
            counts.teamGames[left.teamIndex] - counts.teamGames[right.teamIndex]
            || ((left.teamIndex + variant + roundIndex) % configuration.fixedTeams.length)
                - ((right.teamIndex + variant + roundIndex) % configuration.fixedTeams.length))
        .slice(0, configuration.numCourts * 2);
}

function safeRotatingMatches(active, numCourts, variant) {
    const ordered = [...active].sort((a, b) => a - b);
    if (variant % 2 === 1) ordered.reverse();
    return Array.from({ length: numCourts }, (_, court) => {
        const players = ordered.slice(court * 4, court * 4 + 4);
        return matchPartitions(players)[variant % 3];
    });
}

function safeFixedMatches(activeTeams, numCourts, variant) {
    const ordered = [...activeTeams];
    if (variant % 2 === 1) ordered.reverse();
    return Array.from({ length: numCourts }, (_, court) => [
        ordered[court * 2].team.playerIds,
        ordered[court * 2 + 1].team.playerIds
    ]);
}

function buildRotatingRound({ active, counts, configuration, roundIndex, variant, budget, operations }) {
    let beam = [{ used: new Set(), matches: [], cost: [], counts: cloneCounts(counts) }];
    for (let court = 0; court < configuration.numCourts; court += 1) {
        const next = [];
        for (const state of beam) {
            const available = active.filter(id => !state.used.has(id));
            for (const group of combinations(available, 4)) {
                for (const match of matchPartitions(group)) {
                    operations.value += 1;
                    if (operations.value > budget.maxOperations) return null;
                    const cost = candidateCost(state.counts, match, court, 'rotating', null, variant);
                    const nextCounts = cloneCounts(state.counts);
                    applyMatch(nextCounts, match, court, roundIndex, null);
                    next.push({
                        used: new Set([...state.used, ...group]),
                        matches: [...state.matches, match],
                        cost: [...state.cost, ...cost],
                        counts: nextCounts
                    });
                }
            }
        }
        next.sort((left, right) => compareTuple(left.cost, right.cost));
        beam = next.slice(0, budget.beamWidth);
    }
    return beam[0];
}

function buildFixedRound({ active, counts, configuration, roundIndex, variant, budget, operations, teamIndexByPlayer }) {
    let beam = [{ used: new Set(), matches: [], cost: [], counts: cloneCounts(counts) }];
    for (let court = 0; court < configuration.numCourts; court += 1) {
        const next = [];
        for (const state of beam) {
            const available = active.filter(item => !state.used.has(item.teamIndex));
            for (const pair of combinations(available, 2)) {
                const match = [pair[0].team.playerIds, pair[1].team.playerIds];
                operations.value += 1;
                if (operations.value > budget.maxOperations) return null;
                const cost = candidateCost(state.counts, match, court, 'fixed', teamIndexByPlayer, variant);
                const nextCounts = cloneCounts(state.counts);
                applyMatch(nextCounts, match, court, roundIndex, teamIndexByPlayer);
                next.push({
                    used: new Set([...state.used, pair[0].teamIndex, pair[1].teamIndex]),
                    matches: [...state.matches, match],
                    cost: [...state.cost, ...cost],
                    counts: nextCounts
                });
            }
        }
        next.sort((left, right) => compareTuple(left.cost, right.cost));
        beam = next.slice(0, budget.beamWidth);
    }
    return beam[0];
}

export function optimizeSchedule({
    configuration,
    numRounds,
    fixtureVariant,
    immutableHistory = [],
    budget = DEFAULT_BUDGET
}) {
    const counts = createCounts(configuration);
    const teamIndexByPlayer = seedHistory(counts, immutableHistory, configuration);
    const schedule = [...immutableHistory.map(round => structuredClone(round))];
    const operations = { value: 0 };
    let fallbackUsed = false;
    for (let roundIndex = schedule.length; roundIndex < numRounds; roundIndex += 1) {
        if (configuration.pairingMode === 'fixed') {
            const active = chooseFixedActive(counts, configuration, roundIndex, fixtureVariant);
            const candidate = buildFixedRound({
                active,
                counts,
                configuration,
                roundIndex,
                variant: fixtureVariant,
                budget,
                operations,
                teamIndexByPlayer
            });
            const initialMatches = candidate?.matches
                || safeFixedMatches(active, configuration.numCourts, fixtureVariant + roundIndex);
            if (!candidate) fallbackUsed = true;
            const matches = candidate ? improveCourtAndSides({
                matches: initialMatches,
                counts,
                configuration,
                roundIndex,
                variant: fixtureVariant,
                teamIndexByPlayer,
                budget,
                operations
            }) : initialMatches;
            matches.forEach((match, court) => applyMatch(counts, match, court, roundIndex, teamIndexByPlayer));
            schedule.push(buildRound(roundIndex, matches, fixtureVariant, configuration.fixtureGeneratorVersion));
        } else {
            const active = chooseRotatingActive(counts, configuration, roundIndex, fixtureVariant);
            const candidate = buildRotatingRound({
                active,
                counts,
                configuration,
                roundIndex,
                variant: fixtureVariant,
                budget,
                operations
            });
            const initialMatches = candidate?.matches
                || safeRotatingMatches(active, configuration.numCourts, fixtureVariant + roundIndex);
            if (!candidate) fallbackUsed = true;
            const matches = candidate ? improveCourtAndSides({
                matches: initialMatches,
                counts,
                configuration,
                roundIndex,
                variant: fixtureVariant,
                teamIndexByPlayer: null,
                budget,
                operations
            }) : initialMatches;
            matches.forEach((match, court) => applyMatch(counts, match, court, roundIndex, null));
            schedule.push(buildRound(roundIndex, matches, fixtureVariant, configuration.fixtureGeneratorVersion));
        }
    }
    return {
        schedule,
        classification: {
            solutionClass: 'optimized',
            proofStatus: 'heuristic-only',
            provenObjectives: [],
            cycleStatus: 'not-applicable',
            fallbackUsed,
            variantCount: 8,
            operations: operations.value,
            budget
        }
    };
}

export const OPTIMIZER_BUDGET_V1 = DEFAULT_BUDGET;
