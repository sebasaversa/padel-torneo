function getActivePlayers(numPlayers, playingCount, roundIndex) {
    return Array.from({ length: playingCount }, (_, index) => (roundIndex + index) % numPlayers);
}

function pairFour(active, roundIndex) {
    const pairings = [
        { t1: [0, 1], t2: [2, 3] },
        { t1: [0, 2], t2: [1, 3] },
        { t1: [0, 3], t2: [1, 2] }
    ];
    const pairing = pairings[roundIndex % pairings.length];
    return [{
        court: 1,
        t1_p1: active[pairing.t1[0]], t1_p2: active[pairing.t1[1]],
        t2_p1: active[pairing.t2[0]], t2_p2: active[pairing.t2[1]],
        score1: '', score2: ''
    }];
}

function pairEight(active) {
    return [
        {
            court: 1,
            t1_p1: active[0], t1_p2: active[7],
            t2_p1: active[3], t2_p2: active[4],
            score1: '', score2: ''
        },
        {
            court: 2,
            t1_p1: active[1], t1_p2: active[6],
            t2_p1: active[2], t2_p2: active[5],
            score1: '', score2: ''
        }
    ];
}

export function getCourts(numPlayers, maxCourts = 2) {
    return Math.min(maxCourts, Math.floor(numPlayers / 4));
}

export function getPlayingCount(numPlayers, maxCourts = 2) {
    return getCourts(numPlayers, maxCourts) * 4;
}

export function getRestCount(numPlayers, maxCourts = 2) {
    return numPlayers - getPlayingCount(numPlayers, maxCourts);
}

export function getNumRounds(numPlayers, maxCourts = 2) {
    const rest = getRestCount(numPlayers, maxCourts);
    if (rest > 0) return numPlayers;
    if (numPlayers === 4) return 3;
    return Math.max(numPlayers - 1, 3);
}

export function createAutomaticRound(numPlayers, roundIndex, maxCourts = 2) {
    if (numPlayers === 9) {
        return {
            id: roundIndex,
            matches: [
                {
                    court: 1,
                    t1_p1: roundIndex % 9, t1_p2: (7 + roundIndex) % 9,
                    t2_p1: (3 + roundIndex) % 9, t2_p2: (4 + roundIndex) % 9,
                    score1: '', score2: ''
                },
                {
                    court: 2,
                    t1_p1: (1 + roundIndex) % 9, t1_p2: (6 + roundIndex) % 9,
                    t2_p1: (2 + roundIndex) % 9, t2_p2: (5 + roundIndex) % 9,
                    score1: '', score2: ''
                }
            ]
        };
    }

    const playingCount = getPlayingCount(numPlayers, maxCourts);
    const active = getActivePlayers(numPlayers, playingCount, roundIndex);
    const matches = playingCount >= 8
        ? pairEight(active)
        : playingCount >= 4
            ? pairFour(active, roundIndex)
            : [];
    return { id: roundIndex, matches };
}

export function generateSchedule(numPlayers, roundCount = getNumRounds(numPlayers), {
    minRounds = 1,
    maxRounds = 50,
    maxCourts = 2
} = {}) {
    const rounds = Math.max(minRounds, Math.min(maxRounds, roundCount));
    return Array.from({ length: rounds }, (_, roundIndex) =>
        createAutomaticRound(numPlayers, roundIndex, maxCourts));
}
