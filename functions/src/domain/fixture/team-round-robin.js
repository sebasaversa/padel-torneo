import { buildRound } from './validated-designs.js';

function logicalRoundRobin(teams, variant) {
    const ghost = teams.length % 2 === 1 ? null : undefined;
    const ring = ghost === null ? [...teams, ghost] : [...teams];
    if (variant % 2 === 1) ring.reverse();
    const rounds = [];
    for (let roundIndex = 0; roundIndex < ring.length - 1; roundIndex += 1) {
        const matches = [];
        for (let index = 0; index < ring.length / 2; index += 1) {
            const left = ring[index];
            const right = ring[ring.length - 1 - index];
            if (left && right) matches.push([left.playerIds, right.playerIds]);
        }
        rounds.push(matches);
        ring.splice(1, 0, ring.pop());
    }
    return rounds;
}

export function getFixedRoundRobinDesign({
    configuration,
    numRounds,
    fixtureVariant
}) {
    const logical = logicalRoundRobin(configuration.fixedTeams, fixtureVariant);
    const matchesPerLogicalRound = logical[0].length;
    if (matchesPerLogicalRound % configuration.numCourts !== 0) return null;
    const physicalCycle = logical.flatMap(round => {
        const chunks = [];
        for (let index = 0; index < round.length; index += configuration.numCourts) {
            chunks.push(round.slice(index, index + configuration.numCourts));
        }
        return chunks;
    });
    const schedule = Array.from({ length: numRounds }, (_, roundIndex) => {
        const cycleIndex = Math.floor(roundIndex / physicalCycle.length);
        const source = physicalCycle[(roundIndex + cycleIndex) % physicalCycle.length];
        const matches = cycleIndex % 2 === 0 ? source : source.map(match => [match[1], match[0]]);
        return buildRound(roundIndex, matches, fixtureVariant, configuration.fixtureGeneratorVersion);
    });
    return {
        schedule,
        classification: {
            solutionClass: 'exact',
            proofStatus: 'constructor-verified',
            provenObjectives: ['teamMatchupCoverage', 'teamMatchupRepetitions'],
            cycleStatus: numRounds < physicalCycle.length
                ? 'partial'
                : numRounds === physicalCycle.length ? 'complete' : 'extended',
            fallbackUsed: false,
            variantCount: 2,
            cycleLength: physicalCycle.length
        }
    };
}
