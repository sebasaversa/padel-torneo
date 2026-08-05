# Plan de grupos, identidades de jugadores y estadísticas históricas

Documento de trabajo para incorporar grupos persistentes de jugadores, torneos asociados, invitaciones, membresías y estadísticas globales y por grupo al anotador de torneos de pádel.

Este plan **no modifica todavía el funcionamiento de la aplicación**. Define el alcance, las decisiones recomendadas, el modelo de permisos, la arquitectura de datos, la compatibilidad con torneos anteriores y una implementación por etapas verificables. Cada etapa cerrada deberá incluir pruebas y su propio commit para facilitar revisión y reversión.

Runtime de desarrollo: **Node.js 22 LTS**, usando la versión exacta indicada por el proyecto también para los procesos hijos de npm, Vite, Firebase y los emuladores.

## Objetivo

Permitir que una comunidad habitual de jugadores pueda:

- crear un grupo y conservar una lista reutilizable de jugadores;
- invitar usuarios registrados o agregar jugadores que todavía no tienen cuenta;
- crear torneos independientes o asociados a un único grupo;
- seleccionar para cada torneo sólo los miembros que juegan esa fecha;
- conservar el historial completo de torneos del grupo;
- consultar estadísticas históricas del grupo y rankings internos;
- consultar las estadísticas globales de cada jugador y su desglose por grupo;
- entrar, salir o ser removido de un grupo sin alterar resultados históricos;
- administrar el grupo mediante permisos locales, sin otorgar privilegios globales de plataforma.

La funcionalidad debe mantener la seguridad en dos capas: la interfaz mostrará únicamente las acciones disponibles para cada persona, y Cloud Functions y Firebase Rules impedirán accesos o mutaciones no autorizadas aunque se intente operar directamente contra el backend.

## Estado

- `[x]` Completado
- `[~]` En curso
- `[ ]` Pendiente
- `[!]` Requiere confirmación antes de cerrar la implementación

Estado general: `[ ]` Pendiente de implementación.

## Alcance

### Incluido en la primera versión

- creación, edición y archivo de grupos;
- login y alta pública mediante Google para cualquier usuario;
- listado “Mis grupos” para cada usuario registrado;
- roles locales de propietario, administrador y miembro;
- invitaciones por nombre de usuario y por enlace seguro;
- jugadores provisionales sin cuenta;
- vinculación posterior de un jugador provisional con una cuenta;
- salida voluntaria y remoción de miembros sin pérdida histórica;
- transferencia obligatoria de propiedad antes de que el propietario salga;
- torneos independientes y torneos pertenecientes a un grupo;
- selección de participantes desde la plantilla del grupo;
- historial de torneos por grupo;
- perfil deportivo estable para cada jugador;
- estadísticas globales y estadísticas por grupo;
- rankings históricos básicos;
- configuraciones predeterminadas de torneo por grupo;
- auditoría de operaciones administrativas;
- compatibilidad con los torneos existentes.

### Preparado en el modelo, pero postergado

- temporadas configurables;
- convocatorias y confirmación de asistencia;
- suplentes;
- ranking Elo u otro rating competitivo;
- logros, insignias y reconocimientos;
- comparación directa entre jugadores;
- ubicaciones habituales y calendario recurrente;
- solicitudes espontáneas para entrar a un grupo;
- notificaciones por email o push;
- exportación visual del ranking;
- fotos, comentarios o contenido social.

Estas extensiones no deben condicionar el lanzamiento inicial, pero los identificadores y agregados no deben impedir incorporarlas después.

### Fuera de alcance inicial

- grupos públicos indexados por buscadores;
- pagos, cuotas o reservas de canchas;
- chat interno;
- federación automática de un mismo jugador entre cuentas duplicadas;
- asociación de un torneo con más de un grupo;
- reconocimiento automático de identidades por coincidencia de nombres;
- eliminación física inmediata de grupos con historial.

## Diagnóstico del sistema actual

La aplicación ya dispone de:

- cuentas registradas mediante Firebase Authentication;
- un rol global `superAdmin`;
- un rol global `admin` para administración de torneos autorizados;
- cuentas comunes con perfil `user`;
- permisos específicos por torneo: administrador, participante y espectador;
- propiedad del torneo mediante `ownerUid`;
- acceso privado por torneo en `tournamentAccess`;
- jugadores locales al fixture identificados actualmente por índices enteros;
- resultados, leaderboard, diferencia de games, progreso y mejor racha calculados dentro de cada torneo;
- historial de torneos segmentado según autorización;
- auditoría y borrado lógico de torneos;
- Cloud Functions como límite confiable para operaciones privilegiadas;
- Realtime Database Rules con denegación por defecto.

Los grupos requieren agregar una identidad deportiva estable. El nombre o índice local de un jugador dentro de un fixture no alcanza para sumar estadísticas entre torneos: el índice `2` sólo tiene significado dentro de ese torneo y un nombre puede cambiar, repetirse o contener errores.

## Prerrequisito: login y registro público con Google

Esta ampliación se implementará **antes** que la funcionalidad de grupos. Las membresías, invitaciones, ownership y perfiles deportivos necesitan un UID registrado y estable; resolver el onboarding después obligaría a rehacer flujos de creación, estados vacíos y vinculación de identidad.

### Comportamiento deseado

- Cualquier persona puede elegir “Continuar con Google”.
- Si es su primer ingreso, Firebase Authentication crea la cuenta y el backend crea un `userProfile` común con rol de perfil `user`.
- Si la cuenta ya existe, inicia sesión sin crear otro perfil ni sobrescribir datos actuales.
- La única cuenta confirmada por el propietario y configurada en `SUPER_ADMIN_EMAIL` recibe el rol global `superAdmin`.
- Ningún otro email puede recibir ni ejercer `superAdmin`, aunque un cliente manipule el payload o exista una custom claim obsoleta.
- Un admin de plataforma existente conserva `platformRole: "admin"` si inicia mediante un proveedor Google vinculado; el alta pública no lo degrada ni lo promueve.
- El mensaje de bienvenida distingue “Super administrador”, “Administrador” y “Usuario”; una cuenta Google común no verá un error relacionado con el bootstrap.
- Registro por username o email/contraseña continúa disponible y compatible.

### Fuente autoritativa del super admin

El email autorizado —confirmado como parte de este plan y conservado fuera del repositorio— se mantendrá únicamente en el secreto backend `SUPER_ADMIN_EMAIL`; no se confiará en un email enviado por el cliente ni se incorporará como constante al frontend o a este documento público.

Para garantizar que exista **un único super admin efectivo**, se recomienda complementar la custom claim con un UID canónico privado:

```text
platformConfig
  superAdminUid
  updatedAt
```

- El bootstrap exige sesión Google, email verificado y coincidencia normalizada con `SUPER_ADMIN_EMAIL`.
- Al completarse, registra el UID canónico y asigna `platformRole: "superAdmin"`.
- Si la cuenta autorizada fue recreada y cambió su UID, la recuperación reemplaza el UID canónico y revoca la claim anterior cuando todavía existe.
- Functions autorizan super admin sólo si coinciden la claim y el UID canónico.
- Database Rules verifican la claim y `platformConfig/superAdminUid`; el nodo no será legible ni escribible por clientes.
- Una claim `superAdmin` accidental en otra cuenta no concede acceso porque su UID no coincide con la configuración autoritativa.
- Toda recuperación o reemplazo queda registrada en `adminActivity`.

### Provisionamiento de usuarios Google

Después del login, una Function idempotente de provisionamiento deberá:

1. exigir una sesión no anónima;
2. comprobar que el proveedor autenticado sea Google y que el email esté verificado;
3. leer la identidad desde el token confiable de Firebase;
4. crear el perfil `user` si no existe;
5. preservar `createdAt`, nombre elegido posteriormente y cualquier rol administrativo válido existente;
6. aplicar el bootstrap exclusivo si el email coincide con el secreto;
7. devolver el rol efectivo para refrescar la sesión y la interfaz.

