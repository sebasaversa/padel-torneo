# Plan de grupos v1

Documento de implementación para incorporar grupos privados, una plantilla reutilizable de jugadores, torneos asociados, historial y estadísticas grupales básicas al anotador de torneos de pádel.

Esta primera versión reduce deliberadamente el alcance para evitar fusiones de identidad, permisos ambiguos y agregados estadísticos inconsistentes. Las funcionalidades postergadas se especifican en [`PLAN-GRUPOS_v2.md`](./PLAN-GRUPOS_v2.md).

Cada etapa cerrada deberá incluir pruebas, revisión y un commit independiente. Runtime de desarrollo: **Node.js 22 LTS**, usando la versión exacta del proyecto también en npm, Vite, Firebase y emuladores.

## Estado

- `[x]` Completado
- `[~]` En curso
- `[ ]` Pendiente
- `[!]` Requiere decisión explícita

Estado general: `[ ]` Pendiente de implementación.

## Objetivo de v1

Permitir que una comunidad habitual pueda:

- crear un grupo privado;
- reutilizar una plantilla de miembros registrados y jugadores provisionales;
- invitar cuentas por username o mediante un enlace general multiuso;
- crear torneos asociados al grupo;
- seleccionar quiénes juegan cada torneo;
- conservar el historial del grupo;
- consultar estadísticas grupales básicas;
- salir, ser removido o volver mediante una invitación dirigida sin perder resultados históricos;
- administrar el grupo con roles locales independientes de los roles globales.

## Decisiones cerradas para v1

1. Todos los grupos son privados.
2. Los roles locales son `owner`, `admin` y `member`.
3. Sólo owner y admins crean torneos de grupo.
4. Los miembros comunes no pueden crear torneos, sin configuración para habilitarlo.
5. Un torneo pertenece a cero o un grupo y no puede moverse después.
6. La identidad deportiva de v1 es local al grupo mediante `groupPlayerId`.
7. Los jugadores provisionales no pueden ser reclamados ni vinculados con cuentas en v1.
8. No existen estadísticas globales entre grupos en v1.
9. Las estadísticas grupales son aditivas y se calculan bajo demanda desde torneos fuente.
10. No se mantienen agregados incrementales ni contribuciones materializadas en v1.
11. Los torneos de grupo sólo son administrados por el owner actual, los admins actuales y el superadmin mediante Functions auditadas.
12. Existe un único enlace general activo por grupo, creado y revocado sólo por el owner, con siete días de vigencia y diez usos.
13. Archivar convierte el grupo y todos sus torneos en modo de sólo lectura hasta su reactivación.
14. La pertenencia de un torneo a un grupo se registra en una referencia autoritativa; `groupTournamentIndex` es sólo una proyección de navegación.
15. Ninguna mutación de un torneo de grupo se ejecuta con una autorización leída fuera de control: primero reserva un grant autoritativo y breve dentro del grupo.
16. Los clientes nunca leen el nodo completo `groupDomains/{groupId}`; reciben vistas filtradas por Functions o leen exclusivamente proyecciones sin secretos.

## Alcance incluido

- creación, edición, archivo y reactivación de grupos;
- listado “Mis grupos”;
- roles locales y transferencia de propiedad;
- invitaciones dirigidas por username;
- un enlace general multiuso rígido por grupo;
- miembros registrados;
- jugadores provisionales locales al grupo;
- activación y desactivación manual de provisionales y estado derivado de membresía para registrados;
- salida y remoción con historial de membresía;
- torneos independientes sin cambios funcionales;
- torneos de grupo administrados por roles actuales del grupo;
- snapshots históricos de participantes;
- historial de torneos por grupo;
- estadísticas básicas por `groupPlayerId`;
- ranking grupal básico;
- auditoría administrativa;
- compatibilidad con torneos existentes.

## Fuera de v1

Se trasladan a [`PLAN-GRUPOS_v2.md`](./PLAN-GRUPOS_v2.md):

- reclamo o vinculación de jugadores provisionales;
- perfiles deportivos globales;
- estadísticas globales y desglose entre grupos;
- rachas, parejas, rivales, logros, torneos ganados y otras métricas avanzadas;
- agregados incrementales, workers estadísticos y cachés persistentes;
- administradores específicos de un torneo de grupo;
- conservación de permisos del creador después de perder el rol grupal;
- creación de torneos por miembros comunes;
- enlaces particulares de reclamo;
- múltiples enlaces generales simultáneos;
- cupos, vencimientos y permisos configurables para enlaces;
- operaciones parciales sobre grupos archivados;
- temporadas, Elo, convocatorias, asistencia, suplentes y funciones sociales.

## Prerrequisito de cuentas

La aplicación ya permite cuentas mediante Google, email o username y contraseña. El proveedor de login es independiente del rol de plataforma.

El único superadmin efectivo requiere simultáneamente:

- custom claim `platformRole: "superAdmin"`;
- coincidencia del UID con `platformConfig/superAdminUid`;
- bootstrap autorizado por el secreto backend `SUPER_ADMIN_EMAIL`.

Estado del prerrequisito:

- `[x]` Functions, Rules y frontend desplegados con UID canónico;
- `[x]` claims obsoletas de otros UIDs rechazadas;
- `[ ]` prueba de recuperación si cambia el UID canónico;
- `[ ]` verificación productiva completa con una segunda cuenta Google común.

No se habilitará grupos en producción antes de cerrar estas dos pruebas pendientes.

## Entidades e invariantes

### Cuenta

Una cuenta es un UID de Firebase Authentication. Puede pertenecer a varios grupos y tener roles distintos en cada uno.

Para grupos, una cuenta “registrada activa” debe existir en Auth, no ser anónima, no estar disabled y tener perfil de aplicación activo. El proveedor Google, email o username no modifica esta condición ni el rol local.

### Jugador local del grupo

Cada fila reutilizable de la plantilla se identifica con un `groupPlayerId` opaco y estable dentro de un único grupo.

