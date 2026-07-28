export function renderLeaderboard(tbody, stats) {
    tbody.innerHTML = stats.map((player, index) => `
        <tr class="${index === 0 ? 'leader-row-1' : ''}">
            <td>${index + 1}</td>
            <td>${player.name}</td>
            <td>${player.v}</td>
            <td>${player.d}</td>
            <td>${player.gf}</td>
            <td>${player.gc}</td>
            <td>${player.dif > 0 ? '+' + player.dif : player.dif}</td>
        </tr>
    `).join('');
}
