# Plan de grupos v2

Documento de evolución posterior a [`PLAN-GRUPOS.md`](./PLAN-GRUPOS.md). V2 incorpora identidad deportiva global, reclamo de jugadores provisionales, estadísticas avanzadas, agregados persistentes y permisos configurables sólo después de que v1 esté estable y verificada en producción.

Este documento no autoriza adelantar funcionalidades a v1. Cada bloque requiere migración compatible, feature flag, pruebas de reconstrucción y criterios de rollback.

## Prerrequisitos

V2 comienza únicamente cuando v1 demuestre:

- grupos privados estables;
- unicidad de owner y membresía revisada;
- `groupPlayerId` estable en todos los torneos de grupo;
- invitaciones y enlace rígido sin carreras;
- `tournamentRefs` autoritativas y provisioning recuperable;
- autorización dinámica de torneos por rol grupal, bindings backend y grants sin carreras;
- archivo de sólo lectura;
- recuperación auditada ante owner eliminado externamente;
- estadísticas básicas reproducibles desde torneos fuente;
- proyecciones reconciliables;
- ninguna lectura cliente del dominio completo ni de secretos internos;
- tests productivos con varias cuentas.

## Funcionalidades trasladadas desde v1

1. Reclamo y vinculación de provisionales.
2. Perfil deportivo global por persona.
3. Estadísticas globales y desglose por grupo.
4. Rachas, compañeros, parejas, rivales, torneos ganados y métricas avanzadas.
5. Contribuciones estadísticas materializadas y agregados incrementales.
6. Administradores específicos de torneos de grupo.
7. Permiso configurable para que members creen torneos.
8. Enlaces particulares de reclamo.
9. Varios enlaces generales activos y configuración de cupo/vencimiento.
10. Operaciones limitadas sobre grupos archivados.

## Principios de v2

- V1 sigue siendo fuente válida y compatible durante toda la migración.
- Nunca se fusionan identidades por nombre, email o semejanza automática.
- Reclamar un provisional es una absorción controlada hacia un perfil canónico, no la creación de un segundo perfil principal.
- Los torneos históricos conservan `groupPlayerId`; no se reescriben masivamente.
- Los agregados son derivados y reconstruibles.
- Una proyección o caché nunca concede permisos.
- `groupTournamentIndex` nunca reemplaza las `tournamentRefs` autoritativas de v1.
- Toda mutación v2 que afecte un torneo de grupo conserva el protocolo de grants o lo migra mediante una transición explícita igual de segura.
- Todo cambio de identidad es auditado, reversible administrativamente y protegido contra retries.

## Identidad deportiva global

### Perfil canónico

Cada UID registrado puede tener como máximo un `playerProfileId` canónico activo.

```text
playerProfiles/{playerProfileId}
  ownerUid
  displayName
  status                   # active | disabled
  createdAt
  updatedAt

playerProfileByUser/{uid}
  playerProfileId
  revision
```

El perfil se crea de forma perezosa al activar una funcionalidad global. La autenticación por Google, email o username no crea perfiles deportivos distintos mientras conserve el mismo UID.

### Mapeo desde v1

Los `groupPlayerId` de v1 permanecen estables. V2 agrega una resolución opcional:

```text
groupPlayerCanonical/{groupId}/{groupPlayerId}
  playerProfileId
  linkRevision
  linkedAt
  linkedByUid
  source                   # registered | approvedClaim
```

Los torneos continúan apuntando a `groupPlayerId`. El cálculo global resuelve el perfil canónico mediante este mapa. Esto evita reescribir fixtures y snapshots históricos.

Para jugadores registrados de v1, la migración vincula únicamente cuando:

- la membresía autoritativa sigue asociada al mismo UID;
- `playerProfileByUser/{uid}` existe o se crea idempotentemente;
- no existe un mapeo conflictivo.

## Reclamo de jugadores provisionales

### Problema que debe resolver

