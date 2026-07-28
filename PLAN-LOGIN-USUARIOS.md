# Plan de autenticación, roles y permisos

Documento de trabajo para incorporar cuentas de usuario y permisos reales al anotador de torneos de pádel.

Este plan **no modifica todavía el funcionamiento de la aplicación**. Define la arquitectura, las decisiones pendientes y etapas pequeñas; cada etapa cerrada deberá incluir su propio commit para que sea sencillo volver atrás.

Runtime de desarrollo: **Node.js 22 LTS**.

## Objetivo

Incorporar cuatro tipos de acceso:

| Rol | Inicio de sesión | Alcance |
| --- | --- | --- |
| Super admin | Google | Administra la plataforma completa, usuarios y todos los torneos. |
| Admin | Email y contraseña | Crea y administra los torneos que creó o que el super admin le asignó. |
| Participante | Link + elección de jugador | Interviene en su torneo como jugador. |
| Espectador | Link | Consulta un torneo sin poder modificarlo. |

La seguridad se aplicará en dos capas: la interfaz ocultará o deshabilitará acciones no permitidas, y las reglas de Firebase impedirán esas escrituras aunque alguien intente manipular la aplicación desde el navegador.

## Estado

- `[x]` Completado
- `[~]` En curso
- `[ ]` Pendiente
- `[!]` Requiere una decisión o una acción del super admin

## Decisiones de arquitectura

### Autenticación y backend confiable

