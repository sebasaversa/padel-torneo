export function renderPlayerList(container, players, onPlayerChange) {
    container.innerHTML = '';
    players.forEach((player, index) => {
        const input = document.createElement('input');
        input.type = 'text';
        input.value = player;
        input.placeholder = `Jugador ${index + 1}`;
        input.addEventListener('change', event => {
            onPlayerChange(index, player, event.target.value.trim() || `Jugador ${index + 1}`);
        });
        container.appendChild(input);
    });
}
