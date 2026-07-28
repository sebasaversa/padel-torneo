# Plan de migración a Vite

Documento de trabajo para migrar el anotador de pádel desde un único `index.html` hacia una aplicación modular con Vite.

Runtime de desarrollo definido para todo el proyecto: **Node.js 22 LTS**.

## Objetivo

Mejorar la mantenibilidad y la eficiencia del desarrollo sin cambiar:

- los links de torneos compartidos;
- la estructura de datos existente en Firebase Realtime Database;
- las funciones actuales del torneo;
- el hosting público en GitHub Pages.

## Estado

- `[x]` Completado
- `[~]` En curso
- `[ ]` Pendiente
- `[!]` Bloqueado o requiere una decisión

## Línea de base y respaldo

- Estado actual: aplicación funcional en un único `index.html` de aproximadamente 2.000 líneas.
- Commit de inicio de la migración: `bd27871`.
- Respaldo disponible: tag `v4.0`.
- El tag `v4.0` es un respaldo anterior; antes de modificar la estructura conviene crear un tag adicional `pre-vite-migration` apuntando al commit de inicio.

## Etapas

### 0. Planificación y respaldo

Estado: `[x]` Completa.

- `[x]` Definir objetivo y alcance.
- `[x]` Elegir Vite como herramienta de build.
- `[x]` Definir una migración incremental, con commits verificables por etapa.
- `[x]` Crear el tag `pre-vite-migration` sobre el commit `bd27871`.
- `[x]` Confirmar que la versión actual funciona antes de iniciar la migración.

### 1. Preparar la toolchain

Estado: `[x]` Completa.

- `[x]` Crear `package.json`.
- `[x]` Instalar Vite y las dependencias necesarias.
- `[x]` Agregar scripts `dev`, `build` y `preview`.
- `[x]` Crear `vite.config.js` con `base: './'` para GitHub Pages.
- `[x]` Fijar Node 22 LTS mediante `.nvmrc` y `engines` (`>=22.12.0 <23`).
- `[x]` Mantener inicialmente Firebase cargado de forma compatible con la versión actual.
- `[x]` Verificar que la aplicación pueda generar una build de producción.

Criterio de finalización: la build de Vite termina correctamente y produce una carpeta `dist/`.

Nota: el entorno tiene disponible Node `22.14.0`; la build fue validada con ese runtime. Para activar la versión fijada localmente:

```bash
nvm use
npm install
npm run dev
```

### 2. Separar HTML y estilos

Estado: `[~]` En curso.

- `[x]` Dejar en `index.html` la estructura HTML y el punto de entrada modular.
- `[x]` Mover los estilos a `src/styles.css`.
- `[x]` Mantener separados los estilos base, layout, controles, rondas, modales y vista móvil.
- `[x]` Mantener el comportamiento funcional existente después de la extracción.
- `[ ]` Completar una prueba visual responsive específica de esta etapa.
- `[ ]` Reemplazar los handlers inline por listeners explícitos desde módulos de UI.

Criterio de finalización: la interfaz se ve igual en escritorio y celular, sin lógica de negocio dentro del HTML.

Progreso actual: Vite transforma `src/styles.css` y `src/app.js` en assets optimizados dentro de `dist/assets/`. La compatibilidad con los handlers inline es temporal y se eliminará al extraer los componentes de UI.

### 3. Crear el núcleo de estado

Estado: `[x]` Completa.

- `[x]` Crear un store central para `players`, `schedule`, `gamesPerSet`, `tournamentName`, `tournamentDate` y `collapsedRounds`.
- `[x]` Extraer la creación y normalización del modelo base a `src/state/model.js`.
- `[x]` Definir las funciones de lectura, actualización, snapshot y reemplazo del estado dentro del store.
- `[x]` Mantener `getState`, `setState`, undo y firmas de estado mediante un adaptador reutilizable.
- `[x]` Separar la persistencia local del estado visual.
- `[x]` Desacoplar completamente el estado visual de las variables legacy de `app.js`.

Estructura prevista:

```text
src/state/store.js
src/state/model.js
src/services/local-storage.js
```

Criterio de finalización: cambiar o cargar el estado no depende de variables globales repartidas por distintos módulos.

Progreso final: `src/state/store.js` concentra el estado activo del torneo, sus snapshots, reemplazos, firmas estables y el historial de undo. `src/state/model.js` crea y normaliza el modelo de datos, mientras `src/services/local-storage.js` encapsula la lectura, escritura y limpieza de `localStorage`.

### 4. Extraer el dominio del fixture

Estado: `[x]` Completa.

- `[x]` Mover la generación automática de rondas y parejas.
- `[x]` Mover la lógica de cantidad de jugadores, canchas y descansos.
- `[x]` Mover el agregado y eliminación independiente de rondas.
- `[x]` Mantener los reemplazos de jugadores por ronda o hacia el futuro.
- `[x]` Agregar tests para 4–16 jugadores y para rondas extra.

Estructura prevista:

```text
src/features/fixture/generator.js
src/features/fixture/rounds.js
src/features/fixture/player-swaps.js
```

Criterio de finalización: el fixture generado por la versión modular coincide con el actual para los mismos datos.

