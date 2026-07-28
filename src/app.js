    const MIN_PLAYERS = 4;
    const MAX_PLAYERS = 16;
    const MAX_COURTS = 2;
    const MIN_GAMES_PER_SET = 1;
    const MAX_GAMES_PER_SET = 20;
    const MIN_ROUNDS = 1;
    const MAX_ROUNDS = 50;

    let numPlayers = 9;
    let gamesPerSet = 4;
    let players = [];
    let schedule = [];
    let collapsedRounds = {};
    let tournamentName = '';
    let tournamentDate = '';
    let resolveTournamentName = null;
    let resolvePlayerChange = null;
    let undoStack = [];
    const MAX_UNDO_STEPS = 20;
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
        return Array.from({ length: n }, (_, i) => `Jugador ${i + 1}`);
    }

    function getCourts(n) {
        return Math.min(MAX_COURTS, Math.floor(n / 4));
    }

    function getPlayingCount(n) {
        return getCourts(n) * 4;
    }

    function getRestCount(n) {
        return n - getPlayingCount(n);
    }

    function getNumRounds(n) {
        const rest = getRestCount(n);
        if (rest > 0) return n;
        if (n === 4) return 3;
        return Math.max(n - 1, 3);
    }

    function getActivePlayers(n, playingCount, round) {
        const active = [];
        for (let i = 0; i < playingCount; i++) {
            active.push((round + i) % n);
        }
        return active;
    }

    function pairFour(active, round) {
        const pairings = [
            { t1: [0, 1], t2: [2, 3] },
            { t1: [0, 2], t2: [1, 3] },
            { t1: [0, 3], t2: [1, 2] }
        ];
        const p = pairings[round % pairings.length];
        return {
            court: 1,
            t1_p1: active[p.t1[0]], t1_p2: active[p.t1[1]],
            t2_p1: active[p.t2[0]], t2_p2: active[p.t2[1]],
            score1: '', score2: ''
        };
    }

    function pairEight(active) {
        return [
            {
                court: 1,
                t1_p1: active[0], t1_p2: active[7],
                t2_p1: active[3], t2_p2: active[4],
                score1: '', score2: ''
            },
            {
                court: 2,
                t1_p1: active[1], t1_p2: active[6],
                t2_p1: active[2], t2_p2: active[5],
                score1: '', score2: ''
            }
        ];
    }

    function createAutomaticRound(roundIndex) {
        if (numPlayers === 9) {
            return {
                id: roundIndex,
                matches: [
                    {
                        court: 1,
                        t1_p1: roundIndex % 9, t1_p2: (7 + roundIndex) % 9,
                        t2_p1: (3 + roundIndex) % 9, t2_p2: (4 + roundIndex) % 9,
                        score1: '', score2: ''
                    },
                    {
                        court: 2,
                        t1_p1: (1 + roundIndex) % 9, t1_p2: (6 + roundIndex) % 9,
                        t2_p1: (2 + roundIndex) % 9, t2_p2: (5 + roundIndex) % 9,
                        score1: '', score2: ''
                    }
                ]
            };
        }

        const playingCount = getPlayingCount(numPlayers);
        const active = getActivePlayers(numPlayers, playingCount, roundIndex);
        const matches = playingCount >= 8
            ? pairEight(active)
            : playingCount >= 4
                ? [pairFour(active, roundIndex)]
                : [];
        return { id: roundIndex, matches };
    }

    function generateSchedule(roundCount = getNumRounds(numPlayers)) {
        const rounds = Math.max(MIN_ROUNDS, Math.min(MAX_ROUNDS, roundCount));
        schedule = Array.from({ length: rounds }, (_, roundIndex) =>
            createAutomaticRound(roundIndex));
    }

    function addRound() {
        setRoundCount(schedule.length + 1);
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
            const visibleName = tournamentName || 'Torneo compartido';
            title.textContent = `🏆 ${visibleName}`;
            date.textContent = tournamentDate
                ? `Torneo compartido · ${formatTournamentDate(tournamentDate)}`
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
        const courts = getCourts(numPlayers);
        const rest = getRestCount(numPlayers);
        const rounds = schedule.length || getNumRounds(numPlayers);
        const plannedRounds = getNumRounds(numPlayers);
        let restText = rest === 0 ? 'todos juegan' : `${rest} descansa${rest > 1 ? 'n' : ''} por ronda`;
        document.getElementById('subtitle').textContent =
            `${numPlayers} jugadores · ${courts} cancha${courts > 1 ? 's' : ''} · ${rounds} rondas · ${restText} · Sets a ${gamesPerSet} games`;
        document.getElementById('count-hint').textContent =
            `${courts} cancha${courts > 1 ? 's' : ''} · ${restText}`;
        document.getElementById('round-count').value = rounds;
        document.getElementById('round-count-hint').textContent =
            rounds > plannedRounds
                ? `${rounds - plannedRounds} ronda${rounds - plannedRounds === 1 ? '' : 's'} extra agregada${rounds - plannedRounds === 1 ? '' : 's'}`
                : 'Cantidad de rondas independiente de los jugadores';
        document.getElementById('matches-title').textContent = `3. Partidos (a ${gamesPerSet} games)`;
    }

    function resizePlayers(newCount) {
        const old = [...players];
        players = defaultPlayers(newCount);
        for (let i = 0; i < Math.min(old.length, newCount); i++) {
            players[i] = old[i];
        }
        numPlayers = newCount;
        document.getElementById('player-count').value = newCount;
    }

    function changePlayerCount(delta) {
        setPlayerCount(numPlayers + delta);
    }

    function changeRoundCount(delta) {
        setRoundCount(schedule.length + delta);
    }

    function changeGamesPerSet(delta) {
        setGamesPerSet(gamesPerSet + delta);
    }

    function setGamesPerSet(newTarget) {
        if (isNaN(newTarget)) {
            document.getElementById('games-per-set').value = gamesPerSet;
            return;
        }
        newTarget = Math.max(MIN_GAMES_PER_SET, Math.min(MAX_GAMES_PER_SET, newTarget));
        if (newTarget === gamesPerSet) {
            document.getElementById('games-per-set').value = gamesPerSet;
            return;
        }

        rememberStateForUndo();
        gamesPerSet = newTarget;
        document.getElementById('games-per-set').value = gamesPerSet;
        updateSubtitle();
        saveLocal();
        logActivity(`cambió el objetivo a ${gamesPerSet} games`);
        renderRounds();
        showToast(`Sets a ${gamesPerSet} games`);
    }

    function setPlayerCount(newCount) {
        if (isNaN(newCount)) return;
        newCount = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, newCount));
        if (newCount === numPlayers) {
            document.getElementById('player-count').value = numPlayers;
            return;
        }

        const hasScores = schedule.some(r => r.matches.some(m => m.score1 !== '' || m.score2 !== ''));
        if (hasScores && !confirm(`¿Cambiar a ${newCount} jugadores? Se regenerará el fixture y se pierden los resultados.`)) {
            document.getElementById('player-count').value = numPlayers;
            return;
        }

        rememberStateForUndo();
        const currentRoundCount = schedule.length || getNumRounds(numPlayers);
        resizePlayers(newCount);
        generateSchedule(currentRoundCount);
        collapsedRounds = {};
        saveLocal();
        logActivity(`cambió la cantidad de jugadores a ${numPlayers}`);
        renderAll();
        showToast(`${newCount} jugadores · fixture actualizado`);
    }

    function setRoundCount(newCount) {
        if (Number.isNaN(newCount)) {
            document.getElementById('round-count').value = schedule.length;
            return;
        }
        newCount = Math.max(MIN_ROUNDS, Math.min(MAX_ROUNDS, newCount));
        const currentCount = schedule.length;
        if (newCount === currentCount) {
            document.getElementById('round-count').value = currentCount;
            return;
        }
        if (newCount < currentCount) {
            const roundsToRemove = schedule.slice(newCount);
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
                schedule.push(createAutomaticRound(roundIndex));
                collapsedRounds[roundIndex] = false;
            }
        } else {
            schedule = schedule.slice(0, newCount);
            collapsedRounds = Object.fromEntries(Object.entries(collapsedRounds)
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
        return { numPlayers, gamesPerSet, players, schedule, collapsedRounds, tournamentName, tournamentDate };
    }

    function getStateSignature(value) {
        if (Array.isArray(value)) return `[${value.map(getStateSignature).join(',')}]`;
        if (value && typeof value === 'object') {
            return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${getStateSignature(value[key])}`).join(',')}}`;
        }
        return JSON.stringify(value);
    }

    function rememberStateForUndo() {
        if (applyingRemoteState) return;
        undoStack.push(JSON.parse(JSON.stringify(getState())));
        if (undoStack.length > MAX_UNDO_STEPS) undoStack.shift();
        updateUndoButton();
    }

    function updateUndoButton() {
        const button = document.getElementById('undo-button');
        if (button) button.disabled = undoStack.length === 0;
    }

    function undoLastChange() {
        const previousState = undoStack.pop();
        if (!previousState) return;
        setState(previousState);
        saveLocal();
        logActivity('deshizo su último cambio');
        updateUndoButton();
        showToast('Último cambio deshecho');
    }

    function setState(state) {
        if (state.numPlayers) numPlayers = state.numPlayers;
        else if (state.players) numPlayers = state.players.length;
        const savedGamesPerSet = parseInt(state.gamesPerSet, 10);
        gamesPerSet = Number.isNaN(savedGamesPerSet)
            ? 4
            : Math.max(MIN_GAMES_PER_SET, Math.min(MAX_GAMES_PER_SET, savedGamesPerSet));
        tournamentName = typeof state.tournamentName === 'string' ? state.tournamentName : '';
        tournamentDate = typeof state.tournamentDate === 'string' ? state.tournamentDate : '';
        if (state.players) players = state.players;
        if (state.schedule) schedule = state.schedule;
        if (state.collapsedRounds) collapsedRounds = state.collapsedRounds;
        document.getElementById('player-count').value = numPlayers;
        document.getElementById('games-per-set').value = gamesPerSet;
        renderAll();
    }

    function saveLocal() {
        try {
            localStorage.setItem('padel-torneo', JSON.stringify(getState()));
        } catch (e) { /* quota exceeded */ }
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
        return Number.isInteger(actorPlayerId) && players[actorPlayerId]
            ? players[actorPlayerId]
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
        status.textContent = Number.isInteger(actorPlayerId) && players[actorPlayerId]
            ? `👤 Sos: ${players[actorPlayerId]}`
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
        return players.map((_, id) => id).filter(id => {
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
        select.innerHTML = available.map(id => `<option value="${id}">${escapeHTML(players[id])}</option>`).join('');
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
            `¿Confirmás que sos ${players[selected]}? Tus cambios se registrarán como “${players[selected]} · ${getDeviceLabel()}”.`;
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
                return { presenceId, actorName: players[playerId], device: getDeviceLabel() };
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
        if (!tournamentId || !tournamentRef || !players.length || !claimsLoaded || !sharedStateLoaded || identityPromptShown) return;
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

            tournamentName = chosenName.trim() || 'Torneo de Pádel';
            tournamentDate = getTodayISODate();

            // Un torneo nuevo conserva la configuración, pero siempre empieza sin resultados.
            generateSchedule(schedule.length || getNumRounds(numPlayers));
            collapsedRounds = {};
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
        try {
            const raw = localStorage.getItem('padel-torneo');
            if (raw) return JSON.parse(raw);
        } catch (e) { /* corrupt */ }
        return null;
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
        const savedPlayers = [...players];
        generateSchedule(schedule.length || getNumRounds(numPlayers));
        players = savedPlayers;
        collapsedRounds = {};
        saveLocal();
        logActivity('regeneró el fixture');
        renderAll();
        showToast('Fixture regenerado');
    }

    function resetAll() {
        if (!confirm('¿Borrar todo (nombres y resultados)?')) return;
        rememberStateForUndo();
        numPlayers = 9;
        gamesPerSet = 4;
        players = defaultPlayers(numPlayers);
        generateSchedule();
        collapsedRounds = {};
        document.getElementById('player-count').value = numPlayers;
        document.getElementById('games-per-set').value = gamesPerSet;
        if (tournamentId) saveLocal();
        else {
            localStorage.removeItem('padel-torneo');
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
        players.forEach((p, idx) => {
            const input = document.createElement('input');
            input.type = 'text';
            input.value = p;
            input.placeholder = `Jugador ${idx + 1}`;
            input.addEventListener('change', (e) => {
                rememberStateForUndo();
                players[idx] = e.target.value.trim() || `Jugador ${idx + 1}`;
                saveLocal();
                logActivity(`cambió el nombre de ${p} a ${players[idx]}`);
                updateIdentityStatus();
                renderRounds();
                calculateStats();
            });
            container.appendChild(input);
        });
    }

    function buildSelect(playerIndex, roundIdx, matchIdx, role) {
        let html = `<select onchange="updateMatchPlayer(${roundIdx}, ${matchIdx}, '${role}', this.value)">`;
        players.forEach((p, idx) => {
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
            if (Number.isInteger(playerId) && playerId >= 0 && playerId < numPlayers && !usedPlayers.has(playerId)) {
                usedPlayers.add(playerId);
            } else {
                slot.match[slot.role] = null;
            }
        });

        const availablePlayers = Array.from({ length: numPlayers }, (_, id) => id)
            .filter(id => !usedPlayers.has(id));
        slots.forEach(slot => {
            if (slot.match[slot.role] === null) slot.match[slot.role] = availablePlayers.shift();
        });
    }

    function askPlayerChange(previousPlayer, selectedPlayer) {
        const modal = document.getElementById('player-change-modal');
        document.getElementById('player-change-description').textContent =
            `${players[selectedPlayer]} reemplaza a ${players[previousPlayer]}. ¿Cómo querés aplicar el cambio?`;
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
        return schedule.slice(roundIdx).some(round => round.matches.some(isMatchDone));
    }

    async function updateMatchPlayer(roundIdx, matchIdx, role, newValue) {
        const round = schedule[roundIdx];
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
            for (let index = roundIdx; index < schedule.length; index++) {
                swapPlayersInRound(schedule[index], previousPlayer, selectedPlayer);
            }
        } else {
            rememberStateForUndo();
            applySingleRoundPlayerChange(round, targetMatch, role, previousPlayer, selectedPlayer);
        }
        saveLocal();
        logActivity(`${scope === 'future' ? 'reemplazó en las rondas restantes' : 'cambió en esta ronda'} a ${players[previousPlayer]} por ${players[selectedPlayer]}`);
        renderRounds();
        calculateStats();
    }

    function updateScore(roundIdx, matchIdx, team, value) {
        const parsed = parseInt(value, 10);
        const nextScore = value === '' || Number.isNaN(parsed)
            ? ''
            : Math.max(0, Math.min(gamesPerSet, parsed));
        if (schedule[roundIdx].matches[matchIdx][team] === nextScore) return;
        rememberStateForUndo();
        schedule[roundIdx].matches[matchIdx][team] = nextScore;
        saveLocal();
        const match = schedule[roundIdx].matches[matchIdx];
        if (isMatchDone(match)) {
            logActivity(`cargó el resultado ${match.score1}–${match.score2} de ${players[match.t1_p1]} / ${players[match.t1_p2]} vs ${players[match.t2_p1]} / ${players[match.t2_p2]}`);
        }
        calculateStats();
        updateProgress();
        renderRounds();
    }

    function adjustScore(roundIdx, matchIdx, team, amount) {
        const current = parseInt(schedule[roundIdx].matches[matchIdx][team], 10);
        const next = Math.max(0, Math.min(gamesPerSet, (Number.isNaN(current) ? 0 : current) + amount));
        updateScore(roundIdx, matchIdx, team, next);
    }

    function getRestingPlayers(round) {
        const playing = new Set();
        round.matches.forEach(m => {
            playing.add(m.t1_p1); playing.add(m.t1_p2);
            playing.add(m.t2_p1); playing.add(m.t2_p2);
        });
        const resting = [];
        for (let i = 0; i < numPlayers; i++) {
            if (!playing.has(i)) resting.push(players[i]);
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
        if (score1 < gamesPerSet && score2 < gamesPerSet) {
            return `Ningún equipo llegó a ${gamesPerSet} games.`;
        }
        if (score1 === gamesPerSet && score2 === gamesPerSet) {
            return 'Ambos equipos llegaron al objetivo de games.';
        }
        return '';
    }

    function isRoundDone(round) {
        return round.matches.every(isMatchDone);
    }

    function toggleRound(rIdx) {
        collapsedRounds[rIdx] = !collapsedRounds[rIdx];
        saveLocal();
        renderRounds();
    }

    function renderRounds() {
        const container = document.getElementById('rounds-container');
        container.innerHTML = '';

        schedule.forEach((round, rIdx) => {
            const done = isRoundDone(round);
            const collapsed = collapsedRounds[rIdx] === true;
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
                            <input type="number" min="0" max="${gamesPerSet}" class="score-input" placeholder="0"
                                   value="${m.score1}" inputmode="numeric"
                                   onchange="updateScore(${rIdx}, ${mIdx}, 'score1', this.value)">
                            <button type="button" class="score-adjust" aria-label="Subir puntaje del primer equipo en cancha ${m.court}"
                                    onclick="adjustScore(${rIdx}, ${mIdx}, 'score1', 1)">+</button>
                        </div>
                        <span class="score-sep">—</span>
                        <div class="score-control team-two">
                            <button type="button" class="score-adjust" aria-label="Bajar puntaje del segundo equipo en cancha ${m.court}"
                                    onclick="adjustScore(${rIdx}, ${mIdx}, 'score2', -1)">−</button>
                            <input type="number" min="0" max="${gamesPerSet}" class="score-input" placeholder="0"
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
        const stats = players.map((name, id) => ({
            id, name, v: 0, d: 0, gf: 0, gc: 0, dif: 0, played: 0
        }));

        schedule.forEach(round => {
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
        const current = Array(numPlayers).fill(0);
        const best = Array(numPlayers).fill(0);
        schedule.forEach(round => round.matches.forEach(match => {
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
            players: longest ? best.map((streak, index) => streak === longest ? players[index] : null).filter(Boolean) : []
        };
    }

    function getTournamentSummaryText() {
        const stats = getLeaderboardStats();
        const completed = schedule.reduce((total, round) => total + round.matches.filter(isMatchDone).length, 0);
        const total = schedule.reduce((count, round) => count + round.matches.length, 0);
        const streak = getBestStreak();
        const title = tournamentName || 'Torneo Americano Pádel';
        const date = tournamentDate ? formatTournamentDate(tournamentDate) : '';
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
        const completed = schedule.reduce((total, round) => total + round.matches.filter(isMatchDone).length, 0);
        const total = schedule.reduce((count, round) => count + round.matches.length, 0);
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
                await navigator.share({ title: tournamentName || 'Torneo Americano Pádel', text });
            } catch (error) {
                if (error.name !== 'AbortError') copyTournamentSummary();
            }
            return;
        }
        copyTournamentSummary();
    }

    function updateProgress() {
        const total = schedule.reduce((acc, r) => acc + r.matches.length, 0);
        let done = 0;
        schedule.forEach(r => r.matches.forEach(m => { if (isMatchDone(m)) done++; }));
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
    players = defaultPlayers(numPlayers);
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
