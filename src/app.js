import { createStateStore, createTournamentState } from './state/store.js';
import {
    createDefaultState,
    createDefaultConfiguration,
    hasAnyScore,
    normalizeState,
    withGeneratedFixture
} from './state/model.js';
import { createLocalStorageStore } from './services/local-storage.js';
import { createTournamentHistoryStore } from './services/tournament-history.js';
import { filterTournamentCatalog, loadTournamentCatalog } from './services/tournament-catalog.js';
import {
    generateSchedule as buildSchedule,
    getCourts,
    getPlayingCount,
    getRestCount,
    recommendNumRounds
} from './features/fixture/generator.js';
import { createFixtureGeneratorWorker } from './features/fixture/worker-client.js';
import { scheduleFingerprint } from './features/fixture/canonical.js';
import {
    applySingleRoundPlayerChange
} from './features/fixture/player-swaps.js';
import { adjustScore as getAdjustedScore, normalizeScore } from './features/scoring/scores.js';
import { getScoreWarning, isMatchDone, isRoundDone } from './features/scoring/validation.js';
import { getBestStreak, getLeaderboardStats, getProgress } from './features/scoring/statistics.js';
import { buildTournamentSummaryText } from './features/scoring/summary.js';
import { createFirebaseClient } from './services/firebase.js';
import { createAuthSession } from './services/auth-session.js';
import { createAdminUserApi } from './services/admin-user-api.js';
import { createTournamentSync } from './services/tournament-sync.js';
import { formatPresenceRole, summarizePresence } from './services/presence.js';
import { createActivityLog } from './services/activity.js';
import {
    createSharedTournamentUrl,
    createStandaloneShareUrl,
    decodeState,
    exportStateJSON,
    importStateJSON
} from './services/sharing.js';
import { renderPlayerList } from './ui/components/player-list.js';
import { renderLeaderboard } from './ui/components/leaderboard.js';
import { renderRoundCards } from './ui/components/round-card.js';
import { renderTournamentToolbar } from './ui/components/toolbar.js';
import { renderTournamentHistory } from './ui/components/tournament-history.js';
import { renderSummaryModal, setModalOpen } from './ui/components/modal.js';
import { bindStaticUIEvents } from './ui/bind-events.js';
import { createAppController } from './app/app-controller.js';

    const MIN_PLAYERS = 4;
    const MAX_PLAYERS = 16;
    const UI_MAX_COURTS = 2;
    const MIN_GAMES_PER_SET = 1;
    const MAX_GAMES_PER_SET = 20;
    const MIN_ROUNDS = 1;
    const MAX_ROUNDS = 100;

    const initialState = createDefaultState();
    const tournamentState = createTournamentState(initialState);
    let resolveTournamentName = null;
    let resolvePlayerChange = null;
    const MAX_UNDO_STEPS = 20;
    const localStateStore = createLocalStorageStore('padel-torneo');
    const tournamentHistoryStore = createTournamentHistoryStore(createLocalStorageStore('padel-torneo-history'));
    const firebaseConfig = {
        apiKey: 'AIzaSyAEWG54OzZ7QMHb6otPJTLwuE8ttbBNnPc',
        authDomain: 'padel-torneo-ec30a.firebaseapp.com',
        databaseURL: 'https://padel-torneo-ec30a-default-rtdb.firebaseio.com',
        projectId: 'padel-torneo-ec30a',
        storageBucket: 'padel-torneo-ec30a.firebasestorage.app',
        messagingSenderId: '721713590787',
        appId: '1:721713590787:web:3df62ebcfc8841e41c5436'
    };
    const firebaseClient = createFirebaseClient({ firebase, config: firebaseConfig });
    const authSession = createAuthSession({ firebase, auth: firebaseClient.getAuth() });
    const adminUserApi = createAdminUserApi({ callFunction: (...args) => firebaseClient.callFunction(...args) });
    let tournamentId = new URLSearchParams(location.search).get('torneo');
    let invitationToken = new URLSearchParams(location.search).get('invitacion') || '';
    let realtimeDb = null;
    let tournamentRef = null;
    let tournamentSync = null;
    let tournamentIdentity = null;
    let actorPlayerId = null;
    let pendingActorPlayerId = null;
    let activityLog = null;
    let claimedPlayers = {};
    let identityPromptShown = false;
    let claimsLoaded = false;
    let sharedStateLoaded = false;
    let historyRecordedForTournament = false;
    let sharedTournamentCatalog = [];
    let sessionUser = authSession.currentUser();
    let sessionRole = null;
    let tournamentAccessRole = null;
    let generatingFixture = false;
    let fixtureGenerationRevision = 0;
    let bootstrapAttemptUid = null;
    let bootstrapAttemptPromise = null;
    let adminUsers = [];
    let editingAdminUid = null;
    let pendingTournamentDeletion = null;
    let pendingTournamentDeletionMode = 'logical';
    let selectedTournamentDeletionIds = new Set();
    const presenceId = (() => {
        const key = 'padel-torneo-device-id';
        const generatedId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`).replace(/-/g, '');
        try {
            let id = localStorage.getItem(key);
            if (!id) {
                id = generatedId();
                localStorage.setItem(key, id);
            }
            return id;
        } catch (error) {
            return generatedId();
        }
    })();
    const fixtureGeneratorWorker = createFixtureGeneratorWorker({
        onProgress(progress) {
            if (generatingFixture) setSyncStatus(`Generando fixture… ${Math.round(progress * 100)}%`);
        }
    });

    function defaultPlayers(n) {
        return Array.from({ length: n }, (_, index) => `Jugador ${index + 1}`);
    }

    function currentConfiguration() {
        return createDefaultConfiguration({
            numPlayers: tournamentState.value.numPlayers,
            numCourts: tournamentState.value.numCourts,
            pairingMode: tournamentState.value.pairingMode,
            fixedTeams: tournamentState.value.fixedTeams
        });
    }

    function getNumRounds() {
        return recommendNumRounds(currentConfiguration());
    }

    function generateSchedule(roundCount = getNumRounds(), fixtureVariant = tournamentState.value.fixtureVariant || 0) {
        const generated = buildSchedule({
            configuration: currentConfiguration(),
            numRounds: Math.max(MIN_ROUNDS, Math.min(MAX_ROUNDS, roundCount)),
            fixtureVariant,
            generationContext: { type: 'fresh' }
        });
        const next = withGeneratedFixture(tournamentState.snapshot(), generated);
        tournamentState.replace(next);
        return generated;
    }

    async function generateScheduleWithoutBlocking(
        roundCount = getNumRounds(),
        fixtureVariant = tournamentState.value.fixtureVariant || 0
    ) {
        const requestRevision = ++fixtureGenerationRevision;
        generatingFixture = true;
        renderAuthStatus();
        setSyncStatus('Generando fixture…');
        try {
            const generated = await fixtureGeneratorWorker.generate({
                configuration: currentConfiguration(),
                numRounds: roundCount,
                fixtureVariant,
                generationContext: { type: 'fresh' }
            });
            if (requestRevision !== fixtureGenerationRevision) {
                throw Object.assign(new Error('La respuesta del Worker quedó obsoleta.'), {
                    code: 'GENERATION_STALE'
                });
            }
            tournamentState.replace(withGeneratedFixture(tournamentState.snapshot(), generated));
            return generated;
        } finally {
            if (requestRevision === fixtureGenerationRevision) {
                generatingFixture = false;
                renderAuthStatus();
                if (!tournamentId) setSyncStatus('Guardado en este dispositivo');
            }
        }
    }

    async function extendScheduleWithoutBlocking(targetCount) {
        const requestRevision = ++fixtureGenerationRevision;
        generatingFixture = true;
        renderAuthStatus();
        setSyncStatus('Generando fixture…');
        try {
            const extended = await fixtureGeneratorWorker.extend({
                immutableHistory: tournamentState.value.schedule,
                targetCount,
                configuration: currentConfiguration(),
                fixtureVariant: tournamentState.value.fixtureVariant,
                sourceRevision: tournamentState.value.revision,
                sourceScheduleRevision: tournamentState.value.scheduleRevision
            });
            if (requestRevision !== fixtureGenerationRevision) {
                throw Object.assign(new Error('La respuesta del Worker quedó obsoleta.'), {
                    code: 'GENERATION_STALE'
                });
            }
            return extended;
        } finally {
            if (requestRevision === fixtureGenerationRevision) {
                generatingFixture = false;
                renderAuthStatus();
                if (!tournamentId) setSyncStatus('Guardado en este dispositivo');
            }
        }
    }

    function getTodayISODate() {
        const today = new Date();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');
        return `${today.getFullYear()}-${month}-${day}`;
    }

    function formatTournamentDate(date) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
        const [year, month, day] = date.split('-').map(Number);
        return new Intl.DateTimeFormat('es-AR', {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
        }).format(new Date(year, month - 1, day));
    }

    function updateTournamentHeader() {
        if (!tournamentId) setPresenceStatus(0);
    }

    function renderAuthStatus() {
        const signInButton = document.getElementById('auth-button');
        const signOutButton = document.getElementById('sign-out-button');
        const status = document.getElementById('auth-status');
        const usersButton = document.getElementById('users-button');
        const tournamentAdminButton = document.getElementById('tournament-admin-button');
        const isRegisteredUser = sessionUser && !sessionUser.isAnonymous;
        signInButton.hidden = Boolean(isRegisteredUser);
        signOutButton.hidden = !isRegisteredUser;
        usersButton.hidden = sessionRole !== 'superAdmin';
        tournamentAdminButton.hidden = sessionRole !== 'superAdmin' || !tournamentId;
        const effectiveAdmin = canManageCurrentTournament();
        const roleLabel = sessionRole === 'superAdmin'
            ? ' · Super admin'
            : effectiveAdmin ? ' · Admin del torneo' : '';
        status.textContent = isRegisteredUser
            ? `Sesión iniciada: ${sessionUser.displayName}${roleLabel}`
            : 'Modo invitado: podés entrar a un torneo compartido desde su link.';
        const canManageTournament = canManageCurrentTournament();
        ['round-count', 'round-count-decrease', 'round-count-increase', 'reset-schedule-button']
            .forEach(id => {
                const control = document.getElementById(id);
                if (control) control.disabled = !canManageTournament || generatingFixture;
            });
        const gamesLocked = hasAnyScore(tournamentState.value.schedule);
        ['games-per-set', 'games-decrease', 'games-increase'].forEach(id => {
            const control = document.getElementById(id);
            if (control) control.disabled = !canManageTournament || gamesLocked || generatingFixture;
        });
        const resetAllButton = document.getElementById('reset-all-button');
        if (resetAllButton) resetAllButton.disabled = Boolean(tournamentId) || generatingFixture;
        const undoButton = document.getElementById('undo-button');
        if (undoButton) undoButton.disabled = Boolean(tournamentId) || generatingFixture || !stateStore.hasUndo();
        const regenerateButton = document.getElementById('reset-schedule-button');
        if (regenerateButton && tournamentState.value.diagnostic) {
            regenerateButton.disabled = !canManageTournament || generatingFixture
                || tournamentState.value.fixtureVariant >= tournamentState.value.diagnostic.variantCount - 1;
        }
        ['player-count', 'court-count', 'player-count-decrease', 'player-count-increase',
            'court-count-decrease', 'court-count-increase']
            .forEach(id => {
                const control = document.getElementById(id);
                if (control) control.disabled = Boolean(tournamentId) || generatingFixture;
            });
        document.querySelectorAll('input[name="pairing-mode"]').forEach(input => {
            input.disabled = Boolean(tournamentId) || generatingFixture
                || (input.value === 'fixed' && tournamentState.value.numPlayers % 2 !== 0);
        });
    }

    function canManageCurrentTournament() {
        if (!tournamentId) return true;
        return sessionRole === 'superAdmin' || tournamentAccessRole === 'admin';
    }

    async function refreshSessionRole(forceRefresh = false) {
        // El cambio de usuario puede disparar varias lecturas asíncronas de
        // claims (por ejemplo, al salir y entrar como invitado). Sólo la
        // respuesta correspondiente a la sesión que inició la lectura puede
        // actualizar el rol y habilitar controles administrativos.
        const sessionUid = sessionUser?.uid || null;
        const sessionIsAnonymous = sessionUser?.isAnonymous === true;
        try {
            const claims = await authSession.getClaims(forceRefresh);
            if (sessionUser?.uid !== sessionUid || (sessionUser?.isAnonymous === true) !== sessionIsAnonymous) return;
            sessionRole = claims.platformRole || null;
        } catch (error) {
            if (sessionUser?.uid !== sessionUid || (sessionUser?.isAnonymous === true) !== sessionIsAnonymous) return;
            sessionRole = null;
        }
        renderAuthStatus();
        await migrateLegacyTournamentIfNeeded();
        if (!tournamentId) loadSharedTournamentCatalog();
    }

    async function migrateLegacyTournamentIfNeeded() {
        // Corte limpio: los torneos sin schemaVersion 2 se rechazan y no se migran.
    }

    async function bootstrapSuperAdmin() {
        if (!sessionUser || sessionUser.isAnonymous || sessionRole === 'superAdmin') return sessionRole === 'superAdmin';
        if (bootstrapAttemptUid === sessionUser.uid && bootstrapAttemptPromise) return bootstrapAttemptPromise;
        bootstrapAttemptUid = sessionUser.uid;
        bootstrapAttemptPromise = (async () => {
            try {
                await firebaseClient.callFunction('bootstrapSuperAdmin');
                await refreshSessionRole(true);
                return sessionRole === 'superAdmin';
            } catch (error) {
                await refreshSessionRole();
                return false;
            }
        })();
        return bootstrapAttemptPromise;
    }

    function openAuthModal() {
        document.getElementById('auth-email-input').value = '';
        document.getElementById('auth-password-input').value = '';
        setModalOpen('auth-modal', true);
        setTimeout(() => document.getElementById('auth-email-input').focus(), 0);
    }

    function closeAuthModal() {
        setModalOpen('auth-modal', false);
    }

    function closeUsersModal() {
        setModalOpen('users-modal', false);
    }

    function closeTournamentAdminModal() { setModalOpen('tournament-admin-modal', false); }

    async function openTournamentAdminModal() {
        if (sessionRole !== 'superAdmin' || !tournamentId) return;
        const list = document.getElementById('tournament-admin-list');
        list.textContent = 'Cargando administradores…';
        setModalOpen('tournament-admin-modal', true);
        try {
            const [users, metadata] = await Promise.all([
                adminUserApi.list(),
                firebaseClient.callFunction('getTournamentAdminViewV2', { tournamentId })
            ]);
            list.replaceChildren();
            users.forEach(user => {
                const label = document.createElement('label');
                label.className = 'admin-user-row';
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox'; checkbox.dataset.tournamentAdmin = user.uid;
                checkbox.checked = metadata.admins?.[user.uid] === true;
                const text = document.createElement('span'); text.textContent = `${user.displayName || user.email} · ${user.email}`;
                label.append(checkbox, text); list.append(label);
            });
        } catch { list.textContent = 'No se pudieron cargar los administradores.'; }
    }

    async function setTournamentAdmin(uid, enabled) {
        try { await adminUserApi.setTournamentAdmin(tournamentId, uid, enabled); showToast(enabled ? 'Administrador asignado.' : 'Administrador removido.'); }
        catch (error) { showToast(error.message || 'No se pudo actualizar el torneo.'); }
    }

    function formatCreatedAt(timestamp) {
        if (!timestamp) return 'Fecha no registrada';
        return new Intl.DateTimeFormat('es-AR', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(timestamp));
    }

    function closeDeleteTournamentModal() {
        pendingTournamentDeletion = null;
        pendingTournamentDeletionMode = 'logical';
        setModalOpen('delete-tournament-modal', false);
    }

    function renderDeleteTournamentDetails(tournaments) {
        const details = document.getElementById('delete-tournament-details');
        const isBatch = tournaments.length > 1;
        details.classList.toggle('is-batch', isBatch);
        if (isBatch) {
            const list = document.createElement('ul');
            list.setAttribute('aria-label', 'Torneos seleccionados para borrar');
            tournaments.forEach(tournament => {
                const item = document.createElement('li');
                item.textContent = tournament.name;
                list.append(item);
            });
            details.replaceChildren(list);
            return;
        }
        details.replaceChildren(...tournaments.map(tournament => {
            const row = document.createElement('dl');
            const detail = (label, value) => {
                const item = document.createElement('div');
                const term = document.createElement('dt'); term.textContent = label;
                const definition = document.createElement('dd'); definition.textContent = value;
                item.append(term, definition);
                return item;
            };
            row.append(
                detail('Torneo', tournament.name),
                detail('Creado por', tournament.creatorName || 'No registrado'),
                detail('Fecha de creación', formatCreatedAt(tournament.createdAt))
            );
            return row;
        }));
    }

    function requestDeleteTournaments(ids) {
        if (sessionRole !== 'superAdmin') return;
        const tournaments = [...new Set(ids)]
            .map(id => sharedTournamentCatalog.find(entry => entry.id === id))
            .filter(tournament => tournament && !tournament.deletedAt);
        if (!tournaments.length) return;
        pendingTournamentDeletion = tournaments;
        pendingTournamentDeletionMode = 'logical';
        const plural = tournaments.length !== 1;
        document.getElementById('delete-tournament-modal-title').textContent = plural ? `¿Borrar ${tournaments.length} torneos?` : '¿Borrar torneo?';
        document.getElementById('delete-tournament-description').textContent = plural
            ? 'Los torneos se ocultarán del historial de admins. Como super admin podrás restaurarlos más adelante.'
            : 'El torneo se ocultará del historial de admins. Como super admin podrás restaurarlo más adelante.';
        document.getElementById('confirm-delete-tournament-button').textContent = plural ? `🗑️ Borrar ${tournaments.length} torneos` : '🗑️ Borrar torneo';
        renderDeleteTournamentDetails(tournaments);
        setModalOpen('delete-tournament-modal', true);
    }

    function requestPermanentTournamentDeletion(ids) {
        if (sessionRole !== 'superAdmin') return;
        const tournaments = [...new Set(typeof ids === 'string' ? [ids] : ids)]
            .map(id => sharedTournamentCatalog.find(entry => entry.id === id))
            .filter(tournament => tournament?.deletedAt);
        if (!tournaments.length) return;
        pendingTournamentDeletion = tournaments;
        pendingTournamentDeletionMode = 'permanent';
        const plural = tournaments.length !== 1;
        document.getElementById('delete-tournament-modal-title').textContent = plural ? `¿Eliminar definitivamente ${tournaments.length} torneos?` : '¿Eliminar definitivamente?';
        document.getElementById('delete-tournament-description').textContent = plural
            ? 'Esta acción elimina los torneos y sus datos de forma permanente. No se puede deshacer ni restaurar.'
            : 'Esta acción elimina el torneo y sus datos de forma permanente. No se puede deshacer ni restaurar.';
        document.getElementById('confirm-delete-tournament-button').textContent = plural ? `⚠️ Eliminar ${tournaments.length} torneos` : '⚠️ Eliminar definitivamente';
        renderDeleteTournamentDetails(tournaments);
        setModalOpen('delete-tournament-modal', true);
    }

    function requestDeleteTournament(id) {
        requestDeleteTournaments([id]);
    }

    function requestDeleteSelectedTournaments() {
        requestDeleteTournaments(selectedTournamentDeletionIds);
    }

    function requestPermanentlyDeleteSelectedTournaments() {
        requestPermanentTournamentDeletion(selectedTournamentDeletionIds);
    }

    function toggleTournamentDeletionSelection(id, selected) {
        if (sessionRole !== 'superAdmin') return;
        if (selected) selectedTournamentDeletionIds.add(id);
        else selectedTournamentDeletionIds.delete(id);
        renderPreviousTournaments();
    }

    function selectAllTournamentsForDeletion() {
        if (sessionRole !== 'superAdmin') return;
        selectedTournamentDeletionIds = new Set(sharedTournamentCatalog.map(entry => entry.id));
        renderPreviousTournaments();
    }

    function clearTournamentDeletionSelection() {
        selectedTournamentDeletionIds.clear();
        renderPreviousTournaments();
    }

    async function confirmDeleteTournament() {
        const tournaments = pendingTournamentDeletion;
        if (!tournaments?.length || sessionRole !== 'superAdmin') return;
        if (pendingTournamentDeletionMode === 'permanent') {
            const results = await Promise.allSettled(tournaments.map(tournament => adminUserApi.permanentlyDeleteTournament(tournament.id)));
            const deletedCount = results.filter(result => result.status === 'fulfilled').length;
            const failedResult = results.find(result => result.status === 'rejected');
            try {
                closeDeleteTournamentModal();
                selectedTournamentDeletionIds = new Set([...selectedTournamentDeletionIds].filter(id => !tournaments.some(tournament => tournament.id === id)));
                await loadSharedTournamentCatalog();
                showToast(failedResult
                    ? `${deletedCount} torneo${deletedCount === 1 ? '' : 's'} eliminado${deletedCount === 1 ? '' : 's'}; algunos no se pudieron eliminar.`
                    : `${deletedCount} torneo${deletedCount === 1 ? '' : 's'} eliminado${deletedCount === 1 ? '' : 's'} definitivamente.`);
            } catch (error) { showToast(error.message || 'No se pudo eliminar definitivamente el torneo.'); }
            return;
        }
        const results = await Promise.allSettled(tournaments.map(tournament => adminUserApi.setTournamentDeleted(tournament.id, true)));
        const deletedCount = results.filter(result => result.status === 'fulfilled').length;
        const failedResult = results.find(result => result.status === 'rejected');
        closeDeleteTournamentModal();
        selectedTournamentDeletionIds = new Set([...selectedTournamentDeletionIds].filter(id => !tournaments.some(tournament => tournament.id === id)));
        try {
            await loadSharedTournamentCatalog();
            showToast(failedResult
                ? `${deletedCount} torneo${deletedCount === 1 ? '' : 's'} borrado${deletedCount === 1 ? '' : 's'}; algunos no se pudieron borrar.`
                : `${deletedCount} torneo${deletedCount === 1 ? '' : 's'} borrado${deletedCount === 1 ? '' : 's'} lógicamente.`);
        } catch (error) { showToast(error.message || 'No se pudo actualizar el historial.'); }
    }

    async function restoreTournament(id) {
        if (sessionRole !== 'superAdmin') return;
        try { await adminUserApi.setTournamentDeleted(id, false); await loadSharedTournamentCatalog(); showToast('Torneo restaurado.'); }
        catch (error) { showToast(error.message || 'No se pudo restaurar el torneo.'); }
    }

    async function restoreSelectedTournaments() {
        if (sessionRole !== 'superAdmin') return;
        const tournaments = sharedTournamentCatalog.filter(entry => entry.deletedAt && selectedTournamentDeletionIds.has(entry.id));
        if (!tournaments.length) return;
        const results = await Promise.allSettled(tournaments.map(tournament => adminUserApi.setTournamentDeleted(tournament.id, false)));
        const restoredCount = results.filter(result => result.status === 'fulfilled').length;
        const failedResult = results.find(result => result.status === 'rejected');
        selectedTournamentDeletionIds = new Set([...selectedTournamentDeletionIds].filter(id => !tournaments.some(tournament => tournament.id === id)));
        try {
            await loadSharedTournamentCatalog();
            showToast(failedResult
                ? `${restoredCount} torneo${restoredCount === 1 ? '' : 's'} restaurado${restoredCount === 1 ? '' : 's'}; algunos no se pudieron restaurar.`
                : `${restoredCount} torneo${restoredCount === 1 ? '' : 's'} restaurado${restoredCount === 1 ? '' : 's'}.`);
        } catch (error) { showToast(error.message || 'No se pudo actualizar el historial.'); }
    }

    function renderAdminUsers(users) {
        const list = document.getElementById('admin-users-list');
        list.replaceChildren();
        if (!users.length) {
            list.textContent = 'Todavía no hay administradores creados.';
            return;
        }
        users.forEach(user => {
            const row = document.createElement('div');
            row.className = 'admin-user-row';
            const detail = document.createElement('div');
            const name = document.createElement('strong');
            name.textContent = user.displayName || user.email;
            const email = document.createElement('small');
            email.textContent = `${user.email}${user.disabled ? ' · Desactivado' : ''}`;
            detail.append(name, email);
            const actions = document.createElement('div');
            actions.className = 'admin-user-actions';
            [['Editar', 'editAdmin'], [user.disabled ? 'Activar' : 'Desactivar', 'toggleAdmin'], ['Recuperar clave', 'resetAdmin'], ['Eliminar', 'deleteAdmin']].forEach(([label, action]) => {
                const button = document.createElement('button');
                button.className = `btn btn-sm${action === 'deleteAdmin' ? ' btn-danger' : ' btn-secondary'}`;
                button.type = 'button';
                button.dataset[action] = user.uid;
                button.textContent = label;
                actions.append(button);
            });
            row.append(detail, actions);
            list.append(row);
        });
    }

    async function loadAdminUsers() {
        const status = document.getElementById('admin-users-status');
        status.textContent = 'Cargando usuarios…';
        try {
            const users = await adminUserApi.list();
            adminUsers = users;
            renderAdminUsers(users);
            status.textContent = `${users.length} administrador${users.length === 1 ? '' : 'es'}.`;
        } catch (error) {
            status.textContent = 'No se pudieron cargar los usuarios.';
        }
    }

    async function openUsersModal() {
        if (sessionRole !== 'superAdmin') return;
        setModalOpen('users-modal', true);
        await loadAdminUsers();
    }

    async function createAdminUser() {
        const name = document.getElementById('admin-user-name');
        const email = document.getElementById('admin-user-email');
        const password = document.getElementById('admin-user-password');
        try {
            if (editingAdminUid) {
                const updates = { displayName: name.value.trim(), email: email.value.trim() };
                if (password.value) updates.password = password.value;
                await adminUserApi.update(editingAdminUid, updates);
                showToast('Administrador actualizado.');
            } else {
                await adminUserApi.create({ displayName: name.value.trim(), email: email.value.trim(), password: password.value });
                showToast('Administrador creado.');
            }
            cancelAdminEdit();
            await loadAdminUsers();
        } catch (error) {
            showToast(error.message || 'No se pudo crear el administrador.');
        }
    }

    function startAdminEdit(uid) {
        const user = adminUsers.find(item => item.uid === uid);
        if (!user) return;
        editingAdminUid = uid;
        document.getElementById('admin-user-name').value = user.displayName || '';
        document.getElementById('admin-user-email').value = user.email || '';
        const password = document.getElementById('admin-user-password');
        password.value = ''; password.required = false;
        document.getElementById('admin-user-password-label').textContent = 'Contraseña nueva (opcional)';
        document.getElementById('create-admin-user-button').textContent = 'Guardar cambios';
        document.getElementById('cancel-admin-edit-button').hidden = false;
    }

    function cancelAdminEdit() {
        editingAdminUid = null;
        document.getElementById('admin-user-form').reset();
        document.getElementById('admin-user-password').required = true;
        document.getElementById('admin-user-password-label').textContent = 'Contraseña inicial';
        document.getElementById('create-admin-user-button').textContent = 'Crear administrador';
        document.getElementById('cancel-admin-edit-button').hidden = true;
    }

    async function toggleAdminUser(uid) {
        const user = adminUsers.find(item => item.uid === uid);
        if (!user) return;
        try { await adminUserApi.update(uid, { disabled: !user.disabled }); await loadAdminUsers(); }
        catch (error) { showToast(error.message || 'No se pudo actualizar el administrador.'); }
    }

    async function generateAdminPasswordResetLink(uid) {
        try {
            const { link } = await adminUserApi.generatePasswordResetLink(uid);
            await navigator.clipboard.writeText(link);
            showToast('Link de recuperación copiado.');
        } catch (error) { showToast(error.message || 'No se pudo generar el link.'); }
    }

    async function deleteAdminUser(uid) {
        if (!confirm('¿Eliminar este administrador? Esta acción no se puede deshacer.')) return;
        try {
            await adminUserApi.remove(uid);
            showToast('Administrador eliminado.');
            await loadAdminUsers();
        } catch (error) {
            showToast(error.message || 'No se pudo eliminar el administrador.');
        }
    }

    function getAuthErrorMessage(error) {
        if (error?.code === 'auth/popup-closed-by-user') return 'Se canceló el inicio de sesión.';
        if (error?.code === 'auth/invalid-credential' || error?.code === 'auth/wrong-password') return 'El email o la contraseña no son correctos.';
        if (error?.code === 'auth/too-many-requests') return 'Demasiados intentos. Probá de nuevo más tarde.';
        return 'No se pudo iniciar sesión. Revisá tus datos e intentá nuevamente.';
    }

    async function signInWithGoogle() {
        try {
            const user = await authSession.signInWithGoogle();
            closeAuthModal();
            const isSuperAdmin = await bootstrapSuperAdmin();
            showToast(isSuperAdmin
                ? `Sesión iniciada como super admin: ${user.displayName}`
                : `Sesión iniciada como ${user.displayName}. No se pudo activar el rol de super admin todavía.`);
        } catch (error) {
            if (error?.code !== 'auth/popup-closed-by-user') showToast(getAuthErrorMessage(error));
        }
    }

    async function signInWithEmailAndPassword() {
        const email = document.getElementById('auth-email-input').value;
        const password = document.getElementById('auth-password-input').value;
        if (!email || !password) {
            showToast('Ingresá email y contraseña.');
            return;
        }
        try {
            const user = await authSession.signInWithEmailAndPassword(email, password);
            await refreshSessionRole();
            closeAuthModal();
            showToast(`Sesión iniciada como ${user.displayName}`);
        } catch (error) {
            showToast(getAuthErrorMessage(error));
        }
    }

    async function sendPasswordReset() {
        const email = document.getElementById('auth-email-input').value;
        if (!email) {
            showToast('Ingresá tu email para recuperar el acceso.');
            return;
        }
        try {
            await authSession.sendPasswordReset(email);
            showToast('Te enviamos un email para restablecer la contraseña.');
        } catch (error) {
            showToast(getAuthErrorMessage(error));
        }
    }

    async function signOut() {
        try {
            await authSession.signOut();
            sessionRole = null;
            await firebaseClient.getDatabase();
            showToast('Sesión cerrada. Seguís como invitado.');
        } catch (error) {
            showToast('No se pudo cerrar la sesión. Intentá de nuevo.');
        }
    }

    function formatTournamentUpdatedAt(timestamp) {
        if (!timestamp) return '';
        return `Actualizado ${new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(timestamp))}`;
    }

    function rememberCurrentTournament() {
        if (!tournamentId || historyRecordedForTournament) return;
        tournamentHistoryStore.remember({
            id: tournamentId,
            name: tournamentState.value.tournamentName,
            date: tournamentState.value.tournamentDate
        });
        historyRecordedForTournament = true;
    }

    function renderPreviousTournaments() {
        const container = document.getElementById('tournament-history-list');
        if (!container) return;
        const entries = tournamentId ? [] : sharedTournamentCatalog;
        selectedTournamentDeletionIds = new Set([...selectedTournamentDeletionIds].filter(id => entries.some(entry => entry.id === id)));
        const canDelete = sessionRole === 'superAdmin';
        renderTournamentHistory(container, entries, {
            formatDate: formatTournamentDate,
            formatLastOpened: formatTournamentUpdatedAt,
            canDelete,
            selectedIds: selectedTournamentDeletionIds
        });
        const batchActions = document.getElementById('tournament-batch-actions');
        batchActions.hidden = !canDelete || !entries.length;
        document.getElementById('tournament-selection-status').textContent = `${selectedTournamentDeletionIds.size} seleccionado${selectedTournamentDeletionIds.size === 1 ? '' : 's'}`;
        const selectedEntries = entries.filter(entry => selectedTournamentDeletionIds.has(entry.id));
        const selectedActiveCount = selectedEntries.filter(entry => !entry.deletedAt).length;
        const selectedDeletedCount = selectedEntries.filter(entry => entry.deletedAt).length;
        const deleteSelected = document.getElementById('delete-selected-tournaments-button');
        deleteSelected.hidden = selectedActiveCount === 0;
        deleteSelected.disabled = selectedActiveCount === 0;
        deleteSelected.textContent = `🗑️ Borrar ${selectedActiveCount} seleccionado${selectedActiveCount === 1 ? '' : 's'}`;
        const restoreSelected = document.getElementById('restore-selected-tournaments-button');
        restoreSelected.hidden = selectedDeletedCount === 0;
        restoreSelected.textContent = `↩️ Restaurar ${selectedDeletedCount} seleccionado${selectedDeletedCount === 1 ? '' : 's'}`;
        const permanentlyDeleteSelected = document.getElementById('permanently-delete-selected-tournaments-button');
        permanentlyDeleteSelected.hidden = selectedDeletedCount === 0;
        permanentlyDeleteSelected.textContent = `⚠️ Eliminar ${selectedDeletedCount} definitivamente`;
    }

    async function loadSharedTournamentCatalog() {
        if (tournamentId) return;
        // El catálogo completo está protegido en Firebase: los invitados no
        // deben intentar leerlo ni generar un permission_denied en consola.
        if (!sessionUser || sessionUser.isAnonymous) {
            sharedTournamentCatalog = [];
            renderPreviousTournaments();
            return;
        }
        try {
            const catalog = await loadTournamentCatalog(
                (...args) => firebaseClient.callFunction(...args),
                tournamentHistoryStore.load()
            );
            sharedTournamentCatalog = filterTournamentCatalog(catalog, { uid: sessionUser?.uid, role: sessionRole });
            renderPreviousTournaments();
        } catch (error) {
            console.error(error);
        }
    }

    function openPreviousTournament(id) {
        if (!id) return;
        location.assign(createSharedTournamentUrl(location.origin, location.pathname, id));
    }

    function isHistoryPage() {
        return !tournamentId && location.hash === '#historial';
    }

    function updatePageView() {
        const historyPage = isHistoryPage();
        document.getElementById('main-page').hidden = historyPage;
        document.getElementById('tournament-history-page').hidden = !historyPage;
        if (historyPage) renderPreviousTournaments();
    }

    function showTournamentHistory() {
        if (tournamentId) return;
        location.hash = 'historial';
    }

    function showMainPage() {
        if (!isHistoryPage()) return;
        history.replaceState(null, '', `${location.pathname}${location.search}`);
        updatePageView();
    }

    function goHome() {
        location.assign(location.pathname);
    }

    function updateSubtitle() {
        const courts = getCourts(tournamentState.value.numPlayers, tournamentState.value.numCourts);
        const rest = getRestCount(tournamentState.value.numPlayers, tournamentState.value.numCourts);
        const rounds = tournamentState.value.schedule.length || getNumRounds(tournamentState.value.numPlayers, tournamentState.value.numCourts);
        const plannedRounds = getNumRounds(tournamentState.value.numPlayers, tournamentState.value.numCourts);
        const availableCourts = Math.min(UI_MAX_COURTS, Math.floor(tournamentState.value.numPlayers / 4));
        renderTournamentToolbar({ tournamentId, tournamentName: tournamentState.value.tournamentName, tournamentDate: tournamentState.value.tournamentDate, formattedDate: formatTournamentDate(tournamentState.value.tournamentDate), numPlayers: tournamentState.value.numPlayers, gamesPerSet: tournamentState.value.gamesPerSet, scheduleLength: rounds, courts, rest, plannedRounds, availableCourts });
    }

    function resizePlayers(newCount) {
        const old = [...tournamentState.value.players];
        tournamentState.value.players = defaultPlayers(newCount);
        for (let i = 0; i < Math.min(old.length, newCount); i++) {
            tournamentState.value.players[i] = old[i];
        }
        tournamentState.value.numPlayers = newCount;
        if (tournamentState.value.pairingMode === 'fixed') {
            tournamentState.value.fixedTeams = newCount % 2 === 0
                ? createConsecutiveFixedTeams(newCount)
                : [];
            if (newCount % 2 !== 0) tournamentState.value.pairingMode = 'rotating';
        }
        document.getElementById('player-count').value = newCount;
    }

    function createConsecutiveFixedTeams(numPlayers) {
        return Array.from({ length: numPlayers / 2 }, (_, teamIndex) => {
            const playerIds = [teamIndex * 2, teamIndex * 2 + 1];
            return { id: `team-${playerIds[0]}-${playerIds[1]}`, playerIds };
        });
    }

    async function setPairingMode(mode) {
        if (tournamentId || generatingFixture || !['rotating', 'fixed'].includes(mode)) return;
        if (mode === 'fixed' && tournamentState.value.numPlayers % 2 !== 0) {
            showToast('Las parejas fijas requieren una cantidad par de jugadores.');
            renderFixtureConfiguration();
            return;
        }
        if (mode === tournamentState.value.pairingMode) return;
        const previousState = tournamentState.snapshot();
        rememberStateForUndo();
        tournamentState.value.pairingMode = mode;
        tournamentState.value.fixedTeams = mode === 'fixed'
            ? createConsecutiveFixedTeams(tournamentState.value.numPlayers)
            : [];
        try {
            await generateScheduleWithoutBlocking(getNumRounds(), 0);
        } catch (error) {
            tournamentState.replace(previousState);
            renderAll();
            showToast('No se pudo generar el fixture.');
            return;
        }
        saveLocal();
        renderAll();
    }

    async function setFixedTeamPlayer(teamIndex, memberIndex, playerId) {
        if (tournamentId || generatingFixture || tournamentState.value.pairingMode !== 'fixed') return;
        const previousState = tournamentState.snapshot();
        const teams = structuredClone(tournamentState.value.fixedTeams);
        const target = teams[teamIndex]?.playerIds;
        if (!target || ![0, 1].includes(memberIndex)
            || !Number.isInteger(playerId) || playerId < 0 || playerId >= tournamentState.value.numPlayers) return;
        const previous = target[memberIndex];
        if (previous === playerId) return;
        for (const team of teams) {
            const existingIndex = team.playerIds.indexOf(playerId);
            if (existingIndex !== -1) team.playerIds[existingIndex] = previous;
        }
        target[memberIndex] = playerId;
        tournamentState.value.fixedTeams = teams;
        try {
            await generateScheduleWithoutBlocking(tournamentState.value.schedule.length || getNumRounds(), 0);
        } catch (error) {
            tournamentState.replace(previousState);
            renderAll();
            showToast('No se pudo generar el fixture.');
            return;
        }
        saveLocal();
        renderAll();
    }

    function renderFixtureConfiguration() {
        const fixedRadio = document.querySelector('input[name="pairing-mode"][value="fixed"]');
        const rotatingRadio = document.querySelector('input[name="pairing-mode"][value="rotating"]');
        const odd = tournamentState.value.numPlayers % 2 !== 0;
        fixedRadio.checked = tournamentState.value.pairingMode === 'fixed';
        rotatingRadio.checked = tournamentState.value.pairingMode === 'rotating';
        fixedRadio.disabled = Boolean(tournamentId) || generatingFixture || odd;
        rotatingRadio.disabled = Boolean(tournamentId) || generatingFixture;
        document.getElementById('pairing-mode-hint').textContent = odd
            ? 'Las parejas fijas requieren una cantidad par de jugadores.'
            : tournamentId ? 'El tipo de parejas queda bloqueado al crear el torneo.' : '';
        const editor = document.getElementById('fixed-teams-editor');
        editor.hidden = tournamentState.value.pairingMode !== 'fixed' || Boolean(tournamentId);
        const container = document.getElementById('fixed-teams-container');
        container.replaceChildren();
        if (!editor.hidden) {
            tournamentState.value.fixedTeams.forEach((team, teamIndex) => {
                const row = document.createElement('div');
                row.className = 'fixed-team-row';
                const label = document.createElement('strong');
                label.textContent = `Equipo ${teamIndex + 1}`;
                row.append(label);
                team.playerIds.forEach((selectedId, memberIndex) => {
                    if (memberIndex === 1) {
                        const plus = document.createElement('span');
                        plus.textContent = '+';
                        row.append(plus);
                    }
                    const select = document.createElement('select');
                    select.disabled = generatingFixture;
                    select.dataset.fixedTeamPlayer = '';
                    select.dataset.teamIndex = String(teamIndex);
                    select.dataset.memberIndex = String(memberIndex);
                    tournamentState.value.players.forEach((name, playerId) => {
                        const option = document.createElement('option');
                        option.value = String(playerId);
                        option.textContent = name;
                        option.selected = playerId === selectedId;
                        select.append(option);
                    });
                    row.append(select);
                });
                container.append(row);
            });
        }
        const diagnostic = tournamentState.value.diagnostic;
        const diagnosticElement = document.getElementById('fixture-diagnostic');
        if (!diagnostic) {
            diagnosticElement.textContent = '';
            return;
        }
        const classLabels = {
            exact: 'Diseño exacto verificado',
            'optimal-known': 'Óptimo certificado para repeticiones',
            optimized: 'Fixture optimizado'
        };
        const coverage = diagnostic.pairingMode === 'fixed'
            ? `${diagnostic.uniqueTeamMatchups} de ${diagnostic.possibleTeamMatchups} cruces entre equipos`
            : `${diagnostic.uniquePartners} de ${diagnostic.possiblePartners} parejas`;
        const cycleLabels = { partial: 'ciclo parcial', complete: 'ciclo completo', extended: 'ciclo extendido' };
        const minimumRounds = diagnostic.pairingMode === 'fixed'
            ? diagnostic.minimumRoundsForTeamCoverage
            : diagnostic.minimumRoundsForPairCapacity;
        diagnosticElement.textContent = `${classLabels[diagnostic.solutionClass]} · ${coverage}`
            + (cycleLabels[diagnostic.cycleStatus] ? ` · ${cycleLabels[diagnostic.cycleStatus]}` : '')
            + (diagnostic.coverageStatus === 'impossible-by-capacity'
                ? ` · cobertura total posible desde ${minimumRounds} rondas`
                : '');
    }

    function changePlayerCount(delta) {
        setPlayerCount(tournamentState.value.numPlayers + delta);
    }

    function changeRoundCount(delta) {
        setRoundCount(tournamentState.value.schedule.length + delta);
    }

    function changeCourtCount(delta) {
        setCourtCount(tournamentState.value.numCourts + delta);
    }

    async function setCourtCount(newCount) {
        if (generatingFixture) return;
        if (tournamentId) {
            document.getElementById('court-count').value = tournamentState.value.numCourts;
            showToast('La cantidad de canchas queda bloqueada al crear el torneo.');
            return;
        }
        const maxAvailableCourts = Math.min(UI_MAX_COURTS, Math.floor(tournamentState.value.numPlayers / 4));
        if (!Number.isInteger(newCount) || newCount < 1 || newCount > maxAvailableCourts) {
            document.getElementById('court-count').value = tournamentState.value.numCourts;
            showToast(`Elegí entre 1 y ${maxAvailableCourts} canchas.`);
            return;
        }
        if (newCount === tournamentState.value.numCourts) {
            document.getElementById('court-count').value = tournamentState.value.numCourts;
            return;
        }

        const hasScores = tournamentState.value.schedule.some(round => round.matches.some(match => match.score1 !== '' || match.score2 !== ''));
        if (hasScores && !confirm(`¿Usar ${newCount} cancha${newCount === 1 ? '' : 's'}? Se regenerará el fixture y se pierden los resultados.`)) {
            document.getElementById('court-count').value = tournamentState.value.numCourts;
            return;
        }

        const previousState = tournamentState.snapshot();
        rememberStateForUndo();
        const currentRoundCount = tournamentState.value.schedule.length || getNumRounds(tournamentState.value.numPlayers, tournamentState.value.numCourts);
        tournamentState.value.numCourts = newCount;
        try {
            await generateScheduleWithoutBlocking(currentRoundCount);
        } catch (error) {
            tournamentState.replace(previousState);
            renderAll();
            showToast('No se pudo generar el fixture.');
            return;
        }
        tournamentState.value.collapsedRounds = {};
        saveLocal();
        logActivity(`cambió la cantidad de canchas a ${newCount}`);
        renderAll();
        showToast(`${newCount} cancha${newCount === 1 ? '' : 's'} · fixture actualizado`);
    }

    function changeGamesPerSet(delta) {
        setGamesPerSet(tournamentState.value.gamesPerSet + delta);
    }

    function setGamesPerSet(newTarget) {
        if (isNaN(newTarget)) {
            document.getElementById('games-per-set').value = tournamentState.value.gamesPerSet;
            return;
        }
        if (!Number.isInteger(newTarget) || newTarget < MIN_GAMES_PER_SET || newTarget > MAX_GAMES_PER_SET) {
            document.getElementById('games-per-set').value = tournamentState.value.gamesPerSet;
            showToast(`Elegí entre ${MIN_GAMES_PER_SET} y ${MAX_GAMES_PER_SET} games.`);
            return;
        }
        if (hasAnyScore(tournamentState.value.schedule)) {
            document.getElementById('games-per-set').value = tournamentState.value.gamesPerSet;
            showToast('No se pueden cambiar los games porque ya hay puntajes cargados.');
            return;
        }
        if (newTarget === tournamentState.value.gamesPerSet) {
            document.getElementById('games-per-set').value = tournamentState.value.gamesPerSet;
            return;
        }
        if (tournamentId) {
            tournamentSync?.mutate('updateGamesPerSet', { gamesPerSet: newTarget })
                .catch(error => showToast(error.message || 'No se pudieron cambiar los games.'));
            return;
        }

        rememberStateForUndo();
        tournamentState.value.gamesPerSet = newTarget;
        document.getElementById('games-per-set').value = tournamentState.value.gamesPerSet;
        updateSubtitle();
        saveLocal();
        logActivity(`cambió el objetivo a ${tournamentState.value.gamesPerSet} games`);
        renderRounds();
        showToast(`Sets a ${tournamentState.value.gamesPerSet} games`);
    }

    async function setPlayerCount(newCount) {
        if (generatingFixture) return;
        if (tournamentId) {
            document.getElementById('player-count').value = tournamentState.value.numPlayers;
            showToast('La cantidad de jugadores queda bloqueada al crear el torneo.');
            return;
        }
        if (!Number.isInteger(newCount) || newCount < MIN_PLAYERS || newCount > MAX_PLAYERS) {
            document.getElementById('player-count').value = tournamentState.value.numPlayers;
            showToast(`Elegí entre ${MIN_PLAYERS} y ${MAX_PLAYERS} jugadores.`);
            return;
        }
        if (newCount === tournamentState.value.numPlayers) {
            document.getElementById('player-count').value = tournamentState.value.numPlayers;
            return;
        }

        const hasScores = tournamentState.value.schedule.some(r => r.matches.some(m => m.score1 !== '' || m.score2 !== ''));
        if (hasScores && !confirm(`¿Cambiar a ${newCount} jugadores? Se regenerará el fixture y se pierden los resultados.`)) {
            document.getElementById('player-count').value = tournamentState.value.numPlayers;
            return;
        }

        const previousState = tournamentState.snapshot();
        rememberStateForUndo();
        const currentRoundCount = tournamentState.value.schedule.length || getNumRounds(tournamentState.value.numPlayers, tournamentState.value.numCourts);
        resizePlayers(newCount);
        tournamentState.value.numCourts = Math.min(tournamentState.value.numCourts, Math.floor(newCount / 4));
        try {
            await generateScheduleWithoutBlocking(currentRoundCount);
        } catch (error) {
            tournamentState.replace(previousState);
            renderAll();
            showToast('No se pudo generar el fixture.');
            return;
        }
        tournamentState.value.collapsedRounds = {};
        saveLocal();
        logActivity(`cambió la cantidad de jugadores a ${tournamentState.value.numPlayers}`);
        renderAll();
        showToast(`${newCount} jugadores · fixture actualizado`);
    }

    async function setRoundCount(newCount) {
        if (generatingFixture) return;
        if (Number.isNaN(newCount)) {
            document.getElementById('round-count').value = tournamentState.value.schedule.length;
            return;
        }
        if (!Number.isInteger(newCount) || newCount < MIN_ROUNDS || newCount > MAX_ROUNDS) {
            document.getElementById('round-count').value = tournamentState.value.schedule.length;
            showToast(`Elegí entre ${MIN_ROUNDS} y ${MAX_ROUNDS} rondas.`);
            return;
        }
        const currentCount = tournamentState.value.schedule.length;
        if (newCount === currentCount) {
            document.getElementById('round-count').value = currentCount;
            return;
        }
        if (newCount < currentCount) {
            const roundsToRemove = tournamentState.value.schedule.slice(newCount);
            const hasRecordedResults = hasAnyScore(roundsToRemove);
            if (hasRecordedResults) {
                if (!confirm(`Las rondas que vas a quitar tienen puntajes cargados. ¿Eliminar esas ${currentCount - newCount} ronda${currentCount - newCount === 1 ? '' : 's'} y sus resultados?`)) {
                    document.getElementById('round-count').value = currentCount;
                    return;
                }
            } else if (!confirm(`¿Quitar las últimas ${currentCount - newCount} ronda${currentCount - newCount === 1 ? '' : 's'}?`)) {
                document.getElementById('round-count').value = currentCount;
                return;
            }
        }
        if (tournamentId) {
            tournamentSync?.mutate('changeRoundCount', {
                targetCount: newCount,
                confirmDeleteScores: newCount < currentCount
                    && hasAnyScore(tournamentState.value.schedule.slice(newCount))
            }).catch(error => {
                showToast(error.message || 'No se pudo cambiar la cantidad de rondas.');
                renderAll();
            });
            return;
        }

        const previousState = tournamentState.snapshot();
        rememberStateForUndo();
        if (newCount > currentCount) {
            let extended;
            try {
                extended = await extendScheduleWithoutBlocking(newCount);
            } catch (error) {
                tournamentState.replace(previousState);
                renderAll();
                showToast('No se pudieron agregar las rondas.');
                return;
            }
            tournamentState.value.schedule = extended.schedule;
            tournamentState.value.scheduleFingerprint = extended.scheduleFingerprint;
            tournamentState.value.diagnostic = extended.diagnostic;
        } else {
            tournamentState.value.schedule = tournamentState.value.schedule.slice(0, newCount);
            tournamentState.value.scheduleFingerprint = scheduleFingerprint(
                tournamentState.value.schedule,
                currentConfiguration(),
                tournamentState.value.fixtureVariant
            );
        }
        tournamentState.value.scheduleRevision += 1;
        tournamentState.value.collapsedRounds = Object.fromEntries(
            Object.entries(tournamentState.value.collapsedRounds)
                .filter(([index]) => Number(index) < newCount)
        );
        saveLocal();
        logActivity(`cambió la cantidad de rondas a ${newCount}`);
        renderAll();
        showToast(newCount > currentCount
            ? `Ronda${newCount - currentCount === 1 ? '' : 's'} agregada${newCount - currentCount === 1 ? '' : 's'} · ${newCount} en total`
            : `Rondas ajustadas · ${newCount} en total`);
    }

    function getState() {
        return tournamentState.snapshot();
    }

    const stateStore = createStateStore({
        read: getState,
        write: setState,
        maxUndo: MAX_UNDO_STEPS
    });

    function getStateSignature(value) {
        return stateStore.signature(value);
    }

    function rememberStateForUndo() {
        if (tournamentSync?.isApplyingRemoteState()) return;
        stateStore.remember();
        updateUndoButton();
    }

    function updateUndoButton() {
        const button = document.getElementById('undo-button');
        if (button) button.disabled = Boolean(tournamentId) || generatingFixture || !stateStore.hasUndo();
    }

    function undoLastChange() {
        if (!stateStore.undo()) return;
        saveLocal();
        logActivity('deshizo su último cambio');
        updateUndoButton();
        showToast('Último cambio deshecho');
    }

    function setState(state) {
        if (generatingFixture) {
            fixtureGenerationRevision += 1;
            fixtureGeneratorWorker.cancel();
            generatingFixture = false;
        }
        const normalized = normalizeState(state);
        tournamentState.replace(normalized);
        document.getElementById('player-count').value = tournamentState.value.numPlayers;
        document.getElementById('court-count').value = tournamentState.value.numCourts;
        document.getElementById('games-per-set').value = tournamentState.value.gamesPerSet;
        renderAll();
    }

    function saveLocal() {
        if (!tournamentId) localStateStore.save(getState());
    }

    function setSyncStatus(message) {
        const status = document.getElementById('sync-status');
        if (status) status.textContent = message;
    }

    function setPresenceStatus(presences) {
        const status = document.getElementById('presence-status');
        if (!status) return;
        if (!tournamentId) {
            status.hidden = true;
            return;
        }
        const { devices, people } = summarizePresence(presences);
        status.hidden = false;
        const peopleLabel = `${people.length} persona${people.length === 1 ? '' : 's'} conectada${people.length === 1 ? '' : 's'}`;
        const devicesLabel = devices !== people.length ? ` · ${devices} dispositivos` : '';
        const canSeeDetails = canManageCurrentTournament();
        const detail = canSeeDetails && people.length
            ? ` — ${people.map(person => `${person.actorName} (${formatPresenceRole(person.role)})`).join(', ')}`
            : '';
        status.textContent = `👥 ${peopleLabel}${devicesLabel}${detail}`;
    }

    function getDeviceLabel() {
        const userAgent = navigator.userAgent || '';
        const uaData = navigator.userAgentData;
        const platform = uaData?.platform || (/(iPhone|iPad|iPod)/.test(userAgent) ? 'iOS'
            : /Android/.test(userAgent) ? 'Android'
                : /Windows/.test(userAgent) ? 'Windows'
                    : /Mac OS/.test(userAgent) ? 'macOS' : 'Dispositivo');
        const brands = uaData?.brands?.map(brand => brand.brand).join(' ') || userAgent;
        const browser = /Edg/.test(brands) ? 'Edge'
            : /Firefox/.test(brands) ? 'Firefox'
                : /Chrome|Chromium|Google Chrome/.test(brands) ? 'Chrome'
                    : /Safari/.test(userAgent) ? 'Safari' : 'Navegador web';
        return `${platform} · ${browser}`;
    }

    function getActorName() {
        return Number.isInteger(actorPlayerId) && tournamentState.value.players[actorPlayerId]
            ? tournamentState.value.players[actorPlayerId]
            : 'Espectador';
    }

    function getActorLabel() {
        return `${getActorName()} · ${getDeviceLabel()}`;
    }

    function getActorIdentity() {
        return {
            actorUid: sessionUser?.uid || null,
            actorRole: sessionRole || (Number.isInteger(actorPlayerId) ? 'participant' : 'spectator')
        };
    }

    function updateIdentityStatus() {
        const status = document.getElementById('identity-status');
        if (!status) return;
        if (!tournamentId) {
            status.hidden = true;
            return;
        }
        status.hidden = false;
        status.textContent = Number.isInteger(actorPlayerId) && tournamentState.value.players[actorPlayerId]
            ? `👤 Sos: ${tournamentState.value.players[actorPlayerId]}`
            : '👤 Estás como espectador';
    }

    function getActorStorageKey() {
        return tournamentId ? `padel-torneo-actor-${tournamentId}` : '';
    }

    function saveActorPlayerId(playerId) {
        const key = getActorStorageKey();
        if (!key) return;
        try {
            if (Number.isInteger(playerId)) localStorage.setItem(key, String(playerId));
            else localStorage.removeItem(key);
        } catch (error) { /* local storage may be unavailable */ }
    }

    function loadActorPlayerId() {
        const key = getActorStorageKey();
        if (!key) return null;
        try {
            const value = parseInt(localStorage.getItem(key), 10);
            return Number.isInteger(value) ? value : null;
        } catch (error) {
            return null;
        }
    }

    function getAvailablePlayerIds() {
        return tournamentState.value.players.map((_, id) => id).filter(id => {
            const claim = claimedPlayers[id];
            return !claim || isOwnClaim(claim);
        });
    }

    function isOwnClaim(claim) {
        const authUid = sessionUser?.isAnonymous ? '' : sessionUser?.uid || '';
        return authUid && claim?.uid ? claim.uid === authUid : claim?.presenceId === presenceId;
    }

    function showIdentityChoice() {
        const modal = document.getElementById('identity-modal');
        const select = document.getElementById('identity-player-select');
        const available = getAvailablePlayerIds();
        const continueButton = document.getElementById('identity-continue-button');
        const spectatorButton = document.getElementById('spectator-button');
        pendingActorPlayerId = null;
        document.getElementById('identity-confirm-button').disabled = false;
        document.getElementById('identity-choice-step').hidden = false;
        document.getElementById('identity-confirm-step').hidden = true;
        select.innerHTML = available.map(id => `<option value="${id}">${escapeHTML(tournamentState.value.players[id])}</option>`).join('');
        continueButton.disabled = available.length === 0;
        spectatorButton.hidden = available.length > 0;
        document.getElementById('identity-choice-description').textContent = available.length
            ? 'Elegí tu jugador para identificar tus cambios. Los jugadores ya elegidos por otros dispositivos no aparecen.'
            : 'Todos los jugadores ya están identificados desde otros dispositivos.';
        modal.hidden = false;
    }

    function refreshIdentityChoiceIfNeeded() {
        const modal = document.getElementById('identity-modal');
        if (!modal.hidden && !document.getElementById('identity-choice-step').hidden) showIdentityChoice();
    }

    function continueIdentitySelection() {
        const selected = parseInt(document.getElementById('identity-player-select').value, 10);
        if (!Number.isInteger(selected)) return;
        pendingActorPlayerId = selected;
        document.getElementById('identity-choice-step').hidden = true;
        document.getElementById('identity-confirm-step').hidden = false;
        document.getElementById('identity-confirm-description').textContent =
            `¿Confirmás que sos ${tournamentState.value.players[selected]}? Tus cambios se registrarán como “${tournamentState.value.players[selected]} · ${getDeviceLabel()}”.`;
    }

    async function confirmIdentitySelection() {
        if (!Number.isInteger(pendingActorPlayerId)) return;
        const confirmButton = document.getElementById('identity-confirm-button');
        confirmButton.disabled = true;
        try {
            const claimed = await claimPlayer(pendingActorPlayerId);
            if (!claimed) {
                pendingActorPlayerId = null;
                showToast('Ese jugador acaba de ser elegido desde otro dispositivo. Elegí otro.');
                showIdentityChoice();
                return;
            }
            document.getElementById('identity-modal').hidden = true;
            updateIdentityStatus();
            logActivity(`${getActorName()} se identificó en el torneo`);
        } catch (error) {
            console.error(error);
            pendingActorPlayerId = null;
            setSyncStatus('No se pudo guardar tu identificación');
            showToast('No se pudo confirmar. Revisá la conexión e intentá de nuevo.');
            showIdentityChoice();
        } finally {
            confirmButton.disabled = false;
        }
    }

    function enterAsSpectator() {
        actorPlayerId = null;
        saveActorPlayerId(null);
        document.getElementById('identity-modal').hidden = true;
        tournamentIdentity?.releasePlayer().catch(() => {});
        tournamentIdentity?.updatePresence({ actorName: 'Espectador' });
        updateIdentityStatus();
    }

    async function claimPlayer(playerId) {
        if (!tournamentRef || !Number.isInteger(playerId)) return false;
        const claimed = await tournamentIdentity?.claimPlayer(playerId);
        if (!claimed) return false;
        actorPlayerId = playerId;
        saveActorPlayerId(playerId);
        updateIdentityStatus();
        return true;
    }

    function maybeRequestIdentity() {
        if (!tournamentId || !tournamentRef || !tournamentState.value.players.length || !claimsLoaded || !sharedStateLoaded || identityPromptShown) return;
        const ownClaim = Object.entries(claimedPlayers).find(([, claim]) => isOwnClaim(claim));
        if (ownClaim) {
            actorPlayerId = parseInt(ownClaim[0], 10);
            tournamentIdentity?.restoreClaim(actorPlayerId);
            saveActorPlayerId(actorPlayerId);
            tournamentIdentity?.updatePresence({ actorPlayerId, actorName: getActorName() });
            identityPromptShown = true;
            updateIdentityStatus();
            return;
        }
        const savedPlayerId = loadActorPlayerId();
        if (Number.isInteger(savedPlayerId) && getAvailablePlayerIds().includes(savedPlayerId)) {
            identityPromptShown = true;
            claimPlayer(savedPlayerId).then(claimed => {
                if (!claimed) {
                    identityPromptShown = false;
                    maybeRequestIdentity();
                }
            });
            return;
        }
        identityPromptShown = true;
        showIdentityChoice();
    }

    function logActivity(message) {
        if (!activityLog || tournamentSync?.isApplyingRemoteState()) return;
        activityLog.log(message).catch(() => {});
    }

    function formatActivityTime(timestamp) {
        if (!timestamp) return 'Ahora';
        return new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit' }).format(new Date(timestamp));
    }

    function renderActivity() {
        const list = document.getElementById('activity-list');
        const historyEntries = activityLog?.getEntries() || [];
        if (!historyEntries.length) {
            list.innerHTML = '<p>Todavía no hay cambios registrados.</p>';
            return;
        }
        list.innerHTML = historyEntries.slice().reverse().map(entry => `
            <div class="activity-entry"><strong>${escapeHTML(entry.actor || 'Dispositivo')}</strong> · ${escapeHTML(entry.actorRole || 'espectador')} · ${escapeHTML(entry.device || 'Navegador web')}<br>${escapeHTML(entry.message || 'Actualizó el torneo')}<time>${formatActivityTime(entry.createdAt)}</time></div>
        `).join('');
    }

    function openActivityModal() {
        renderActivity();
        document.getElementById('activity-modal').hidden = false;
    }

    function closeActivityModal() {
        document.getElementById('activity-modal').hidden = true;
    }

    async function ensureFirebase() {
        if (realtimeDb) return realtimeDb;
        try {
            realtimeDb = await firebaseClient.getDatabase();
            return realtimeDb;
        } catch (error) {
            console.error(error);
            setSyncStatus('No se pudo conectar al torneo compartido');
            throw error;
        }
    }

    async function connectToTournament(id) {
        try {
            if (generatingFixture) {
                fixtureGenerationRevision += 1;
                fixtureGeneratorWorker.cancel();
                generatingFixture = false;
            }
            await ensureFirebase();
            if (tournamentSync) tournamentSync.disconnect();
            if (tournamentIdentity) tournamentIdentity.disconnect();
            if (activityLog) activityLog.disconnect();
            tournamentId = id;
            historyRecordedForTournament = false;
            actorPlayerId = null;
            tournamentAccessRole = null;
            claimedPlayers = {};
            identityPromptShown = false;
            claimsLoaded = false;
            sharedStateLoaded = false;
            updateIdentityStatus();
            setSyncStatus('Conectando al torneo compartido…');
            if (invitationToken) {
                await firebaseClient.callFunction('joinTournamentV2', {
                    tournamentId: id,
                    token: invitationToken
                }, { allowAnonymous: true });
            }
            tournamentSync = createTournamentSync({
                database: realtimeDb,
                callFunction: (...args) => firebaseClient.callFunction(...args),
                getStateSignature,
                onStatus: setSyncStatus,
                onRemoteState: (remoteState, { changedByAnotherDevice }) => {
                sharedStateLoaded = true;
                if (!remoteState) {
                    maybeRequestIdentity();
                    return;
                }
                if (changedByAnotherDevice) {
                    stateStore.clearUndo();
                    updateUndoButton();
                }
                setState({
                    ...remoteState,
                    ui: { collapsedRounds: tournamentState.value.collapsedRounds }
                });
                rememberCurrentTournament();
                maybeRequestIdentity();
                }
            });
            tournamentRef = tournamentSync.connect(id);
            tournamentIdentity = createV2TournamentIdentity(id);
            activityLog = createActivityLog({
                tournamentRef,
                serverTimestamp: () => firebaseClient.serverTimestamp(),
                getActorName,
                getActorIdentity,
                getDeviceLabel,
                onEntries: () => {
                if (!document.getElementById('activity-modal').hidden) renderActivity();
                }
            });
            activityLog.connect();
            await tournamentIdentity.connect({ actorName: getActorName(), actorPlayerId });
        } catch (error) {
            console.error(error);
            setSyncStatus(error?.message || 'No se pudo ingresar al torneo compartido');
        }
    }

    function createV2TournamentIdentity(id) {
        let presenceRef = null;
        let presenceListRef = null;
        let presenceListener = null;
        async function refreshAccess() {
            const view = await firebaseClient.callFunction('getTournamentAccessViewV2', {
                tournamentId: id
            }, { allowAnonymous: true });
            claimedPlayers = Object.fromEntries((view.claimedPlayerIds || []).map(playerId => [playerId, {
                uid: playerId === view.playerId ? sessionUser?.uid : 'ocupado'
            }]));
            tournamentAccessRole = view.role || null;
            claimsLoaded = true;
            if (Number.isInteger(view.playerId)) actorPlayerId = view.playerId;
            renderAuthStatus();
            renderPlayers();
            renderRounds();
            refreshIdentityChoiceIfNeeded();
            maybeRequestIdentity();
            return view;
        }
        return {
            async connect({ actorName = 'Espectador', actorPlayerId: connectedPlayerId = null } = {}) {
                await refreshAccess();
                if (!sessionUser?.uid) return;
                presenceRef = realtimeDb.ref(`tournamentPresence/${id}/${sessionUser.uid}`);
                presenceListRef = realtimeDb.ref(`tournamentPresence/${id}`);
                presenceListener = snapshot => setPresenceStatus(snapshot.val() || {});
                presenceListRef.on('value', presenceListener);
                await presenceRef.onDisconnect().remove();
                await presenceRef.set({
                    uid: sessionUser.uid,
                    role: Number.isInteger(connectedPlayerId) ? 'participant' : 'spectator',
                    actorPlayerId: connectedPlayerId,
                    actorName,
                    device: getDeviceLabel(),
                    updatedAt: firebaseClient.serverTimestamp()
                });
            },
            async claimPlayer(playerId) {
                await firebaseClient.callFunction('claimTournamentPlayerV2', {
                    tournamentId: id,
                    playerId
                }, { allowAnonymous: true });
                actorPlayerId = playerId;
                await refreshAccess();
                await this.updatePresence({
                    actorPlayerId: playerId,
                    actorName: tournamentState.value.players[playerId]
                });
                return true;
            },
            async restoreClaim(playerId) {
                actorPlayerId = playerId;
            },
            async updatePresence({ actorPlayerId: playerId = null, actorName = 'Espectador' } = {}) {
                if (!presenceRef) return;
                await presenceRef.update({
                    role: Number.isInteger(playerId) ? 'participant' : 'spectator',
                    actorPlayerId: playerId,
                    actorName,
                    updatedAt: firebaseClient.serverTimestamp()
                });
            },
            disconnect() {
                if (presenceListRef && presenceListener) presenceListRef.off('value', presenceListener);
                presenceRef?.remove().catch(() => {});
            }
        };
    }

    async function saveRemoteNow() {
        await tournamentSync?.saveNow();
    }

    function askTournamentName() {
        const modal = document.getElementById('tournament-name-modal');
        const input = document.getElementById('tournament-name-input');
        input.value = '';
        modal.hidden = false;
        setTimeout(() => input.focus(), 0);
        return new Promise(resolve => { resolveTournamentName = resolve; });
    }

    function closeTournamentNameModal(value) {
        document.getElementById('tournament-name-modal').hidden = true;
        if (resolveTournamentName) resolveTournamentName(value);
        resolveTournamentName = null;
    }

    function confirmTournamentName() {
        const name = document.getElementById('tournament-name-input').value.trim();
        closeTournamentNameModal(name || 'Torneo de Pádel');
    }

    function cancelTournamentName() {
        closeTournamentNameModal(null);
    }

    function createRandomRequestId() {
        return (crypto.randomUUID
            ? crypto.randomUUID()
            : Array.from(
                crypto.getRandomValues(new Uint8Array(16)),
                byte => byte.toString(16).padStart(2, '0')
            ).join('')
        ).replace(/-/g, '');
    }

    async function createRemoteTournament({
        configuration,
        numRounds,
        gamesPerSet,
        players,
        metadata
    }) {
        await ensureFirebase();
        const created = await firebaseClient.callFunction('createTournamentV2', {
            creationRequestId: createRandomRequestId(),
            configuration,
            numRounds,
            gamesPerSet,
            players,
            metadata
        });
        tournamentId = created.tournamentId;
        invitationToken = '';
        try {
            const invitation = await firebaseClient.callFunction('createTournamentInvitationV2', {
                tournamentId,
                role: 'participant'
            });
            invitationToken = invitation.token;
        } catch (error) {
            // El torneo ya existe y el owner puede abrirlo. El botón Compartir
            // volverá a intentar crear una invitación.
        }
        history.replaceState(null, '', createSharedTournamentUrl(
            location.origin,
            location.pathname,
            tournamentId,
            invitationToken
        ));
        stateStore.clearUndo();
        updateUndoButton();
        await connectToTournament(tournamentId);
        return created;
    }

    async function createSharedTournament(copyLink = false) {
        if (!tournamentId) {
            if (!sessionUser || !['admin', 'superAdmin'].includes(sessionRole)) {
                showToast('Iniciá sesión como admin para crear un torneo compartido.');
                openAuthModal();
                return;
            }
            const chosenName = await askTournamentName();
            if (chosenName === null) return;

            tournamentState.value.tournamentName = chosenName.trim() || 'Torneo de Pádel';
            tournamentState.value.tournamentDate = getTodayISODate();

            // Un torneo nuevo conserva la configuración, pero siempre empieza sin resultados.
            try {
                await generateScheduleWithoutBlocking(tournamentState.value.schedule.length || getNumRounds());
            } catch (error) {
                showToast('No se pudo preparar el fixture.');
                return;
            }
            tournamentState.value.collapsedRounds = {};
            try {
                await createRemoteTournament({
                    configuration: currentConfiguration(),
                    numRounds: tournamentState.value.schedule.length,
                    gamesPerSet: tournamentState.value.gamesPerSet,
                    players: tournamentState.value.players,
                    metadata: {
                        tournamentName: tournamentState.value.tournamentName,
                        tournamentDate: tournamentState.value.tournamentDate
                    }
                });
            } catch (error) {
                showToast(error?.message || 'No se pudo crear el torneo compartido.');
                return;
            }
        } else if (!tournamentRef) {
            await connectToTournament(tournamentId);
        }
        if (copyLink) copyTournamentLink();
        else showToast('¡Torneo compartido creado! Ahora compartí el link.');
    }

    async function copyTournamentLink() {
        if (!invitationToken && canManageCurrentTournament()) {
            try {
                const invitation = await firebaseClient.callFunction('createTournamentInvitationV2', {
                    tournamentId,
                    role: 'participant'
                });
                invitationToken = invitation.token;
            } catch (error) {
                showToast('No se pudo crear una invitación nueva.');
                return;
            }
        }
        const url = createSharedTournamentUrl(location.origin, location.pathname, tournamentId, invitationToken);
        navigator.clipboard.writeText(url).then(() => showToast('¡Link copiado! Todos verán los cambios al instante.'))
            .catch(() => prompt('Copiá este link:', url));
    }

    function loadLocal() {
        return localStateStore.load();
    }

    function loadFromHash() {
        const hash = location.hash.slice(1);
        if (!hash.startsWith('s=')) return false;
        try {
            setState(decodeState(hash.slice(2)));
            saveLocal();
            return true;
        } catch (e) {
            showToast('Link inválido');
            return false;
        }
    }

    async function shareState() {
        if (!tournamentId) {
            await createSharedTournament(true);
            return;
        }
        if (tournamentRef) {
            await saveRemoteNow();
            copyTournamentLink();
            return;
        }
        const url = createStandaloneShareUrl(location.origin, location.pathname, getState());
        navigator.clipboard.writeText(url).then(() => {
            showToast('¡Link copiado! Mandalo al grupo.');
        }).catch(() => {
            prompt('Copiá este link:', url);
        });
        history.replaceState(null, '', url);
    }

    function exportJSON() {
        const blob = new Blob([exportStateJSON(getState())], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'torneo-padel.json';
        a.click();
        showToast('Archivo descargado');
    }

    function importJSON() {
        document.getElementById('file-input').click();
    }

    document.getElementById('file-input').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (ev) => {
            try {
                const imported = importStateJSON(ev.target.result);
                if (!confirm(
                    'Importar crea un torneo nuevo. Se conservarán configuración, nombres, games y rondas, '
                    + 'pero no resultados, correcciones manuales, dueño, permisos ni actividad. ¿Continuar?'
                )) return;
                if (!sessionUser || !['admin', 'superAdmin'].includes(sessionRole)) {
                    showToast('Iniciá sesión como admin para importar y crear el torneo.');
                    openAuthModal();
                    return;
                }
                await createRemoteTournament({
                    configuration: imported.configuration,
                    numRounds: imported.state.numRounds,
                    gamesPerSet: imported.state.gamesPerSet,
                    players: imported.state.players,
                    metadata: {
                        tournamentName: imported.metadata.tournamentName || 'Torneo importado',
                        tournamentDate: imported.metadata.tournamentDate
                    }
                });
                showToast('Torneo nuevo creado desde el archivo, sin resultados anteriores.');
            } catch (err) {
                showToast(err?.message || 'Archivo inválido');
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    });

    async function resetSchedule() {
        if (generatingFixture) return;
        if (!confirm('¿Regenerar el fixture? Se pierden los resultados pero se mantienen los nombres.')) return;
        if (tournamentId) {
            tournamentSync?.mutate('regenerateFixture', {
                confirmDeleteScores: hasAnyScore(tournamentState.value.schedule)
            }).catch(error => showToast(error.message || 'No se pudo regenerar el fixture.'));
            return;
        }
        rememberStateForUndo();
        const previousState = tournamentState.snapshot();
        const savedPlayers = [...tournamentState.value.players];
        const nextVariant = tournamentState.value.fixtureVariant + 1;
        try {
            await generateScheduleWithoutBlocking(
                tournamentState.value.schedule.length || getNumRounds(),
                nextVariant
            );
        } catch (error) {
            tournamentState.replace(previousState);
            renderAll();
            showToast(error.code === 'NO_MORE_FIXTURE_VARIANTS'
                ? 'No quedan variantes diferentes para esta configuración.'
                : 'No se pudo regenerar el fixture.');
            return;
        }
        tournamentState.value.players = savedPlayers;
        tournamentState.value.collapsedRounds = {};
        saveLocal();
        logActivity('regeneró el fixture');
        renderAll();
        showToast('Fixture regenerado');
    }

    function resetAll() {
        if (generatingFixture) return;
        if (tournamentId) {
            showToast('Un torneo creado conserva su configuración. Creá otro para cambiarla.');
            return;
        }
        if (!confirm('¿Borrar todo (nombres y resultados)?')) return;
        rememberStateForUndo();
        tournamentState.value.numPlayers = 9;
        tournamentState.value.numCourts = 2;
        tournamentState.value.pairingMode = 'rotating';
        tournamentState.value.fixedTeams = [];
        tournamentState.value.fixtureVariant = 0;
        tournamentState.value.gamesPerSet = 4;
        tournamentState.value.players = defaultPlayers(tournamentState.value.numPlayers);
        generateSchedule();
        tournamentState.value.collapsedRounds = {};
        document.getElementById('player-count').value = tournamentState.value.numPlayers;
        document.getElementById('court-count').value = tournamentState.value.numCourts;
        document.getElementById('games-per-set').value = tournamentState.value.gamesPerSet;
        if (tournamentId) saveLocal();
        else {
            localStateStore.remove();
            history.replaceState(null, '', location.pathname);
        }
        renderAll();
        logActivity('reinició el torneo');
        showToast('Todo reiniciado');
    }

    function showToast(msg) {
        const t = document.getElementById('toast');
        t.textContent = msg;
        t.classList.add('show');
        setTimeout(() => t.classList.remove('show'), 2500);
    }

    function renderPlayers() {
        const container = document.getElementById('players-container');
        renderPlayerList(container, tournamentState.value.players, (index, previousName, nextName) => {
            if (tournamentId) {
                tournamentSync?.mutate('renamePlayer', { playerId: index, name: nextName })
                    .catch(error => {
                        showToast(error.message || 'No se pudo cambiar el nombre.');
                        renderPlayers();
                    });
                return;
            }
            rememberStateForUndo();
            tournamentState.value.players[index] = nextName;
            saveLocal();
            logActivity(`cambió el nombre de ${previousName} a ${nextName}`);
            updateIdentityStatus();
            renderRounds();
            calculateStats();
            renderFixtureConfiguration();
        }, index => !tournamentId || canManageCurrentTournament() || actorPlayerId === index);
    }

    function canEditPairing(match) {
        if (tournamentState.value.pairingMode === 'fixed' || hasAnyScore([{ matches: [match] }])) return false;
        if (!tournamentId) return true;
        return canManageCurrentTournament();
    }

    function canEditScore(match) {
        if (!tournamentId || canManageCurrentTournament()) return true;
        return Number.isInteger(actorPlayerId)
            && [match.t1_p1, match.t1_p2, match.t2_p1, match.t2_p2].includes(actorPlayerId);
    }

    function askPlayerChange(previousPlayer, selectedPlayer) {
        const modal = document.getElementById('player-change-modal');
        document.getElementById('player-change-description').textContent =
            `${tournamentState.value.players[selectedPlayer]} reemplaza a ${tournamentState.value.players[previousPlayer]}. ¿Cómo querés aplicar el cambio?`;
        modal.hidden = false;
        return new Promise(resolve => { resolvePlayerChange = resolve; });
    }

    function closePlayerChangeModal(value) {
        document.getElementById('player-change-modal').hidden = true;
        if (resolvePlayerChange) resolvePlayerChange(value);
        resolvePlayerChange = null;
    }

    function confirmPlayerChange(scope) {
        closePlayerChangeModal(scope);
    }

    function cancelPlayerChange() {
        closePlayerChangeModal(null);
    }

    async function updateMatchPlayer(roundIdx, matchIdx, role, newValue) {
        if (tournamentState.value.pairingMode === 'fixed') {
            renderRounds();
            showToast('Las parejas fijas no se pueden modificar.');
            return;
        }
        const round = tournamentState.value.schedule[roundIdx];
        const selectedPlayer = parseInt(newValue, 10);
        const targetMatch = round.matches[matchIdx];
        const previousPlayer = targetMatch[role];
        if (Number.isNaN(selectedPlayer) || selectedPlayer === previousPlayer) return;

        const scope = await askPlayerChange(previousPlayer, selectedPlayer);
        if (!scope) {
            renderRounds();
            return;
        }
        if (tournamentId && !canManageCurrentTournament()) {
            showToast('Sólo un administrador del torneo puede corregir las parejas.');
            renderRounds();
            return;
        }
        const sourceMatch = round.matches.find(match =>
            match !== targetMatch
            && [match.t1_p1, match.t1_p2, match.t2_p1, match.t2_p2].includes(selectedPlayer));
        const affectedMatches = sourceMatch ? [targetMatch, sourceMatch] : [targetMatch];
        if (hasAnyScore([{ matches: affectedMatches }])) {
            renderRounds();
            showToast('No se puede cambiar: uno de los partidos afectados ya tiene puntaje.');
            return;
        }
        if (tournamentId) {
            tournamentSync?.mutate('updateRotatingPairing', {
                expectedScheduleRevision: tournamentState.value.scheduleRevision,
                expectedScheduleFingerprint: tournamentState.value.scheduleFingerprint,
                roundId: round.id,
                matchId: targetMatch.id,
                expectedPlayerIds: [
                    targetMatch.t1_p1,
                    targetMatch.t1_p2,
                    targetMatch.t2_p1,
                    targetMatch.t2_p2
                ],
                role,
                playerId: selectedPlayer
            }).catch(error => {
                showToast(error.message || 'No se pudo corregir la pareja.');
                renderRounds();
            });
            return;
        }
        rememberStateForUndo();
        applySingleRoundPlayerChange(round, targetMatch, role, previousPlayer, selectedPlayer, tournamentState.value.numPlayers);
        tournamentState.value.scheduleRevision += 1;
        tournamentState.value.scheduleFingerprint = scheduleFingerprint(
            tournamentState.value.schedule,
            currentConfiguration(),
            tournamentState.value.fixtureVariant
        );
        saveLocal();
        logActivity(`cambió en esta ronda a ${tournamentState.value.players[previousPlayer]} por ${tournamentState.value.players[selectedPlayer]}`);
        renderRounds();
        calculateStats();
    }

    function updateScore(roundIdx, matchIdx, team, value) {
        const nextScore = normalizeScore(value, tournamentState.value.gamesPerSet);
        if (tournamentState.value.schedule[roundIdx].matches[matchIdx][team] === nextScore) return;
        if (tournamentId) {
            const round = tournamentState.value.schedule[roundIdx];
            const match = round.matches[matchIdx];
            tournamentSync?.mutate('updateScore', {
                expectedScheduleRevision: tournamentState.value.scheduleRevision,
                expectedScheduleFingerprint: tournamentState.value.scheduleFingerprint,
                roundId: round.id,
                matchId: match.id,
                expectedPlayerIds: [
                    match.t1_p1,
                    match.t1_p2,
                    match.t2_p1,
                    match.t2_p2
                ],
                field: team,
                value: nextScore
            })
                .catch(error => {
                    console.error(error);
                    showToast(error.message || 'No se pudo cargar el resultado.');
                    renderRounds();
                });
            return;
        }
        rememberStateForUndo();
        tournamentState.value.schedule[roundIdx].matches[matchIdx][team] = nextScore;
        saveLocal();
        const match = tournamentState.value.schedule[roundIdx].matches[matchIdx];
        if (isMatchDone(match)) {
            logActivity(`cargó el resultado ${match.score1}–${match.score2} de ${tournamentState.value.players[match.t1_p1]} / ${tournamentState.value.players[match.t1_p2]} vs ${tournamentState.value.players[match.t2_p1]} / ${tournamentState.value.players[match.t2_p2]}`);
        }
        calculateStats();
        updateProgress();
        renderRounds();
        renderAuthStatus();
    }

    function adjustScore(roundIdx, matchIdx, team, amount) {
        const current = tournamentState.value.schedule[roundIdx].matches[matchIdx][team];
        const next = getAdjustedScore(current, amount, tournamentState.value.gamesPerSet);
        if (tournamentId) {
            if (next === current) return;
            const round = tournamentState.value.schedule[roundIdx];
            const match = round.matches[matchIdx];
            tournamentSync?.mutate('adjustScore', {
                expectedScheduleRevision: tournamentState.value.scheduleRevision,
                expectedScheduleFingerprint: tournamentState.value.scheduleFingerprint,
                roundId: round.id,
                matchId: match.id,
                expectedPlayerIds: [
                    match.t1_p1,
                    match.t1_p2,
                    match.t2_p1,
                    match.t2_p2
                ],
                field: team,
                amount
            }).catch(error => {
                console.error(error);
                showToast(error.message || 'No se pudo ajustar el resultado.');
                renderRounds();
            });
            return;
        }
        updateScore(roundIdx, matchIdx, team, next);
    }

    function getRestingPlayers(round) {
        const playing = new Set();
        round.matches.forEach(m => {
            playing.add(m.t1_p1); playing.add(m.t1_p2);
            playing.add(m.t2_p1); playing.add(m.t2_p2);
        });
        const resting = [];
        for (let i = 0; i < tournamentState.value.numPlayers; i++) {
            if (!playing.has(i)) resting.push(tournamentState.value.players[i]);
        }
        return resting;
    }

    function toggleRound(rIdx) {
        tournamentState.value.collapsedRounds[rIdx] = !tournamentState.value.collapsedRounds[rIdx];
        saveLocal();
        renderRounds();
    }

    function renderRounds() {
        const container = document.getElementById('rounds-container');
        renderRoundCards(container, {
            schedule: tournamentState.value.schedule,
            players: tournamentState.value.players,
            gamesPerSet: tournamentState.value.gamesPerSet,
            collapsedRounds: tournamentState.value.collapsedRounds,
            getRestingPlayers,
            isMatchDone,
            isRoundDone,
            getScoreWarning,
            onToggleRound: toggleRound,
            onUpdatePlayer: updateMatchPlayer,
            onAdjustScore: adjustScore,
            onUpdateScore: updateScore,
            canEditPairing,
            canEditScore
        });
    }

    function calculateStats() {
        const stats = getLeaderboardStats(tournamentState.value.players, tournamentState.value.schedule);

        renderLeaderboard(document.getElementById('leaderboard-body'), stats);
    }

    function escapeHTML(value) {
        return String(value).replace(/[&<>'"]/g, char => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
        }[char]));
    }

    function getTournamentSummaryText() {
        const title = tournamentState.value.tournamentName || 'Torneo Americano Pádel';
        const date = tournamentState.value.tournamentDate ? formatTournamentDate(tournamentState.value.tournamentDate) : '';
        return buildTournamentSummaryText({
            players: tournamentState.value.players,
            schedule: tournamentState.value.schedule,
            title,
            date
        });
    }

    function openSummaryModal() {
        const stats = getLeaderboardStats(tournamentState.value.players, tournamentState.value.schedule);
        const streak = getBestStreak(tournamentState.value.players, tournamentState.value.schedule);
        const progress = getProgress(tournamentState.value.schedule);
        const leader = stats[0];
        const positions = stats.slice(0, 3).map((player, index) =>
            `<li>${['🥇', '🥈', '🥉'][index]} <strong>${escapeHTML(player.name)}</strong> · ${player.v}V, ${player.d}D, Dif ${player.dif >= 0 ? '+' : ''}${player.dif}</li>`
        ).join('');
        renderSummaryModal(document.getElementById('summary-content'), { leader, positions, streak, progress, escapeHTML });
        setModalOpen('summary-modal', true);
    }

    function closeSummaryModal() {
        setModalOpen('summary-modal', false);
    }

    function copyTournamentSummary() {
        navigator.clipboard.writeText(getTournamentSummaryText())
            .then(() => showToast('Resumen copiado'))
            .catch(() => prompt('Copiá este resumen:', getTournamentSummaryText()));
    }

    async function shareTournamentSummary() {
        const text = getTournamentSummaryText();
        if (navigator.share) {
            try {
                await navigator.share({ title: tournamentState.value.tournamentName || 'Torneo Americano Pádel', text });
            } catch (error) {
                if (error.name !== 'AbortError') copyTournamentSummary();
            }
            return;
        }
        copyTournamentSummary();
    }

    function updateProgress() {
        const progress = getProgress(tournamentState.value.schedule);
        document.getElementById('progress-fill').style.width = progress.percentage + '%';
        document.getElementById('progress-text').textContent =
            `${progress.completed} de ${progress.total} partidos anotados (${progress.percentage}%)`;
    }

    function renderAll() {
        updateTournamentHeader();
        updateIdentityStatus();
        updateUndoButton();
        updateSubtitle();
        renderAuthStatus();
        renderFixtureConfiguration();
        renderPreviousTournaments();
        renderPlayers();
        renderRounds();
        calculateStats();
        updateProgress();
        updatePageView();
    }

    function initializeApplication() {
    authSession.subscribe(user => {
        sessionUser = user;
        if (!user) {
            bootstrapAttemptUid = null;
            bootstrapAttemptPromise = null;
        }
        refreshSessionRole().then(() => bootstrapSuperAdmin());
    });
    tournamentState.value.players = defaultPlayers(tournamentState.value.numPlayers);
    generateSchedule();
    if (!loadFromHash()) {
        const saved = loadLocal();
        if (saved) {
            try {
                setState(saved);
            } catch (error) {
                localStateStore.remove();
                renderAll();
                showToast('El borrador anterior no es compatible con la versión 2.');
            }
        } else renderAll();
    }
    if (tournamentId) connectToTournament(tournamentId);
    else loadSharedTournamentCatalog();
    updatePageView();
    }

    function bindApplicationEvents() {
    bindStaticUIEvents({
    cancelPlayerChange, cancelTournamentName, changeCourtCount, changeGamesPerSet, changePlayerCount,
    changeRoundCount, closeActivityModal, closeSummaryModal,
    confirmIdentitySelection, confirmPlayerChange, confirmTournamentName,
    continueIdentitySelection, copyTournamentSummary, createSharedTournament,
    enterAsSpectator, exportJSON, goHome, importJSON, openActivityModal, openAuthModal, openPreviousTournament, openSummaryModal,
    resetAll, resetSchedule, sendPasswordReset, setCourtCount, setGamesPerSet, setPlayerCount, setRoundCount,
    setPairingMode, setFixedTeamPlayer,
    shareState, shareTournamentSummary, showIdentityChoice, showMainPage, showTournamentHistory, signInWithEmailAndPassword,
    signInWithGoogle, signOut, closeAuthModal, undoLastChange,
    openUsersModal, closeUsersModal, createAdminUser, deleteAdminUser,
    startAdminEdit, cancelAdminEdit, toggleAdminUser, generateAdminPasswordResetLink,
    openTournamentAdminModal, closeTournamentAdminModal, setTournamentAdmin
    , closeDeleteTournamentModal, confirmDeleteTournament, requestDeleteTournament, restoreTournament,
    toggleTournamentDeletionSelection, selectAllTournamentsForDeletion,
    clearTournamentDeletionSelection, requestDeleteSelectedTournaments, requestPermanentTournamentDeletion
    , restoreSelectedTournaments, requestPermanentlyDeleteSelectedTournaments
    });
    }

    export function createTournamentApplication() {
        return createAppController({
            initialize: initializeApplication,
            bindEvents: bindApplicationEvents,
            onHashChange: () => {
                loadFromHash();
                updatePageView();
            }
        });
    }