Una cuenta probablemente ya tendrá perfil canónico cuando reclame un provisional. Por eso no se vincula el UID directamente al perfil provisional ni se reemplaza `playerProfileByUser`.

El reclamo aprobado:

1. valida que el `groupPlayerId` siga siendo provisional y no esté reclamado;
2. obtiene o crea el perfil canónico del UID;
3. crea `groupPlayerCanonical → playerProfileId`;
4. cambia la fila local a un estado de provisional absorbido o la mantiene histórica y crea la presentación registrada correspondiente;
5. reasigna la membresía local si corresponde sin duplicar filas activas;
6. reconstruye estadísticas globales desde los torneos fuente;
7. registra receipt, actor, aprobador y revisiones.

La absorción de un provisional hacia el perfil ya existente es parte obligatoria de v2. La fusión arbitraria entre dos cuentas activas sigue fuera de alcance.

### Solicitud espontánea

- El miembro elige “Ya figuro como jugador”.
- Selecciona un provisional visible del mismo grupo.
- La solicitud no concede identidad ni permisos.
- Owner/admin revisa nombre, historial y cuenta solicitante.
- La aprobación aplica la absorción en una operación idempotente.
- Rechazo y cancelación quedan auditados.

### Enlace particular

Puede contener `targetUid`, `groupPlayerId` o ambos.

- Con `targetUid`: sólo esa cuenta acepta y la absorción puede quedar preautorizada.
- Sin `targetUid`: posesión del token no alcanza para transferir identidad; crea una solicitud pendiente que owner/admin debe confirmar.
- Es de un solo uso, vencible y revocable.
- Nunca permite seleccionar otro provisional ni buscar coincidencias por nombre.

### Conflictos

Se rechaza cuando:

- el provisional ya tiene mapeo canónico;
- otro reclamo ganó la revisión;
- el UID ya representa otra fila activa incompatible en el mismo grupo y la transición no puede consolidarse;
- el token fue usado, venció o se revocó;
- el grupo está archivado según la política vigente.

## Estadísticas globales

Incluyen torneos válidos donde el `groupPlayerId` resuelve al mismo `playerProfileId` canónico.

El dueño puede consultar:

- totales globales;
- desglose por grupo;
- historial cronológico;
- volumen de torneos y partidos;
- métricas avanzadas habilitadas.

Privacidad:

- el perfil global es privado por defecto;
- un grupo sólo expone estadísticas generadas dentro de ese grupo;
- salir no concede acceso futuro al grupo, pero conserva la vista personal de las contribuciones propias;
- la consulta global nunca revela nombres ni miembros de grupos donde el usuario no tenga acceso.

### Torneos independientes

Un torneo independiente sólo aporta a estadísticas globales cuando cada cuenta acepta o reclama explícitamente su participante.

- El creador no puede adjuntar perfiles globales ajenos por su cuenta.
- Un participante sin confirmación permanece local y no aporta globalmente.
- La aceptación vincula UID, perfil canónico y jugador local del torneo.
- Cambiar esa identidad después de tener resultados exige auditoría y reconstrucción.

## Estadísticas avanzadas

V2 puede incorporar por etapas:

- mejor racha de victorias;
- compañero más frecuente;
- pareja con mejores resultados y denominador mínimo;
- rival más frecuente;
- torneos ganados según definición por formato;
- primeros puestos;
- evolución por período;
- comparaciones directas;
- Elo u otro rating, sólo mediante un plan específico.

Las definiciones deben fijar empates, mínimos de muestra, orden cronológico, timezone y desempates estables antes de implementar.

## Agregados incrementales

### Fuente y contribución

Los torneos y participantes resueltos siguen siendo la fuente de verdad.

```text
statsContributions/{tournamentId}
  sourceRevision
  calculationVersion
  groupId
  status
  players/{playerProfileId}
  chronologicalMatches/{matchId}
```

