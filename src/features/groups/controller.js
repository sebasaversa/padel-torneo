import {
    buildGeneralGroupInvitationUrl,
    clearPendingGeneralInvitation,
    createGroupsApi,
    createOperationId,
    loadPendingGeneralInvitation,
    parseGeneralGroupInvitation,
    savePendingGeneralInvitation
} from '../../services/groups.js';

const ROLE_LABELS = { owner: 'Owner', admin: 'Admin', member: 'Miembro' };

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    })[character]);
}

function asDate(value) {
    if (!value) return 'Sin fecha';
    const date = typeof value === 'number' ? new Date(value) : new Date(`${value}T12:00:00`);
    return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat('es-AR', {
        day: '2-digit', month: 'short', year: 'numeric'
    }).format(date);
}

function promptText(message, initial = '', maxLength = 60) {
    const value = globalThis.prompt(message, initial);
    if (value === null) return null;
    const normalized = value.trim();
    if (!normalized || normalized.length > maxLength) throw new Error(`Ingresá un valor de hasta ${maxLength} caracteres.`);
    return normalized;
}

function promptInteger(message, initial, min, max) {
    const value = globalThis.prompt(message, String(initial));
    if (value === null) return null;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
        throw new Error(`Ingresá un número entero entre ${min} y ${max}.`);
    }
    return parsed;
}

async function copyText(value) {
    if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(value);
    const input = document.createElement('textarea');
    input.value = value;
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.appendChild(input);
    input.select();
    document.execCommand('copy');
    input.remove();
}