- Firebase Authentication manejará Google y email/contraseña.
- Los participantes y espectadores usarán autenticación anónima automática para poder aplicar reglas de lectura y presencia por dispositivo, sin pedirles una cuenta.
- La creación, edición, listado y eliminación de cuentas de administradores se hará desde **Cloud Functions** con Firebase Admin SDK. Nunca desde el navegador: una credencial de administrador no puede incluirse en GitHub Pages.
- Cloud Functions exige que el proyecto Firebase esté en el plan Blaze para desplegarse en producción. Es un requisito previo a esa etapa, aunque el costo para un uso pequeño puede ser bajo. Ver [Firebase Functions](https://firebase.google.com/docs/functions/get-started) y [Admin SDK para usuarios](https://firebase.google.com/docs/auth/admin/manage-users).

### Modelo de permisos propuesto

- El super admin tendrá una *custom claim* global: `platformRole: "superAdmin"`.
- Los admins serán usuarios de Firebase Auth; cada torneo guardará sus UIDs en `admins/{uid}: true`.
- El creador quedará registrado como `ownerUid` y como admin del torneo.
- Participantes y espectadores no recibirán una custom claim global: su permiso será específico al torneo y al jugador que hayan reclamado.
- Las reglas de Realtime Database consultarán `auth.uid`, `ownerUid`, `admins`, y la identidad/presencia del torneo. Las custom claims complementan estas reglas; no reemplazan los permisos por torneo.

### Separación de identidades

Un usuario de acceso (UID de Firebase) no es necesariamente un jugador del fixture. Un admin puede ser también jugador, y varios dispositivos pueden entrar como espectadores. Se conservará la elección actual de “¿Quién sos?” pero se la vinculará a `auth.uid` y a un claim de jugador por torneo.

### Datos previstos en Realtime Database

Las rutas actuales de estado del torneo se conservarán. Se agregará metadata separada para no romper torneos existentes:

```text
tournaments/{tournamentId}/metadata
  ownerUid
  admins/{uid}: true
  createdAt
  updatedAt
  deletedAt                 # sólo si se elige borrado lógico

tournaments/{tournamentId}/access
  playerClaims/{playerId}/{uid}: { claimedAt, displayName }
  viewers/{uid}: { displayName, role, lastSeenAt }

userProfiles/{uid}
  displayName
  email                     # sólo para usuarios registrados, no espectadores
  role                      # superAdmin o admin; no es fuente única de autorización
  createdAt
  updatedAt
```

No se guardarán contraseñas en Realtime Database ni en GitHub.

## Decisiones que requieren confirmación antes de implementar permisos

### 1. Identidad inicial del super admin `[!]`

La dirección de Gmail del super admin fue confirmada por el super admin y se usará una única vez para asignar, mediante un proceso seguro, la custom claim inicial. No se guarda esa dirección en el código público ni en este documento.

### 2. Edición de parejas por participantes `[!]`

El requerimiento dice que un participante puede corregir parejas de rondas/partidos, pero también que sólo puede cargar resultados de sus partidos. Propuesta segura por defecto:

- un participante puede cambiar parejas únicamente en los partidos en que está asignado;
- puede cargar únicamente el resultado de esos mismos partidos;
- cualquier cambio que afecte otras rondas o a jugadores ajenos requiere un admin.

Si se quiere permitir a cualquier participante modificar **todo** el fixture, se puede hacer, pero ya no habría protección práctica frente a cambios accidentales de otros partidos.

### 3. Eliminación de torneos `[!]`

Propuesta: borrado lógico por defecto (`deletedAt`), invisible para usuarios comunes y recuperable por el super admin. El borrado físico definitivo puede quedar como segunda acción de confirmación.

### 4. Administración de usuarios `[!]`

Propuesta: el super admin crea usuarios de tipo admin con email, contraseña temporal y nombre visible. El usuario cambia luego su contraseña con el flujo estándar de Firebase. También se podrá editar email, nombre, estado (activo/inactivo) y eliminar la cuenta.

## Etapas

### 0. Planificación, respaldo y decisiones

Estado: `[~]` En curso; quedan tres decisiones de producto antes de restringir permisos.

- `[x]` Documentar roles, permisos y alcance.
- `[x]` Documentar la necesidad de Cloud Functions/Admin SDK para gestionar usuarios de manera segura.
- `[x]` Proponer el modelo de datos compatible con torneos existentes.
- `[x]` Confirmar el email de Google del super admin (guardado fuera del repositorio).
- `[ ]` Confirmar el alcance exacto de edición de parejas por participantes.
- `[ ]` Confirmar borrado lógico o físico de torneos.
- `[ ]` Confirmar el procedimiento de contraseñas iniciales de admins.
- `[x]` Crear el tag de respaldo `pre-authentication-roles` previo a la implementación.

Commit: `Add authentication and roles implementation plan`.

### 1. Preparar Firebase Authentication y Cloud Functions

Estado: `[~]` En curso.

- `[x]` Activar Google y Email/Password en Firebase Authentication.
- `[x]` Pasar el proyecto Firebase a Blaze.
- `[ ]` Configurar alertas de presupuesto en Google Cloud.
- `[x]` Inicializar Firebase CLI y Cloud Functions con Node 22.
- `[x]` Agregar emuladores locales de Authentication, Realtime Database y Functions.
- `[x]` Agregar scripts de desarrollo, test y deploy sin afectar GitHub Pages.
- `[x]` Documentar variables de configuración y prohibir secretos en el repositorio.
- `[x]` Validar en local que Authentication, Realtime Database y Functions inician mediante emuladores.

Criterio de finalización: las Functions se ejecutan localmente con emuladores y la aplicación actual sigue funcionando sin cambios de permisos.

Commit: `Prepare Firebase authentication and functions`.

### 2. Base de perfiles, metadata de torneos y migración compatible

Estado: `[x]` Completada.

- `[x]` Crear y probar servicios de modelo para perfiles de usuario y metadata de torneo.
- `[x]` Crear y probar el almacenamiento de metadata que no sobrescribe propietarios existentes.
- `[x]` Crear y probar el modelo compatible de metadata de propietarios y admins por torneo.
- `[x]` Al crear un torneo, registrar `ownerUid`, `admins` y timestamps.
- `[x]` Crear una migración perezosa: un torneo anterior recibe metadata mínima al ser abierto por un super admin.
- `[x]` Definir qué ocurre con torneos existentes que no tienen propietario (Decidido: super admin como administrador).
- `[x]` Agregar tests de compatibilidad con estados y torneos existentes.

Criterio de finalización: ningún link ni estado previo se rompe y los torneos nuevos tienen un propietario inequívoco.

Commit: `Add tournament ownership metadata`.

### 3. Inicio de sesión y experiencia de sesión

Estado: `[x]` Completada.

- `[x]` Crear pantalla/modal de sesión para Google, email/contraseña y cerrar sesión.
- `[x]` Mantener entrada por link como espectador sin exigir una cuenta.
- `[x]` Preparar una sesión que conserva cuentas existentes y usa identidad anónima sólo cuando corresponda.
- `[x]` Mostrar nombre y estado de sesión en la interfaz; el rol se incorpora al bootstrap del super admin.
- `[x]` Manejar errores de credenciales sin revelar información sensible.
- `[x]` Agregar flujo de recuperación de contraseña para admins.
- `[x]` Validar accesibilidad y uso desde celular.

Criterio de finalización: un admin puede iniciar/cerrar sesión y un espectador puede abrir un link sin cuenta.

Commit: `Add Firebase sign-in experience`.

### 4. Bootstrap del super admin y funciones de gestión de usuarios

Estado: `[x]` Completada.

- `[x]` Implementar una Function de bootstrap protegida por el secreto `SUPER_ADMIN_EMAIL`.
- `[x]` Configurar el secreto, desplegar la Function y asignar la custom claim inicial del super admin.
- `[x]` Implementar Functions protegidas para crear, editar, desactivar, eliminar y listar usuarios.
- `[x]` Implementar Functions para restablecer contraseñas o generar un enlace seguro de recuperación.
- `[x]` Crear el panel “Usuarios” exclusivo del super admin.
- `[x]` Registrar en actividad administrativa quién realizó cada cambio.
- `[x]` Agregar pruebas de autorización de cada Function.

Criterio de finalización: sólo el super admin puede administrar cuentas y ninguna operación privilegiada expone credenciales al cliente.

Commit: `Add super admin user management`.

### 5. Administración por torneo e historial segmentado

Estado: `[ ]` Pendiente.

- `[ ]` Crear interfaz para que el super admin agregue o quite admins de un torneo.
- `[ ]` Permitir al admin crear torneos y registrar su propiedad.
- `[ ]` Mostrar al admin sólo sus torneos creados y aquellos asignados explícitamente.
- `[ ]` Mostrar al super admin todos los torneos, incluidos los eliminados lógicamente.
- `[ ]` Implementar eliminación y recuperación de torneos según la decisión aprobada.
- `[ ]` Asegurar que el historial actual no revele torneos de otros admins.

Criterio de finalización: el historial y las acciones administrativas respetan la propiedad y las asignaciones por torneo.

Commit: `Add tournament admin management and scoped history`.

### 6. Presencia, espectadores y asignación de jugador

Estado: `[ ]` Pendiente.

- `[ ]` Asociar presencia a `auth.uid` y no sólo a un identificador del dispositivo.
- `[ ]` Mantener varios dispositivos por persona sin duplicar de forma engañosa la lista de usuarios.
- `[ ]` Mostrar al admin quiénes están conectados o visualizando, con su rol y jugador si corresponde.
- `[ ]` Reemplazar el claim actual por una asignación jugador ↔ UID robusta y exclusiva.
- `[ ]` Permitir entrar explícitamente como espectador.
- `[ ]` Resolver abandono, reconexión y liberación de jugador de forma segura.

Criterio de finalización: el admin ve presencia confiable y un jugador no puede ser reclamado simultáneamente por dos identidades distintas.

Commit: `Add authenticated presence and player claims`.

### 7. Reglas de Firebase y permisos de escritura

Estado: `[ ]` Pendiente.

- `[ ]` Reemplazar la regla actual amplia (`auth != null`) por reglas por ruta y rol.
- `[ ]` Permitir lectura de un torneo a participantes/espectadores autenticados anónimamente mediante el link.
- `[ ]` Permitir configuración, fixture, jugadores, rondas, canchas, actividad y resultados completos a owner/admin/super admin.
- `[ ]` Limitar resultados de participantes a sus partidos.
- `[ ]` Limitar edición de parejas según la decisión de la etapa 0.
- `[ ]` Restringir historial global, metadata, perfiles, presencia y usuarios a quienes corresponda.
- `[ ]` Crear y ejecutar una matriz de pruebas con Firebase Rules Emulator.

Criterio de finalización: cada acción prohibida falla también al llamar directamente a Realtime Database, no sólo al ocultar un botón.

Commit: `Enforce tournament roles in Firebase rules`.

### 8. Interfaz de permisos dentro del torneo

Estado: `[ ]` Pendiente.

- `[ ]` Ocultar o deshabilitar controles según rol y explicar brevemente el motivo.
- `[ ]` Añadir selector de entrada “Jugar como…” / “Entrar como espectador”.
- `[ ]` Mostrar claramente qué jugador tiene asignado el participante.
- `[ ]` Limitar controles de resultados y parejas a los partidos permitidos.
- `[ ]` Añadir panel de personas conectadas para admins.
- `[ ]` Mantener controles táctiles y modales cómodos en celular.

Criterio de finalización: cada rol entiende qué puede hacer sin depender de mensajes de error.

Commit: `Add role-aware tournament interface`.

### 9. Auditoría, pruebas y endurecimiento

Estado: `[ ]` Pendiente.

- `[ ]` Ampliar el historial de actividad con UID, nombre visible, rol y tipo de dispositivo disponible.
- `[ ]` Implementar auditoría de cambios administrativos, asignación de admins y eliminación/restauración de torneos.
- `[ ]` Probar flujos completos de super admin, admin, participante y espectador en sesiones separadas.
- `[ ]` Probar revocación de permisos mientras una sesión sigue abierta.
- `[ ]` Configurar política de contraseñas y protección contra enumeración de emails en Firebase Authentication.
- `[ ]` Revisar que logs, exportaciones y errores no filtren emails o datos de otros usuarios.

Criterio de finalización: los cuatro roles quedan cubiertos por pruebas y las reglas no admiten escalamiento de privilegios.

Commit: `Harden role security and audit logging`.

### 10. Publicación, documentación y respaldo estable

Estado: `[ ]` Pendiente.

- `[ ]` Desplegar Functions y reglas de Firebase en producción.
- `[ ]` Publicar la aplicación en GitHub Pages.
- `[ ]` Actualizar README con uso por rol, despliegue, emuladores y recuperación operativa.
- `[ ]` Documentar cómo asignar un nuevo super admin ante una contingencia.
- `[ ]` Crear un tag estable de la versión con roles.
- `[ ]` Verificar en producción los flujos críticos desde escritorio y celular.

Criterio de finalización: la versión publicada funciona con reglas de producción y existe una recuperación documentada.

Commit: `Document and release role-based access`.

## Orden de implementación recomendado

Primero se implementan las etapas 1 a 4, pero **no se endurecen las reglas** hasta contar con la migración de metadata, inicio de sesión y herramientas de administración. Después se siguen las etapas 5 a 9 y se publica recién al cerrar la validación integral.

## Referencias

- [Firebase Authentication para web](https://firebase.google.com/docs/auth/web/start)
- [Inicio de sesión con email y contraseña](https://firebase.google.com/docs/auth/web/password-auth)
- [Firebase Admin SDK: gestión de usuarios](https://firebase.google.com/docs/auth/admin/manage-users)
- [Cloud Functions for Firebase](https://firebase.google.com/docs/functions/get-started)