El cliente nunca podrá solicitar `role`, `platformRole`, UID objetivo ni email privilegiado dentro de esta operación.

### Colisiones y vinculación de proveedores

- No se crearán dos perfiles deportivos porque una misma persona use Google y email/contraseña.
- Si Firebase informa que el email ya existe con otro proveedor, la interfaz guiará a iniciar sesión con el método original y vincular Google desde una sesión autenticada.
- La vinculación de proveedores conserva el mismo UID; no fusiona cuentas ni estadísticas por nombre o email desde el cliente.
- Una eventual fusión de dos UIDs distintos seguirá siendo una operación administrativa separada, auditada y fuera del alta pública.

### Orden de despliegue de este prerrequisito

1. Incorporar el UID canónico y endurecer helpers, Functions y Rules de super admin.
2. Probar que la cuenta autorizada conserva acceso y que cualquier otra claim queda bloqueada.
3. Incorporar el provisionamiento idempotente de perfiles Google.
4. Corregir la experiencia de login y los mensajes para usuarios comunes.
5. Desplegar primero las Functions nuevas.
6. Publicar el frontend y entrar con la cuenta autorizada para establecer `platformConfig/superAdminUid` mientras las Rules anteriores siguen vigentes.
7. Confirmar que el UID canónico existe y recién entonces desplegar las Rules endurecidas.
8. Verificar en producción con la cuenta super admin y con una segunda cuenta Google común.

No se abrirá la creación de grupos hasta completar estas verificaciones.

## Principios e invariantes

### Separación de cuenta, jugador y membresía

Se distinguirán tres entidades:

1. **Cuenta**: identidad que inicia sesión, representada por un UID de Firebase Authentication.
2. **Jugador**: identidad deportiva estable que acumula estadísticas, representada por un `playerProfileId`.
3. **Membresía**: relación entre una cuenta o jugador y un grupo, con rol y estado propios.

Una cuenta registrada tendrá como máximo un perfil deportivo principal activo. Un perfil deportivo puede comenzar como provisional, sin cuenta vinculada, y ser reclamado posteriormente mediante un flujo confirmado.

### Identidad histórica estable

- Los resultados históricos apuntarán a `playerProfileId`, no al nombre actual del jugador.
- Cada torneo conservará además una copia del nombre mostrado al momento de su creación.
- Cambiar el nombre visible no reescribirá torneos anteriores.
- Salir de un grupo no borrará la identidad ni las contribuciones estadísticas históricas.
- Nunca se fusionarán jugadores automáticamente sólo porque sus nombres coinciden.

### Pertenencia del torneo

- Un torneo pertenece a cero o un grupo.
- `groupId: null` representa un torneo independiente.
- La asociación con el grupo se decide al crear el torneo.
- En la primera versión no se permitirá asociar retroactivamente un torneo ya jugado ni moverlo entre grupos.
- Un torneo de grupo conservará el `groupId` aunque el grupo se archive.

Esta restricción evita duplicar estadísticas, ambigüedad de permisos y movimientos históricos difíciles de auditar.

### Fuente de verdad y datos derivados

- Los resultados y participantes estables del torneo son la fuente de verdad.
- Los índices y estadísticas agregadas son datos derivados y reconstruibles.
- Ningún cliente podrá escribir directamente totales globales, porcentajes o rankings.
- Toda actualización de agregados incluirá una revisión de origen para ser idempotente.

### Preservación histórica

- Archivar un grupo impide nuevas invitaciones y torneos, pero conserva su consulta histórica.
- Salir o ser removido cambia el estado de la membresía, no elimina el registro.
- El borrado lógico o anulación de un torneo debe retirar su contribución de las estadísticas sin borrar la auditoría.
- Corregir un resultado debe reemplazar la contribución anterior, no sumarla nuevamente.

## Modelo de roles y permisos

### Roles globales existentes

| Rol global | Alcance recomendado |
| --- | --- |
| `superAdmin` | Administración y soporte de toda la plataforma, con intervención excepcional y auditada. |
| `admin` | Capacidades administrativas de plataforma ya existentes y gestión de torneos propios o asignados; no administra automáticamente todos los grupos. |
| `user` | Cuenta registrada normal, apta para crear grupos, recibir invitaciones y mantener un perfil deportivo. |

No se agregará un nuevo rol global para grupos. La administración de un grupo será siempre un permiso local.

Las custom claims se reservarán para `superAdmin` y `admin` de plataforma. Una cuenta común se reconocerá por su autenticación y perfil activo; no necesita una claim `user`. Los roles de grupo se consultarán desde datos autoritativos de acceso y **no** se copiarán a custom claims, para que una promoción, degradación, salida o remoción tenga efecto inmediato sin esperar la renovación del token.

En la interfaz se usarán etiquetas inequívocas:

- “Super administrador”;
- “Administrador de plataforma”;
- “Propietario del grupo”;
- “Administrador del grupo”;
- “Administrador del torneo”.

### Roles locales del grupo

#### Propietario (`owner`)

Existe exactamente uno por grupo.

En persistencia, `groupAccess/{groupId}/ownerUid` será la única fuente autoritativa de propiedad. “Owner” será el rol efectivo derivado de que el UID autenticado coincide con ese campo; no se guardará una segunda asignación independiente `role: "owner"` que pueda divergir. El propietario también tendrá una membresía activa para plantilla e índices.

Puede:

- editar la identidad y configuración del grupo;
- invitar, remover y reincorporar miembros;
- nombrar o quitar administradores del grupo;
- transferir la propiedad;
- administrar todos los torneos del grupo;
- archivar o reactivar el grupo;
- gestionar jugadores provisionales y solicitudes de vinculación.

No puede salir mientras siga siendo propietario. Antes debe transferir la propiedad a otro miembro activo o archivar el grupo siguiendo el flujo de contingencia definido.

#### Administrador del grupo (`admin`)

Puede:

- editar información operativa del grupo;
- invitar usuarios y agregar jugadores provisionales;
- remover miembros comunes;
- crear y administrar torneos del grupo;
- corregir resultados y gestionar configuraciones predeterminadas;
- consultar la auditoría operativa del grupo.

No puede:

- remover ni degradar al propietario;
- transferir la propiedad;
- archivar definitivamente el grupo;
- nombrar o quitar otros administradores;
- borrar la historia del grupo.

En la primera versión, sólo el propietario modifica los roles administrativos. Esto evita cadenas de escalamiento difíciles de explicar.

#### Miembro (`member`)

Puede:

- ver el grupo, su plantilla, torneos y estadísticas;
- participar en torneos;
- consultar sus propias estadísticas;
- salir voluntariamente;
- crear torneos únicamente si la configuración `membersCanCreateTournaments` está activada.

No puede administrar membresías, roles, invitaciones ni resultados ajenos salvo autorización específica dentro de un torneo.

### Estados que no son roles

Los siguientes valores describen un ciclo de vida y no deben convertirse en permisos:

- invitación pendiente;
- invitación aceptada, rechazada, vencida o revocada;
- membresía activa;
- miembro que salió;
- miembro removido;
- jugador provisional sin cuenta;
- grupo activo o archivado.

Separar rol y estado evita, por ejemplo, que una invitación pendiente sea interpretada accidentalmente como acceso de lectura.

### Matriz de permisos recomendada