Cada contribución reemplaza por completo la revisión anterior del torneo. Nunca se aplican diferencias sin conocer la contribución previa confirmada.

### Pipeline

1. Una mutación de torneo confirma `sourceRevision`.
2. En la misma operación se publica un evento/outbox idempotente.
3. Worker calcula la contribución para esa revisión.
4. Si ya existe una revisión superior, descarta el resultado obsoleto.
5. Reemplaza contribución y agregados con compare-and-set.
6. Marca `appliedRevision` o `failedRevision`.
7. Reintentos conservan el mismo resultado.

Estados operativos mínimos:

- `pendingRevision`;
- `appliedRevision`;
- `failedRevision`;
- `calculationVersion`;
- `lastErrorCode` sin datos sensibles;
- `updatedAt`.

### Reconstrucción

- puede regenerar todas las contribuciones desde torneos fuente;
- usa snapshot o corte de revisión para no mezclar mutaciones concurrentes;
- compara incremental contra reconstrucción;
- permite shadow mode antes de activar lecturas productivas;
- el rollback vuelve a cálculo bajo demanda de v1 sin borrar fuentes.

## Administración flexible de torneos de grupo

V2 puede agregar admins específicos sólo con una política explícita.

Recomendación:

- owner/admin grupal conserva administración dinámica;
- un admin específico debe ser miembro activo del grupo;
- perder membresía revoca también el permiso específico;
- perder rol grupal no revoca un permiso específico mientras siga siendo miembro, si esa excepción fue otorgada explícitamente;
- `createdByUid` nunca concede permisos;
- `ownerUid` del torneo no elude autorización grupal;
- cada alta y revocación queda auditada.

Si se desea permitir admins externos al grupo, debe tratarse como una nueva excepción de privacidad y no como extensión automática.

## Creación de torneos por members

Configuración futura:

```text
membersCanCreateTournaments: false | true
```

Al habilitarla:

- sólo members activos crean;
- el grupo debe estar activo;
- existen cuotas por UID y grupo;
- el creador no obtiene admin permanente por crear;
- owner/admin actuales administran el torneo;
- remover al creador no afecta el torneo;
- creación concurrente con remoción debe validar revisión de membresía en backend.

## Enlaces generales configurables

V2 puede reemplazar el único enlace rígido por varios enlaces administrables:

- owner y admins pueden crear según política del grupo;
- etiqueta opcional;
- `maxUses` dentro de límites de plataforma;
- vencimiento dentro de máximo permitido;
- múltiples activos con cuota por grupo;
- listado de actividad sin reexponer tokens;
- rotación mediante revocar y crear;
- rol inicial siempre `member` salvo un plan futuro separado.

La semántica de reingreso permanece dirigida: `left` y `removed` no usan enlaces generales.

## Archivo flexible

V1 congela todo. V2 puede permitir políticas explícitas, por ejemplo:

- `readOnly`: comportamiento v1;
- `finishActiveTournaments`: impide crear torneos pero permite anotar los ya iniciados;
- `historicalMaintenance`: permite correcciones auditadas de owner/admin.

Antes de habilitar otra política se debe definir:

- qué significa torneo iniciado;
- quién conserva permisos;
- qué mutaciones estadísticas se permiten;
- si members pueden salir;
- cómo funciona reactivación;
- qué ocurre con invitaciones y enlaces.

Archivar nunca reemplaza la transferencia de propiedad. La eliminación normal del owner sigue bloqueada; un borrado externo de Auth conserva el estado `recoveryRequired` de v1 hasta una recuperación auditada.

## Modelo adicional tentativo

```text
playerProfiles/{playerProfileId}
playerProfileByUser/{uid}
groupPlayerCanonical/{groupId}/{groupPlayerId}

playerLinkRequests/{groupId}/{requestId}
  groupPlayerId
  requestedByUid
  targetPlayerProfileId
  status
  expectedPlayerRevision
  createdAt
  resolvedAt
  resolvedByUid

statsContributions/{tournamentId}
statsProcessing/{tournamentId}
groupStats/{groupId}
playerStats/{playerProfileId}
```