Puede ser:

- `registered`: representa una membresía vinculada a un UID;
- `provisional`: representa sólo un nombre local sin cuenta ni permisos.

Invariantes:

- un `groupPlayerId` nunca cambia de grupo;
- un UID tiene como máximo un jugador `registered` dentro del mismo grupo;
- un jugador `registered` está vinculado a exactamente una membresía;
- una membresía es efectiva sólo cuando `status == active` y `accountStatus == active`;
- un provisional nunca tiene `linkedUid` en v1;
- nombres iguales no implican identidad compartida;
- salir o ser removido desactiva la fila registrada, pero no la elimina;
- una reincorporación dirigida reactiva la misma fila y no crea otra;
- un provisional no se convierte en registrado en v1.

### Membresía

La membresía relaciona un UID con un grupo y con su `groupPlayerId` registrado.

Estados:

- `active`;
- `left`;
- `removed`.

Cada membresía conserva:

- `membershipRevision` creciente;
- fecha de primera incorporación;
- fecha de activación actual;
- rol actual;
- historial append-only de ingresos, salidas, remociones, reincorporaciones y cambios de rol.

### Torneo

- `groupId: null` significa torneo independiente.
- Un torneo de grupo conserva su `groupId` y snapshots aunque el grupo se archive.
- Los resultados apuntan a participantes locales del torneo y cada participante de grupo guarda su `groupPlayerId`.
- La membresía actual no modifica snapshots ni resultados históricos.
- La relación autoritativa grupo ↔ torneo vive en `groupDomains/{groupId}/tournamentRefs/{tournamentId}`; el índice externo no define pertenencia ni estadísticas.
- La creación no se informa como exitosa hasta que la referencia autoritativa y el torneo están confirmados; reintentos completan o revierten el mismo provisioning.

## Roles y permisos

### Roles globales

| Rol | Alcance |
| --- | --- |
| `superAdmin` | Soporte excepcional mediante Functions auditadas. |
| `admin` | Administración de plataforma existente; no obtiene acceso automático a grupos. |
| `user` | Cuenta común que puede crear grupos y recibir invitaciones. |

### Owner

Existe exactamente uno por grupo y se deriva exclusivamente de `ownerUid`.

Puede:

- editar el grupo;
- administrar miembros y provisionales;
- crear y revocar el enlace general;
- nombrar o quitar admins;
- crear y administrar torneos del grupo;
- transferir propiedad;
- archivar y reactivar.

No puede salir ni eliminar su cuenta mientras sea owner, aunque el grupo esté archivado. Debe transferir primero.

### Admin del grupo

Puede:

- editar información operativa;
- invitar por username;
- agregar y desactivar provisionales;
- remover miembros comunes;
- crear y administrar torneos del grupo;
- consultar auditoría operativa.

No puede:

- crear ni revocar el enlace general;
- nombrar o degradar admins;
- remover al owner;
- transferir propiedad;
- archivar o reactivar;
- administrar un grupo archivado.

En v1, “editar el grupo” o “información operativa” significa únicamente `name` y `description`. `visibility`, `ownerUid`, roles, estado, límites e identificadores jamás se aceptan en `updateGroupV1`; usan operaciones específicas o son inmutables.

### Member

Puede:

- ver el grupo activo, plantilla, torneos e indicadores grupales;
- participar;
- anotar resultados únicamente si su membresía sigue activa y su UID está vinculado por backend al `groupPlayerId` participante;
- salir voluntariamente si el grupo está activo.

No puede crear torneos, administrar invitaciones, miembros, roles, configuración ni resultados ajenos.

### Matriz resumida

| Acción | Superadmin | Admin global | Owner | Admin grupo | Member |
| --- | ---: | ---: | ---: | ---: | ---: |
| Crear grupo propio | Soporte | Sí | — | — | Sí |
| Ver grupo activo | Soporte | Sólo si es miembro | Sí | Sí | Sí |
| Editar grupo | Soporte | Según rol local | Sí | Sí | No |
| Invitar por username | Soporte | Según rol local | Sí | Sí | No |
| Crear/revocar enlace general | Soporte | Sólo como owner | Sí | No | No |
| Agregar provisional | Soporte | Según rol local | Sí | Sí | No |
| Remover member | Soporte | Según rol local | Sí | Sí | No |
| Cambiar admins | Soporte | Sólo como owner | Sí | No | No |
| Crear torneo de grupo | Soporte | Según rol local | Sí | Sí | No |
| Administrar torneo de grupo | Soporte | Según rol local | Sí | Sí | No |
| Archivar/reactivar | Soporte | Sólo como owner | Sí | No | No |
| Salir | No aplica | Según rol local | Tras transferir | Sí | Sí |

“Soporte” siempre significa una Function con motivo obligatorio y auditoría. Ningún cliente, incluido el superadmin, escribe directamente nodos autoritativos.

## Ciclo de vida

### Creación

- Cualquier cuenta registrada activa puede crear un grupo.
- En una operación idempotente se crea el grupo, owner, membresía activa, jugador registrado local e historial inicial.
- Backend deriva un `groupId` opaco y determinista desde UID + `operationId`; un retry llega al mismo nodo sin necesitar un receipt global previo.
- Nombre o slug nunca son identidad autoritativa.

### Transferencia

- Sólo owner o recuperación de superadmin.
- Destino: miembro registrado con membresía y cuenta activas.
- La operación cambia `ownerUid` y aumenta `accessRevision`.
- El owner anterior pasa a `admin` por defecto; la interfaz puede permitir elegir `admin` o `member` antes de confirmar.
- Siempre queda exactamente un owner.

### Salida

- Member o admin puede salir sólo de un grupo activo.
- Si tiene mutaciones de torneo en curso, la operación devuelve `GROUP_BUSY` y puede reintentarse; nunca invalida un grant ya reservado.
- Cambia a `left`, fija `role: member`, aumenta `membershipRevision` y desactiva su jugador registrado.
- Pierde acceso al contenido privado nuevo.
- Conserva snapshots y estadísticas históricas del grupo.
- Para volver necesita una invitación dirigida por username.