Progreso final: `src/features/fixture/generator.js` contiene la generación de rondas, descansos, canchas y parejas para todas las cantidades actuales de jugadores. `src/features/fixture/rounds.js` concentra el agregado, eliminación y validación de rondas con resultados; `src/features/fixture/player-swaps.js`, los reemplazos. `npm test` verifica fixtures de 4 a 16 jugadores, rondas extra y la unicidad de jugadores durante reemplazos.

### 5. Extraer resultados y estadísticas

Estado: `[x]` Completa.

- `[x]` Separar actualización de scores y límites de games.
- `[x]` Separar detección de partidos y rondas completas.
- `[x]` Separar advertencias de resultados.
- `[x]` Separar tabla general, diferencias, resumen y rachas.
- `[x]` Agregar tests unitarios para resultados válidos, empates y partidos incompletos.

Estructura prevista:

```text
src/features/scoring/scores.js
src/features/scoring/validation.js
src/features/scoring/statistics.js
src/features/scoring/summary.js
```

Criterio de finalización: el cálculo de resultados, posiciones y resumen se puede validar sin depender del DOM.

Progreso final: `src/features/scoring/` concentra límites, validaciones, tabla general, diferencias, progreso, rachas y resumen. `npm test` cubre resultados válidos, empates, partidos incompletos y estadísticas derivadas.

### 6. Extraer servicios externos

Estado: `[x]` Completa.

- `[x]` Encapsular inicialización y autenticación anónima de Firebase.
- `[x]` Encapsular sincronización del estado compartido.
- `[x]` Encapsular presencia y claims de identidad.
- `[x]` Encapsular historial de actividad.
- `[x]` Encapsular links compartidos y exportación/importación.
- `[x]` Mantener sin cambios las rutas existentes de Firebase.

Estructura prevista:

```text
src/services/firebase.js
src/services/tournament-sync.js
src/services/identity.js
src/services/activity.js
src/services/sharing.js
```

Criterio de finalización: un torneo creado con la versión actual puede abrirse, editarse y sincronizarse con la versión modular.

Progreso final: Firebase, sincronización de estado, presencia, identidad, historial y utilidades de compartir viven en módulos de `src/services/`. Las rutas de Firebase y el formato de links existentes se conservan.

### 7. Extraer la interfaz

Estado: `[~]` En curso.

- `[~]` Crear renderizadores o componentes para toolbar, jugadores, tabla, rondas, partidos y scores.
- Separar modales de nombre de torneo, identidad, actividad, resumen y reemplazo de jugadores.
- Mantener los controles accesibles y cómodos en celular.
- Eliminar handlers inline progresivamente.

Estructura prevista:

```text
src/ui/render.js
src/ui/components/toolbar.js
src/ui/components/player-list.js
src/ui/components/leaderboard.js
src/ui/components/round-card.js
src/ui/components/score-control.js
src/ui/components/modal.js
```

Progreso actual: `toolbar.js`, `player-list.js`, `leaderboard.js`, `round-card.js` y `modal.js` ya separan las principales áreas visuales. Las rondas y los anotadores de puntos usan listeners explícitos; quedan los controles estáticos y algunos modales por migrar fuera de los handlers inline.

### 8. Componer la aplicación

Estado: `[ ]` Pendiente.

- Crear `src/main.js` como punto de entrada.
- Conectar store, dominio, servicios y UI mediante eventos explícitos.
- Reducir o eliminar el uso de variables globales.
- Mantener una sola dirección de actualización: acción → estado → renderizado → persistencia.

Estructura prevista:

```text
src/main.js
src/app/app-controller.js
```

Criterio de finalización: no quedan funciones de negocio grandes dentro de `index.html`.

### 9. Tests y validación de regresión

Estado: `[ ]` Pendiente.

- Tests de generación de fixture.
- Tests de scores y estadísticas.
- Tests de agregado y eliminación de rondas.
- Tests de serialización y compatibilidad de estado.
- Prueba manual de Firebase con dos navegadores/dispositivos.
- Prueba responsive en celular.
- Verificación de importación de torneos anteriores.

### 10. Deploy con GitHub Pages

Estado: `[ ]` Pendiente.

- Crear workflow de GitHub Actions para instalar dependencias y ejecutar `npm run build`.
- Publicar `dist/` en GitHub Pages.
- Mantener la URL pública actual.
- Verificar que las rutas de Firebase, assets y módulos funcionen en producción.
- No publicar una etapa incompleta.

### 11. Limpieza y documentación

Estado: `[ ]` Pendiente.

- Eliminar código duplicado y handlers antiguos.
- Actualizar `README.md` con instalación, desarrollo, build y deploy.
- Documentar las rutas de Firebase y las decisiones importantes.
- Crear un tag de la primera versión modular estable.

## Orden de commits recomendado

Cada etapa debería terminar con un commit pequeño y recuperable:

1. `Prepare Vite toolchain`
2. `Extract styles and HTML shell`
3. `Extract application state`
4. `Extract fixture domain`
5. `Extract scoring domain`
6. `Extract Firebase services`
7. `Extract UI components`
8. `Compose modular application`
9. `Add regression tests`
10. `Deploy Vite build`

## Regla de seguridad

Si una etapa rompe la sincronización, la importación de datos o los links compartidos, se detiene la migración, se corrige esa etapa y recién después se continúa. No se deben mezclar refactors con cambios funcionales grandes durante la misma etapa.