| Acción | Super admin | Admin global | Owner del grupo | Admin del grupo | Miembro |
| --- | ---: | ---: | ---: | ---: | ---: |
| Crear un grupo propio | Sí | Sí | — | — | Sí |
| Listar un grupo privado | Soporte | Sólo con membresía | Sí | Sí | Sí |
| Ver historial y estadísticas | Soporte | Sólo con membresía | Sí | Sí | Sí |
| Editar perfil operativo | Soporte | Según rol local | Sí | Sí | No |
| Cambiar privacidad | Soporte | Sólo como owner | Sí | No | No |
| Invitar miembros | Soporte | Según rol local | Sí | Sí | No |
| Agregar jugador provisional | Soporte | Según rol local | Sí | Sí | No |
| Remover miembro común | Soporte | Según rol local | Sí | Sí | No |
| Nombrar o quitar admin | Soporte | Sólo como owner | Sí | No | No |
| Transferir propiedad | Soporte | Sólo como owner | Sí | No | No |
| Crear torneo del grupo | Soporte | Según rol local | Sí | Sí | Configurable |
| Administrar torneo del grupo | Soporte | Según rol local | Sí | Sí | Sólo asignado |
| Archivar/reactivar grupo | Soporte | Sólo como owner | Sí | No | No |
| Salir del grupo | No aplica | Sí si no es owner | Tras transferir | Sí | Sí |

“Soporte” significa que el super admin puede intervenir ante abuso, pérdida de acceso o corrupción, con motivo obligatorio y registro de auditoría. No se lo incorporará como miembro visible ni se lo incluirá en estadísticas.

### Relación con permisos del torneo

Se conservarán los roles locales del torneo:

- `admin`: administra configuración, fixture, participantes y resultados;
- `participant`: actúa como un jugador asignado;
- `spectator`: consulta sin modificar.

Para un torneo asociado a un grupo podrán administrar:

- el `superAdmin`, como intervención auditada;
- el propietario actual del grupo;
- los administradores actuales del grupo;
- el creador del torneo, mientras conserve acceso válido;
- administradores adicionales asignados específicamente al torneo.

Los permisos derivados del grupo serán dinámicos: si una persona deja de ser administradora del grupo, pierde esa capacidad sobre los torneos del grupo. Un permiso explícito de administrador del torneo puede conservarse hasta que un administrador autorizado lo revoque.

### Recomendación sobre creación de torneos

Actualmente la creación está restringida a `admin` y `superAdmin`. Para que los grupos sean autogestionables se recomienda cambiar la política:

- cualquier cuenta registrada y activa puede crear un torneo independiente y queda como su propietaria;
- owner y admins pueden crear torneos para su grupo;
- un miembro puede crearlos sólo si el grupo lo habilita;
- deben existir límites razonables de frecuencia para evitar abuso;
- los usuarios anónimos, participantes por enlace y espectadores no pueden crear grupos ni torneos persistentes.

Esto es una ampliación deliberada del permiso actual, no un nuevo rol global.

## Visibilidad y privacidad

### Visibilidad inicial recomendada

Todos los grupos serán privados en la primera versión:

- sólo miembros activos pueden leer el detalle, la plantilla, los torneos y las estadísticas;
- una persona invitada recibe únicamente la información mínima necesaria para decidir si acepta;
- un enlace de invitación no concede lectura permanente antes de ser aceptado;
- los perfiles deportivos globales son privados por defecto y visibles para su dueño;
- los miembros pueden ver dentro del grupo las estadísticas grupales de los demás miembros;
- un exmiembro conserva acceso a sus estadísticas personales, pero no al contenido privado nuevo del grupo.

El modelo puede reservar `visibility: "private" | "discoverable" | "link"`, pero solamente `private` quedará habilitado inicialmente. La apertura pública exige una revisión adicional de privacidad y reglas.

### Datos personales

- No se expondrán emails en plantillas, rankings ni invitaciones.
- La búsqueda por username se realizará en backend sin exponer `usernameDirectory`.
- Los links guardarán sólo tokens hasheados en el backend.
- El nombre histórico de un torneo no debe revelar identificadores internos.
- Las exportaciones y logs respetarán el mismo alcance que la pantalla de origen.

## Miembros, invitaciones y jugadores provisionales

### Invitación por usuario

Flujo recomendado:

1. Owner o admin busca un username exacto.
2. Una Cloud Function resuelve la identidad sin revelar el directorio interno.
3. Se crea una invitación con vencimiento, grupo, invitador y rol solicitado `member`.
4. El destinatario la ve en “Mis grupos”.
5. Al aceptar, una transacción valida que siga vigente y crea la membresía activa.
6. La misma transacción invalida invitaciones duplicadas compatibles.

No se invitará directamente como `admin`. Primero se acepta como miembro y luego el owner puede promoverlo.

### Invitación por enlace

- El cliente recibe un token aleatorio de alta entropía una sola vez.
- La base guarda únicamente su hash.
- El link tiene vencimiento y puede ser revocado.
- Por defecto será de un único uso.
- Aceptarlo requiere iniciar sesión o crear una cuenta.
- La aceptación es transaccional e idempotente.
- El grupo puede ofrecer un link multiuso sólo en una etapa posterior y con límite explícito.

### Jugador provisional sin cuenta

Owner o admin puede agregar un jugador mediante nombre visible. Se crea un `playerProfileId` provisional y una entrada de plantilla, pero no una cuenta ficticia ni una membresía con permisos.

El jugador provisional:

- puede ser seleccionado en torneos del grupo;
- acumula estadísticas dentro del grupo;
- no puede iniciar sesión ni leer el grupo;
- no recibe estadísticas globales entre diferentes grupos hasta que exista una identidad confirmada;
- puede ser desactivado de la plantilla sin perder resultados históricos.

### Reclamo y vinculación de identidad

Flujo recomendado:

1. Un miembro registrado solicita vincular su cuenta con un jugador provisional del grupo.
2. El sistema impide que el perfil ya esté vinculado a otra cuenta activa.
3. Owner o admin confirma la solicitud, salvo que la invitación original ya contenga una vinculación segura preautorizada.
4. Se conecta el `playerProfileId` existente con el UID.
5. Se conserva todo el historial y se habilita su inclusión en estadísticas globales.
6. La operación queda auditada y admite reversión administrativa ante un error.

No se usará coincidencia de nombres como prueba de identidad.

### Fusión de duplicados

La fusión de perfiles es una operación delicada y se postergará. Si se incorpora:

- estará limitada a super admin o a un flujo con doble confirmación;
- conservará alias y referencias anteriores;
- será idempotente;
- no reescribirá silenciosamente resultados;
- permitirá reconstruir estadísticas;
- nunca fusionará dos cuentas activas de manera automática.

## Ciclo de vida del grupo

### Creación

- Cualquier cuenta registrada y activa puede crear un grupo.
- El creador se convierte en `owner` y miembro activo en una única transacción.
- Se crea una plantilla vacía o con el perfil deportivo del creador.
- Nombre, configuración y slug visible no se usarán como identidad autoritativa; el grupo tendrá un `groupId` opaco.
- La creación será idempotente mediante `operationId`.

### Salida voluntaria

- Un miembro o admin puede salir.
- Un owner debe transferir primero la propiedad.
- La membresía pasa a estado `left`; no se elimina.
- Pierde acceso al contenido privado nuevo.
- Conserva sus estadísticas personales y su participación histórica.
- Puede ser invitado otra vez mediante una nueva transición auditada.

### Remoción

- Un admin puede remover miembros comunes.
- Sólo el owner puede remover o degradar admins.
- Nadie puede remover al owner sin transferencia previa.
- La remoción no borra resultados, perfiles ni auditoría.
- Una cuenta removida pierde inmediatamente permisos derivados del grupo.

### Transferencia de propiedad

- Sólo el owner puede iniciarla, salvo recuperación por super admin.
- El destino debe ser un miembro registrado, activo y no provisional.
- La transferencia cambia ambos roles en una única transacción.
- Siempre debe quedar exactamente un owner.
- La acción exige confirmación explícita y registro de auditoría.

