import { isMatchDone } from './validation.js';

export function getLeaderboardStats(players, schedule) {
    const stats = players.map((name, id) => ({
        id, name, v: 0, d: 0, gf: 0, gc: 0, dif: 0, played: 0
    }));

    schedule.forEach(round => {
        round.matches.forEach(match => {
            if (!isMatchDone(match)) return;
            const score1 = parseInt(match.score1, 10);
            const score2 = parseInt(match.score2, 10);
            const team1 = [match.t1_p1, match.t1_p2];
            const team2 = [match.t2_p1, match.t2_p2];

            team1.forEach(player => {
                if (!Number.isInteger(player) || player < 0 || player >= stats.length) return;
                stats[player].played += 1;
                stats[player].gf += score1;
                stats[player].gc += score2;
                if (score1 > score2) stats[player].v += 1;
                if (score1 < score2) stats[player].d += 1;
            });
            team2.forEach(player => {
                if (!Number.isInteger(player) || player < 0 || player >= stats.length) return;
                stats[player].played += 1;
                stats[player].gf += score2;
                stats[player].gc += score1;
                if (score2 > score1) stats[player].v += 1;
                if (score2 < score1) stats[player].d += 1;
            });
        });
    });

    stats.forEach(stat => { stat.dif = stat.gf - stat.gc; });
    return stats.sort((a, b) => {
        if (b.v !== a.v) return b.v - a.v;
        if (b.dif !== a.dif) return b.dif - a.dif;
        return b.gf - a.gf;
    });
}

export function getBestStreak(players, schedule) {
    const current = Array(players.length).fill(0);
    const best = Array(players.length).fill(0);
    schedule.forEach(round => round.matches.forEach(match => {
        if (!isMatchDone(match)) return;
        const score1 = parseInt(match.score1, 10);
        const score2 = parseInt(match.score2, 10);
        const team1 = [match.t1_p1, match.t1_p2];
        const team2 = [match.t2_p1, match.t2_p2];
        if (score1 === score2) {
            [...team1, ...team2].forEach(player => { current[player] = 0; });
            return;
        }
        const winners = score1 > score2 ? team1 : team2;
        const losers = score1 > score2 ? team2 : team1;
        winners.forEach(player => {
            current[player] += 1;
            best[player] = Math.max(best[player], current[player]);
        });
        losers.forEach(player => { current[player] = 0; });
    }));
    const longest = Math.max(...best, 0);
    return {
        longest,
        players: longest ? best.map((streak, index) => streak === longest ? players[index] : null).filter(Boolean) : []
    };
}

export function getProgress(schedule) {
    const total = schedule.reduce((count, round) => count + round.matches.length, 0);
    const completed = schedule.reduce((count, round) =>
        count + round.matches.filter(isMatchDone).length, 0);
    return { completed, total, percentage: total ? Math.round((completed / total) * 100) : 0 };
}
