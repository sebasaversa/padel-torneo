export function bindStaticUIEvents(actions) {
    const click = (id, handler) => document.getElementById(id)?.addEventListener('click', handler);
    click('create-shared-button', () => actions.createSharedTournament());
    click('history-button', actions.showTournamentHistory);
    click('back-to-main-button', actions.showMainPage);
    click('auth-button', actions.openAuthModal);
    click('sign-out-button', actions.signOut);
    click('users-button', actions.openUsersModal);
    click('tournament-admin-button', actions.openTournamentAdminModal);
    click('cancel-delete-tournament-button', actions.closeDeleteTournamentModal);
    click('confirm-delete-tournament-button', actions.confirmDeleteTournament);
    click('select-all-tournaments-button', actions.selectAllTournamentsForDeletion);
    click('clear-tournament-selection-button', actions.clearTournamentDeletionSelection);
    click('delete-selected-tournaments-button', actions.requestDeleteSelectedTournaments);
    click('close-tournament-admin-modal', actions.closeTournamentAdminModal);
    click('close-users-modal', actions.closeUsersModal);
    click('cancel-admin-edit-button', actions.cancelAdminEdit);
    click('sign-in-google-button', actions.signInWithGoogle);
    click('sign-in-email-button', actions.signInWithEmailAndPassword);
    click('reset-password-button', actions.sendPasswordReset);
    click('close-auth-modal', actions.closeAuthModal);
    click('home-button', actions.goHome);
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
        const restore = event.target.closest('[data-restore-tournament]');
        if (restore) actions.restoreTournament(restore.dataset.restoreTournament);
        const remove = event.target.closest('[data-delete-tournament]');
        if (remove) actions.requestDeleteTournament(remove.dataset.deleteTournament);
    });
    document.getElementById('tournament-history-list')?.addEventListener('change', event => {
        const selection = event.target.closest('[data-select-tournament]');
        if (selection) actions.toggleTournamentDeletionSelection(selection.dataset.selectTournament, selection.checked);
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
    document.getElementById('auth-password-input')?.addEventListener('keydown', event => {
        if (event.key === 'Enter') actions.signInWithEmailAndPassword();
    });
    document.getElementById('admin-user-form')?.addEventListener('submit', event => {
        event.preventDefault();
        actions.createAdminUser();
    });
    document.getElementById('admin-users-list')?.addEventListener('click', event => {
        const button = event.target.closest('[data-delete-admin]');
        if (button) actions.deleteAdminUser(button.dataset.deleteAdmin);
        const edit = event.target.closest('[data-edit-admin]');
        if (edit) actions.startAdminEdit(edit.dataset.editAdmin);
        const toggle = event.target.closest('[data-toggle-admin]');
        if (toggle) actions.toggleAdminUser(toggle.dataset.toggleAdmin);
        const reset = event.target.closest('[data-reset-admin]');
        if (reset) actions.generateAdminPasswordResetLink(reset.dataset.resetAdmin);
    });
    document.getElementById('tournament-admin-list')?.addEventListener('change', event => {
        if (event.target.matches('[data-tournament-admin]')) actions.setTournamentAdmin(event.target.dataset.tournamentAdmin, event.target.checked);
    });
}
