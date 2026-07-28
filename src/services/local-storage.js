export function createLocalStorageStore(key) {
    return {
        load() {
            try {
                const raw = localStorage.getItem(key);
                return raw ? JSON.parse(raw) : null;
            } catch {
                return null;
            }
        },
        save(value) {
            try {
                localStorage.setItem(key, JSON.stringify(value));
            } catch {
                // Ignore quota and private-mode storage errors.
            }
        },
        remove() {
            try {
                localStorage.removeItem(key);
            } catch {
                // Ignore unavailable storage.
            }
        }
    };
}