### Remoción

- Owner/admin puede remover miembros comunes.
- Sólo owner puede remover o degradar admins.
- Si el destino tiene mutaciones de torneo en curso, devuelve `GROUP_BUSY` y debe reintentarse.
- Cambia a `removed`, fija `role: member`, aumenta revisión y desactiva su jugador registrado.
- Un enlace general no permite reingresar.
- Reincorporar requiere invitación dirigida y transición auditada.

### Eliminación o desactivación de cuentas

- No se puede eliminar una cuenta que sea owner de uno o más grupos.
- Debe transferir propiedad antes de eliminarse o ser eliminada por soporte.
- El borrado de Auth no elimina membresías, jugadores locales, snapshots ni resultados.
- La eliminación iniciada desde la aplicación y la eliminación administrativa existente consultan grupos owned y rechazan antes de tocar Auth.
- Como Firebase Auth también puede borrarse fuera de ese flujo, un trigger `onDelete` y un reconciliador periódico son obligatorios.
- Si desaparece un owner, el grupo pasa a `recoveryRequired`, revoca invitaciones, rechaza toda mutación y conserva lectura histórica de los demás miembros activos.
- `orphanedOwnerUid` y `recoveryPreviousStatus` conservan la referencia y estado históricos. Superadmin sólo puede recuperar mediante Function auditada, transfiriendo a un miembro registrado activo y con motivo obligatorio; no se convierte automáticamente en owner ni obtiene lectura del contenido deportivo. El grupo vuelve a su estado previo (`active` o `archived`).
- Si desaparece un no-owner, su membresía conserva historia con `accountStatus: deleted`, queda inaccesible y su jugador registrado se desactiva.
- Un grupo operacional (`active` o `archived`) siempre tiene owner existente; `recoveryRequired` es la única excepción transitoria explícita.
- La búsqueda preventiva y el reconciliador consultan `groupDomains` con índice backend por `access/ownerUid`; no dependen de `groupsByUser`, que es eventual.
- Toda Function que pretenda mutar un grupo operacional verifica que `ownerUid` siga existiendo en Auth. Si falta, falla cerrada, encola reconciliación y no continúa aunque el trigger todavía no haya actualizado el estado.

### Archivo rígido

Archivar convierte el grupo en **sólo lectura**:

- primero rechaza con `GROUP_BUSY` si existe un grant de torneo vigente o un provisioning pendiente; sólo finaliza cuando no queda trabajo en curso;
- revoca el enlace general y todas las invitaciones pendientes;
- bloquea altas, bajas, salidas, cambios de rol y edición de plantilla;
- bloquea creación, anotación y corrección de torneos del grupo;
- conserva lectura histórica para miembros que estaban activos al archivarse;
- owner permanece owner y no puede salir;
- sólo owner puede reactivar; superadmin puede hacerlo mediante recuperación auditada.

“Sólo lectura” bloquea operaciones funcionales. Triggers y reconciliadores internos todavía pueden marcar cuentas borradas, cerrar grants, drenar outbox y reparar proyecciones, siempre sin cambiar resultados deportivos y con auditoría.

Reactivar no revive invitaciones ni enlaces: el owner debe crear nuevos.

## Invitaciones

### Invitación dirigida por username

- Owner o admin busca un username exacto mediante Function no enumerable.
- La invitación se vincula a `targetUid`, vence a los siete días y sólo concede `member`.
- Aparece en la bandeja privada del destinatario.
- Al aceptar, revalida grupo y owner operacionales y el límite de miembros; crea o reactiva membresía y jugador registrado en una operación idempotente. Una reactivación siempre sobrescribe `role: member`, aunque la persona haya sido admin.
- Puede reincorporar estados `left` o `removed` porque existe una decisión administrativa dirigida.
- Invitaciones duplicadas compatibles se invalidan en la misma transición.

### Enlace general multiuso rígido

Reglas cerradas:

- sólo owner crea y revoca;
- máximo un enlace general efectivamente utilizable por grupo;
- vencimiento fijo: siete días desde creación;
- `maxUses` fijo: diez;
- rol fijo: `member`;
- requiere cuenta registrada no anónima;
- no admite cuentas `left` o `removed`;
- no reclama provisionales;
- no puede editarse ni reactivarse: se revoca y crea otro;
- archivar lo revoca;
- el token usa 32 bytes aleatorios en base64url, se muestra una sola vez y la base guarda únicamente su SHA-256.

Aceptación:

1. La URL contiene `groupId` e `invitationId` opacos; el secreto se transporta en el fragmento para evitar `Referer`.
2. El frontend extrae el secreto, limpia la URL y lo envía por POST a la Function.
3. La Function valida con reloj backend grupo y owner operacionales, hash, vigencia, cupo del enlace y límite de miembros activos.
4. Si la membresía ya está activa, devuelve éxito sin consumir cupo.
5. Si está `left` o `removed`, devuelve `REINVITE_REQUIRED`.
6. Si nunca perteneció, crea membresía, jugador registrado, receipt y aumenta `usedCount`.
7. El décimo ingreso agota efectivamente el enlace; la aceptación siguiente falla.

`usedCount` representa incorporaciones exitosas acumuladas. No disminuye por salida o remoción. Un enlace es **utilizable** sólo cuando `status == active`, el reloj backend es anterior a `expiresAt` y `usedCount < maxUses`. Estados `expired` y `exhausted` se derivan; `revoked` es terminal persistido. Un enlace vencido o agotado no bloquea la creación de otro: la misma transacción limpia `activeGeneralInvitationId` y apunta al nuevo enlace. Nunca pueden quedar dos enlaces utilizables.

Seguridad web:

- `Referrer-Policy: no-referrer`;
- tokens prohibidos en logs, analytics, errores y auditoría;
- comparación segura del hash;
- respuestas no enumerables para token inválido;
- rate limits por IP, UID, grupo e invitación;
- la previsualización sólo devuelve nombre del grupo, invitador, vencimiento y cupos restantes.

Continuidad de autenticación:

- si quien abre el enlace aún no inició sesión, el frontend guarda temporalmente `groupId`, `invitationId` y secreto en `sessionStorage`, nunca en `localStorage`;
- después de Google redirect, login o registro, retoma la aceptación en la misma pestaña;
- el secreto se elimina al aceptar, rechazar, vencer, cerrar el flujo o recibir un error terminal;
- el estado pendiente no se copia a analytics, URL limpia, logs ni mensajes de error.

## Plantilla

- Owner/admin agrega provisionales por nombre visible.
- Un provisional puede jugar, acumular estadísticas grupales y ser desactivado.
- No puede iniciar sesión, ser miembro, recibir permisos ni ser reclamado en v1.
- Un miembro registrado usa siempre su único `groupPlayerId` del grupo.
- `players.status` de un registrado deriva de su membresía y no puede cambiarse con `setGroupPlayerStatusV1`; la activación manual sólo aplica a provisionales.
- Owner/admin puede corregir el `displayName` local mediante `updateGroupPlayerV1`; torneos ya creados conservan su snapshot anterior.
- No se fusionan filas por nombre.
- La interfaz debe distinguir “Miembro con cuenta” y “Jugador sin cuenta”.

## Torneos

### Independientes

- Continúan funcionando como actualmente.
- No aportan a estadísticas grupales ni globales nuevas.
- Sus nombres locales no se convierten en identidades de grupo.

### De grupo

- Sólo owner/admin actual puede crear.
- Participantes deben ser jugadores activos de la plantilla al crear.
- Se guardan `groupPlayerId`, `displayNameSnapshot` y tipo registrado/provisional.
- El backend revalida permisos, grupo activo y participantes en la operación de creación.
- Cambios posteriores de plantilla no alteran el torneo.

Creación idempotente en dos pasos recuperables:

1. Una transacción del grupo valida rol, estado, cupos y participantes; crea `tournamentRefs/{tournamentId}` en `provisioning`, el receipt y un grant de creación.
2. La Function crea el torneo y sus bindings con el mismo `operationId`.
3. Una segunda transacción confirma la referencia como `active` y cierra el grant.
4. La respuesta exitosa se entrega sólo después de confirmar ambos lados.
5. Un retry con igual payload retoma el paso faltante. Un reconciliador completa o revierte provisioning abandonado después del tiempo máximo de ejecución más un margen de seguridad.

`groupTournamentIndex` se genera después de la confirmación y sólo sirve para enriquecer listados rápidamente. `getGroupHistoryV1` pagina primero `tournamentRefs` y usa el índice si está presente; si falta, carga el torneo y encola reparación. Una ausencia o demora del índice no cambia pertenencia, historial, permisos ni estadísticas.

Autorización:

- `createdByUid` es sólo auditoría.
- Para `groupId != null`, `ownerUid` del torneo no concede acceso por sí solo.
- Administran únicamente owner actual, admins actuales y superadmin vía Function.
- Si owner/admin pierde su rol o membresía, ninguna operación nueva puede reservar autorización; sólo puede concluir una operación que ya hubiera obtenido un grant antes de la transición.
- No existen admins específicos del torneo de grupo en v1.
- `tournamentAccess` no guarda admins autoritativos de un torneo de grupo.
- Al crear, backend genera un binding inmutable por participante registrado entre `localPlayerId`, `groupPlayerId` y `linkedUid`; un provisional no recibe binding ni puede reclamarlo.
- En torneos de grupo se deshabilita el reclamo manual de jugadores.
- Un member sólo anota un partido si tiene membresía activa, el binding pertenece a su UID y el `localPlayerId` aparece en ese partido.
- Cada mutación reserva dentro del grupo un grant con `operationId`, actor, torneo, `accessRevision`, `membershipRevision`, `payloadHash` y vencimiento. Sin grant vigente, la transacción del torneo falla.
- Salida, remoción, degradación de rol, transferencia y archivo rechazan con `GROUP_BUSY` mientras exista un grant relevante. Los grants se cierran en `finally`; los abandonados sólo se liberan tras superar el timeout máximo de la Function más margen y comprobar que no existe receipt en el torneo.

En grupo `archived` o `recoveryRequired` no se crean, anotan, corrigen, anulan, eliminan ni restauran torneos hasta reactivar o completar la recuperación.

## Estadísticas grupales básicas

### Fuente

Las Functions enumeran exclusivamente `groupDomains/{groupId}/tournamentRefs` autoritativas confirmadas, cargan esos torneos y calculan bajo demanda. `groupTournamentIndex` sólo acelera la pantalla de historial y nunca decide qué cuenta. No existen `groupStats`, `playerStats` ni `statsContributions` persistentes en v1.

Sólo cuentan partidos completos según las reglas del torneo. El score terminal `4–vacío` se normaliza como `4–0` cuando cuatro es el objetivo; `3–vacío` permanece incompleto.

Predicado de inclusión:

- la referencia debe estar `active` y el torneo debe existir con el mismo `groupId`;
- torneos en `provisioning`, soft-deleted o anulados no cuentan;
- restaurar un torneo lo vuelve a incluir;
- una aparición cuenta cuando el jugador está en el snapshot de un torneo incluido, aunque todavía no tenga partidos completos;
- victorias, derrotas y games sólo cuentan partidos completos y no empatados;
- si una referencia y su torneo divergen, la respuesta falla completa con `STATS_SOURCE_INCONSISTENT`, dispara reconciliación y nunca omite silenciosamente el torneo.

### Métricas

Por `groupPlayerId`:

- apariciones en torneos;
- torneos con al menos un partido completo;
- partidos jugados;
- victorias y derrotas;
- games a favor y en contra;
- diferencia de games;
- porcentaje `victorias / partidos completos` con denominador visible.