### Archivo y reactivación

Al archivar:

- se bloquean nuevas invitaciones y torneos;
- se revocan links pendientes;
- se conserva el acceso histórico para miembros activos;
- no se eliminan resultados ni estadísticas;
- el owner puede reactivar el grupo;
- el super admin puede intervenir sólo mediante recuperación auditada.

La eliminación física queda fuera de la primera versión.

## Torneos independientes y torneos de grupo

### Creación independiente

- `groupId` queda ausente o `null`.
- El creador se convierte en owner y admin del torneo.
- Puede seleccionar perfiles deportivos conocidos o crear participantes locales.
- Sólo los participantes vinculados de forma estable aportan a estadísticas globales.
- Los nombres locales no vinculados siguen funcionando, pero no se agregan automáticamente a perfiles existentes.

### Creación para un grupo

Flujo recomendado:

1. El usuario elige uno de “Mis grupos” o “Torneo independiente”.
2. El backend valida que pueda crear torneos para ese grupo.
3. La interfaz carga miembros y jugadores provisionales activos.
4. Se seleccionan sólo quienes juegan esa fecha.
5. Se aplican los valores predeterminados del grupo.
6. El backend vuelve a validar todas las identidades y crea el torneo.
7. Se registra el torneo en el índice histórico del grupo.
8. Se crean referencias estables de participantes y snapshots de nombres.

### Snapshot de participantes

El torneo conservará para cada índice local del fixture:

- `playerProfileId`, cuando exista;
- `displayNameSnapshot`;
- estado provisional o registrado al momento del torneo.

El fixture puede seguir usando índices compactos internamente, pero las estadísticas y el historial resolverán esos índices mediante este mapa estable.

### Cambio posterior de la plantilla

- Agregar o quitar miembros del grupo no cambia torneos existentes.
- Renombrar un jugador cambia su perfil actual, no el snapshot histórico.
- Las correcciones de participantes dentro de un torneo deben actualizar su mapa estable y recalcular contribuciones afectadas.
- Si el torneo ya tiene resultados, se aplicarán las mismas restricciones y auditoría que para una corrección de parejas.

### Torneo anulado, eliminado o restaurado

- Un torneo eliminado lógicamente deja de aportar a rankings activos.
- Restaurarlo repone su última contribución válida.
- Anular un torneo y borrarlo son conceptos distintos: puede conservarse visible como “anulado” sin aportar estadísticas.
- Cada transición debe reemplazar contribuciones de forma idempotente.

## Estadísticas

### Fuente de cálculo

Sólo cuentan partidos completos según las reglas del torneo. Esto incluye el comportamiento vigente donde un resultado terminal `4–vacío` se interpreta como `4–0`, mientras que `3–vacío` sigue incompleto cuando el objetivo es cuatro games.

Los partidos incompletos no aportan victorias, derrotas, games, porcentajes ni rachas.

### Métricas básicas por jugador

- torneos jugados;
- partidos jugados;
- victorias y derrotas;
- games a favor y en contra;
- diferencia de games;
- porcentaje de victorias;
- mejor racha de victorias;
- participación o asistencia;
- primeros puestos o torneos ganados, cuando el formato permita determinarlo;
- fecha del primer y último torneo computado.

Definiciones recomendadas:

- “Torneo jugado” exige al menos un partido completo de ese jugador.
- “Asistencia” indica que fue incluido en la lista del torneo aunque no haya completado partidos.
- El porcentaje de victorias usa `victorias / partidos completos`.
- Todo porcentaje se muestra junto con su denominador.
- Los empates, si una configuración futura los permite, se contabilizan por separado y no como derrota.

### Estadísticas del grupo

Incluyen únicamente torneos cuyo `groupId` coincide con el grupo y que no están anulados ni eliminados.

El grupo podrá mostrar:

- ranking histórico;
- torneos y partidos jugados por miembro;
- victorias, derrotas y porcentaje;
- games a favor, en contra y diferencia;
- mejor racha;
- compañero más frecuente;
- pareja con mejores resultados, con mínimo de partidos visible;
- rival más frecuente;
- últimos torneos;
- participación de miembros activos e históricos.

Los exmiembros permanecen en rankings históricos con una etiqueta de estado. Por defecto no aparecen en la plantilla de selección ni en un ranking filtrado a “miembros actuales”.

### Estadísticas globales

Incluyen todos los torneos válidos donde el participante se encuentre vinculado al mismo `playerProfileId`, sean independientes o de grupo.

El dueño del perfil podrá ver:

- totales globales;
- desglose por grupo;
- historial cronológico;
- parejas y rivales frecuentes;
- evolución futura por temporada.

Un jugador provisional acumula contribuciones identificables, pero su vista global no se expone hasta vincularlo con una cuenta. Al vincularse, las contribuciones existentes se vuelven visibles sin volver a sumar resultados.

### Ranking

Para la primera versión se conservará un criterio transparente, similar al torneo actual:

1. mayor cantidad de victorias;
2. mayor diferencia de games;
3. mayor cantidad de games a favor;
4. mayor porcentaje de victorias si continúa el empate;
5. nombre visible sólo como último orden estable, no como mérito deportivo.

La interfaz debe permitir filtrar miembros activos o historial completo y mostrar el volumen de partidos. Un rating Elo se evaluará después de contar con suficientes datos y una definición aprobada para parejas rotativas.

### Parejas y rivales

Cada partido completo produce:

- una participación por jugador;
- una relación de compañero para cada integrante de la pareja;
- dos relaciones de rival por cada cruce;
- una contribución de resultado y games.

Las claves de pareja se normalizarán ordenando ambos `playerProfileId` para evitar duplicar `A+B` y `B+A`.

### Rachas

- Se calculan cronológicamente por fecha efectiva del torneo y orden de ronda/partido.
- Si dos torneos tienen la misma fecha, se usa `createdAt` y luego un identificador estable como desempate.
- Una derrota o empate corta la racha de victorias.
- Un partido incompleto no inicia ni corta rachas.
- Una corrección histórica obliga a reconstruir la racha afectada; no puede resolverse sólo con sumas acumulativas.

### Estadísticas derivadas y reconstrucción

Se recomienda guardar una contribución normalizada por torneo:

```text
statsContributions/{tournamentId}
  sourceRevision
  groupId
  status
  players/{playerProfileId}
    tournaments
    appearances
    played
    wins
    losses
    draws
    gamesFor
    gamesAgainst
    partners/{otherPlayerProfileId}
    opponents/{otherPlayerProfileId}
  chronologicalMatches/{matchId}
```

Los agregados globales y grupales se construyen reemplazando la contribución anterior de ese torneo por la nueva. Nunca se aplica una contribución dos veces. Cada agregado incluirá `statsVersion` y podrá reconstruirse desde torneos válidos.

Las rachas e historiales cronológicos deben reconstruirse desde eventos ordenados, aunque los totales simples puedan actualizarse por diferencias.

## Configuración del grupo

Configuraciones iniciales útiles:

- `membersCanCreateTournaments`, por defecto `false`;
- cantidad habitual de canchas;
- objetivo habitual de games;
- modo habitual de parejas;
- cantidad habitual de rondas;
- nombre o prefijo sugerido para torneos;
- visibilidad, inicialmente fija en `private`;
- zona horaria, usando por defecto la del creador;
- filtro predeterminado de ranking: miembros activos o histórico.

Estas opciones son valores iniciales para un torneo nuevo. Cambiarlas no modifica torneos existentes.

## Modelo de datos propuesto

La forma exacta podrá ajustarse durante la implementación, pero deberá preservar estas responsabilidades y límites de lectura.

