function buildPlayerSelect(players, playerIndex, roundIndex, matchIndex, role, disabled) {
    const options = players.map((player, index) =>
        `<option value="${index}" ${index === playerIndex ? 'selected' : ''}>${player}</option>`
    ).join('');
    return `<select data-player-select data-round="${roundIndex}" data-match="${matchIndex}" data-role="${role}" ${disabled ? 'disabled' : ''}>${options}</select>`;
}

export function renderRoundCards(container, {
    schedule, players, gamesPerSet, collapsedRounds,
    getRestingPlayers, isMatchDone, isRoundDone, getScoreWarning,
    onToggleRound, onUpdatePlayer, onAdjustScore, onUpdateScore, canEditMatch = () => true
}) {
    container.innerHTML = schedule.map((round, roundIndex) => {
        const done = isRoundDone(round);
        const collapsed = collapsedRounds[roundIndex] === true;
        const resting = getRestingPlayers(round);
        const restLabel = resting.length === 0 ? 'Todos juegan'
            : resting.length === 1 ? `Descansa: ${resting[0]}`
                : `Descansan: ${resting.join(', ')}`;
        const matches = round.matches.map((match, matchIndex) => {
            const editable = canEditMatch(match);
            const matchDone = isMatchDone(match);
            const warning = getScoreWarning(match, gamesPerSet);
            const scoreControl = (team, label) => `
                <div class="score-control ${team === 'score1' ? 'team-one' : 'team-two'}">
                    <button type="button" class="score-adjust" aria-label="Bajar puntaje del ${label} equipo en cancha ${match.court}"
                        data-score-adjust data-round="${roundIndex}" data-match="${matchIndex}" data-team="${team}" data-amount="-1" ${editable ? '' : 'disabled'}>−</button>
                    <input type="number" min="0" max="${gamesPerSet}" class="score-input" placeholder="0" value="${match[team]}" inputmode="numeric"
                        data-score-input data-round="${roundIndex}" data-match="${matchIndex}" data-team="${team}" ${editable ? '' : 'disabled'}>
                    <button type="button" class="score-adjust" aria-label="Subir puntaje del ${label} equipo en cancha ${match.court}"
                        data-score-adjust data-round="${roundIndex}" data-match="${matchIndex}" data-team="${team}" data-amount="1" ${editable ? '' : 'disabled'}>+</button>
                </div>`;
            return `<div class="match ${matchDone ? 'match-done' : ''}">
                <div class="court-title">📍 Cancha ${match.court}</div>
                <div class="team team-one"><div class="team-pair">
                    ${buildPlayerSelect(players, match.t1_p1, roundIndex, matchIndex, 't1_p1', !editable)}
                    ${buildPlayerSelect(players, match.t1_p2, roundIndex, matchIndex, 't1_p2', !editable)}
                </div></div>
                <div class="vs">CONTRA</div>
                <div class="team team-two"><div class="team-pair">
                    ${buildPlayerSelect(players, match.t2_p1, roundIndex, matchIndex, 't2_p1', !editable)}
                    ${buildPlayerSelect(players, match.t2_p2, roundIndex, matchIndex, 't2_p2', !editable)}
                </div></div>
                <div class="score-row">${scoreControl('score1', 'primer')}<span class="score-sep">—</span>${scoreControl('score2', 'segundo')}</div>
                ${warning ? `<div class="score-warning">⚠️ ${warning}</div>` : ''}
            </div>`;
        }).join('');
        return `<div class="card round-card ${done ? 'round-done' : ''}">
            <div class="round-header" data-toggle-round data-round="${roundIndex}"><h3>Ronda ${roundIndex + 1}</h3><span class="chevron">${collapsed ? '▶ Mostrar' : '▼ Ocultar'}</span></div>
            <div class="round-body ${collapsed ? 'collapsed' : ''}"><div class="rest-badge">💤 ${restLabel}</div>${matches}</div>
        </div>`;
    }).join('');

    container.querySelectorAll('[data-toggle-round]').forEach(element => element.addEventListener('click', () => onToggleRound(Number(element.dataset.round))));
    container.querySelectorAll('[data-player-select]').forEach(element => element.addEventListener('change', event => onUpdatePlayer(Number(element.dataset.round), Number(element.dataset.match), element.dataset.role, event.target.value)));
    container.querySelectorAll('[data-score-adjust]').forEach(element => element.addEventListener('click', () => onAdjustScore(Number(element.dataset.round), Number(element.dataset.match), element.dataset.team, Number(element.dataset.amount))));
    container.querySelectorAll('[data-score-input]').forEach(element => element.addEventListener('change', event => onUpdateScore(Number(element.dataset.round), Number(element.dataset.match), element.dataset.team, event.target.value)));
}
