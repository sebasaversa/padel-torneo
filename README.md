# Torneo Americano Pádel

Anotador web para torneo americano de pádel: **9 jugadores**, **2 canchas**, **9 rondas** (cada uno descansa 1 vez), sets a **4 games**.

## Esquema de juego

| Ronda | Cancha 1 | Cancha 2 | Descansa |
|-------|----------|----------|----------|
| 1 | P0+P7 vs P3+P4 | P1+P6 vs P2+P5 | P8 |
| 2 | P1+P8 vs P4+P5 | P2+P7 vs P3+P6 | P0 |
| 3 | P2+P0 vs P5+P6 | P3+P8 vs P4+P7 | P1 |
| ... | *(rotación cíclica)* | | |

Con 9 rondas, cada jugador juega **8 partidos** con **8 compañeros distintos** y enfrenta la mayoría de combinaciones posibles.

## Uso local

Abrí `index.html` en el navegador, o servilo con:

```bash
python3 -m http.server 8080
```

Luego entrá a http://localhost:8080

## Publicar en la web (GitHub Pages)

1. Creá un repo en GitHub y subí este proyecto:
   ```bash
   git add index.html README.md
   git commit -m "Add padel tournament scorer"
   git remote add origin https://github.com/TU-USUARIO/padel-torneo.git
   git push -u origin master
   ```

2. En GitHub: **Settings → Pages → Source**: deploy from branch `master`, folder `/ (root)`.

3. En unos minutos estará en `https://TU-USUARIO.github.io/padel-torneo/`

## Compartir entre todos

- Una persona anota en su celular.
- Después de cada ronda, tocá **Compartir link** y mandalo al grupo de WhatsApp.
- Al abrir el link, todos ven los mismos nombres, fixture y resultados.
- Los datos también se guardan automáticamente en el navegador (localStorage).

## Funciones

- Editar nombres de jugadores
- Fixture automático con rotación (editable manualmente)
- Anotar resultados a 4 games
- Tabla de posiciones (V, D, GF, GC, Dif)
- Compartir link / Exportar / Importar JSON
- Regenerar fixture o borrar todo