```text
groups/{groupId}/public
  schemaVersion
  profile
    name
    description
    avatarUrl
    visibility
  metadata
    status                   # active | archived
    createdAt
    updatedAt
    archivedAt
  settings
    membersCanCreateTournaments
    defaultTournament
      numCourts
      gamesPerSet
      pairingMode
      numRounds
    timezone

groups/{groupId}/_server
  operationReceipts/{operationId}

groupAccess/{groupId}
  ownerUid                   # única fuente autoritativa de propiedad
  members/{uid}
    role                     # admin | member; owner se deriva de ownerUid
    status                   # active | left | removed
    playerProfileId
    joinedAt
    updatedAt
    leftAt
    removedAt
  invitationHashes/{hash}
    type                     # username | link
    targetUid
    role                     # member en v1
    status
    invitedByUid
    expiresAt
    createdAt
  accessRevision
  activity/{activityId}

groupsByUser/{uid}/{groupId}
  role                       # rol efectivo denormalizado para listado
  status
  updatedAt

groupInvitationInbox/{uid}/{invitationId}
  groupId
  groupNameSnapshot
  invitedByNameSnapshot
  expiresAt
  status

groupPlayers/{groupId}/{playerProfileId}
  displayNameSnapshot
  kind                     # registered | provisional
  status                   # active | inactive
  linkedUid
  addedAt
  updatedAt

playerProfiles/{playerProfileId}
  displayName
  ownerUid
  status                   # provisional | linked | merged
  createdAt
  updatedAt

playerProfileByUser/{uid}
  playerProfileId

groupTournamentIndex/{groupId}/{tournamentId}
  tournamentNameSnapshot
  tournamentDate
  status
  updatedAt

playerTournamentIndex/{playerProfileId}/{tournamentId}
  groupId
  tournamentDate
  status
  updatedAt

groupStats/{groupId}
  statsVersion
  sourceRevision
  players/{playerProfileId}

playerStats/{playerProfileId}
  statsVersion
  global
  groups/{groupId}
```

### Extensión del torneo

El documento público del torneo agregará:

```text
tournaments/{tournamentId}/public/metadata
  groupId                  # null o un único grupo
  createdByUid

tournaments/{tournamentId}/public/state
  participantRefs/{localPlayerId}
    playerProfileId
    displayNameSnapshot
    groupMembershipStatusSnapshot
```

`ownerUid` seguirá representando propiedad administrativa del torneo. `createdByUid` permite conservar quién lo creó aunque cambie la propiedad o administración.

En los grupos, en cambio, la propiedad autoritativa vive en `groupAccess/{groupId}/ownerUid`. Cualquier resumen de grupo que incluya el owner será una proyección derivada y deberá actualizarse en la misma operación transaccional.

### Datos privados y públicos

- `groups/{groupId}/public` es “público” sólo dentro del grupo autorizado; no significa acceso anónimo.
- `groupAccess`, hashes, operaciones internas y vínculos sensibles no son legibles directamente por clientes.
- Los índices por usuario exponen sólo datos necesarios para construir “Mis grupos”.
- Los agregados se entregan mediante lecturas filtradas o Functions, nunca mediante acceso global a todos los jugadores.
- Los emails y el directorio de usernames permanecen privados.

## Cloud Functions y dominio confiable

Todas las mutaciones de membresía, identidad, permisos, invitaciones e índices se realizarán en backend. Nombres tentativos:

- `createGroupV1`;
- `updateGroupV1`;
- `archiveGroupV1` / `restoreGroupV1`;
- `createGroupInvitationV1`;
- `acceptGroupInvitationV1`;
- `rejectGroupInvitationV1`;
- `revokeGroupInvitationV1`;
- `addProvisionalGroupPlayerV1`;
- `requestPlayerLinkV1`;
- `approvePlayerLinkV1`;
- `updateGroupMemberRoleV1`;
- `removeGroupMemberV1`;
- `leaveGroupV1`;
- `transferGroupOwnershipV1`;
- `listMyGroupsV1`;
- `getGroupV1`;
- `getGroupStatsV1`;
- `getPlayerStatsV1`;
- extensión de `createTournamentV2` para aceptar `groupId` y participantes estables.

Los nombres finales podrán agruparse, pero cada operación deberá:

- exigir autenticación registrada cuando corresponda;
- validar rol global y rol local por separado;
- validar estado activo de grupo, membresía e invitación;
- usar `operationId` para idempotencia;
- operar transaccionalmente sobre entidad, acceso e índices relacionados;
- rechazar revisiones obsoletas;
- registrar actor, acción, objetivo y timestamp;
- devolver errores de dominio estables sin filtrar datos privados.

## Realtime Database Rules

Las reglas conservarán denegación por defecto.

Se probará como mínimo:

- un usuario no autenticado no puede listar grupos ni perfiles;
- un usuario registrado sólo ve sus invitaciones y grupos activos;
- un miembro no puede leer otro grupo privado;
- un miembro no puede promoverse ni alterar `groupAccess`;
- un admin global sin membresía no puede leer ni administrar un grupo;
- un admin de grupo no puede transferir propiedad ni remover al owner;
- un owner no puede crear un estado sin propietario;
- una invitación vencida, revocada o ya usada no puede aceptarse;
- un token de invitación no puede leerse desde la base;
- un jugador provisional no obtiene permisos de cuenta;
- un exmiembro pierde lectura del contenido nuevo;
- group owner/admin puede administrar torneos del grupo;
- un miembro sólo puede crear torneos si la configuración lo permite;
- el super admin puede intervenir sin convertirse en miembro y la Function registra la acción;
- ningún cliente puede escribir estadísticas agregadas ni índices autoritativos.

Aunque las escrituras principales pasen por Functions, las Rules deben impedir toda escritura directa a nodos derivados o sensibles.

## Experiencia de usuario

### Navegación principal

Agregar una entrada “Mis grupos” con:

- grupos activos;
- grupos archivados;
- invitaciones pendientes;
- botón “Crear grupo”.

La creación de torneo comenzará con una elección explícita:

- “Torneo independiente”;
- uno de los grupos donde el usuario tiene permiso de creación.

### Detalle del grupo

Pestañas recomendadas:

1. **Resumen**: última actividad, próximo acceso rápido y últimos torneos.
2. **Jugadores**: miembros activos, provisionales y exmiembros históricos.
3. **Torneos**: historial ordenado y filtros.
4. **Estadísticas**: ranking y métricas del grupo.
5. **Invitaciones**: visibles para owner/admin.
6. **Configuración**: según permisos.

### Perfil del jugador

- resumen global;
- desglose por grupo;
- historial cronológico;
- parejas y rivales frecuentes;
- visibilidad clara de la cantidad de partidos detrás de cada porcentaje;
- estado de vinculación si todavía es provisional.

### Estados y errores

La interfaz debe explicar:

- por qué una persona no puede crear un torneo;
- que salir no borra su historial;
- que transferir propiedad es obligatorio antes de salir;
- cuándo una invitación venció o fue revocada;
- que una vinculación de jugador necesita aprobación;
- cuándo las estadísticas están recalculándose;
- por qué un torneo incompleto no aporta determinadas métricas.

Todos los flujos deben validarse en celular y admitir reintentos sin duplicar grupos, invitaciones o contribuciones.

## Compatibilidad y migración

### Cuentas actuales

- `superAdmin`, `admin` y usuarios registrados conservan sus roles actuales.
- No se promoverá ninguna cuenta por crear o administrar un grupo.
- Se creará un `playerProfileId` de forma perezosa cuando el usuario use por primera vez funciones deportivas persistentes.
- Los admins actuales podrán crear grupos igual que un usuario común.

### Torneos actuales