No se calculan en v1 rachas, parejas, rivales, torneos ganados, logros, evolución ni estadísticas entre grupos.

### Ranking básico

1. victorias;
2. diferencia de games;
3. games a favor;
4. porcentaje de victorias;
5. nombre sólo como orden estable final.

La vista permite filtrar plantilla activa o historial completo. La pertenencia y estado actual no alteran resultados históricos.

### Límites de cálculo

- consultas paginadas de `tournamentRefs`, en lotes de 25, y lectura validada de cada torneo;
- máximo v1 de 250 referencias de torneo totales por grupo, incluyendo soft-deleted y canceladas, para mantener acotados historial y transacciones;
- los torneos de grupo conservan los límites actuales de 4–16 participantes y agregan un máximo v1 de 40 rondas;
- los límites se controlan al crear o ampliar un torneo, no recién al consultar estadísticas;
- la interfaz avisa al llegar al 80 % y bloquea nuevas altas al alcanzar el máximo, sin romper historial ni estadísticas existentes;
- máximo de 100 jugadores locales totales y 50 membresías efectivamente activas por grupo; desactivar una fila no libera el cupo histórico de jugador;
- los límites por grupo se aplican en su transacción autoritativa con códigos estables; rate limits por UID/IP/App Check y alertas de costo controlan creación abusiva de grupos sin introducir un contador global distribuido en v1;
- antes del feature flag productivo, una prueba de carga debe demostrar el cálculo del máximo permitido dentro del timeout; si no lo cumple, se reduce el límite de torneos, nunca se publica una configuración que falle al consultarse;
- ningún resultado parcial se presenta como completo;
- caché sólo de respuesta corta y descartable, nunca fuente autoritativa.

La materialización incremental y reconstrucción avanzada pertenecen a v2.

## Modelo de datos v1

Las ramas autoritativas que deben cambiar condicionalmente se agrupan por `groupId` para evitar transacciones sobre la raíz completa.

```text
groupDomains/{groupId}
  schemaVersion
  profile
    name
    description
    visibility              # private
  metadata
    status                  # active | archived | recoveryRequired
    statusRevision
    createdAt
    updatedAt
    archivedAt
    creationOperationId
    creationPayloadHash
    orphanedOwnerUid        # sólo recoveryRequired
    recoveryPreviousStatus  # active | archived; sólo recoveryRequired
  access
    ownerUid
    accessRevision
    activeGeneralInvitationId
    members/{uid}
      role                  # admin | member; owner derivado
      status                # active | left | removed
      accountStatus         # active | deleted
      groupPlayerId
      membershipRevision
      firstJoinedAt
      activatedAt
      updatedAt
  players/{groupPlayerId}
    displayName
    kind                    # registered | provisional
    status                  # active | inactive
    linkedUid               # sólo registered
    createdAt
    updatedAt
  invitations/{invitationId}
    type                    # username | generalMultiuse
    targetUid               # sólo username
    tokenHash               # sólo generalMultiuse
    status                  # active | accepted | rejected | revoked
    maxUses                 # 1 o 10
    usedCount
    expiresAt
    createdByUid
    createdAt
    acceptedUids/{uid}
      acceptedAt
      membershipRevision
  tournamentRefs/{tournamentId}
    status                  # provisioning | active | deleted | cancelled
    creationOperationId
    createdAt
    activatedAt
    updatedAt
  operationGrants/{operationId}
    type
    actorUid
    targetUid
    tournamentId
    accessRevision
    membershipRevision
    payloadHash
    expiresAt
    status                  # reserved | completed | failed
  operationReceipts/{actorUid}/{operationName}/{operationId}
    payloadHash
    resultRef
    createdAt
  outbox/{eventId}
    type
    payload
    createdAt
```

`groupDomains/{groupId}` no es legible como unidad por ningún cliente. Grants, hashes, receipts y outbox son exclusivamente backend. Invitaciones terminales se purgan a los 30 días; receipts ofrecen idempotencia durante 30 días con el límite cuantitativo indicado abajo; grants completados se purgan después de siete días. La outbox debe permanecer normalmente vacía y genera alerta si un evento no se publica.

Se conservan como máximo 200 receipts por actor y tipo de operación: la garantía cubre 30 días o las últimas 200 operaciones, lo que se alcance primero, y este contrato se comunica al cliente. Las invitaciones dirigidas pendientes se limitan a 100 por grupo. Ninguna purga elimina referencias de torneos, membresías, jugadores ni auditoría publicada.

Auditoría append-only separada del límite transaccional:

```text
groupAudit/{groupId}/{eventId}
  type
  actorUid
  targetUid
  membershipRevision
  roleBefore
  roleAfter
  metadataSanitized
  createdAt
```

La transición autoritativa y su evento de outbox nacen en la misma transacción. Un worker idempotente publica `groupAudit` y proyecciones y luego elimina el evento. La auditoría no contiene tokens, hashes ni payloads sensibles y sólo se entrega mediante una vista paginada y filtrada.

`listGroupAuditV1` admite owner/admin actuales, orden descendente, cursor opaco y páginas de hasta 50 eventos. Member y exmiembro no acceden a auditoría; superadmin requiere modo soporte y motivo obligatorio.

Proyecciones reconstruibles:

```text
groupsByUser/{uid}/{groupId}
  effectiveRole
  status
  updatedAt

groupInvitationInbox/{uid}/{invitationId}
  groupId
  groupNameSnapshot
  invitedByNameSnapshot
  expiresAt
  status

groupTournamentIndex/{groupId}/{tournamentId}
  tournamentNameSnapshot
  tournamentDate
  status
  updatedAt
```

Extensión del torneo:

```text
tournamentAccess/{tournamentId}
  mode                      # independent | group
  groupId                   # sólo group
  claims/{localPlayerId}
    uid
    source                  # group
    groupPlayerId

tournaments/{tournamentId}/public/metadata
  groupId                   # null o groupId
  createdByUid

tournaments/{tournamentId}/public/state/participantRefs/{localPlayerId}
  groupPlayerId
  displayNameSnapshot
  playerKindSnapshot
```

