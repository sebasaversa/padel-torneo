# Torneo Americano Pádel

Aplicación web para organizar un torneo americano de pádel con jugadores configurables, fixture automático editable, resultados, tabla general y sincronización en tiempo real.

La versión pública está disponible en [sebasaversa.github.io/padel-torneo](https://sebasaversa.github.io/padel-torneo/).

## Funciones

- De 4 a 16 jugadores y selección de 1 o 2 canchas simultáneas, según la cantidad disponible.
- Rondas independientes de la cantidad de jugadores, con descansos rotativos.
- Parejas rotativas balanceadas o equipos fijos canónicos, elegidos antes de crear el torneo.
- Catálogo de diseños exactos y óptimos conocidos, con optimizador determinístico para las demás configuraciones.
- Correcciones de parejas rotativas por ronda reservadas a administradores y bloqueadas si afectan partidos con puntaje.
- Games por set configurables y anotación manual o mediante botones táctiles.
- Tabla de posiciones con victorias, derrotas, games a favor/en contra y diferencia.
- Torneos compartidos con actualización en tiempo real, presencia, identidad de jugador e historial de cambios.
- Catálogo global de torneos compartidos, accesible desde la pantalla principal y ordenado por última actualización.
- Exportación de auditoría e importación v2 como torneo nuevo, sin restaurar resultados, permisos ni actividad.
- Diseño responsive para computadora y celular.

## Uso del torneo

1. Ajustá cantidad de jugadores, canchas, rondas, games por set y tipo de parejas. Los valores se pueden escribir y confirmar con Enter o ajustar con − y +.
2. Editá los nombres y, si elegiste parejas fijas, organizá los equipos antes de crear.
3. Tocá **Crear torneo compartido**, elegí un nombre y compartí el link.
4. Cada participante selecciona quién es; esa identidad se muestra en la app y en el historial.
5. Anotá resultados desde cualquier dispositivo: la tabla y los demás dispositivos se actualizan automáticamente.

Un link con `?torneo=<id>` es un torneo compartido en Firebase. Un link con `#s=...` contiene una copia local del estado y no sincroniza cambios.

## Roles y permisos

- **Super admin:** inicia con Google, administra cuentas de admins, ve todos los torneos y puede recuperar los eliminados.
- **Admin:** inicia con email y contraseña; crea sus torneos y administra la configuración completa de los que creó o le asignaron.
- **Usuario:** puede crear una cuenta con email o con un username, siempre con contraseña, y usarla para unirse a torneos sin recibir permisos administrativos.
- **Participante:** entra por invitación, elige su jugador y sólo puede cambiar su nombre o cargar resultados en los partidos que juega.
- **Espectador:** entra por link sin elegir jugador y consulta el torneo en modo lectura.

Las operaciones de participantes se validan en Cloud Functions y las reglas de Realtime Database bloquean las escrituras directas no autorizadas.
La recuperación por email está disponible para las cuentas creadas con email. Las cuentas creadas sólo con username no tienen recuperación por email.

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
npm --prefix functions test
npm run test:rules
npm run test:functions-emulator
npm run build
npm run preview
```

La build se genera en `dist/`. No se debe abrir `index.html` directamente: Vite resuelve los módulos y assets durante desarrollo y build.

`npm run test:rules` prueba las barreras de lectura y escritura directa.
`npm run test:functions-emulator` levanta Auth, Realtime Database y Functions para un smoke integrado de alta por email/username, creación idempotente, invitación, claim, score y extensión.

## Arquitectura

```text
src/
  app.js                    Coordinación de la aplicación
  app/app-controller.js     Ciclo de vida e inicio
  state/                    Modelo y store del torneo
  features/fixture/         Catálogo, análisis, optimizador, Worker y reemplazos
  features/scoring/         Puntajes, estadísticas y resumen
  services/                 Firebase, identidad, actividad, sharing y almacenamiento local
  ui/                       Listeners y componentes visuales
  styles.css                Estilos globales y responsive
```

`index.html` contiene únicamente la estructura declarativa y los SDK compat de Firebase. Los listeners de UI se registran desde `src/ui/bind-events.js`.

## Firebase y datos compartidos

La app utiliza Firebase Authentication y Realtime Database con esquema v2. El cliente sólo lee `public` y envía mutaciones tipadas a Cloud Functions:

```text
tournaments/{tournamentId}/
  public/
    schemaVersion       Versión de contrato, actualmente 2
    configuration       Jugadores, canchas, modo, equipos y versiones write-once
    metadata            Nombre, fecha, owner, timestamps y tombstone
    state               Nombres, fixture, scores, revisiones y fingerprint
    activity            Auditoría sanitizada por operationId
  _server/
    operationReceipts   Recibos idempotentes privados

tournamentAccess/{tournamentId}/
  members               Roles privados
  claims                Jugadores reclamados
  invitationHashes      Invitaciones opacas almacenadas sólo como hash

tournamentPresence/{tournamentId}/{uid}
                        Presencia efímera por usuario

usernameDirectory/{usernameHash}
                        Resolución privada de usernames, accesible sólo desde Functions

userProfiles/{uid}
                        Perfil y tipo de cuenta, sin contraseñas
```

La configuración pública del proyecto Firebase vive en `src/app.js`; las credenciales de cliente no son secretas. La protección real depende de Authentication, Rules con denegación por defecto y Functions autoritativas. Ni owner, admin ni superadmin pueden escribir directamente configuración, fixture o scores.

Los nombres de jugadores, resultados, historial e información genérica del navegador (por ejemplo, plataforma y navegador) se almacenan en el torneo compartido. Para las cuentas se guarda el email o username elegido y un perfil de rol. Las contraseñas permanecen exclusivamente en Firebase Authentication. Las cuentas con username usan un email técnico aleatorio, privado y nunca visible en la interfaz.

### Recuperación operativa

El email del super admin se conserva como secreto `SUPER_ADMIN_EMAIL` en Firebase Functions. Si hubiera que recuperar su permiso, esa misma cuenta inicia sesión con Google y la Function `bootstrapSuperAdmin` restaura su claim. Nunca se debe guardar ese email ni contraseñas en el repositorio.

Los torneos se eliminan de forma lógica: el super admin puede restaurarlos desde el historial. Las contraseñas de admins se recuperan con el enlace que genera el panel **Usuarios**.

## Deploy

GitHub Pages se publica automáticamente desde `master` mediante [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml):

1. Instala dependencias con Node 22.
2. Ejecuta `npm run build`.
3. Publica `dist/` con GitHub Pages.

La URL pública se mantiene en `https://sebasaversa.github.io/padel-torneo/`. La configuración de Vite usa rutas relativas (`base: './'`) para que assets y módulos funcionen también dentro del subdirectorio de Pages.

El primer despliegue v2 requiere el procedimiento manual de backup, limpieza de datos v1, Functions, Rules, smoke test y rollback compatible documentado en [`CUTOVER-FIXTURE-V2.md`](CUTOVER-FIXTURE-V2.md).

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
