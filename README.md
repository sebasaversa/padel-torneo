# Torneo Americano Pádel

Anotador web para torneo americano de pádel: **jugadores configurables (4–16)**, **2 canchas**, sets a **4 games**.

## Versiones

| Tag | Descripción |
|-----|-------------|
| `v1-fijo-9-jugadores` | Versión original fija para 9 jugadores |
| `master` (actual) | Cantidad de jugadores configurable |

Para volver a la versión original:
```bash
git checkout v1-fijo-9-jugadores
```

Para volver a la versión nueva:
```bash
git checkout master
```

## Esquema de juego

- **4–7 jugadores:** 1 cancha (4 juegan, el resto descansa)
- **8 jugadores:** 2 canchas, todos juegan
- **9+ jugadores:** 2 canchas (8 juegan), el resto descansa rotando

Con 9 jugadores se usa el fixture cíclico perfecto original. Para otros números, se genera automáticamente.

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
