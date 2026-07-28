# Torneo Americano Pádel

Aplicación web para organizar un torneo americano de pádel con jugadores configurables, fixture automático editable, resultados, tabla general y sincronización en tiempo real.

La versión pública está disponible en [sebasaversa.github.io/padel-torneo](https://sebasaversa.github.io/padel-torneo/).

## Funciones

- De 4 a 16 jugadores y hasta 2 canchas.
- Rondas independientes de la cantidad de jugadores, con descansos rotativos.
- Parejas y cruces generados automáticamente; cada jugador puede corregirse en una ronda o hacia el resto del fixture.
- Games por set configurables y anotación manual o mediante botones táctiles.
- Tabla de posiciones con victorias, derrotas, games a favor/en contra y diferencia.
- Torneos compartidos con actualización en tiempo real, presencia, identidad de jugador e historial de cambios.
- Exportación e importación de torneos en JSON, además de links locales de solo estado.
- Diseño responsive para computadora y celular.

## Uso del torneo

1. Ajustá cantidad de jugadores, rondas y games por set.
2. Editá los nombres si hace falta y revisá el fixture.
3. Tocá **Crear torneo compartido**, elegí un nombre y compartí el link.
4. Cada participante selecciona quién es; esa identidad se muestra en la app y en el historial.
5. Anotá resultados desde cualquier dispositivo: la tabla y los demás dispositivos se actualizan automáticamente.

Un link con `?torneo=<id>` es un torneo compartido en Firebase. Un link con `#s=...` contiene una copia local del estado y no sincroniza cambios.

## Desarrollo local

### Requisitos

- Node.js 22 LTS (el proyecto usa `>=22.12.0 <23`).
- `npm`.

Con `nvm`:

```bash
nvm use
npm ci
```

Iniciá el servidor de desarrollo:

```bash
npm run dev
```

Para ejecutar las pruebas y generar una build de producción:

```bash
npm test
npm run build
npm run preview
```

La build se genera en `dist/`. No se debe abrir `index.html` directamente: Vite resuelve los módulos y assets durante desarrollo y build.

## Arquitectura

```text
src/
  app.js                    Coordinación de la aplicación
  app/app-controller.js     Ciclo de vida e inicio
  state/                    Modelo y store del torneo
  features/fixture/         Fixture, rondas y reemplazos
  features/scoring/         Puntajes, estadísticas y resumen
  services/                 Firebase, identidad, actividad, sharing y almacenamiento local
  ui/                       Listeners y componentes visuales
  styles.css                Estilos globales y responsive
```

`index.html` contiene únicamente la estructura declarativa y los SDK compat de Firebase. Los listeners de UI se registran desde `src/ui/bind-events.js`.

## Firebase y datos compartidos

La app utiliza Firebase Authentication anónima y Realtime Database. Para cada torneo compartido, la base contiene estas rutas:

```text
tournaments/{tournamentId}/
  state                 Estado completo: jugadores, fixture, resultados y configuración
  updatedAt             Marca de tiempo del último cambio
  presence/{presenceId} Dispositivos conectados temporalmente
  claims/{playerId}     Jugador reclamado por un dispositivo
  history/{eventId}     Últimos cambios, actor, dispositivo y fecha
```

La configuración pública del proyecto Firebase vive en `src/app.js`; las credenciales de cliente de Firebase no son secretas. La protección real depende de las reglas de Realtime Database y de Firebase Authentication. Si se reutiliza el proyecto para otro torneo, mantené habilitado el acceso anónimo y configurá reglas que permitan únicamente las operaciones necesarias sobre `tournaments/{tournamentId}`.

Los nombres de jugadores, resultados, historial e información genérica del navegador (por ejemplo, plataforma y navegador) se almacenan en el torneo compartido. No se registra nombre real del dispositivo ni información de cuenta.

## Deploy

GitHub Pages se publica automáticamente desde `master` mediante [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml):

1. Instala dependencias con Node 22.
2. Ejecuta `npm run build`.
3. Publica `dist/` con GitHub Pages.

La URL pública se mantiene en `https://sebasaversa.github.io/padel-torneo/`. La configuración de Vite usa rutas relativas (`base: './'`) para que assets y módulos funcionen también dentro del subdirectorio de Pages.

## Versiones

| Tag | Descripción |
| --- | --- |
| `v1-fijo-9-jugadores` | Versión original fija para 9 jugadores. |
| `v1.0` a `v4.0` | Hitos previos del desarrollo funcional. |
| `v5.0` | Primera versión modular estable basada en Vite. |

Para inspeccionar una versión anterior:

```bash
git checkout v1-fijo-9-jugadores
```

Volvé a la versión actual con:

```bash
git checkout master
```