export function createGroupsController({ callFunction, getCurrentUser, showToast, openAuth, openTournament }) {
    const api = createGroupsApi(callFunction);
    let selectedGroupId = null;
    let selectedGroup = null;
    let loading = false;
    let bound = false;
    let processingGeneralInvitation = false;
    let pendingTournamentCreation = null;
    let statsScope = 'all';

    const element = id => document.getElementById(id);
    const isRegistered = () => Boolean(getCurrentUser() && !getCurrentUser().isAnonymous);
    const canAdminister = group => ['owner', 'admin'].includes(group?.role) && group?.status === 'active';

    function setLoading(value, message = 'Cargando…') {
        loading = value;
        const status = element('groups-status');
        if (status) status.textContent = value ? message : '';
        element('groups-page')?.querySelectorAll('button').forEach(button => { button.disabled = value; });
    }

    function showError(error) {
        const domainCode = error?.details?.domainCode;
        if (domainCode === 'GROUP_BUSY') {
            showToast('Hay una operación de torneo finalizando. Esperá unos segundos y reintentá.');
            return;
        }
        showToast(error?.message || 'No se pudo completar la operación.');
    }

    async function run(task, message) {
        if (loading) return null;
        setLoading(true, message);
        try {
            return await task();
        } catch (error) {
            showError(error);
            return null;
        } finally {
            setLoading(false);
        }
    }

    function renderInvitations(invitations) {
        const container = element('group-invitations-list');
        if (!invitations.length) {
            container.innerHTML = '<p class="empty-state">No tenés invitaciones pendientes.</p>';
            return;
        }
        container.innerHTML = invitations.map(invitation => `
            <article class="group-list-item">
                <div><strong>${escapeHtml(invitation.groupNameSnapshot)}</strong>
                    <small>Invitó ${escapeHtml(invitation.invitedByNameSnapshot)} · vence ${escapeHtml(asDate(invitation.expiresAt))}</small>
                </div>
                <div class="group-item-actions">
                    <button class="btn btn-primary btn-sm" data-accept-group-invitation="${escapeHtml(invitation.invitationId)}"
                        data-group-id="${escapeHtml(invitation.groupId)}">Aceptar</button>
                    <button class="btn btn-secondary btn-sm" data-reject-group-invitation="${escapeHtml(invitation.invitationId)}"
                        data-group-id="${escapeHtml(invitation.groupId)}">Rechazar</button>
                </div>
            </article>`).join('');
    }

    function renderGroupList(groups, former = []) {
        const container = element('groups-list');
        if (!groups.length && !former.length) {
            container.innerHTML = '<p class="empty-state">Todavía no pertenecés a ningún grupo.</p>';
            return;
        }
        const currentHtml = groups.map(group => `
            <button class="group-list-item group-list-button" data-open-group="${escapeHtml(group.groupId)}">
                <span><strong>${escapeHtml(group.groupNameSnapshot)}</strong>
                    <small>${escapeHtml(ROLE_LABELS[group.effectiveRole] || 'Miembro')} · ${group.groupStatus === 'archived' ? 'Archivado' : 'Activo'}</small>
                </span><span aria-hidden="true">›</span>
            </button>`).join('');
        const formerHtml = former.length ? `
            <h3 class="group-subheading">Grupos anteriores</h3>${former.map(group => `
            <button class="group-list-item group-list-button is-muted" data-open-group="${escapeHtml(group.groupId)}">
                <span><strong>${escapeHtml(group.groupNameSnapshot)}</strong>
                    <small>${group.membershipStatus === 'left' ? 'Saliste del grupo' : 'Membresía removida'}</small>
                </span><span aria-hidden="true">›</span>
            </button>`).join('')}` : '';
        container.innerHTML = currentHtml + formerHtml;
    }

    function renderMemberActions(group, member) {
        if (member.role === 'owner') return '';
        if (group.role === 'admin' && member.role === 'member') {
            return `<div class="group-item-actions">
                <button class="btn btn-danger btn-sm" data-remove-group-member="${escapeHtml(member.uid)}">Remover</button>
            </div>`;
        }
        if (group.role !== 'owner') return '';
        const nextRole = member.role === 'admin' ? 'member' : 'admin';
        return `<div class="group-item-actions">
            <button class="btn btn-secondary btn-sm" data-set-group-role="${escapeHtml(member.uid)}" data-role="${nextRole}">
                ${nextRole === 'admin' ? 'Hacer admin' : 'Quitar admin'}
            </button>
            <button class="btn btn-secondary btn-sm" data-transfer-group="${escapeHtml(member.uid)}">Transferir ownership</button>
            <button class="btn btn-danger btn-sm" data-remove-group-member="${escapeHtml(member.uid)}">Remover</button>
        </div>`;
    }

    function renderPlayers(group) {
        const memberByPlayer = new Map(group.members.map(member => [member.groupPlayerId, member]));
        element('group-players-list').innerHTML = group.players.map(player => {
            const member = memberByPlayer.get(player.groupPlayerId);
            const selectable = player.status === 'active';
            return `<article class="group-player-item ${player.status === 'inactive' ? 'is-muted' : ''}">
                <label class="group-player-select">
                    <input type="checkbox" data-group-player-selection value="${escapeHtml(player.groupPlayerId)}"
                        ${selectable ? 'checked' : 'disabled'}>
                    <span><strong>${escapeHtml(player.displayName)}</strong>
                        <small>${member ? escapeHtml(ROLE_LABELS[member.role] || 'Miembro con cuenta') : 'Jugador sin cuenta'} · ${player.status === 'active' ? 'Activo' : 'Inactivo'}</small>
                    </span>
                </label>
                ${canAdminister(group) ? `<div class="group-item-actions">
                    <button class="btn btn-secondary btn-sm" data-edit-group-player="${escapeHtml(player.groupPlayerId)}"
                        data-player-name="${escapeHtml(player.displayName)}">Editar nombre</button>
                    ${player.kind === 'provisional' ? `<button class="btn btn-secondary btn-sm" data-toggle-group-player="${escapeHtml(player.groupPlayerId)}"
                        data-player-status="${player.status === 'active' ? 'inactive' : 'active'}">${player.status === 'active' ? 'Desactivar' : 'Reactivar'}</button>` : ''}
                </div>` : ''}
                ${member ? renderMemberActions(group, member) : ''}
            </article>`;
        }).join('');
    }

    function renderHistory(history) {
        const container = element('group-tournaments-list');
        container.innerHTML = history.length ? history.map(item => `
            <button class="group-list-item group-list-button" data-open-group-tournament="${escapeHtml(item.tournamentId)}">
                <span><strong>${escapeHtml(item.tournamentName || 'Torneo de Pádel')}</strong>
                    <small>${escapeHtml(asDate(item.tournamentDate || item.updatedAt))}</small>
                </span><span aria-hidden="true">›</span>
            </button>`).join('') : '<p class="empty-state">Todavía no hay torneos en este grupo.</p>';
    }

    function renderPendingInvitations(group) {
        const card = element('group-pending-invitations-card');
        const container = element('group-pending-invitations-list');
        card.hidden = !canAdminister(group);
        if (!canAdminister(group)) return;
        const invitations = group.invitations || [];
        container.innerHTML = invitations.length ? invitations.map(invitation => `
            <article class="group-list-item">
                <div><strong>@${escapeHtml(invitation.targetUsername || invitation.targetUid)}</strong>
                    <small>Pendiente · vence ${escapeHtml(asDate(invitation.expiresAt))}</small></div>
                <button class="btn btn-secondary btn-sm" data-revoke-group-invitation="${escapeHtml(invitation.invitationId)}">Revocar</button>
            </article>`).join('') : '<p class="empty-state">No hay invitaciones enviadas pendientes.</p>';
    }

    function renderStats(stats) {
        const body = element('group-stats-body');
        body.innerHTML = stats.length ? stats.map((player, index) => `<tr>
            <td>${index + 1}</td><td>${escapeHtml(player.displayName)}</td>
            <td>${player.tournamentAppearances}</td><td>${player.matchesPlayed}</td>
            <td>${player.wins}</td><td>${player.losses}</td><td>${player.gamesFor}</td>
            <td>${player.gamesAgainst}</td><td>${player.gameDifference}</td>
        </tr>`).join('') : '<tr><td colspan="9">Sin resultados contabilizados.</td></tr>';
        document.querySelectorAll('[data-group-stats-scope]').forEach(button => {
            button.classList.toggle('btn-primary', button.dataset.groupStatsScope === statsScope);
            button.classList.toggle('btn-secondary', button.dataset.groupStatsScope !== statsScope);
        });
    }

    function renderDetail(group, history, stats) {
        element('groups-overview').hidden = true;
        element('group-detail').hidden = false;
        element('group-detail-title').textContent = group.profile.name;
        element('group-detail-description').textContent = group.profile.description || 'Grupo privado';
        element('group-detail-role').textContent = `${ROLE_LABELS[group.role] || 'Exmiembro'} · ${group.status === 'archived' ? 'Archivado' : group.status === 'recoveryRequired' ? 'Requiere recuperación' : 'Activo'}`;
        const operationalAdmin = canAdminister(group);
        element('group-admin-actions').hidden = !operationalAdmin;
        element('group-owner-actions').hidden = group.role !== 'owner';
        element('create-general-group-link-button').hidden = group.role !== 'owner' || Boolean(group.generalInvitation);
        element('revoke-general-group-link-button').hidden = group.role !== 'owner' || !group.generalInvitation;
        element('create-group-tournament-button').hidden = !operationalAdmin;
        element('leave-group-button').hidden = !group.role || group.role === 'owner' || group.status !== 'active';
        element('archive-group-button').hidden = group.role !== 'owner' || group.status !== 'active';
        element('restore-group-button').hidden = group.role !== 'owner' || group.status !== 'archived';
        element('group-recovery-warning').hidden = group.status !== 'recoveryRequired';
        renderPlayers(group);
        renderPendingInvitations(group);
        renderHistory(history);
        renderStats(stats);
    }

    async function loadOverview() {
        if (!isRegistered()) return;
        selectedGroupId = null;
        selectedGroup = null;
        element('groups-overview').hidden = false;
        element('group-detail').hidden = true;
        const result = await run(async () => Promise.all([api.list(), api.listFormer()]), 'Cargando grupos…');
        if (!result) return;
        renderGroupList(result[0].groups || [], result[1] || []);
        renderInvitations(result[0].invitations || []);
    }

    async function loadDetail(groupId) {
        const result = await run(async () => {
            const group = await api.get(groupId);
            const canSeeCurrent = Boolean(group.role);
            if (canSeeCurrent) {
                const [history, stats] = await Promise.all([api.history(groupId), api.stats(groupId, statsScope)]);
                return { group, history, stats: stats.players || [] };
            }
            const personal = await api.personalStats(groupId);
            return { group, history: [], stats: personal.player ? [personal.player] : [] };
        }, 'Cargando grupo…');
        if (!result) return;
        selectedGroupId = groupId;
        selectedGroup = result.group;
        renderDetail(result.group, result.history, result.stats);
    }

    async function refreshDetail() {
        if (selectedGroupId) await loadDetail(selectedGroupId);
        else await loadOverview();
    }

    async function createGroup() {
        try {
            const name = promptText('Nombre del grupo:');
            if (name === null) return;
            const descriptionValue = globalThis.prompt('Descripción opcional:', '');
            if (descriptionValue === null) return;
            const description = descriptionValue.trim();
            if (description.length > 500) throw new Error('La descripción admite hasta 500 caracteres.');
            const created = await run(() => api.create({ name, description }), 'Creando grupo…');
            if (!created) return;
            showToast('Grupo creado.');
            await loadDetail(created.groupId);
        } catch (error) { showError(error); }
    }

    async function editGroup() {
        try {
            const name = promptText('Nombre del grupo:', selectedGroup.profile.name);
            if (name === null) return;
            const descriptionValue = globalThis.prompt('Descripción opcional:', selectedGroup.profile.description || '');
            if (descriptionValue === null) return;
            const description = descriptionValue.trim();
            if (description.length > 500) throw new Error('La descripción admite hasta 500 caracteres.');
            if (await run(() => api.update({ groupId: selectedGroupId, name, description }), 'Guardando grupo…')) {
                showToast('Grupo actualizado.');
                await refreshDetail();
            }
        } catch (error) { showError(error); }
    }

    async function inviteUsername() {
        try {
            const username = promptText('Username de la persona a invitar:', '', 30);
            if (username === null) return;
            if (await run(() => api.inviteUsername(selectedGroupId, username), 'Enviando invitación…')) {
                showToast('Invitación enviada.');
            }
        } catch (error) { showError(error); }
    }

    async function addProvisional() {
        try {
            const displayName = promptText('Nombre del jugador sin cuenta:');
            if (displayName === null) return;
            if (await run(() => api.addProvisional(selectedGroupId, displayName), 'Agregando jugador…')) {
                showToast('Jugador agregado.');
                await refreshDetail();
            }
        } catch (error) { showError(error); }
    }

    async function createGeneralLink() {
        if (!globalThis.confirm('Se creará un enlace válido para 10 ingresos durante 7 días. ¿Continuar?')) return;
        const result = await run(() => api.createGeneralLink(selectedGroupId), 'Creando enlace…');
        if (!result) return;
        const url = buildGeneralGroupInvitationUrl({
            origin: location.origin,
            pathname: location.pathname,
            groupId: selectedGroupId,
            invitationId: result.invitationId,
            token: result.token
        });
        try {
            await copyText(url);
            showToast('Enlace copiado. Guardalo: el secreto se muestra una sola vez.');
        } catch (error) {
            globalThis.prompt('Copiá este enlace. El secreto se muestra una sola vez:', url);
        }
    }

    async function createTournament() {
        try {
            const playerIds = Array.from(document.querySelectorAll('[data-group-player-selection]:checked'))
                .map(input => input.value);
            if (playerIds.length < 4 || playerIds.length > 16) {
                throw new Error('Seleccioná entre 4 y 16 jugadores activos.');
            }
            const name = promptText('Nombre del torneo:', `Torneo de ${selectedGroup.profile.name}`, 100);
            if (name === null) return;
            const dateInput = globalThis.prompt('Fecha (AAAA-MM-DD):', new Date().toISOString().slice(0, 10));
            if (dateInput === null) return;
            const tournamentDate = dateInput.trim();
            if (!/^\d{4}-\d{2}-\d{2}$/.test(tournamentDate)) throw new Error('La fecha no es válida.');
            const numRounds = promptInteger('Cantidad de rondas (máximo 40):', playerIds.length, 1, 40);
            if (numRounds === null) return;
            const gamesPerSet = promptInteger('Games por set:', 4, 1, 20);
            if (gamesPerSet === null) return;
            const playerNames = playerIds.map(id => selectedGroup.players.find(player => player.groupPlayerId === id)?.displayName || 'Jugador');
            const requestData = {
                groupId: selectedGroupId,
                groupPlayerIds: playerIds,
                configuration: {
                    numPlayers: playerIds.length,
                    numCourts: Math.max(1, Math.min(2, Math.floor(playerIds.length / 4))),
                    pairingMode: 'rotating',
                    fixedTeams: []
                },
                numRounds,
                gamesPerSet,
                players: playerNames,
                metadata: { tournamentName: name, tournamentDate }
            };
            const requestKey = JSON.stringify(requestData);
            if (pendingTournamentCreation?.key !== requestKey) {
                pendingTournamentCreation = { key: requestKey, creationRequestId: createOperationId() };
            }
            const created = await run(() => callFunction('createTournamentV2', {
                ...requestData,
                creationRequestId: pendingTournamentCreation.creationRequestId
            }), 'Creando torneo…');
            if (!created) return;
            pendingTournamentCreation = null;
            showToast('Torneo del grupo creado.');
            openTournament(created.tournamentId);
        } catch (error) { showError(error); }
    }

    async function processGeneralInvitation() {
        if (processingGeneralInvitation) return;
        const invitation = loadPendingGeneralInvitation();
        if (!invitation) return;
        processingGeneralInvitation = true;
        try {
            const preview = await api.previewGeneralLink(invitation);
            if (!isRegistered()) {
                showToast(`Iniciá sesión para unirte a ${preview.groupName}.`);
                openAuth();
                return;
            }
            if (!globalThis.confirm(`¿Querés unirte a “${preview.groupName}”? Quedan ${preview.remainingUses} ingresos.`)) {
                clearPendingGeneralInvitation();
                return;
            }
            const accepted = await api.acceptGeneralLink(invitation);
            clearPendingGeneralInvitation();
            selectedGroupId = accepted.groupId;
            location.hash = 'grupos';
            showToast(`Te uniste a ${preview.groupName}.`);
            await loadDetail(accepted.groupId);
        } catch (error) {
            const retryAfterAuth = !isRegistered() && /iniciar sesión|cuenta registrada/i.test(error?.message || '');
            const terminalCodes = new Set([
                'FORBIDDEN', 'INVITATION_EXPIRED', 'REINVITE_REQUIRED', 'GROUP_ARCHIVED',
                'GROUP_RECOVERY_REQUIRED', 'GROUP_LIMIT_REACHED', 'NOT_FOUND'
            ]);
            if (!retryAfterAuth && terminalCodes.has(error?.details?.domainCode)) {
                clearPendingGeneralInvitation();
            }
            showError(error);
        } finally {
            processingGeneralInvitation = false;
        }
    }

    function captureInvitationFromUrl() {
        const invitation = parseGeneralGroupInvitation(location);
        if (!invitation) return false;
        savePendingGeneralInvitation(invitation);
        const url = new URL(location.href);
        url.searchParams.delete('grupoInvitacion');
        url.searchParams.delete('invitacionGrupo');
        url.hash = '';
        history.replaceState(null, '', `${url.pathname}${url.search}`);
        return true;
    }

    async function handleAction(event) {
        const action = event.target.closest('button');
        if (!action || loading) return;
        if (action.id === 'groups-button') {
            if (!isRegistered()) { openAuth(); return; }
            location.hash = 'grupos';
            await loadOverview();
        } else if (action.id === 'back-from-groups-button') {
            history.replaceState(null, '', `${location.pathname}${location.search}`);
            globalThis.dispatchEvent(new HashChangeEvent('hashchange'));
        } else if (action.id === 'create-group-button') await createGroup();
        else if (action.id === 'back-to-groups-list-button') await loadOverview();
        else if (action.id === 'edit-group-button') await editGroup();
        else if (action.id === 'invite-group-user-button') await inviteUsername();
        else if (action.id === 'add-provisional-player-button') await addProvisional();
        else if (action.id === 'create-general-group-link-button') await createGeneralLink();
        else if (action.id === 'revoke-general-group-link-button') {
            if (globalThis.confirm('¿Revocar el enlace general activo?')
                && await run(() => api.revokeGeneralLink(selectedGroupId), 'Revocando enlace…')) showToast('Enlace revocado.');
        } else if (action.id === 'create-group-tournament-button') await createTournament();
        else if (action.id === 'archive-group-button') {
            if (globalThis.confirm('¿Archivar el grupo? Sus torneos quedarán en modo sólo lectura.')
                && await run(() => api.archive(selectedGroupId), 'Archivando grupo…')) await refreshDetail();
        } else if (action.id === 'restore-group-button') {
            if (await run(() => api.restore(selectedGroupId), 'Reactivando grupo…')) await refreshDetail();
        } else if (action.id === 'leave-group-button') {
            if (globalThis.confirm('¿Salir del grupo? Para volver necesitarás una invitación dirigida.')
                && await run(() => api.leave(selectedGroupId), 'Saliendo del grupo…')) await loadOverview();
        } else if (action.dataset.openGroup) await loadDetail(action.dataset.openGroup);
        else if (action.dataset.openGroupTournament) openTournament(action.dataset.openGroupTournament);
        else if (action.dataset.groupStatsScope) {
            statsScope = action.dataset.groupStatsScope === 'active' ? 'active' : 'all';
            await refreshDetail();
        }
        else if (action.dataset.acceptGroupInvitation) {
            if (await run(() => api.acceptInvitation(action.dataset.groupId, action.dataset.acceptGroupInvitation), 'Aceptando invitación…')) {
                showToast('Invitación aceptada.');
                await loadDetail(action.dataset.groupId);
            }
        } else if (action.dataset.rejectGroupInvitation) {
            if (await run(() => api.rejectInvitation(action.dataset.groupId, action.dataset.rejectGroupInvitation), 'Rechazando invitación…')) await loadOverview();
        } else if (action.dataset.revokeGroupInvitation) {
            if (await run(() => api.revokeInvitation(selectedGroupId, action.dataset.revokeGroupInvitation), 'Revocando invitación…')) await refreshDetail();
        } else if (action.dataset.editGroupPlayer) {
            try {
                const name = promptText('Nombre del jugador:', action.dataset.playerName);
                if (name && await run(() => api.updatePlayer(selectedGroupId, action.dataset.editGroupPlayer, name), 'Actualizando jugador…')) await refreshDetail();
            } catch (error) { showError(error); }
        } else if (action.dataset.toggleGroupPlayer) {
            if (await run(() => api.setPlayerStatus(selectedGroupId, action.dataset.toggleGroupPlayer, action.dataset.playerStatus), 'Actualizando jugador…')) await refreshDetail();
        } else if (action.dataset.setGroupRole) {
            if (await run(() => api.setMemberRole(selectedGroupId, action.dataset.setGroupRole, action.dataset.role), 'Actualizando rol…')) await refreshDetail();
        } else if (action.dataset.transferGroup) {
            if (globalThis.confirm('¿Transferir el ownership? Vos quedarás como admin.')
                && await run(() => api.transferOwnership(selectedGroupId, action.dataset.transferGroup), 'Transfiriendo ownership…')) await refreshDetail();
        } else if (action.dataset.removeGroupMember) {
            if (globalThis.confirm('¿Remover a este miembro?')
                && await run(() => api.removeMember(selectedGroupId, action.dataset.removeGroupMember), 'Removiendo miembro…')) await refreshDetail();
        }
    }

    return {
        bind() {
            if (bound) return;
            bound = true;
            element('groups-button')?.addEventListener('click', handleAction);
            element('groups-page')?.addEventListener('click', handleAction);
            const captured = captureInvitationFromUrl();
            if (captured || loadPendingGeneralInvitation()) processGeneralInvitation();
        },
        async onAuthChanged() {
            element('groups-button').hidden = !isRegistered();
            if (loadPendingGeneralInvitation()) await processGeneralInvitation();
            if (location.hash === '#grupos' && isRegistered()) await loadOverview();
        },
        async onRouteChanged() {
            if (location.hash !== '#grupos') return;
            if (!isRegistered()) { openAuth(); return; }
            if (!selectedGroupId) await loadOverview();
        },
        cancelPendingInvitation() {
            if (!loadPendingGeneralInvitation()) return;
            clearPendingGeneralInvitation();
            showToast('Se canceló la invitación al grupo.');
        }
    };
}
