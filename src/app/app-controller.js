export function createAppController({ initialize, bindEvents, onHashChange }) {
    let started = false;

    return {
        start() {
            if (started) return;
            started = true;
            initialize();
            bindEvents();
            window.addEventListener('hashchange', onHashChange);
        }
    };
}
