# Plan de migración a Vite

Documento de trabajo para migrar el anotador de pádel desde un único `index.html` hacia una aplicación modular con Vite.

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
- `[x]` Fijar Node 22 LTS mediante `.nvmrc` y `engines`.
- `[x]` Mantener inicialmente Firebase cargado de forma compatible con la versión actual.
- `[x]` Verificar que la aplicación pueda generar una build de producción.

Criterio de finalización: la build de Vite termina correctamente y produce una carpeta `dist/`.

Nota: el entorno tiene disponible Node `22.14.0`; la build fue validada con ese runtime.

### 2. Separar HTML y estilos

Estado: `[ ]` Pendiente.

- Dejar en `index.html` solamente la estructura mínima de entrada.
- Mover los estilos a `src/styles/`.
- Separar estilos base, layout, controles, rondas, modales y vista móvil.
- Mantener exactamente el aspecto y el comportamiento responsive actuales.

Criterio de finalización: la interfaz se ve igual en escritorio y celular, sin lógica de negocio dentro del HTML.

### 3. Crear el núcleo de estado

Estado: `[ ]` Pendiente.

- Crear un store central para `players`, `schedule`, `gamesPerSet`, `tournamentName`, `tournamentDate` y `collapsedRounds`.
- Definir funciones de lectura y actualización del estado.
- Mantener `getState`, `setState`, undo y firmas de estado.
- Separar persistencia local del estado visual.

Estructura prevista:

```text
src/state/store.js
src/state/undo.js
src/services/local-storage.js
```

Criterio de finalización: cambiar o cargar el estado no depende de variables globales repartidas por distintos módulos.

### 4. Extraer el dominio del fixture

Estado: `[ ]` Pendiente.

- Mover la generación automática de rondas y parejas.
- Mover la lógica de cantidad de jugadores, canchas y descansos.
- Mover el agregado y eliminación independiente de rondas.
- Mantener los reemplazos de jugadores por ronda o hacia el futuro.
- Agregar tests para 4–16 jugadores y para rondas extra.

Estructura prevista:

```text
src/features/fixture/generator.js
src/features/fixture/rounds.js
src/features/fixture/player-swaps.js
```

Criterio de finalización: el fixture generado por la versión modular coincide con el actual para los mismos datos.

### 5. Extraer resultados y estadísticas

Estado: `[ ]` Pendiente.

- Separar actualización de scores y límites de games.
- Separar detección de partidos y rondas completas.
- Separar advertencias de resultados.
- Separar tabla general, diferencias, resumen y rachas.
- Agregar tests unitarios para resultados válidos, empates y partidos incompletos.

Estructura prevista:

```text
src/features/scoring/scores.js
src/features/scoring/validation.js
src/features/scoring/statistics.js
src/features/scoring/summary.js
```

### 6. Extraer servicios externos

Estado: `[ ]` Pendiente.

- Encapsular inicialización y autenticación anónima de Firebase.
- Encapsular sincronización del estado compartido.
- Encapsular presencia y claims de identidad.
- Encapsular historial de actividad.
- Encapsular links compartidos y exportación/importación.
- Mantener sin cambios las rutas existentes de Firebase.

Estructura prevista:

```text
src/services/firebase.js
src/services/tournament-sync.js
src/services/identity.js
src/services/activity.js
src/services/sharing.js
```

Criterio de finalización: un torneo creado con la versión actual puede abrirse, editarse y sincronizarse con la versión modular.

### 7. Extraer la interfaz

Estado: `[ ]` Pendiente.

- Crear renderizadores o componentes para toolbar, jugadores, tabla, rondas, partidos y scores.
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
