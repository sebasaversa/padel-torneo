import { createLegacyTournamentMetadata, createTournamentMetadata, normalizeTournamentMetadata } from './tournament-access.js';

export function createTournamentMetadataStore({ database, serverTimestamp }) {
    function metadataRef(tournamentId) {
        return database.ref(`tournaments/${tournamentId}/metadata`);
    }

    return {
        async get(tournamentId) {
            const snapshot = await metadataRef(tournamentId).once('value');
            return normalizeTournamentMetadata(snapshot.val());
        },
        async initialize(tournamentId, ownerUid) {
            const timestamp = serverTimestamp();
            const initialMetadata = createTournamentMetadata({ ownerUid, timestamp });
            const result = await metadataRef(tournamentId).transaction(current => current || initialMetadata);
            return normalizeTournamentMetadata(result.snapshot.val());
        },
        async initializeLegacy(tournamentId, superAdminUid) {
            const timestamp = serverTimestamp();
            const initialMetadata = createLegacyTournamentMetadata({ adminUid: superAdminUid, timestamp });
            const result = await metadataRef(tournamentId).transaction(current => current || initialMetadata);
            return normalizeTournamentMetadata(result.snapshot.val());
        }
    };
}