- Todo torneo existente se interpreta como independiente con `groupId: null`.
- Sus jugadores locales continúan funcionando sin migración obligatoria.
- No se inferirán perfiles por nombre.
- Los resultados anteriores no aparecerán automáticamente en estadísticas globales.
- Una herramienta de vinculación retroactiva puede diseñarse más adelante con revisión y auditoría.

### Corte de versión

- El schema del torneo se extenderá de forma compatible o mediante una nueva versión explícita.
- Clientes antiguos no deben poder crear torneos de grupo incompletos.
- Functions validarán versión y campos obligatorios.
- El despliegue se ordenará para que backend y reglas acepten primero el estado compatible, luego se publique la interfaz y finalmente se active la funcionalidad.
- Debe existir un feature flag o condición equivalente durante el corte si backend y frontend no pueden desplegarse atómicamente.

### Reconstrucción y rollback

- Los agregados estadísticos deben regenerarse desde torneos fuente.
- Desactivar temporalmente la interfaz de grupos no debe afectar torneos independientes.
- El rollback no eliminará nodos nuevos; una versión anterior simplemente los ignorará.
- Una migración destructiva requerirá respaldo exportable y un plan independiente.

## Etapas de implementación

### 0. Planificación y decisiones finales

Estado: `[~]` En curso.

- `[x]` Documentar alcance, roles, permisos, identidades y estadísticas.
- `[x]` Recomendar grupos privados y un único grupo por torneo.
- `[x]` Recomendar roles locales `owner`, `admin` y `member`.
- `[x]` Recomendar que usuarios comunes puedan crear torneos propios.
- `[x]` Definir el login/alta Google como prerrequisito de grupos.
- `[x]` Confirmar fuera del repositorio el único email autorizado para super admin.
- `[ ]` Confirmar si miembros comunes pueden crear torneos por defecto. Recomendación: no.
- `[ ]` Confirmar el período de vencimiento de invitaciones. Recomendación: siete días.
- `[ ]` Confirmar si exmiembros ven el historial completo anterior. Recomendación: sólo sus estadísticas personales, no el grupo privado.
- `[ ]` Confirmar criterio exacto de “torneo ganado” para cada formato.
- `[ ]` Confirmar si el ranking inicial incluye exmiembros por defecto. Recomendación: sólo activos, con filtro histórico.

Criterio de finalización: decisiones pendientes confirmadas y modelo aprobado antes de implementar datos persistentes.

Commit: `Add groups and statistics implementation plan`.

### 0A. Login público con Google y super admin único

Estado: `[~]` Implementación local completada; falta despliegue y verificación productiva antes de iniciar grupos.

- `[x]` Modelar el UID canónico del único super admin.
- `[x]` Endurecer Functions y Rules para exigir claim y UID canónico.
- `[x]` Mantener el email confirmado únicamente en el secreto backend `SUPER_ADMIN_EMAIL`.
- `[x]` Exigir proveedor Google y email verificado para el bootstrap.
- `[x]` Implementar provisionamiento idempotente de cuentas Google comunes.
- `[x]` Crear perfil `user` sin custom claim global para altas nuevas.
- `[x]` Preservar claims `admin` legítimas al vincular o usar Google.
- `[x]` Resolver colisiones de proveedor sin crear cuentas o perfiles duplicados.
- `[x]` Corregir mensajes y estados de la interfaz para usuarios Google comunes.
- `[ ]` Probar recuperación si cambia el UID de la cuenta super admin.
- `[x]` Probar que otra cuenta con claim obsoleta no puede ejercer super admin.
- `[ ]` Desplegar y verificar con dos cuentas Google distintas.

Criterio de finalización: cualquier usuario puede registrarse o ingresar con Google como `user`, mientras sólo el UID canónico correspondiente a `SUPER_ADMIN_EMAIL` puede ejercer `superAdmin` en Functions y Database Rules.

Commit: `Add public Google sign-in and unique super admin`.

### 1. Dominio de identidades, grupos y permisos

Estado: `[ ]` Pendiente.

- `[ ]` Crear modelos puros para perfil deportivo, grupo, membresía e invitación.
- `[ ]` Definir errores de dominio tipados.
- `[ ]` Implementar matrices de autorización puras y exhaustivas.
- `[ ]` Definir transiciones válidas de membresía y grupo.
- `[ ]` Modelar transferencia de propiedad con exactamente un owner.
- `[ ]` Definir IDs opacos, revisiones y operación idempotente.
- `[ ]` Probar normalización de nombres sin usarla como identidad.

Criterio de finalización: las invariantes pueden probarse sin Firebase ni interfaz.

Commit: `Add group identity and permission domain`.

### 2. Persistencia segura y operaciones de grupo

Estado: `[ ]` Pendiente.

- `[ ]` Crear nodos de grupos, accesos, perfiles e índices.
- `[ ]` Implementar creación, edición, archivo y restauración.
- `[ ]` Implementar transferencia de propiedad, salida y remoción.
- `[ ]` Implementar índices “grupos por usuario” de manera transaccional.
- `[ ]` Incorporar auditoría e idempotencia.
- `[ ]` Agregar Functions y pruebas unitarias/de integración.
- `[ ]` Agregar Rules con denegación por defecto.

Criterio de finalización: backend y emuladores permiten administrar un grupo sin exponer nodos privados ni depender de controles de interfaz.

Commit: `Add secure group lifecycle backend`.

### 3. Invitaciones y plantilla de jugadores

Estado: `[ ]` Pendiente.

- `[ ]` Implementar invitación por username exacto.
- `[ ]` Implementar links hasheados, revocables y con vencimiento.
- `[ ]` Crear bandeja privada de invitaciones.
- `[ ]` Implementar aceptación, rechazo y revocación idempotentes.
- `[ ]` Implementar jugadores provisionales sin cuenta.
- `[ ]` Implementar activación/desactivación de jugadores de plantilla.
- `[ ]` Probar invitaciones simultáneas, duplicadas y vencidas.

Criterio de finalización: un grupo puede construir su plantilla con usuarios y jugadores provisionales sin conceder permisos incorrectos.

Commit: `Add group invitations and reusable roster`.

### 4. Interfaz “Mis grupos” y administración

Estado: `[ ]` Pendiente.

- `[ ]` Crear listado de grupos e invitaciones.
- `[ ]` Crear flujo de alta y edición.
- `[ ]` Crear detalle con resumen, jugadores, torneos, estadísticas y configuración.
- `[ ]` Aplicar controles según rol local.
- `[ ]` Implementar transferencia, salida, remoción y archivo con confirmación.
- `[ ]` Optimizar navegación y controles táctiles para celular.
- `[ ]` Probar estados vacíos, carga, error, reintento y permisos revocados durante la sesión.

Criterio de finalización: cada rol entiende qué puede hacer y todas las prohibiciones también son rechazadas por backend.

Commit: `Add group management experience`.

### 5. Perfiles deportivos y vinculación

Estado: `[ ]` Pendiente.

- `[ ]` Crear perfiles deportivos estables para usuarios y provisionales.
- `[ ]` Crear vínculo único UID ↔ perfil deportivo.
- `[ ]` Implementar solicitud y aprobación de reclamo.
- `[ ]` Añadir auditoría y reversión controlada.
- `[ ]` Resolver la relación con player claims dentro de cada torneo.
- `[ ]` Probar homónimos, renombres, cuentas duplicadas y reclamos concurrentes.

Criterio de finalización: cambiar nombres o vincular una cuenta no altera la identidad histórica ni duplica resultados.

Commit: `Add persistent player identities`.

### 6. Creación de torneos independientes y de grupo

Estado: `[ ]` Pendiente.

