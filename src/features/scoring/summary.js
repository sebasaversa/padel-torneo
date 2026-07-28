import { getBestStreak, getLeaderboardStats, getProgress } from './statistics.js';

export function buildTournamentSummaryText({ players, schedule, title, date }) {
    const stats = getLeaderboardStats(players, schedule);
    const progress = getProgress(schedule);
    const streak = getBestStreak(players, schedule);
    const positions = stats.slice(0, 3).map((player, index) =>
        `${['🥇', '🥈', '🥉'][index]} ${player.name}: ${player.v}V · Dif ${player.dif >= 0 ? '+' : ''}${player.dif}`
    );
    const streakText = streak.longest
        ? `🔥 Mejor racha: ${streak.players.join(', ')} (${streak.longest})`
        : '🔥 Mejor racha: todavía sin resultados';
    return [
        `🏆 ${title}`,
        date,
        `📊 ${progress.completed} de ${progress.total} partidos anotados`,
        '',
        ...positions,
        '',
        streakText
    ].filter((line, index, list) => line || (index > 0 && list[index - 1] !== '')).join('\n');
}