En un torneo de grupo, `claims` se genera y corrige sólo por backend desde la plantilla; el endpoint público de claim devuelve `FORBIDDEN`. `members` y admins históricos de `tournamentAccess` no conceden permisos para modo `group`.

`groupDomains/{groupId}` es el límite transaccional de membresías, invitaciones, referencias y grants. El contenido pesado del torneo permanece separado, pero toda mutación requiere primero un grant vigente. `groupsByUser`, inbox e índice de torneos se actualizan mediante outbox idempotente y disponen de reconciliación. Una proyección nunca concede permisos ni define estadísticas: Functions y Rules consultan la fuente autoritativa.

## Idempotencia, concurrencia y tiempo

- `operationId` se combina con actor y operación.
- Cada receipt guarda `payloadHash`; reutilizar el ID con otro payload falla.
- Todas las fechas sensibles usan reloj backend.
- Invitaciones calculan vigencia desde `expiresAt`, no desde un `status` potencialmente obsoleto.
- Transiciones comparan revisiones esperadas.
- El último cupo, membresía, jugador local y receipt se confirman en la misma transacción del grupo.
- La reserva del grant es el punto de orden de una mutación de torneo respecto de cambios de rol, salida, remoción, transferencia y archivo.
- Una operación que obtuvo grant primero puede concluir; una transición incompatible no se confirma mientras ese grant siga vigente y devuelve `GROUP_BUSY`.
- Para bloquear transiciones, todo grant `reserved` cuenta aunque `expiresAt` haya pasado; sólo el reconciliador puede cerrarlo tras el chequeo seguro. El vencimiento por sí solo nunca autoriza archivo, salida o remoción.
- La Function comprueba nuevamente el grant y su reloj justo antes de la transacción del torneo, guarda el `operationId` en el receipt del torneo y después lo cierra en el grupo.
- El tiempo de vida del grant supera el timeout máximo configurado de la Function más un margen; no se libera por reloj antes de que esa ejecución ya no pueda escribir.
- El reconciliador sólo marca un grant abandonado después de revisar el receipt del torneo: si existe lo completa, y si no existe lo falla y libera.
- Proyecciones fallidas se reintentan y pueden reconstruirse.
- La aceptación general, la invitación dirigida y el provisioning de torneos tienen tests de crash/retry entre cada paso durable.
- Los límites y políticas de retención definidos en este documento forman parte de la configuración backend y de las pruebas.

## Cloud Functions tentativas

- `createGroupV1`;
- `updateGroupV1`;
- `archiveGroupV1`;
- `restoreGroupV1`;
- `transferGroupOwnershipV1`;
- `inviteGroupUserV1`;
- `acceptGroupUserInvitationV1`;
- `rejectGroupUserInvitationV1`;
- `createGeneralGroupLinkV1`;
- `revokeGeneralGroupLinkV1`;
- `previewGeneralGroupLinkV1`;
- `acceptGeneralGroupLinkV1`;
- `addProvisionalGroupPlayerV1`;
- `updateGroupPlayerV1`;
- `setGroupPlayerStatusV1`;
- `setGroupMemberRoleV1`;
- `removeGroupMemberV1`;
- `leaveGroupV1`;
- `listMyGroupsV1`;
- `getGroupV1`;
- `getGroupHistoryV1`;
- `getGroupStatsV1`;
- `listMyFormerGroupsV1`;
- `getMyHistoricalGroupStatsV1`;
- `listGroupAuditV1`;
- trigger de Auth `onDelete` y `reconcileGroupDomainsV1` programada;
- extensión de `createTournamentV2` y mutaciones para autorización por grupo.

La reserva y cierre de grants son helpers internos, no endpoints públicos. Todas las mutaciones autoritativas pasan por Functions. Database Rules deniegan escrituras directas incluso al superadmin.

## Rules y privacidad

- usuario anónimo no lista grupos, plantilla ni estadísticas;
- cuenta registrada sólo lista sus proyecciones;
- no existe `.read` cliente en `groupDomains/{groupId}`, `access`, `invitations`, `operationGrants`, receipts, outbox ni `groupAudit`;
- `getGroupV1`, historial, estadísticas y auditoría devuelven DTOs con allowlist; nunca serializan el snapshot autoritativo completo;
- lectura detallada exige membresía activa o acceso histórico permitido y se resuelve en backend contra el grupo autoritativo;
- admin global no obtiene acceso sin rol local;
- miembros no escriben roles, invitaciones, plantilla, índices ni estadísticas;
- grupos archivados rechazan toda mutación funcional excepto restauración por Function; sólo se permiten tareas internas de integridad expresamente enumeradas;
- tokens, hashes, receipts y auditoría no son legibles por clientes;
- superadmin interviene sólo por Functions auditadas;
- en modo `group`, ni siquiera superadmin obtiene lectura cliente directa del torneo por claim global; soporte usa vistas auditadas con motivo;
- datos de un grupo nunca autorizan otro grupo;
- exmiembros sólo acceden a su participación y estadísticas personales históricas mediante una vista filtrada, no al contenido privado nuevo;
- las lecturas públicas actuales de torneos consultan `mode`: para torneos de grupo requieren membresía activa autoritativa o la vista histórica personal; una entrada estática en `tournamentAccess.members` nunca alcanza.

## Experiencia de usuario

### Mis grupos

- activos;
- archivados;
- anteriores, con acceso únicamente a participación y estadísticas personales;
- invitaciones dirigidas pendientes;
- crear grupo.

### Grupo

1. Resumen.
2. Jugadores.
3. Torneos.
4. Estadísticas básicas.
5. Invitaciones, sólo owner/admin.
6. Configuración.

La plantilla diferencia visualmente miembros con cuenta y jugadores sin cuenta. No muestra una acción “Reclamar” en v1.