- `[ ]` Permitir creación independiente a usuarios registrados activos.
- `[ ]` Extender la creación con `groupId` opcional.
- `[ ]` Validar permiso local y estado del grupo en backend.
- `[ ]` Seleccionar jugadores desde la plantilla activa.
- `[ ]` Guardar participant refs y snapshots.
- `[ ]` Aplicar configuraciones predeterminadas sin vincularlas al torneo después de creado.
- `[ ]` Crear el índice de torneos del grupo transaccionalmente.
- `[ ]` Adaptar administración de torneos a permisos derivados del grupo.
- `[ ]` Mantener compatibilidad con links y torneos independientes existentes.

Criterio de finalización: un torneo de grupo es inequívoco, conserva sus participantes históricos y no puede crearse mediante una membresía insuficiente.

Commit: `Add group-scoped tournament creation`.

### 7. Historial y contribuciones estadísticas

Estado: `[ ]` Pendiente.

- `[ ]` Extraer una contribución normalizada desde cada torneo.
- `[ ]` Usar únicamente partidos completos y scores normalizados.
- `[ ]` Implementar reemplazo idempotente por revisión.
- `[ ]` Crear índices por grupo y perfil deportivo.
- `[ ]` Resolver correcciones, anulaciones, borrado y restauración.
- `[ ]` Implementar reconstrucción completa verificable.
- `[ ]` Comparar agregados incrementales contra recálculo desde cero.

Criterio de finalización: repetir una operación, corregir un score o restaurar un torneo nunca duplica estadísticas.

Commit: `Add rebuildable tournament statistics`.

### 8. Estadísticas globales y por grupo

Estado: `[ ]` Pendiente.

- `[ ]` Implementar métricas básicas, ranking y denominadores.
- `[ ]` Implementar desglose global y por grupo.
- `[ ]` Implementar parejas y rivales frecuentes.
- `[ ]` Implementar rachas cronológicas reconstruibles.
- `[ ]` Mostrar activos e históricos con filtros claros.
- `[ ]` Crear pantallas de estadísticas del grupo y perfil.
- `[ ]` Definir estados de actualización o reconstrucción.
- `[ ]` Validar que un provisional vinculado conserva sus números sin duplicación.

Criterio de finalización: los mismos torneos fuente producen resultados coherentes en la vista del grupo, el perfil global y una reconstrucción independiente.

Commit: `Add group and global player statistics`.

### 9. Seguridad, concurrencia y privacidad

Estado: `[ ]` Pendiente.

- `[ ]` Completar matriz de Rules para todos los roles y estados.
- `[ ]` Probar revocación de permisos con sesiones abiertas.
- `[ ]` Probar carreras de aceptación, transferencia y remoción.
- `[ ]` Agregar rate limits para creación e invitaciones.
- `[ ]` Revisar enumeración de usernames y filtración de emails.
- `[ ]` Revisar logs, exportaciones y mensajes de error.
- `[ ]` Probar intervención auditada de super admin.
- `[ ]` Ejecutar tests integrados de Auth, Functions y Database.

Criterio de finalización: no existe escalamiento de privilegios ni lectura cruzada entre grupos privados, incluso llamando directamente al backend.

Commit: `Harden group security and privacy`.

### 10. Migración compatible y publicación

Estado: `[ ]` Pendiente.

- `[ ]` Probar torneos anteriores sin `groupId` ni participant refs.
- `[ ]` Probar creación perezosa de perfiles deportivos.
- `[ ]` Definir orden exacto de deploy de Functions, Rules y frontend.
- `[ ]` Ejecutar tests completos con Node 22 LTS verificado dentro de los procesos hijos.
- `[ ]` Ejecutar emuladores de Functions, Auth y Database Rules sin errores de puertos.
- `[ ]` Desplegar Functions y Rules y verificar su estado final.
- `[ ]` Publicar GitHub Pages y esperar el workflow exitoso.
- `[ ]` Verificar producción con varias cuentas, grupo privado, invitaciones y torneos.
- `[ ]` Verificar celular y escritorio sin errores de consola.
- `[ ]` Actualizar README y crear un tag estable.

Criterio de finalización: la versión productiva permite completar los flujos críticos y los torneos anteriores continúan funcionando sin cambios.

Commit: `Release groups and player statistics`.

### 11. Funcionalidades posteriores

Estado: `[ ]` Pendiente; fuera del primer lanzamiento.

- `[ ]` Temporadas y rankings por período.
- `[ ]` Convocatorias, asistencia y suplentes.
- `[ ]` Botón “Repetir torneo”.
- `[ ]` Comparación entre jugadores.
- `[ ]` Reconocimientos y logros.
- `[ ]` Ranking Elo evaluado con datos reales.
- `[ ]` Grupos descubribles y solicitudes de ingreso.
- `[ ]` Notificaciones externas.
- `[ ]` Exportación visual y perfiles compartibles.

Cada funcionalidad requerirá su propia definición de privacidad y criterios de aceptación.

## Estrategia de pruebas

### Tests unitarios de dominio

- creación válida de grupo con un único owner;
- normalización y validación de perfil y configuración;
- matriz completa de permisos;
- transiciones de membresía permitidas y prohibidas;
- transferencia atómica de propiedad;
- expiración y revocación de invitaciones;
- identidad provisional y vinculación;
- snapshots de participantes;
- extracción de contribuciones estadísticas;
- ranking, porcentajes, parejas, rivales y rachas;
- terminal blank score y partidos incompletos;
- reconstrucción determinista.

### Tests de Cloud Functions

- alta Google crea exactamente un perfil `user`;
- reingreso Google no sobrescribe el perfil ni duplica identidades;
- bootstrap exige proveedor Google, email verificado, secreto y UID canónico;
- la cuenta configurada en `SUPER_ADMIN_EMAIL` recibe `superAdmin` y otra cuenta Google no;
- una claim `superAdmin` con UID distinto queda sin autorización efectiva;
- un `admin` existente conserva su claim al usar Google vinculado;
- colisión de proveedores no crea un segundo UID silenciosamente;
- autenticación obligatoria;
- rol global separado de rol local;
- admin global sin acceso automático al grupo;
- idempotencia por `operationId`;
- conflictos de revisión;
- aceptación simultánea de invitaciones;
- revocación durante aceptación;
- remoción mientras se crea un torneo;
- corrección de resultado y reemplazo de contribución;
- errores sin filtración de existencia o identidad privada.

### Tests de Firebase Rules

Se cubrirá la matriz de owner, admin de grupo, miembro, exmiembro, invitado, admin global, super admin, participante, espectador, usuario ajeno y sesión anónima para cada ruta legible o escribible.

No se considerará suficiente que la interfaz o los tests unitarios bloqueen una acción. Las pruebas deben demostrar el rechazo real del backend y de Rules Emulator.

### Tests de integración

- crear cuenta → crear grupo → invitar → aceptar → crear torneo → anotar resultados → verificar estadísticas;
- agregar provisional → jugar varios torneos → vincular cuenta → conservar estadísticas;
- salir del grupo → perder acceso → conservar estadísticas personales;
- transferir propiedad → salir owner anterior → mantener grupo administrable;
- borrar/restaurar torneo → retirar/reponer contribución;
- corregir resultado histórico → actualizar ranking y racha;
- archivar/reactivar grupo;
- abrir un torneo anterior independiente.

### Tests de concurrencia

- dos administradores invitan al mismo usuario;
- dos sesiones aceptan el mismo link;
- owner transfiere mientras otro admin remueve al destino;
- miembro es removido mientras crea un torneo;
- dos scores actualizan estadísticas sobre la misma revisión;
- reconstrucción coincide con una mutación en curso;
- retry de Function no duplica actividad ni estadísticas.

### Verificación visual y productiva

- escritorio y celular;
- controles reales de la interfaz, no sólo escritura programática del DOM;
- múltiples sesiones con roles diferentes;
- revocación visible sin recargar cuando sea viable;
- enlaces de invitación vencidos y válidos;
- ausencia de errores de consola;
- estado final de Functions, Rules y GitHub Pages confirmado por separado.