Todos son privados o servidos por vistas filtradas. Ningún cliente escribe vínculos, contribuciones o agregados.

## Migración desde v1

### Fase 1: preparar

- agregar nodos v2 sin cambiar lecturas v1;
- enumerar torneos desde `tournamentRefs` autoritativas, nunca desde `groupTournamentIndex`;
- crear perfiles canónicos para cuentas activas de manera idempotente;
- mapear jugadores registrados de v1 en shadow mode;
- detectar conflictos sin mutar torneos.

### Fase 2: validar

- reconstruir estadísticas v2 en paralelo;
- comparar métricas básicas contra cálculo v1;
- resolver conflictos manualmente;
- medir tiempos, costos y errores.

### Fase 3: activar por feature flag

- habilitar perfil global para cuentas seleccionadas;
- habilitar reclamos en grupos seleccionados;
- mantener fallback a estadísticas v1;
- monitorear revisiones pendientes y divergencias.

### Fase 4: ampliar

- activar estadísticas globales;
- activar métricas avanzadas por separado;
- activar permisos y enlaces flexibles sólo después de seguridad específica.

### Rollback

- deshabilitar flags v2;
- volver a vistas v1 calculadas desde torneos;
- conservar mapeos y contribuciones para diagnóstico;
- no borrar ni reescribir `groupPlayerId` ni snapshots.

## Etapas sugeridas

1. Perfil canónico y mapeo de registrados.
2. Reclamo de provisional con absorción y conflictos.
3. Confirmación de participantes en torneos independientes.
4. Pipeline incremental en shadow mode.
5. Estadísticas globales básicas.
6. Métricas avanzadas, una familia por vez.
7. Admins específicos y creación configurable por members.
8. Enlaces configurables.
9. Archivo flexible.
10. Migración gradual y publicación.

## Pruebas críticas

- cuenta con perfil canónico reclama provisional sin crear segundo perfil;
- dos cuentas compiten por el mismo provisional;
- una cuenta reclama provisionales de dos grupos y ambos resuelven al mismo perfil;
- retry de aprobación no duplica mappings ni estadísticas;
- torneo independiente no aporta globalmente antes de confirmación;
- corrección histórica reemplaza contribución y reconstruye racha;
- worker obsoleto no pisa revisión nueva;
- reconstrucción coincide con agregados incrementales;
- admin específico pierde acceso al salir del grupo;
- member removido durante creación no completa torneo;
- una operación v2 no elude grants, `recoveryRequired` ni privacidad de lectura de v1;
- enlace configurable respeta límite concurrente;
- rollback muestra estadísticas v1 correctas.

## Criterios de aceptación de v2

- cada UID tiene como máximo un perfil canónico;
- un provisional reclamado se absorbe en el perfil existente sin duplicarlo;
- mappings históricos no requieren reescribir torneos;
- estadísticas globales sólo incluyen identidades confirmadas;
- ninguna cuenta puede atribuir resultados globales a terceros sin aceptación;
- contribuciones incrementales y reconstrucción producen los mismos resultados;
- errores del worker son visibles, reintentables y no publican resultados parciales;
- permisos flexibles nunca eluden membresía ni privacidad del grupo;
- enlaces configurables mantienen idempotencia y límites bajo concurrencia;
- v1 continúa disponible como fallback durante el rollout;
- migración y rollback se verifican en producción por etapas.

## Referencias

- [`PLAN-GRUPOS.md`](./PLAN-GRUPOS.md): alcance implementable de v1.
- `PLAN-LOGIN-USUARIOS.md`: cuentas y proveedores.
- `functions/src/domain/tournament-v2.js`: revisiones y autorización actual.
- `database.rules.json`: reglas actuales.
- `src/features/scoring/statistics.js`: estadísticas actuales de un torneo.