El owner ve “Crear enlace general”, con texto fijo: “10 ingresos · vence en 7 días”. Si ya existe uno activo, sólo puede copiar el token durante la creación original o revocarlo y generar otro.

Un grupo archivado muestra un banner de sólo lectura y oculta o deshabilita toda acción salvo “Reactivar” para owner.

Un grupo `recoveryRequired` muestra un banner de recuperación, no expone contenido nuevo ni permite mutaciones. Los miembros ven que soporte debe reasignar propiedad; sólo superadmin accede al comando auditado de recuperación.

Si una transición devuelve `GROUP_BUSY`, la interfaz explica que hay una operación de torneo finalizando y ofrece reintentar; nunca presenta la salida, remoción o archivo como completados.

Las pantallas de plantilla y torneos muestran el consumo de límites desde el 80 %. Alcanzar un límite no oculta ni invalida contenido existente.

## Etapas de implementación

### 0. Cerrar decisiones y prerrequisitos

- `[x]` Reducir alcance v1 y separar v2.
- `[ ]` Verificar segunda cuenta Google común en producción.
- `[ ]` Probar recuperación de UID canónico.
- `[x]` Definir límites máximos iniciales de grupos, miembros, jugadores y torneos para v1.

### 1. Dominio local y permisos

- `[x]` Modelar grupo, membresía revisada, `groupPlayerId` e invitaciones rígidas.
- `[x]` Implementar matrices de permisos.
- `[x]` Modelar archivo de sólo lectura y transferencia.
- `[x]` Probar transiciones y unicidad UID ↔ groupPlayerId.

### 2. Persistencia autoritativa

- `[x]` Implementar `groupDomains/{groupId}`.
- `[x]` Implementar receipts con payload hash.
- `[ ]` Implementar outbox, auditoría, proyecciones y reconciliación.
- `[x]` Agregar Rules con escrituras directas denegadas.
- `[x]` Incorporar validación previa, trigger Auth y recuperación de owner eliminado.

### 3. Invitaciones y plantilla

- `[x]` Invitación dirigida por username.
- `[x]` Enlace general único, 7 días y 10 usos.
- `[x]` Persistencia temporal segura del enlace durante login/registro.
- `[x]` Carreras por último cupo, revocación y reintentos.
- `[x]` Provisionales sin reclamo.
- `[x]` Salida, remoción y reincorporación dirigida.

### 4. Interfaz de grupos

- `[x]` Mis grupos, detalle, plantilla e invitaciones.
- `[x]` Gestión de roles, transferencia y archivo.
- `[x]` Estados de sólo lectura y permisos revocados.
- `[x]` Verificación táctil en celular.

### 5. Torneos de grupo

- `[x]` Crear con `groupId` y participant refs locales.
- `[x]` Implementar `tournamentRefs` autoritativas y provisioning recuperable.
- `[x]` Autorizar sólo mediante roles actuales del grupo.
- `[x]` Generar bindings UID ↔ groupPlayerId y bloquear claims manuales.
- `[x]` Reservar y cerrar grants para cada mutación de torneo.
- `[x]` Bloquear todas las mutaciones al archivar.
- `[x]` Mantener torneos independientes compatibles.

### 6. Estadísticas bajo demanda

- `[x]` Recorrer referencias autoritativas paginadas y validar cada torneo fuente.
- `[x]` Implementar métricas aditivas y ranking básico.
- `[x]` Filtrar activos o historia completa.
- `[ ]` Probar correcciones, anulaciones, borrado y restauración.
- `[x]` Definir límites de cálculo y respuesta no parcial.
- `[x]` Validar por carga el máximo de 250 torneos × 40 rondas y reducirlo antes del feature flag si excede el timeout.

### 7. Seguridad y concurrencia

- `[ ]` Matriz completa de Functions y Rules.
- `[x]` Rate limits y cuotas.
- `[ ]` App Check obligatorio en Functions públicas de grupos e invitaciones, con manejo explícito del flujo de enlace.
- `[ ]` Pruebas de owner eliminado, recuperación, transferencia concurrente y remoción durante score.
- `[ ]` Probar grants abandonados, provisioning interrumpido y reconciliación.
- `[x]` Verificar que ninguna lectura padre exponga secretos en RTDB.
- `[x]` Revisar tokens, logs, referrers y respuestas no enumerables.
- `[x]` Integración Auth + Functions + Database.

### 8. Migración y publicación

- `[x]` Torneos anteriores compatibles como independientes.
- `[ ]` Orden de deploy: Functions compatibles, Rules, frontend y feature flag.
- `[x]` Tests completos con Node 22 LTS.
- `[x]` Emuladores sin errores de puertos.
- `[ ]` Deploy y verificación separada de Functions, Rules y GitHub Pages.
- `[ ]` Prueba productiva con varias cuentas, enlace agotado, archivo y torneo.

## Estrategia de pruebas mínima

### Dominio

- exactamente un owner en estados operacionales y excepción controlada `recoveryRequired` ante borrado Auth externo;
- transferencia define rol del owner anterior;
- UID único dentro del grupo;
- membership revisions y eventos;
- reincorporación de un exadmin siempre vuelve como member;
- provisional nunca adquiere UID;
- enlace fijo y estado efectivo;
- archivo bloquea mutaciones.

### Integración

- crear cuenta → grupo → invitación → aceptación → torneo → stats;
- diez cuentas aceptan y la undécima falla;
- el mismo UID reintenta sin consumir cupo;
- miembro sale y no reingresa con enlace general;
- invitación dirigida reincorpora reutilizando groupPlayerId;
- admin removido pierde administración de torneos existentes;
- member removido pierde scores propios y un provisional no puede reclamarse;
- archivar bloquea score y reactivar lo habilita;
- login/registro desde enlace general conserva el secreto sólo durante la sesión de pestaña;
- provisional conserva historial al desactivarse;
- corrección de score cambia estadísticas calculadas bajo demanda;
- índice de torneos ausente no elimina el torneo de estadísticas;
- soft-delete excluye y restore reincluye exactamente una vez;
- eliminación normal de owner queda bloqueada y borrado Auth externo pasa a `recoveryRequired`.

