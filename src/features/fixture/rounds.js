export function hasResults(rounds, isMatchDone) {
    return rounds.some(round => round.matches.some(isMatchDone));
}

export function resizeRounds({ schedule, collapsedRounds, targetCount, createRound }) {
    if (targetCount === schedule.length) {
        return { schedule, collapsedRounds };
    }

    if (targetCount < schedule.length) {
        return {
            schedule: schedule.slice(0, targetCount),
            collapsedRounds: Object.fromEntries(
                Object.entries(collapsedRounds).filter(([index]) => Number(index) < targetCount)
            )
        };
    }

    const nextSchedule = [...schedule];
    const nextCollapsedRounds = { ...collapsedRounds };
    for (let roundIndex = schedule.length; roundIndex < targetCount; roundIndex++) {
        nextSchedule.push(createRound(roundIndex));
        nextCollapsedRounds[roundIndex] = false;
    }
    return { schedule: nextSchedule, collapsedRounds: nextCollapsedRounds };
}
