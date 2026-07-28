import { createStateStore, createTournamentState } from './state/store.js';
import { createDefaultState, normalizeState } from './state/model.js';
import { createLocalStorageStore } from './services/local-storage.js';
import { createTournamentHistoryStore } from './services/tournament-history.js';
import { loadTournamentCatalog } from './services/tournament-catalog.js';
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
import { createTournamentSync } from './services/tournament-sync.js';
import { createTournamentIdentity } from './services/identity.js';
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
    let tournamentId = new URLSearchParams(location.search).get('torneo');
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
        const isRegisteredUser = sessionUser && !sessionUser.isAnonymous;
        signInButton.hidden = Boolean(isRegisteredUser);
        signOutButton.hidden = !isRegisteredUser;
        const roleLabel = sessionRole === 'superAdmin' ? ' · Super admin' : sessionRole === 'admin' ? ' · Admin' : '';
        status.textContent = isRegisteredUser
            ? `Sesión iniciada: ${sessionUser.displayName}${roleLabel}`
            : 'Modo invitado: podés entrar a un torneo compartido desde su link.';
    }

    async function refreshSessionRole(forceRefresh = false) {
        try {
            const claims = await authSession.getClaims(forceRefresh);
            sessionRole = claims.platformRole || null;
        } catch (error) {
            sessionRole = null;
        }
        renderAuthStatus();
    }

    async function bootstrapSuperAdmin() {
        try {
            await firebaseClient.callFunction('bootstrapSuperAdmin');
            await refreshSessionRole(true);
            return sessionRole === 'superAdmin';
        } catch (error) {
            await refreshSessionRole();
            return false;
        }
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
        renderTournamentHistory(container, tournamentId ? [] : sharedTournamentCatalog, {
            formatDate: formatTournamentDate,
            formatLastOpened: formatTournamentUpdatedAt
        });
    }

    async function loadSharedTournamentCatalog() {
        if (tournamentId) return;
        try {
            const database = await ensureFirebase();
            sharedTournamentCatalog = await loadTournamentCatalog(database, tournamentHistoryStore.load());
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

    function setPresenceStatus(count) {
        const status = document.getElementById('presence-status');
        if (!status) return;
        if (!tournamentId) {
            status.hidden = true;
            return;
        }
        status.hidden = false;
        status.textContent = `👥 ${count} persona${count === 1 ? '' : 's'} conectada${count === 1 ? '' : 's'}`;
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
            return !claim || claim.presenceId === presenceId;
        });
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
        const ownClaim = Object.entries(claimedPlayers).find(([, claim]) => claim?.presenceId === presenceId);
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
            <div class="activity-entry"><strong>${escapeHTML(entry.actor || 'Dispositivo')}</strong> · ${escapeHTML(entry.device || 'Navegador web')}<br>${escapeHTML(entry.message || 'Actualizó el torneo')}<time>${formatActivityTime(entry.createdAt)}</time></div>
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
                onPresenceCount: setPresenceStatus,
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
                getDeviceLabel,
                onEntries: () => {
                if (!document.getElementById('activity-modal').hidden) renderActivity();
                }
            });
            activityLog.connect();
            await tournamentIdentity.connect({ actorName: getActorName(), actorPlayerId });
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
            onUpdateScore: updateScore
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
        refreshSessionRole();
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
    signInWithGoogle, signOut, closeAuthModal, undoLastChange
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
