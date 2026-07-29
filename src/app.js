import { createStateStore, createTournamentState } from './state/store.js';
import { createDefaultState, normalizeState } from './state/model.js';
import { createLocalStorageStore } from './services/local-storage.js';
import { createTournamentHistoryStore } from './services/tournament-history.js';
import { filterTournamentCatalog, loadTournamentCatalog } from './services/tournament-catalog.js';
import {
    createAutomaticRound as createFixtureRound,
    generateSchedule as buildSchedule,
    getCourts,
    getNumRounds,
    getPlayingCount,
    getRestCount
} from './features/fixture/generator.js';
import { hasResults, resizeRounds } from './features/fixture/rounds.js';
import {
    applySingleRoundPlayerChange,
    hasRecordedScoresFromRound,
    swapPlayersInRound
} from './features/fixture/player-swaps.js';
import { adjustScore as getAdjustedScore, normalizeScore } from './features/scoring/scores.js';
import { getScoreWarning, isMatchDone, isRoundDone } from './features/scoring/validation.js';
import { getBestStreak, getLeaderboardStats, getProgress } from './features/scoring/statistics.js';
import { buildTournamentSummaryText } from './features/scoring/summary.js';
import { createFirebaseClient } from './services/firebase.js';
import { createAuthSession } from './services/auth-session.js';
import { createAdminUserApi } from './services/admin-user-api.js';
import { createTournamentMetadataStore } from './services/tournament-metadata-store.js';
import { createTournamentSync } from './services/tournament-sync.js';
import { createTournamentIdentity } from './services/identity.js';
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
    const MAX_COURTS = 2;
    const MIN_GAMES_PER_SET = 1;
    const MAX_GAMES_PER_SET = 20;
    const MIN_ROUNDS = 1;
    const MAX_ROUNDS = 50;

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
    let realtimeDb = null;
    let tournamentMetadataStore = null;
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
    let bootstrapAttemptUid = null;
    let bootstrapAttemptPromise = null;
    let adminUsers = [];
    let editingAdminUid = null;
    let pendingTournamentDeletion = null;
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

    function defaultPlayers(n) {
        return createDefaultState({ numPlayers: n }).players;
    }

    function createAutomaticRound(roundIndex) {
        return createFixtureRound(tournamentState.value.numPlayers, roundIndex, tournamentState.value.numCourts);
    }

    function generateSchedule(roundCount = getNumRounds(tournamentState.value.numPlayers, tournamentState.value.numCourts)) {
        tournamentState.value.schedule = buildSchedule(tournamentState.value.numPlayers, roundCount, {
            minRounds: MIN_ROUNDS,
            maxRounds: MAX_ROUNDS,
            maxCourts: tournamentState.value.numCourts
        });
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
        const roleLabel = sessionRole === 'superAdmin' ? ' · Super admin' : sessionRole === 'admin' ? ' · Admin' : '';
        status.textContent = isRegisteredUser
            ? `Sesión iniciada: ${sessionUser.displayName}${roleLabel}`
            : 'Modo invitado: podés entrar a un torneo compartido desde su link.';
        const canConfigure = !tournamentId || ['admin', 'superAdmin'].includes(sessionRole);
        ['player-count', 'round-count', 'court-count', 'games-per-set', 'player-count-decrease', 'player-count-increase',
            'round-count-decrease', 'round-count-increase', 'games-decrease', 'games-increase', 'reset-schedule-button', 'reset-all-button']
            .forEach(id => {
                const control = document.getElementById(id);
                if (control) control.disabled = !canConfigure;
            });
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
        if (sessionRole !== 'superAdmin' || !sessionUser || !tournamentId || !tournamentMetadataStore) return;
        try {
            const metadata = await tournamentMetadataStore.get(tournamentId);
            if (!metadata.ownerUid && !Object.keys(metadata.admins).length) {
                await tournamentMetadataStore.initializeLegacy(tournamentId, sessionUser.uid);
            }
        } catch (error) {
            console.warn('No se pudo preparar la metadata del torneo anterior.', error);
        }
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
            const [users, metadata] = await Promise.all([adminUserApi.list(), tournamentMetadataStore.get(tournamentId)]);
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
        const plural = tournaments.length !== 1;
        document.getElementById('delete-tournament-modal-title').textContent = plural ? `¿Borrar ${tournaments.length} torneos?` : '¿Borrar torneo?';
        document.getElementById('delete-tournament-description').textContent = plural
            ? 'Los torneos se ocultarán del historial de admins. Como super admin podrás restaurarlos más adelante.'
            : 'El torneo se ocultará del historial de admins. Como super admin podrás restaurarlo más adelante.';
        document.getElementById('confirm-delete-tournament-button').textContent = plural ? `🗑️ Borrar ${tournaments.length} torneos` : '🗑️ Borrar torneo';
        renderDeleteTournamentDetails(tournaments);
        setModalOpen('delete-tournament-modal', true);
    }

    function requestDeleteTournament(id) {
        requestDeleteTournaments([id]);
    }

    function requestDeleteSelectedTournaments() {
        requestDeleteTournaments(selectedTournamentDeletionIds);
    }

    function toggleTournamentDeletionSelection(id, selected) {
        if (sessionRole !== 'superAdmin') return;
        if (selected) selectedTournamentDeletionIds.add(id);
        else selectedTournamentDeletionIds.delete(id);
        renderPreviousTournaments();
    }

    function selectAllTournamentsForDeletion() {
        if (sessionRole !== 'superAdmin') return;
        selectedTournamentDeletionIds = new Set(sharedTournamentCatalog.filter(entry => !entry.deletedAt).map(entry => entry.id));
        renderPreviousTournaments();
    }

    function clearTournamentDeletionSelection() {
        selectedTournamentDeletionIds.clear();
        renderPreviousTournaments();
    }

    async function confirmDeleteTournament() {
        const tournaments = pendingTournamentDeletion;
        if (!tournaments?.length || sessionRole !== 'superAdmin') return;
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
        selectedTournamentDeletionIds = new Set([...selectedTournamentDeletionIds].filter(id => entries.some(entry => entry.id === id && !entry.deletedAt)));
        const canDelete = sessionRole === 'superAdmin';
        renderTournamentHistory(container, entries, {
            formatDate: formatTournamentDate,
            formatLastOpened: formatTournamentUpdatedAt,
            canDelete,
            selectedIds: selectedTournamentDeletionIds
        });
        const batchActions = document.getElementById('tournament-batch-actions');
        batchActions.hidden = !canDelete || !entries.some(entry => !entry.deletedAt);
        document.getElementById('tournament-selection-status').textContent = `${selectedTournamentDeletionIds.size} seleccionado${selectedTournamentDeletionIds.size === 1 ? '' : 's'}`;
        document.getElementById('delete-selected-tournaments-button').disabled = selectedTournamentDeletionIds.size === 0;
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
        const availableCourts = Math.min(MAX_COURTS, Math.floor(tournamentState.value.numPlayers / 4));
        renderTournamentToolbar({ tournamentId, tournamentName: tournamentState.value.tournamentName, tournamentDate: tournamentState.value.tournamentDate, formattedDate: formatTournamentDate(tournamentState.value.tournamentDate), numPlayers: tournamentState.value.numPlayers, gamesPerSet: tournamentState.value.gamesPerSet, scheduleLength: rounds, courts, rest, plannedRounds, availableCourts });
    }

    function resizePlayers(newCount) {
        const old = [...tournamentState.value.players];
        tournamentState.value.players = defaultPlayers(newCount);
        for (let i = 0; i < Math.min(old.length, newCount); i++) {
            tournamentState.value.players[i] = old[i];
        }
        tournamentState.value.numPlayers = newCount;
        document.getElementById('player-count').value = newCount;
    }

    function changePlayerCount(delta) {
        setPlayerCount(tournamentState.value.numPlayers + delta);
    }

    function changeRoundCount(delta) {
        setRoundCount(tournamentState.value.schedule.length + delta);
    }

    function setCourtCount(newCount) {
        if (Number.isNaN(newCount)) return;
        const maxAvailableCourts = Math.min(MAX_COURTS, Math.floor(tournamentState.value.numPlayers / 4));
        newCount = Math.max(1, Math.min(maxAvailableCourts, newCount));
        if (newCount === tournamentState.value.numCourts) {
            document.getElementById('court-count').value = tournamentState.value.numCourts;
            return;
        }

        const hasScores = tournamentState.value.schedule.some(round => round.matches.some(match => match.score1 !== '' || match.score2 !== ''));
        if (hasScores && !confirm(`¿Usar ${newCount} cancha${newCount === 1 ? '' : 's'}? Se regenerará el fixture y se pierden los resultados.`)) {
            document.getElementById('court-count').value = tournamentState.value.numCourts;
            return;
        }

        rememberStateForUndo();
        const currentRoundCount = tournamentState.value.schedule.length || getNumRounds(tournamentState.value.numPlayers, tournamentState.value.numCourts);
        tournamentState.value.numCourts = newCount;
        generateSchedule(currentRoundCount);
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
        newTarget = Math.max(MIN_GAMES_PER_SET, Math.min(MAX_GAMES_PER_SET, newTarget));
        if (newTarget === tournamentState.value.gamesPerSet) {
            document.getElementById('games-per-set').value = tournamentState.value.gamesPerSet;
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

    function setPlayerCount(newCount) {
        if (isNaN(newCount)) return;
        newCount = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, newCount));
        if (newCount === tournamentState.value.numPlayers) {
            document.getElementById('player-count').value = tournamentState.value.numPlayers;
            return;
        }

        const hasScores = tournamentState.value.schedule.some(r => r.matches.some(m => m.score1 !== '' || m.score2 !== ''));
        if (hasScores && !confirm(`¿Cambiar a ${newCount} jugadores? Se regenerará el fixture y se pierden los resultados.`)) {
            document.getElementById('player-count').value = tournamentState.value.numPlayers;
            return;
        }

        rememberStateForUndo();
        const currentRoundCount = tournamentState.value.schedule.length || getNumRounds(tournamentState.value.numPlayers, tournamentState.value.numCourts);
        resizePlayers(newCount);
        tournamentState.value.numCourts = Math.min(tournamentState.value.numCourts, Math.floor(newCount / 4));
        generateSchedule(currentRoundCount);
        tournamentState.value.collapsedRounds = {};
        saveLocal();
        logActivity(`cambió la cantidad de jugadores a ${tournamentState.value.numPlayers}`);
        renderAll();
        showToast(`${newCount} jugadores · fixture actualizado`);
    }

    function setRoundCount(newCount) {
        if (Number.isNaN(newCount)) {
            document.getElementById('round-count').value = tournamentState.value.schedule.length;
            return;
        }
        newCount = Math.max(MIN_ROUNDS, Math.min(MAX_ROUNDS, newCount));
        const currentCount = tournamentState.value.schedule.length;
        if (newCount === currentCount) {
            document.getElementById('round-count').value = currentCount;
            return;
        }
        if (newCount < currentCount) {
            const roundsToRemove = tournamentState.value.schedule.slice(newCount);
            const hasRecordedResults = hasResults(roundsToRemove, isMatchDone);
            if (hasRecordedResults) {
                document.getElementById('round-count').value = currentCount;
                showToast('No se pueden quitar rondas que ya tienen resultados cargados.');
                return;
            }
            if (!confirm(`¿Quitar las últimas ${currentCount - newCount} ronda${currentCount - newCount === 1 ? '' : 's'}?`)) {
                document.getElementById('round-count').value = currentCount;
                return;
            }
        }

        rememberStateForUndo();
        const resized = resizeRounds({
            schedule: tournamentState.value.schedule,
            collapsedRounds: tournamentState.value.collapsedRounds,
            targetCount: newCount,
            createRound: createAutomaticRound
        });
        tournamentState.value.schedule = resized.schedule;
        tournamentState.value.collapsedRounds = resized.collapsedRounds;
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
        if (button) button.disabled = !stateStore.hasUndo();
    }

    function undoLastChange() {
        if (!stateStore.undo()) return;
        saveLocal();
        logActivity('deshizo su último cambio');
        updateUndoButton();
        showToast('Último cambio deshecho');
    }

    function setState(state) {
        const normalized = normalizeState({ ...getState(), ...state }, {
            maxCourts: MAX_COURTS,
            minGamesPerSet: MIN_GAMES_PER_SET,
            maxGamesPerSet: MAX_GAMES_PER_SET
        });
        tournamentState.replace(normalized);
        document.getElementById('player-count').value = tournamentState.value.numPlayers;
        document.getElementById('court-count').value = tournamentState.value.numCourts;
        document.getElementById('games-per-set').value = tournamentState.value.gamesPerSet;
        renderAll();
    }

    function saveLocal() {
        localStateStore.save(getState());
        queueRemoteSave();
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
        const canSeeDetails = sessionRole === 'admin' || sessionRole === 'superAdmin';
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
            tournamentMetadataStore = createTournamentMetadataStore({
                database: realtimeDb,
                serverTimestamp: () => firebaseClient.serverTimestamp()
            });
            return realtimeDb;
        } catch (error) {
            console.error(error);
            setSyncStatus('No se pudo conectar al torneo compartido');
            throw error;
        }
    }

    async function connectToTournament(id) {
        try {
            await ensureFirebase();
            if (tournamentSync) tournamentSync.disconnect();
            if (tournamentIdentity) tournamentIdentity.disconnect();
            if (activityLog) activityLog.disconnect();
            tournamentId = id;
            historyRecordedForTournament = false;
            actorPlayerId = null;
            claimedPlayers = {};
            identityPromptShown = false;
            claimsLoaded = false;
            sharedStateLoaded = false;
            updateIdentityStatus();
            setSyncStatus('Conectando al torneo compartido…');
            tournamentSync = createTournamentSync({
                database: realtimeDb,
                serverTimestamp: () => firebaseClient.serverTimestamp(),
                getState,
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
                setState(remoteState);
                rememberCurrentTournament();
                maybeRequestIdentity();
                }
            });
            tournamentRef = tournamentSync.connect(id);
            tournamentIdentity = createTournamentIdentity({
                tournamentRef,
                presenceId,
                serverTimestamp: () => firebaseClient.serverTimestamp(),
                getPlayerName: id => tournamentState.value.players[id],
                getDeviceLabel,
                authUid: sessionUser?.uid || '',
                actorRole: sessionRole || 'spectator',
                onPresenceCount: () => {},
                onPresence: setPresenceStatus,
                onClaims: claims => {
                    claimedPlayers = claims;
                    claimsLoaded = true;
                    refreshIdentityChoiceIfNeeded();
                    maybeRequestIdentity();
                }
            });
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
            await migrateLegacyTournamentIfNeeded();
        } catch (error) { /* status set in ensureFirebase */ }
    }

    function queueRemoteSave() {
        tournamentSync?.queueSave();
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
            generateSchedule(tournamentState.value.schedule.length || getNumRounds(tournamentState.value.numPlayers, tournamentState.value.numCourts));
            tournamentState.value.collapsedRounds = {};
            const id = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`).replace(/-/g, '');
            tournamentId = id;
            history.replaceState(null, '', `${location.pathname}?torneo=${id}`);
            saveLocal();
            renderAll();
            // La metadata debe existir antes de conectar: al conectarse, los
            // torneos sin metadata se tratan como legados y perderían el
            // ownerUid del admin que los creó.
            await ensureFirebase();
            await tournamentMetadataStore?.initialize(id, sessionUser.uid);
            await connectToTournament(id);
            await saveRemoteNow();
        } else if (!tournamentRef) {
            await connectToTournament(tournamentId);
        }
        if (copyLink) copyTournamentLink();
        else showToast('¡Torneo compartido creado! Ahora compartí el link.');
    }

    function copyTournamentLink() {
        const url = createSharedTournamentUrl(location.origin, location.pathname, tournamentId);
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
        reader.onload = (ev) => {
            try {
                rememberStateForUndo();
                setState(importStateJSON(ev.target.result));
                saveLocal();
                logActivity('importó un archivo del torneo');
                showToast('Datos importados');
            } catch (err) {
                showToast('Archivo inválido');
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    });

    function resetSchedule() {
        if (!confirm('¿Regenerar el fixture? Se pierden los resultados pero se mantienen los nombres.')) return;
        rememberStateForUndo();
        const savedPlayers = [...tournamentState.value.players];
        generateSchedule(tournamentState.value.schedule.length || getNumRounds(tournamentState.value.numPlayers, tournamentState.value.numCourts));
        tournamentState.value.players = savedPlayers;
        tournamentState.value.collapsedRounds = {};
        saveLocal();
        logActivity('regeneró el fixture');
        renderAll();
        showToast('Fixture regenerado');
    }

    function resetAll() {
        if (!confirm('¿Borrar todo (nombres y resultados)?')) return;
        rememberStateForUndo();
        tournamentState.value.numPlayers = 9;
        tournamentState.value.numCourts = 2;
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
            rememberStateForUndo();
            tournamentState.value.players[index] = nextName;
            saveLocal();
            logActivity(`cambió el nombre de ${previousName} a ${nextName}`);
            updateIdentityStatus();
            renderRounds();
            calculateStats();
        });
    }

    function canEditMatch(match) {
        if (!tournamentId || ['admin', 'superAdmin'].includes(sessionRole)) return true;
        return Number.isInteger(actorPlayerId) && [match.t1_p1, match.t1_p2, match.t2_p1, match.t2_p2].includes(actorPlayerId);
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
        if (tournamentId && !['admin', 'superAdmin'].includes(sessionRole)) {
            if (scope === 'future') {
                showToast('Como jugador sólo podés corregir la ronda actual.');
                renderRounds();
                return;
            }
            try {
                await firebaseClient.callFunction('updateParticipantPairing', {
                    tournamentId, roundIndex: roundIdx, matchIndex: matchIdx, role, playerId: selectedPlayer
                }, { allowAnonymous: true });
            } catch (error) {
                console.error(error);
                showToast(error.message || 'No se pudo corregir esa pareja.');
                renderRounds();
            }
            return;
        }
        if (scope === 'future') {
            if (hasRecordedScoresFromRound(tournamentState.value.schedule, roundIdx, isMatchDone)) {
                renderRounds();
                showToast('No se puede cambiar el resto: ya hay resultados cargados desde esta ronda.');
                return;
            }
            rememberStateForUndo();
            for (let index = roundIdx; index < tournamentState.value.schedule.length; index++) {
                swapPlayersInRound(tournamentState.value.schedule[index], previousPlayer, selectedPlayer, tournamentState.value.numPlayers);
            }
        } else {
            rememberStateForUndo();
            applySingleRoundPlayerChange(round, targetMatch, role, previousPlayer, selectedPlayer, tournamentState.value.numPlayers);
        }
        saveLocal();
        logActivity(`${scope === 'future' ? 'reemplazó en las rondas restantes' : 'cambió en esta ronda'} a ${tournamentState.value.players[previousPlayer]} por ${tournamentState.value.players[selectedPlayer]}`);
        renderRounds();
        calculateStats();
    }

    function updateScore(roundIdx, matchIdx, team, value) {
        const nextScore = normalizeScore(value, tournamentState.value.gamesPerSet);
        if (tournamentState.value.schedule[roundIdx].matches[matchIdx][team] === nextScore) return;
        if (tournamentId && !['admin', 'superAdmin'].includes(sessionRole)) {
            firebaseClient.callFunction('updateParticipantScore', {
                tournamentId, roundIndex: roundIdx, matchIndex: matchIdx, team, score: nextScore
            }, { allowAnonymous: true })
                .catch(error => {
                    console.error(error);
                    showToast('Sólo podés cargar resultados de los partidos que jugás.');
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
    }

    function adjustScore(roundIdx, matchIdx, team, amount) {
        const current = tournamentState.value.schedule[roundIdx].matches[matchIdx][team];
        const next = getAdjustedScore(current, amount, tournamentState.value.gamesPerSet);
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
            canEditMatch
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
        renderAuthStatus();
        updateIdentityStatus();
        updateUndoButton();
        updateSubtitle();
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
        if (saved) setState(saved);
        else renderAll();
    }
    if (tournamentId) connectToTournament(tournamentId);
    else loadSharedTournamentCatalog();
    updatePageView();
    }

    function bindApplicationEvents() {
    bindStaticUIEvents({
    cancelPlayerChange, cancelTournamentName, changeGamesPerSet, changePlayerCount,
    changeRoundCount, closeActivityModal, closeSummaryModal,
    confirmIdentitySelection, confirmPlayerChange, confirmTournamentName,
    continueIdentitySelection, copyTournamentSummary, createSharedTournament,
    enterAsSpectator, exportJSON, goHome, importJSON, openActivityModal, openAuthModal, openPreviousTournament, openSummaryModal,
    resetAll, resetSchedule, sendPasswordReset, setCourtCount, setGamesPerSet, setPlayerCount, setRoundCount,
    shareState, shareTournamentSummary, showIdentityChoice, showMainPage, showTournamentHistory, signInWithEmailAndPassword,
    signInWithGoogle, signOut, closeAuthModal, undoLastChange,
    openUsersModal, closeUsersModal, createAdminUser, deleteAdminUser,
    startAdminEdit, cancelAdminEdit, toggleAdminUser, generateAdminPasswordResetLink,
    openTournamentAdminModal, closeTournamentAdminModal, setTournamentAdmin
    , closeDeleteTournamentModal, confirmDeleteTournament, requestDeleteTournament, restoreTournament,
    toggleTournamentDeletionSelection, selectAllTournamentsForDeletion,
    clearTournamentDeletionSelection, requestDeleteSelectedTournaments
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