### Concurrencia

- dos UIDs compiten por el décimo cupo;
- revocación simultánea con aceptación;
- dos admins invitan al mismo username;
- transferencia simultánea con remoción del destino;
- salida simultánea con mutación de score;
- archivo o remoción con grant vigente devuelve `GROUP_BUSY` y funciona al reintentar;
- degradación de admin y transferencia también respetan grants relevantes;
- crash después de reservar grant y después de crear torneo se recupera sin duplicar;
- retry no duplica eventos ni proyecciones.

### Rules y privacidad

- leer `groupDomains/{groupId}` completo falla para owner, admin, member y superadmin cliente;
- ningún DTO contiene `tokenHash`, receipts, grants, outbox ni payloads de auditoría;
- una entrada estática en `tournamentAccess` no permite leer un torneo de grupo después de salir o ser removido;
- exmiembro obtiene sólo sus snapshots y estadísticas personales, nunca plantilla actual ni torneos nuevos;
- grupo `recoveryRequired` rechaza todas las mutaciones ordinarias.
- superadmin cliente no puede usar su claim para saltar privacidad de un torneo de grupo.

## Riesgos principales y mitigaciones

### Índices divergentes

Las proyecciones pueden atrasarse. Se mitiga con `tournamentRefs` y dominio como fuentes autoritativas, outbox idempotente y reconciliación; nunca autorizan ni alimentan estadísticas por sí mismas.

### Mutación concurrente con archivo o remoción

Una validación previa aislada permite carreras entre ramas RTDB. Se mitiga reservando un grant en la transacción del grupo y haciendo que transiciones incompatibles fallen con `GROUP_BUSY` mientras exista trabajo vigente. El reconciliador nunca libera un grant sólo por reloj sin comprobar timeout de ejecución y receipt del torneo.

### Token filtrado

Se mitiga con fragmento URL, limpieza inmediata, no-referrer, hash, vencimiento fijo, diez usos, revocación y rate limits.

Durante login o registro se conserva exclusivamente en `sessionStorage` de la pestaña y se borra en todos los finales del flujo.

### Owner inexistente

Se bloquea eliminación normal antes de transferir. Ante borrado externo de Auth, trigger y reconciliación llevan el grupo a `recoveryRequired`; no se finge que el owner sigue existiendo ni se reasigna silenciosamente.

### Acceso residual a torneos

Para torneos de grupo se ignora `ownerUid` como permiso independiente y siempre se consulta el rol grupal actual.

### Lectura accidental de secretos RTDB

Una regla `.read` en el padre expondría todos los hijos. No se concede lectura cliente en `groupDomains`; Functions construyen DTOs con allowlist y Rules tests verifican que hashes, receipts, grants, outbox y auditoría sean inaccesibles.

### Crecimiento del límite transaccional

Auditoría e historial de eventos se publican fuera de `groupDomains`. Invitaciones, grants y receipts tienen retención fija; la outbox drenada se monitorea. Los contadores y límites evitan que una transacción condicional crezca sin control.

### Cálculo estadístico costoso

Se mitiga con paginación y límites aplicados al alta, antes de que el grupo supere la capacidad calculable. V1 no mantiene agregados que puedan divergir y nunca devuelve un resultado parcial.

## Criterios de aceptación de v1

V1 se considera completa cuando:

- una cuenta común crea un grupo sin recibir rol global;
- cada grupo operacional conserva exactamente un owner existente; un borrado Auth externo produce explícitamente `recoveryRequired` hasta su recuperación auditada;
- owner/admin/member sólo ejecutan acciones permitidas;
- miembros comunes no crean torneos;
- un provisional puede jugar y acumular estadísticas grupales pero no ser reclamado;
- una invitación dirigida reincorpora sin duplicar jugador local;
- una reincorporación siempre vuelve como member y nunca recupera privilegios anteriores;
- un único enlace general admite exactamente diez incorporaciones durante siete días;
- reintentos no consumen usos y `left/removed` no reingresan por enlace general;
- el enlace sobrevive login/registro sólo en la sesión de pestaña y se elimina al terminar;
- sólo roles grupales actuales administran torneos de grupo;
- un score de member exige binding backend y membresía activa; no existe claim manual en torneos de grupo;
- archivar bloquea toda mutación y reactivar no revive invitaciones;
- archivo, remoción y salida no se confirman mientras haya grants incompatibles vigentes;
- estadísticas básicas se calculan desde referencias autoritativas y torneos fuente, reflejan correcciones y no dependen del índice proyectado;
- un exmiembro conserva únicamente su vista histórica personal y no accede a contenido grupal nuevo;
- no existe ninguna estadística global ni perfil deportivo global en v1;
- ningún cliente escribe datos autoritativos directamente;
- ningún cliente puede leer el dominio completo ni secretos internos del grupo;
- torneos existentes continúan como independientes;
- límites máximos se rechazan al escribir y el máximo estadístico publicado pasa la prueba de carga completa;
- tests unitarios, Functions, Rules Emulator e integración pasan;
- Functions, Rules y frontend se despliegan y verifican por separado;
- escritorio y celular funcionan sin errores de consola.

## Referencias

- [`PLAN-GRUPOS_v2.md`](./PLAN-GRUPOS_v2.md): funcionalidades postergadas y migración futura.
- `PLAN-LOGIN-USUARIOS.md`: cuentas y roles globales.
- `PLAN-FIXTURE-BALANCEADO.md`: esquema y concurrencia del fixture.
- `functions/src/domain/tournament-v2.js`: autorización y mutaciones actuales.
- `functions/src/user-accounts.js`: cuentas comunes y usernames.
- `database.rules.json`: reglas actuales.
- `src/features/scoring/validation.js`: partido completo y score terminal.
