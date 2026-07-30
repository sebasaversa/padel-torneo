export function renderPlayerList(container, players, onPlayerChange, canEditPlayer = () => true) {
    container.innerHTML = '';
    players.forEach((player, index) => {
        const input = document.createElement('input');
        input.type = 'text';
        input.value = player;
        input.placeholder = `Jugador ${index + 1}`;
        input.disabled = !canEditPlayer(index);
        if (input.disabled) input.title = 'Sólo ese jugador o un administrador puede cambiar este nombre.';
        input.addEventListener('change', event => {
            onPlayerChange(index, player, event.target.value.trim() || `Jugador ${index + 1}`);
        });
        container.appendChild(input);
    });
}
