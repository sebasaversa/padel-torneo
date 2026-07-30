# Corte productivo del fixture v2

Este procedimiento es deliberadamente manual: elimina los torneos v1 de la
ruta activa y no debe ejecutarse sin confirmar una ventana de mantenimiento,
el proyecto Firebase exacto y el backup verificado.

Proyecto esperado: `padel-torneo-ec30a`.

## 1. Preparación y mantenimiento

1. Confirmar que `master` apunta al commit aprobado y crear un tag inmutable
   `pre-fixture-v2-cutover`.
2. Publicar primero las Rules v2 para bloquear las escrituras directas de los
   clientes v1. No reabrir la aplicación todavía.
3. Verificar que `npm test`, `npm --prefix functions test`,
   `npm run test:rules` y `npm run build` pasan con Node 22.12 o posterior.

## 2. Backup y verificación

1. Crear un directorio fuera del repositorio para el backup administrativo.
2. Exportar la raíz completa de Realtime Database con Firebase CLI usando
   explícitamente `--project padel-torneo-ec30a`.
3. Guardar fecha UTC, tamaño y SHA-256 del archivo.
4. Abrir el JSON y comprobar que contiene los nodos esperados
   (`tournaments`, acceso, perfiles y actividad).
5. Hacer una segunda copia de sólo `tournaments` para facilitar una
   recuperación manual.

No borrar ningún dato si ambos archivos no son JSON válidos, si están vacíos o
si no se registró su hash.

## 3. Limpieza v1 y despliegue

1. Enumerar los IDs bajo `/tournaments` y clasificar cada torneo por
   `public/schemaVersion`.
2. Detenerse si aparece un torneo v2: desde ese momento ya no es válido volver
   a un release exclusivamente v1.
3. Eliminar de la ruta activa únicamente los torneos sin
   `public/schemaVersion: 2`, junto con sus nodos asociados de acceso y
   presencia. Conservar el backup fuera de la base activa.
4. Desplegar Functions y confirmar que aparecen los callables v2.
5. Desplegar `database.rules.json`.
6. Publicar el cliente v2 desde GitHub Pages mediante el workflow de `master`.

## 4. Smoke test antes de reabrir

Con dos sesiones independientes:

1. crear un torneo rotativo y otro de parejas fijas;
2. abrir el link como espectador y comprobar lectura sin escritura;
3. reclamar un jugador y cargar sólo el score de uno de sus partidos;
4. agregar una ronda desde una sesión admin mientras la otra permanece abierta;
5. provocar un conflicto de revisión y comprobar que no se pierde ningún score;
6. verificar que ni owner, admin ni superadmin pueden escribir directamente
   `public/state` o `public/configuration`;
7. comprobar que un usuario ajeno no puede leer el torneo;
8. revisar consola, actividad, métricas y vista móvil.

Sólo después de completar el smoke test se da por terminada la ventana de
mantenimiento.

## 5. Rollback

- Antes del primer torneo v2: se puede restaurar el tag previo y el backup v1.
- Después del primer torneo v2: usar únicamente un release compatible con
  schema v2 o aplicar un forward-fix. No restaurar el backup v1 sobre la ruta
  activa ni desplegar un cliente v1.
- Conservar Functions, Rules y cliente como una unidad compatible; no revertir
  uno de esos contratos de forma aislada.

