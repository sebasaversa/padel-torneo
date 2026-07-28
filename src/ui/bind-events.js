export function bindStaticUIEvents(actions) {
    const click = (id, handler) => document.getElementById(id)?.addEventListener('click', handler);
    click('create-shared-button', () => actions.createSharedTournament());
    click('share-button', actions.shareState);
    click('undo-button', actions.undoLastChange);
    click('summary-button', actions.openSummaryModal);
    click('activity-button', actions.openActivityModal);
    click('export-button', actions.exportJSON);
    click('import-button', actions.importJSON);
    click('reset-schedule-button', actions.resetSchedule);
    click('reset-all-button', actions.resetAll);
    click('player-count-decrease', () => actions.changePlayerCount(-1));
    click('player-count-increase', () => actions.changePlayerCount(1));
    click('round-count-decrease', () => actions.changeRoundCount(-1));
    click('round-count-increase', () => actions.changeRoundCount(1));
    click('games-decrease', () => actions.changeGamesPerSet(-1));
    click('games-increase', () => actions.changeGamesPerSet(1));
    click('cancel-tournament-name', actions.cancelTournamentName);
    click('confirm-tournament-name', actions.confirmTournamentName);
    click('confirm-player-change-future', () => actions.confirmPlayerChange('future'));
    click('confirm-player-change-single', () => actions.confirmPlayerChange('single'));
    click('cancel-player-change', actions.cancelPlayerChange);
    click('close-summary', actions.closeSummaryModal);
    click('copy-summary', actions.copyTournamentSummary);
    click('share-summary', actions.shareTournamentSummary);
    click('identity-continue-button', actions.continueIdentitySelection);
    click('spectator-button', actions.enterAsSpectator);
    click('identity-choose-other', actions.showIdentityChoice);
    click('identity-confirm-button', actions.confirmIdentitySelection);
    click('close-activity', actions.closeActivityModal);
    document.getElementById('tournament-history-list')?.addEventListener('click', event => {
        const button = event.target.closest('[data-open-tournament]');
        if (button) actions.openPreviousTournament(button.dataset.openTournament);
    });
    document.getElementById('player-count')?.addEventListener('change', event => actions.setPlayerCount(parseInt(event.target.value, 10)));
    document.getElementById('round-count')?.addEventListener('change', event => actions.setRoundCount(parseInt(event.target.value, 10)));
    document.getElementById('round-count')?.addEventListener('keydown', event => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        actions.setRoundCount(parseInt(event.target.value, 10));
        event.target.blur();
    });
    document.getElementById('court-count')?.addEventListener('change', event => actions.setCourtCount(parseInt(event.target.value, 10)));
    document.getElementById('games-per-set')?.addEventListener('input', event => actions.setGamesPerSet(parseInt(event.target.value, 10)));
    document.getElementById('tournament-name-input')?.addEventListener('keydown', event => {
        if (event.key === 'Enter') actions.confirmTournamentName();
        if (event.key === 'Escape') actions.cancelTournamentName();
    });
}
