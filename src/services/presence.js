export function summarizePresence(presences = {}) {
    const entries = Object.entries(presences).map(([presenceId, value]) => ({
        presenceId,
        uid: value?.uid || '',
        actorName: value?.actorName || 'Espectador',
        role: value?.role || 'spectator',
        device: value?.device || 'Dispositivo'
    }));
    const identities = new Map();
    for (const entry of entries) {
        const key = entry.uid ? `uid:${entry.uid}` : `device:${entry.presenceId}`;
        if (!identities.has(key)) identities.set(key, { ...entry, devices: 0 });
        identities.get(key).devices += 1;
    }
    return { devices: entries.length, people: [...identities.values()] };
}

export function formatPresenceRole(role) {
    return ({ superAdmin: 'Super admin', admin: 'Admin', participant: 'Jugador', spectator: 'Espectador' })[role] || 'Espectador';
}
