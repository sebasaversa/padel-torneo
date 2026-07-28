import { createStateStore, createTournamentState } from './state/store.js';
import { createDefaultState, normalizeState } from './state/model.js';
import { createLocalStorageStore } from './services/local-storage.js';
import {
    createAutomaticRound as createFixtureRound,
    generateSchedule as buildSchedule,
    getCourts,
    getNumRounds,
    getPlayingCount,
    getRestCount
} from './features/fixture/generator.js';

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
    const firebaseConfig = {
        apiKey: 'AIzaSyAEWG54OzZ7QMHb6otPJTLwuE8ttbBNnPc',
        authDomain: 'padel-torneo-ec30a.firebaseapp.com',
        databaseURL: 'https://padel-torneo-ec30a-default-rtdb.firebaseio.com',
        projectId: 'padel-torneo-ec30a',
        storageBucket: 'padel-torneo-ec30a.firebasestorage.app',
        messagingSenderId: '721713590787',
        appId: '1:721713590787:web:3df62ebcfc8841e41c5436'
    };
    let tournamentId = new URLSearchParams(location.search).get('torneo');
    let realtimeDb = null;
    let tournamentRef = null;
    let remoteSaveTimer = null;
    let applyingRemoteState = false;
    let remoteUnsubscribe = null;
    let presenceRef = null;
    let presenceUnsubscribe = null;
    let lastSavedStateSignature = null;
    let actorPlayerId = null;
    let pendingActorPlayerId = null;
    let actorClaimRef = null;
    let claimsUnsubscribe = null;
    let historyUnsubscribe = null;
    let claimedPlayers = {};
    let historyEntries = [];
    let identityPromptShown = false;
    let claimsLoaded = false;
    let sharedStateLoaded = false;
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
        return createFixtureRound(tournamentState.value.numPlayers, roundIndex, MAX_COURTS);
    }

    function generateSchedule(roundCount = getNumRounds(tournamentState.value.numPlayers)) {
        tournamentState.value.schedule = buildSchedule(tournamentState.value.numPlayers, roundCount, {
            minRounds: MIN_ROUNDS,
            maxRounds: MAX_ROUNDS,
            maxCourts: MAX_COURTS
        });
    }

    function addRound() {
        setRoundCount(tournamentState.value.schedule.length + 1);
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
        const title = document.getElementById('tournament-title');
        const date = document.getElementById('tournament-date');
        const createButton = document.getElementById('create-shared-button');
        const isSharedTournament = Boolean(tournamentId);
        createButton.disabled = isSharedTournament;
        createButton.textContent = isSharedTournament
            ? '☁️ Torneo compartido activo'
            : '☁️ Crear torneo compartido';
        createButton.title = isSharedTournament
            ? 'Ya estás dentro de un torneo compartido'
            : '';

        if (isSharedTournament) {
            const visibleName = tournamentState.value.tournamentName || 'Torneo compartido';
            title.textContent = `🏆 ${visibleName}`;
            date.textContent = tournamentState.value.tournamentDate
                ? `Torneo compartido · ${formatTournamentDate(tournamentState.value.tournamentDate)}`
                : 'Torneo compartido';
            date.hidden = false;
            document.title = `${visibleName} · Torneo Americano Pádel`;
            return;
        }
        title.textContent = '🏆 Torneo Americano Pádel';
        date.hidden = true;
        setPresenceStatus(0);
        document.title = 'Torneo Americano Pádel';
    }

    function updateSubtitle() {
        const courts = getCourts(tournamentState.value.numPlayers);
        const rest = getRestCount(tournamentState.value.numPlayers);
        const rounds = tournamentState.value.schedule.length || getNumRounds(tournamentState.value.numPlayers);
        const plannedRounds = getNumRounds(tournamentState.value.numPlayers);
        let restText = rest === 0 ? 'todos juegan' : `${rest} descansa${rest > 1 ? 'n' : ''} por ronda`;
        document.getElementById('subtitle').textContent =
            `${tournamentState.value.numPlayers} jugadores · ${courts} cancha${courts > 1 ? 's' : ''} · ${rounds} rondas · ${restText} · Sets a ${tournamentState.value.gamesPerSet} games`;
        document.getElementById('count-hint').textContent =
            `${courts} cancha${courts > 1 ? 's' : ''} · ${restText}`;
        document.getElementById('round-count').value = rounds;
        document.getElementById('round-count-hint').textContent =
            rounds > plannedRounds
                ? `${rounds - plannedRounds} ronda${rounds - plannedRounds === 1 ? '' : 's'} extra agregada${rounds - plannedRounds === 1 ? '' : 's'}`
                : 'Cantidad de rondas independiente de los jugadores';
        document.getElementById('matches-title').textContent = `3. Partidos (a ${tournamentState.value.gamesPerSet} games)`;
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
        const currentRoundCount = tournamentState.value.schedule.length || getNumRounds(tournamentState.value.numPlayers);
        resizePlayers(newCount);
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
            const hasRecordedResults = roundsToRemove.some(round => round.matches.some(isMatchDone));
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
        if (newCount > currentCount) {
            for (let roundIndex = currentCount; roundIndex < newCount; roundIndex++) {
                tournamentState.value.schedule.push(createAutomaticRound(roundIndex));
                tournamentState.value.collapsedRounds[roundIndex] = false;
            }
        } else {
            tournamentState.value.schedule = tournamentState.value.schedule.slice(0, newCount);
            tournamentState.value.collapsedRounds = Object.fromEntries(Object.entries(tournamentState.value.collapsedRounds)
                .filter(([index]) => parseInt(index, 10) < newCount));
        }
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
        if (applyingRemoteState) return;
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
            minGamesPerSet: MIN_GAMES_PER_SET,
            maxGamesPerSet: MAX_GAMES_PER_SET
        });
        tournamentState.replace(normalized);
        document.getElementById('player-count').value = tournamentState.value.numPlayers;
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
        if (presenceRef) presenceRef.update({ actorName: 'Espectador', device: getDeviceLabel() });
        updateIdentityStatus();
    }

    async function claimPlayer(playerId) {
        if (!tournamentRef || !Number.isInteger(playerId)) return false;
        const claimRef = tournamentRef.child(`claims/${playerId}`);
        const result = await claimRef.transaction(current => {
            if (!current || current.presenceId === presenceId) {
                return { presenceId, actorName: tournamentState.value.players[playerId], device: getDeviceLabel() };
            }
            return;
        });
        if (!result.committed || result.snapshot.val()?.presenceId !== presenceId) return false;
        if (actorClaimRef && actorClaimRef !== claimRef) actorClaimRef.remove().catch(() => {});
        actorClaimRef = claimRef;
        await actorClaimRef.onDisconnect().remove();
        actorPlayerId = playerId;
        saveActorPlayerId(playerId);
        updateIdentityStatus();
        if (presenceRef) await presenceRef.update({ actorPlayerId: playerId, actorName: getActorName(), device: getDeviceLabel() });
        return true;
    }

    function maybeRequestIdentity() {
        if (!tournamentId || !tournamentRef || !tournamentState.value.players.length || !claimsLoaded || !sharedStateLoaded || identityPromptShown) return;
        const ownClaim = Object.entries(claimedPlayers).find(([, claim]) => claim?.presenceId === presenceId);
        if (ownClaim) {
            actorPlayerId = parseInt(ownClaim[0], 10);
            actorClaimRef = tournamentRef.child(`claims/${actorPlayerId}`);
            actorClaimRef.onDisconnect().remove();
            saveActorPlayerId(actorPlayerId);
            if (presenceRef) presenceRef.update({ actorPlayerId, actorName: getActorName(), device: getDeviceLabel() });
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
        if (!tournamentRef || applyingRemoteState) return;
        tournamentRef.child('history').push({
            message,
            actor: getActorName(),
            device: getDeviceLabel(),
            createdAt: firebase.database.ServerValue.TIMESTAMP
        }).catch(() => {});
    }

    function formatActivityTime(timestamp) {
        if (!timestamp) return 'Ahora';
        return new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit' }).format(new Date(timestamp));
    }

    function renderActivity() {
        const list = document.getElementById('activity-list');
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
            if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
            await firebase.auth().signInAnonymously();
            realtimeDb = firebase.database();
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
            if (remoteUnsubscribe) remoteUnsubscribe();
            if (presenceUnsubscribe) presenceUnsubscribe();
            if (claimsUnsubscribe) claimsUnsubscribe();
            if (historyUnsubscribe) historyUnsubscribe();
            if (presenceRef) presenceRef.remove().catch(() => {});
            if (actorClaimRef) actorClaimRef.remove().catch(() => {});
            tournamentId = id;
            lastSavedStateSignature = null;
            actorPlayerId = null;
            actorClaimRef = null;
            claimedPlayers = {};
            historyEntries = [];
            identityPromptShown = false;
            claimsLoaded = false;
            sharedStateLoaded = false;
            updateIdentityStatus();
            tournamentRef = realtimeDb.ref(`tournaments/${id}`);
            setSyncStatus('Conectando al torneo compartido…');
            const stateRef = tournamentRef.child('state');
            const listener = stateRef.on('value', (snapshot) => {
                const remoteState = snapshot.val();
                sharedStateLoaded = true;
                if (!remoteState) {
                    setSyncStatus('Torneo compartido listo');
                    maybeRequestIdentity();
                    return;
                }
                const remoteSignature = getStateSignature(remoteState);
                if (remoteSignature !== lastSavedStateSignature) {
                    undoStack = [];
                    updateUndoButton();
                }
                applyingRemoteState = true;
                setState(remoteState);
                applyingRemoteState = false;
                setSyncStatus('Sincronizado en todos los dispositivos');
                maybeRequestIdentity();
            }, () => setSyncStatus('No se pudo actualizar el torneo compartido'));
            remoteUnsubscribe = () => stateRef.off('value', listener);
            const claimsRef = tournamentRef.child('claims');
            const claimsListener = claimsRef.on('value', snapshot => {
                claimedPlayers = snapshot.val() || {};
                claimsLoaded = true;
                refreshIdentityChoiceIfNeeded();
                maybeRequestIdentity();
            });
            claimsUnsubscribe = () => claimsRef.off('value', claimsListener);
            const historyRef = tournamentRef.child('history').limitToLast(50);
            const historyListener = historyRef.on('value', snapshot => {
                historyEntries = Object.values(snapshot.val() || {}).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
                if (!document.getElementById('activity-modal').hidden) renderActivity();
            });
            historyUnsubscribe = () => historyRef.off('value', historyListener);
            await connectPresence();
        } catch (error) { /* status set in ensureFirebase */ }
    }

    async function connectPresence() {
        presenceRef = tournamentRef.child(`presence/${presenceId}`);
        const presenceListRef = tournamentRef.child('presence');
        const listener = presenceListRef.on('value', snapshot => {
            setPresenceStatus(snapshot.numChildren());
        });
        presenceUnsubscribe = () => presenceListRef.off('value', listener);
        await presenceRef.onDisconnect().remove();
        await presenceRef.set({
            connectedAt: firebase.database.ServerValue.TIMESTAMP,
            actorName: getActorName(),
            device: getDeviceLabel()
        });
    }

    function queueRemoteSave() {
        if (!tournamentRef || applyingRemoteState) return;
        clearTimeout(remoteSaveTimer);
        setSyncStatus('Guardando cambios…');
        remoteSaveTimer = setTimeout(saveRemoteNow, 350);
    }

    async function saveRemoteNow() {
        if (!tournamentRef || applyingRemoteState) return;
        try {
            const state = getState();
            lastSavedStateSignature = getStateSignature(state);
            await tournamentRef.update({ state, updatedAt: firebase.database.ServerValue.TIMESTAMP });
            setSyncStatus('Sincronizado en todos los dispositivos');
        } catch (error) {
            console.error(error);
            setSyncStatus('No se pudieron guardar los cambios compartidos');
        }
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
            generateSchedule(tournamentState.value.schedule.length || getNumRounds(tournamentState.value.numPlayers));
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
        const url = `${location.origin}${location.pathname}?torneo=${tournamentId}`;
        navigator.clipboard.writeText(url).then(() => showToast('¡Link copiado! Todos verán los cambios al instante.'))
            .catch(() => prompt('Copiá este link:', url));
    }

    function loadLocal() {
        return localStateStore.load();
    }

    function encodeState(state) {
        return btoa(unescape(encodeURIComponent(JSON.stringify(state))));
    }

    function decodeState(encoded) {
        return JSON.parse(decodeURIComponent(escape(atob(encoded))));
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
        const encoded = encodeState(getState());
        const url = location.origin + location.pathname + '#s=' + encoded;
        navigator.clipboard.writeText(url).then(() => {
            showToast('¡Link copiado! Mandalo al grupo.');
        }).catch(() => {
            prompt('Copiá este link:', url);
        });
        history.replaceState(null, '', '#s=' + encoded);
    }

    function exportJSON() {
        const blob = new Blob([JSON.stringify(getState(), null, 2)], { type: 'application/json' });
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
                setState(JSON.parse(ev.target.result));
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
        generateSchedule(tournamentState.value.schedule.length || getNumRounds(tournamentState.value.numPlayers));
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
        tournamentState.value.gamesPerSet = 4;
        tournamentState.value.players = defaultPlayers(tournamentState.value.numPlayers);
        generateSchedule();
        tournamentState.value.collapsedRounds = {};
        document.getElementById('player-count').value = tournamentState.value.numPlayers;
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
        container.innerHTML = '';
        tournamentState.value.players.forEach((p, idx) => {
            const input = document.createElement('input');
            input.type = 'text';
            input.value = p;
            input.placeholder = `Jugador ${idx + 1}`;
            input.addEventListener('change', (e) => {
                rememberStateForUndo();
                tournamentState.value.players[idx] = e.target.value.trim() || `Jugador ${idx + 1}`;
                saveLocal();
                logActivity(`cambió el nombre de ${p} a ${tournamentState.value.players[idx]}`);
                updateIdentityStatus();
                renderRounds();
                calculateStats();
            });
            container.appendChild(input);
        });
    }

    function buildSelect(playerIndex, roundIdx, matchIdx, role) {
        let html = `<select onchange="updateMatchPlayer(${roundIdx}, ${matchIdx}, '${role}', this.value)">`;
        tournamentState.value.players.forEach((p, idx) => {
            html += `<option value="${idx}" ${idx === playerIndex ? 'selected' : ''}>${p}</option>`;
        });
        html += '</select>';
        return html;
    }

    function getRoundPlayerSlots(round) {
        const roles = ['t1_p1', 't1_p2', 't2_p1', 't2_p2'];
        return round.matches.flatMap(match => roles.map(role => ({ match, role })));
    }

    function normalizeRoundPlayers(round) {
        const slots = getRoundPlayerSlots(round);
        const usedPlayers = new Set();

        slots.forEach(slot => {
            const playerId = slot.match[slot.role];
            if (Number.isInteger(playerId) && playerId >= 0 && playerId < tournamentState.value.numPlayers && !usedPlayers.has(playerId)) {
                usedPlayers.add(playerId);
            } else {
                slot.match[slot.role] = null;
            }
        });

        const availablePlayers = Array.from({ length: tournamentState.value.numPlayers }, (_, id) => id)
            .filter(id => !usedPlayers.has(id));
        slots.forEach(slot => {
            if (slot.match[slot.role] === null) slot.match[slot.role] = availablePlayers.shift();
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

    function swapPlayersInRound(round, firstPlayer, secondPlayer) {
        getRoundPlayerSlots(round).forEach(slot => {
            if (slot.match[slot.role] === firstPlayer) slot.match[slot.role] = secondPlayer;
            else if (slot.match[slot.role] === secondPlayer) slot.match[slot.role] = firstPlayer;
        });
        normalizeRoundPlayers(round);
    }

    function applySingleRoundPlayerChange(round, targetMatch, role, previousPlayer, selectedPlayer) {
        const selectedPlayerSlot = getRoundPlayerSlots(round)
            .find(slot => (slot.match !== targetMatch || slot.role !== role) && slot.match[slot.role] === selectedPlayer);
        if (selectedPlayerSlot) selectedPlayerSlot.match[selectedPlayerSlot.role] = previousPlayer;
        targetMatch[role] = selectedPlayer;
        normalizeRoundPlayers(round);
    }

    function hasRecordedScoresFromRound(roundIdx) {
        return tournamentState.value.schedule.slice(roundIdx).some(round => round.matches.some(isMatchDone));
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
            if (hasRecordedScoresFromRound(roundIdx)) {
                renderRounds();
                showToast('No se puede cambiar el resto: ya hay resultados cargados desde esta ronda.');
                return;
            }
            rememberStateForUndo();
            for (let index = roundIdx; index < tournamentState.value.schedule.length; index++) {
                swapPlayersInRound(tournamentState.value.schedule[index], previousPlayer, selectedPlayer);
            }
        } else {
            rememberStateForUndo();
            applySingleRoundPlayerChange(round, targetMatch, role, previousPlayer, selectedPlayer);
        }
        saveLocal();
        logActivity(`${scope === 'future' ? 'reemplazó en las rondas restantes' : 'cambió en esta ronda'} a ${tournamentState.value.players[previousPlayer]} por ${tournamentState.value.players[selectedPlayer]}`);
        renderRounds();
        calculateStats();
    }

    function updateScore(roundIdx, matchIdx, team, value) {
        const parsed = parseInt(value, 10);
        const nextScore = value === '' || Number.isNaN(parsed)
            ? ''
            : Math.max(0, Math.min(tournamentState.value.gamesPerSet, parsed));
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
        const current = parseInt(tournamentState.value.schedule[roundIdx].matches[matchIdx][team], 10);
        const next = Math.max(0, Math.min(tournamentState.value.gamesPerSet, (Number.isNaN(current) ? 0 : current) + amount));
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

    function isMatchDone(m) {
        return m.score1 !== '' && m.score2 !== '';
    }

    function getScoreWarning(m) {
        if (!isMatchDone(m)) return '';
        const score1 = parseInt(m.score1, 10);
        const score2 = parseInt(m.score2, 10);
        if (score1 === score2) return 'Empate: revisá el resultado antes de cerrar la ronda.';
        if (score1 < tournamentState.value.gamesPerSet && score2 < tournamentState.value.gamesPerSet) {
            return `Ningún equipo llegó a ${tournamentState.value.gamesPerSet} games.`;
        }
        if (score1 === tournamentState.value.gamesPerSet && score2 === tournamentState.value.gamesPerSet) {
            return 'Ambos equipos llegaron al objetivo de games.';
        }
        return '';
    }

    function isRoundDone(round) {
        return round.matches.every(isMatchDone);
    }

    function toggleRound(rIdx) {
        tournamentState.value.collapsedRounds[rIdx] = !tournamentState.value.collapsedRounds[rIdx];
        saveLocal();
        renderRounds();
    }

    function renderRounds() {
        const container = document.getElementById('rounds-container');
        container.innerHTML = '';

        tournamentState.value.schedule.forEach((round, rIdx) => {
            const done = isRoundDone(round);
            const collapsed = tournamentState.value.collapsedRounds[rIdx] === true;
            const resting = getRestingPlayers(round);
            const restLabel = resting.length === 0
                ? 'Todos juegan'
                : resting.length === 1
                    ? `Descansa: ${resting[0]}`
                    : `Descansan: ${resting.join(', ')}`;

            let html = `<div class="card round-card ${done ? 'round-done' : ''}">
                <div class="round-header" onclick="toggleRound(${rIdx})">
                    <h3>Ronda ${rIdx + 1}</h3>
                    <span class="chevron">${collapsed ? '▶ Mostrar' : '▼ Ocultar'}</span>
                </div>
                <div class="round-body ${collapsed ? 'collapsed' : ''}">
                    <div class="rest-badge">💤 ${restLabel}</div>`;

            round.matches.forEach((m, mIdx) => {
                const mDone = isMatchDone(m);
                const scoreWarning = getScoreWarning(m);
                html += `
                <div class="match ${mDone ? 'match-done' : ''}">
                    <div class="court-title">📍 Cancha ${m.court}</div>
                    <div class="team team-one">
                        <div class="team-pair">
                            ${buildSelect(m.t1_p1, rIdx, mIdx, 't1_p1')}
                            ${buildSelect(m.t1_p2, rIdx, mIdx, 't1_p2')}
                        </div>
                    </div>
                    <div class="vs">CONTRA</div>
                    <div class="team team-two">
                        <div class="team-pair">
                            ${buildSelect(m.t2_p1, rIdx, mIdx, 't2_p1')}
                            ${buildSelect(m.t2_p2, rIdx, mIdx, 't2_p2')}
                        </div>
                    </div>
                    <div class="score-row">
                        <div class="score-control team-one">
                            <button type="button" class="score-adjust" aria-label="Bajar puntaje del primer equipo en cancha ${m.court}"
                                    onclick="adjustScore(${rIdx}, ${mIdx}, 'score1', -1)">−</button>
                            <input type="number" min="0" max="${tournamentState.value.gamesPerSet}" class="score-input" placeholder="0"
                                   value="${m.score1}" inputmode="numeric"
                                   onchange="updateScore(${rIdx}, ${mIdx}, 'score1', this.value)">
                            <button type="button" class="score-adjust" aria-label="Subir puntaje del primer equipo en cancha ${m.court}"
                                    onclick="adjustScore(${rIdx}, ${mIdx}, 'score1', 1)">+</button>
                        </div>
                        <span class="score-sep">—</span>
                        <div class="score-control team-two">
                            <button type="button" class="score-adjust" aria-label="Bajar puntaje del segundo equipo en cancha ${m.court}"
                                    onclick="adjustScore(${rIdx}, ${mIdx}, 'score2', -1)">−</button>
                            <input type="number" min="0" max="${tournamentState.value.gamesPerSet}" class="score-input" placeholder="0"
                                   value="${m.score2}" inputmode="numeric"
                                   onchange="updateScore(${rIdx}, ${mIdx}, 'score2', this.value)">
                            <button type="button" class="score-adjust" aria-label="Subir puntaje del segundo equipo en cancha ${m.court}"
                                    onclick="adjustScore(${rIdx}, ${mIdx}, 'score2', 1)">+</button>
                        </div>
                    </div>
                    ${scoreWarning ? `<div class="score-warning">⚠️ ${scoreWarning}</div>` : ''}
                </div>`;
            });

            html += '</div></div>';
            container.innerHTML += html;
        });
    }

    function getLeaderboardStats() {
        const stats = tournamentState.value.players.map((name, id) => ({
            id, name, v: 0, d: 0, gf: 0, gc: 0, dif: 0, played: 0
        }));

        tournamentState.value.schedule.forEach(round => {
            round.matches.forEach(m => {
                if (!isMatchDone(m)) return;
                const s1 = parseInt(m.score1, 10);
                const s2 = parseInt(m.score2, 10);
                const t1 = [m.t1_p1, m.t1_p2];
                const t2 = [m.t2_p1, m.t2_p2];

                t1.forEach(p => {
                    if (p >= stats.length) return;
                    stats[p].played += 1;
                    stats[p].gf += s1;
                    stats[p].gc += s2;
                    if (s1 > s2) stats[p].v += 1;
                    if (s1 < s2) stats[p].d += 1;
                });
                t2.forEach(p => {
                    if (p >= stats.length) return;
                    stats[p].played += 1;
                    stats[p].gf += s2;
                    stats[p].gc += s1;
                    if (s2 > s1) stats[p].v += 1;
                    if (s2 < s1) stats[p].d += 1;
                });
            });
        });

        stats.forEach(s => { s.dif = s.gf - s.gc; });
        stats.sort((a, b) => {
            if (b.v !== a.v) return b.v - a.v;
            if (b.dif !== a.dif) return b.dif - a.dif;
            return b.gf - a.gf;
        });
        return stats;
    }

    function calculateStats() {
        const stats = getLeaderboardStats();

        const tbody = document.getElementById('leaderboard-body');
        tbody.innerHTML = stats.map((s, idx) => `
            <tr class="${idx === 0 ? 'leader-row-1' : ''}">
                <td>${idx + 1}</td>
                <td>${s.name}</td>
                <td>${s.v}</td>
                <td>${s.d}</td>
                <td>${s.gf}</td>
                <td>${s.gc}</td>
                <td>${s.dif > 0 ? '+' + s.dif : s.dif}</td>
            </tr>
        `).join('');
    }

    function escapeHTML(value) {
        return String(value).replace(/[&<>'"]/g, char => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
        }[char]));
    }

    function getBestStreak() {
        const current = Array(tournamentState.value.numPlayers).fill(0);
        const best = Array(tournamentState.value.numPlayers).fill(0);
        tournamentState.value.schedule.forEach(round => round.matches.forEach(match => {
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
        const longest = Math.max(...best);
        return {
            longest,
            players: longest ? best.map((streak, index) => streak === longest ? tournamentState.value.players[index] : null).filter(Boolean) : []
        };
    }

    function getTournamentSummaryText() {
        const stats = getLeaderboardStats();
        const completed = tournamentState.value.schedule.reduce((total, round) => total + round.matches.filter(isMatchDone).length, 0);
        const total = tournamentState.value.schedule.reduce((count, round) => count + round.matches.length, 0);
        const streak = getBestStreak();
        const title = tournamentState.value.tournamentName || 'Torneo Americano Pádel';
        const date = tournamentState.value.tournamentDate ? formatTournamentDate(tournamentState.value.tournamentDate) : '';
        const positions = stats.slice(0, 3).map((player, index) =>
            `${['🥇', '🥈', '🥉'][index]} ${player.name}: ${player.v}V · Dif ${player.dif >= 0 ? '+' : ''}${player.dif}`
        );
        const streakText = streak.longest
            ? `🔥 Mejor racha: ${streak.players.join(', ')} (${streak.longest})`
            : '🔥 Mejor racha: todavía sin resultados';
        return [
            `🏆 ${title}`,
            date,
            `📊 ${completed} de ${total} partidos anotados`,
            '',
            ...positions,
            '',
            streakText
        ].filter((line, index, list) => line || (index > 0 && list[index - 1] !== '')).join('\n');
    }

    function openSummaryModal() {
        const stats = getLeaderboardStats();
        const streak = getBestStreak();
        const completed = tournamentState.value.schedule.reduce((total, round) => total + round.matches.filter(isMatchDone).length, 0);
        const total = tournamentState.value.schedule.reduce((count, round) => count + round.matches.length, 0);
        const leader = stats[0];
        const positions = stats.slice(0, 3).map((player, index) =>
            `<li>${['🥇', '🥈', '🥉'][index]} <strong>${escapeHTML(player.name)}</strong> · ${player.v}V, ${player.d}D, Dif ${player.dif >= 0 ? '+' : ''}${player.dif}</li>`
        ).join('');
        document.getElementById('summary-content').innerHTML = `
            <div class="summary-highlight">🏆 MVP actual: ${escapeHTML(leader.name)} · ${leader.v} victorias · Dif ${leader.dif >= 0 ? '+' : ''}${leader.dif}</div>
            <p>${completed} de ${total} partidos anotados.</p>
            <h3>Posiciones</h3>
            <ol class="summary-list">${positions}</ol>
            <h3>Racha</h3>
            <p>${streak.longest ? `🔥 ${escapeHTML(streak.players.join(', '))} lleva la mejor racha: ${streak.longest} victoria${streak.longest > 1 ? 's' : ''}.` : '🔥 Cargá resultados para calcular la mejor racha.'}</p>`;
        document.getElementById('summary-modal').hidden = false;
    }

    function closeSummaryModal() {
        document.getElementById('summary-modal').hidden = true;
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
        const total = tournamentState.value.schedule.reduce((acc, r) => acc + r.matches.length, 0);
        let done = 0;
        tournamentState.value.schedule.forEach(r => r.matches.forEach(m => { if (isMatchDone(m)) done++; }));
        const pct = total ? Math.round((done / total) * 100) : 0;
        document.getElementById('progress-fill').style.width = pct + '%';
        document.getElementById('progress-text').textContent =
            `${done} de ${total} partidos anotados (${pct}%)`;
    }

    function renderAll() {
        updateTournamentHeader();
        updateIdentityStatus();
        updateUndoButton();
        updateSubtitle();
        renderPlayers();
        renderRounds();
        calculateStats();
        updateProgress();
    }

    // Init
    tournamentState.value.players = defaultPlayers(tournamentState.value.numPlayers);
    generateSchedule();
    if (!loadFromHash()) {
        const saved = loadLocal();
        if (saved) setState(saved);
        else renderAll();
    }
    if (tournamentId) connectToTournament(tournamentId);

window.addEventListener('hashchange', () => loadFromHash());

// Compatibilidad temporal con los handlers inline del HTML. Se eliminarán al
// extraer los componentes de UI y reemplazarlos por listeners explícitos.
Object.assign(window, {
    addRound, adjustScore, cancelPlayerChange, cancelTournamentName,
    changeGamesPerSet, changePlayerCount, changeRoundCount,
    closeActivityModal, closeSummaryModal, confirmIdentitySelection,
    confirmPlayerChange, confirmTournamentName, continueIdentitySelection,
    copyTournamentSummary, createSharedTournament, enterAsSpectator,
    exportJSON, importJSON, openActivityModal, openSummaryModal,
    resetAll, resetSchedule, setGamesPerSet, setPlayerCount, setRoundCount,
    shareState, shareTournamentSummary, showIdentityChoice, toggleRound,
    undoLastChange, updateMatchPlayer, updateScore
});
