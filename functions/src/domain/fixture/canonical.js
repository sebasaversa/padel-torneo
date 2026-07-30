import { domainError } from './errors.js';

export const SCHEMA_VERSION = 2;
export const FIXTURE_GENERATOR_VERSION = 1;
export const CATALOG_VERSION = 1;
export const MAX_OPTIMIZED_VARIANTS_V1 = 8;

export function pairKey(a, b) {
    return a < b ? `${a}:${b}` : `${b}:${a}`;
}

export function canonicalizeFixedTeams(fixedTeams, numPlayers) {
    if (!Array.isArray(fixedTeams) || fixedTeams.length !== numPlayers / 2) {
        throw domainError('INVALID_CONFIGURATION', 'Las parejas fijas deben incluir exactamente a todos los jugadores.');
    }
    const seen = new Set();
    const pairs = fixedTeams.map(team => {
        const ids = Array.isArray(team) ? team : team?.playerIds;
        if (!Array.isArray(ids) || ids.length !== 2 || !ids.every(Number.isInteger)) {
            throw domainError('INVALID_CONFIGURATION', 'Cada pareja fija debe tener exactamente dos IDs de jugador.');
        }
        const sorted = [...ids].sort((a, b) => a - b);
        if (sorted[0] === sorted[1] || sorted.some(id => id < 0 || id >= numPlayers)) {
            throw domainError('INVALID_CONFIGURATION', 'Las parejas fijas contienen IDs inválidos.');
        }
        sorted.forEach(id => {
            if (seen.has(id)) throw domainError('INVALID_CONFIGURATION', 'Un jugador no puede estar en más de una pareja fija.');
            seen.add(id);
        });
        return sorted;
    }).sort((left, right) => left[0] - right[0] || left[1] - right[1]);
    if (seen.size !== numPlayers) {
        throw domainError('INVALID_CONFIGURATION', 'Cada jugador debe aparecer exactamente una vez en las parejas fijas.');
    }
    return pairs.map(playerIds => ({ id: `team-${playerIds[0]}-${playerIds[1]}`, playerIds }));
}

export function validateConfiguration(configuration) {
    if (!configuration || typeof configuration !== 'object' || Array.isArray(configuration)) {
        throw domainError('INVALID_CONFIGURATION', 'Falta la configuración estructural.');
    }
    const {
        numPlayers,
        numCourts,
        pairingMode,
        fixtureGeneratorVersion,
        catalogVersion
    } = configuration;
    if (!Number.isInteger(numPlayers) || numPlayers < 4 || numPlayers > 16) {
        throw domainError('INVALID_CONFIGURATION', 'La cantidad de jugadores debe ser un entero entre 4 y 16.');
    }
    if (!Number.isInteger(numCourts) || numCourts < 1 || numCourts > Math.floor(numPlayers / 4)) {
        throw domainError('INVALID_CONFIGURATION', `La cantidad de canchas debe estar entre 1 y ${Math.floor(numPlayers / 4)}.`);
    }
    if (!['rotating', 'fixed'].includes(pairingMode)) {
        throw domainError('INVALID_CONFIGURATION', 'El modo de parejas no es válido.');
    }
    if (fixtureGeneratorVersion !== FIXTURE_GENERATOR_VERSION || catalogVersion !== CATALOG_VERSION) {
        throw domainError('UNSUPPORTED_GENERATOR_VERSION', 'La versión del generador o del catálogo no está soportada.');
    }
    if (pairingMode === 'fixed' && numPlayers % 2 !== 0) {
        throw domainError('INVALID_CONFIGURATION', 'Las parejas fijas requieren una cantidad par de jugadores.');
    }
    const fixedTeams = pairingMode === 'fixed'
        ? canonicalizeFixedTeams(configuration.fixedTeams, numPlayers)
        : [];
    if (pairingMode === 'rotating' && Array.isArray(configuration.fixedTeams) && configuration.fixedTeams.length) {
        throw domainError('INVALID_CONFIGURATION', 'El modo rotativo no admite parejas fijas.');
    }
    return Object.freeze({
        numPlayers,
        numCourts,
        pairingMode,
        fixedTeams,
        fixtureGeneratorVersion,
        catalogVersion
    });
}

export function stableSerialize(value) {
    if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

// SHA-256 sin dependencias de runtime, compartido por navegador y Functions.
export function sha256(value) {
    const text = typeof value === 'string' ? value : stableSerialize(value);
    const bytes = new TextEncoder().encode(text);
    const bitLength = bytes.length * 8;
    const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
    const padded = new Uint8Array(paddedLength);
    padded.set(bytes);
    padded[bytes.length] = 0x80;
    const view = new DataView(padded.buffer);
    view.setUint32(paddedLength - 4, bitLength >>> 0);
    view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000));
    const constants = Array.from({ length: 64 }, (_, index) => [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    ][index]);
    const hash = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const rotate = (word, count) => (word >>> count) | (word << (32 - count));
    for (let offset = 0; offset < padded.length; offset += 64) {
        const words = Array(64);
        for (let index = 0; index < 16; index += 1) words[index] = view.getUint32(offset + index * 4);
        for (let index = 16; index < 64; index += 1) {
            const x = words[index - 15];
            const y = words[index - 2];
            const s0 = rotate(x, 7) ^ rotate(x, 18) ^ (x >>> 3);
            const s1 = rotate(y, 17) ^ rotate(y, 19) ^ (y >>> 10);
            words[index] = (words[index - 16] + s0 + words[index - 7] + s1) >>> 0;
        }
        let [a, b, c, d, e, f, g, h] = hash;
        for (let index = 0; index < 64; index += 1) {
            const s1 = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25);
            const choice = (e & f) ^ (~e & g);
            const temp1 = (h + s1 + choice + constants[index] + words[index]) >>> 0;
            const s0 = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22);
            const majority = (a & b) ^ (a & c) ^ (b & c);
            const temp2 = (s0 + majority) >>> 0;
            h = g; g = f; f = e; e = (d + temp1) >>> 0;
            d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
        }
        [a, b, c, d, e, f, g, h].forEach((word, index) => { hash[index] = (hash[index] + word) >>> 0; });
    }
    return hash.map(word => word.toString(16).padStart(8, '0')).join('');
}

export function scheduleIdentityPayload(schedule, configuration, fixtureVariant) {
    return {
        fixtureGeneratorVersion: configuration.fixtureGeneratorVersion,
        catalogVersion: configuration.catalogVersion,
        fixtureVariant,
        rounds: schedule.map(round => ({
            id: round.id,
            matches: round.matches.map(match => ({
                id: match.id,
                court: match.court,
                players: [match.t1_p1, match.t1_p2, match.t2_p1, match.t2_p2]
            }))
        }))
    };
}

export function scheduleFingerprint(schedule, configuration, fixtureVariant) {
    return sha256(scheduleIdentityPayload(schedule, configuration, fixtureVariant));
}