## Riesgos y mitigaciones

### Confundir roles globales y locales

Riesgo: un admin de plataforma obtiene acceso a grupos ajenos o un admin de grupo recibe funciones globales.

Mitigación: helpers de autorización separados, nombres de UI explícitos y matriz de Rules con casos negativos.

### Usar nombres como identidad

Riesgo: homónimos, renombres o errores de tipeo mezclan estadísticas.

Mitigación: `playerProfileId` opaco, snapshots históricos y vinculación confirmada.

### Duplicar estadísticas por retries

Riesgo: una Function reintentada suma dos veces un torneo.

Mitigación: contribución reemplazable por `tournamentId`, `sourceRevision`, receipts idempotentes y reconstrucción comparativa.

### Estadísticas incoherentes después de correcciones

Riesgo: totales se corrigen pero rachas o parejas quedan obsoletas.

Mitigación: contribución normalizada, eventos cronológicos y reconstrucción de métricas no aditivas.

### Perder historia al salir o borrar

Riesgo: eliminar una membresía rompe referencias antiguas.

Mitigación: estados de ciclo de vida, borrado lógico y referencias estables que nunca dependen de la membresía activa.

### Reclamo incorrecto de un jugador provisional

Riesgo: una cuenta se apropia de estadísticas ajenas.

Mitigación: aprobación de owner/admin, unicidad UID-perfil, auditoría y reversión controlada.

### Enumeración de usuarios

Riesgo: búsqueda o invitaciones revelan usernames, emails o pertenencia a grupos.

Mitigación: resolución exacta en Functions, respuestas no enumerables, rate limiting y directorio privado.

### Links filtrados o reutilizados

Riesgo: terceros entran al grupo.

Mitigación: hash, vencimiento, revocación, un solo uso y aceptación autenticada.

### Owner inexistente

Riesgo: el grupo queda sin administración o con dos propietarios.

Mitigación: transferencia transaccional, invariante de exactamente uno y recuperación excepcional por super admin.

### Índices divergentes

Riesgo: “Mis grupos”, historial o estadísticas no reflejan la fuente real.

Mitigación: escrituras multipath transaccionales, revisión de origen, tareas de verificación y reconstrucción.

### Creación abierta y abuso

Riesgo: permitir torneos a usuarios comunes produce spam o costos inesperados.

Mitigación: cuentas verificadas, límites de frecuencia, cuotas razonables y monitoreo antes de abrir visibilidad pública.

### Migración por coincidencia de nombres

Riesgo: intentar sumar torneos anteriores asigna resultados a la persona equivocada.

Mitigación: torneos anteriores permanecen independientes; cualquier vinculación retroactiva será explícita, revisable y fuera del corte inicial.

## Criterios de aceptación

La primera versión se considerará completa cuando:

- cualquier usuario pueda registrarse o iniciar sesión con Google y obtener un perfil común;
- sólo el UID canónico de la cuenta configurada en `SUPER_ADMIN_EMAIL` pueda ejercer `superAdmin`;
- una segunda cuenta Google no reciba errores o mensajes de bootstrap de super admin;
- una cuenta `user` pueda crear un grupo sin convertirse en admin global;
- cada grupo tenga exactamente un owner activo;
- owner, admin y member vean y ejecuten sólo sus acciones permitidas;
- un admin global sin membresía no pueda leer ni modificar un grupo privado;
- el super admin pueda realizar recuperación excepcional auditada;
- se pueda invitar por username y por link vencible sin exponer el directorio;
- un usuario pueda aceptar, rechazar, salir y volver a ser invitado;
- un jugador sin cuenta pueda figurar en la plantilla y acumular historia grupal;
- ese jugador pueda vincularse después con una cuenta sin duplicar resultados;
- se pueda crear un torneo independiente o asociado a un único grupo;
- un torneo de grupo use la plantilla y conserve snapshots estables;
- cambiar la plantilla, los nombres o la membresía no altere torneos históricos;
- los partidos completos alimenten estadísticas globales y del grupo exactamente una vez;
- los partidos incompletos no aporten métricas;
- `4–vacío` compute como `4–0` sólo cuando cuatro sea el objetivo terminal;
- corregir, anular, borrar o restaurar un torneo actualice los agregados correctamente;
- salir o ser removido no borre contribuciones históricas;
- archivar un grupo bloquee actividad nueva pero preserve consulta histórica;
- las estadísticas muestren denominadores y distingan miembros activos de históricos;
- una reconstrucción total coincida con los agregados incrementales;
- Functions y Rules rechacen accesos cruzados y escalamiento de privilegios;
- torneos anteriores continúen funcionando como independientes;
- tests unitarios, Functions, Rules Emulator e integración pasen con Node 22 LTS;
- Functions, Rules y frontend queden desplegados y verificados por separado;
- los flujos críticos funcionen en producción desde escritorio y celular sin errores de consola.

## Decisiones recomendadas

1. Implementar login/registro Google público antes de comenzar grupos.
2. Autorizar como único super admin efectivo al UID canónico de la cuenta confirmada en `SUPER_ADMIN_EMAIL`.
3. Mantener roles globales y locales completamente separados.
4. Usar sólo `owner`, `admin` y `member` dentro de grupos en la primera versión.
5. Permitir que cualquier cuenta registrada cree grupos y torneos independientes.
6. Desactivar por defecto la creación de torneos por miembros comunes.
7. Hacer privados todos los grupos inicialmente.
8. Asociar cada torneo con cero o un grupo y no permitir movimientos posteriores en v1.
9. Introducir un `playerProfileId` estable independiente del nombre y del UID.
10. Permitir jugadores provisionales y vinculación confirmada posterior.
11. Conservar snapshots históricos y estados de membresía en lugar de borrar registros.
12. Mantener resultados como fuente de verdad y estadísticas como agregados reconstruibles.
13. Usar contribuciones por torneo con revisión para tolerar retries y correcciones.
14. No migrar estadísticas anteriores mediante coincidencia automática de nombres.
15. Mantener Elo, temporadas, convocatorias y funciones sociales fuera del primer lanzamiento.
16. Desplegar en etapas compatibles y verificar Functions, Rules, frontend y comportamiento real por separado.

## Orden de implementación recomendado

Primero se completa el login público con Google y se garantiza el super admin único (etapa 0A). Después se cierra el dominio y la seguridad de grupos (etapas 1 y 2). Luego se incorporan invitaciones, plantilla e interfaz básica (etapas 3 y 4). Antes de asociar torneos se resuelve la identidad deportiva estable (etapa 5). Recién después se crean torneos de grupo y su historia (etapa 6), y sobre esa fuente se construyen contribuciones y estadísticas (etapas 7 y 8). El endurecimiento, la migración y la publicación cierran el trabajo (etapas 9 y 10).

No se publicará una interfaz que permita crear grupos antes de que Functions y Rules impidan accesos cruzados. Tampoco se habilitarán estadísticas globales hasta demostrar que una corrección o retry no puede duplicar contribuciones.

## Referencias internas

- `PLAN-LOGIN-USUARIOS.md`: autenticación, roles globales y permisos actuales.
- `PLAN-FIXTURE-BALANCEADO.md`: esquema v2, edición, concurrencia y corte de versión de torneos.
- `functions/src/domain/tournament-v2.js`: fuente autoritativa actual de creación y mutaciones de torneo.
- `functions/src/user-accounts.js`: perfiles de cuentas comunes y usernames.
- `functions/src/tournament-catalog.js`: autorización e historial actual por rol.
- `database.rules.json`: límites actuales de lectura y escritura.
- `src/features/scoring/statistics.js`: métricas actuales dentro de un torneo.
- `src/features/scoring/validation.js`: definición vigente de partido completo y score terminal.
