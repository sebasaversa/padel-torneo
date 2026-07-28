export function renderTournamentToolbar({ tournamentId, tournamentName, tournamentDate, formattedDate, numPlayers, gamesPerSet, scheduleLength, courts, rest, plannedRounds, availableCourts }) {
    const title = document.getElementById('tournament-title');
    const date = document.getElementById('tournament-date');
    const createButton = document.getElementById('create-shared-button');
    const historyButton = document.getElementById('history-button');
    const isShared = Boolean(tournamentId);
    createButton.disabled = isShared;
    createButton.textContent = isShared ? '☁️ Torneo compartido activo' : '☁️ Crear torneo compartido';
    createButton.title = isShared ? 'Ya estás dentro de un torneo compartido' : '';
    if (historyButton) historyButton.hidden = isShared;
    if (isShared) {
        const visibleName = tournamentName || 'Torneo compartido';
        title.textContent = `🏆 ${visibleName}`;
        date.textContent = tournamentDate ? `Torneo compartido · ${formattedDate}` : 'Torneo compartido';
        date.hidden = false;
        document.title = `${visibleName} · Torneo Americano Pádel`;
    } else {
        title.textContent = '🏆 Torneo Americano Pádel';
        date.hidden = true;
        document.title = 'Torneo Americano Pádel';
    }
    const restText = rest === 0 ? 'todos juegan' : `${rest} descansa${rest > 1 ? 'n' : ''} por ronda`;
    document.getElementById('subtitle').textContent = `${numPlayers} jugadores · ${courts} cancha${courts > 1 ? 's' : ''} · ${scheduleLength} rondas · ${restText} · Sets a ${gamesPerSet} games`;
    document.getElementById('count-hint').textContent = `${courts} cancha${courts > 1 ? 's' : ''} · ${restText}`;
    document.getElementById('round-count').value = scheduleLength;
    document.getElementById('round-count-hint').textContent = scheduleLength > plannedRounds
        ? `${scheduleLength - plannedRounds} ronda${scheduleLength - plannedRounds === 1 ? '' : 's'} extra agregada${scheduleLength - plannedRounds === 1 ? '' : 's'}`
        : 'Cantidad de rondas independiente de los jugadores';
    const courtCount = document.getElementById('court-count');
    courtCount.value = courts;
    courtCount.querySelector('option[value="2"]').disabled = availableCourts < 2;
    document.getElementById('court-count-hint').textContent = availableCourts < 2
        ? 'Con esta cantidad de jugadores se puede usar 1 cancha.'
        : 'Elegí cuántas canchas se usan en simultáneo.';
    document.getElementById('matches-title').textContent = `3. Partidos (a ${gamesPerSet} games)`;
}
