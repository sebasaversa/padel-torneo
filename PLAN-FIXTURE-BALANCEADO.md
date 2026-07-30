# Plan de migración del generador de fixtures balanceados

Documento de trabajo para reemplazar la generación actual de parejas por un
generador global, determinístico y verificable.

Este plan **no modifica todavía el funcionamiento de la aplicación**. Define la
lógica propuesta, las garantías posibles para cada configuración, los tests y
las etapas de implementación.

Runtime de desarrollo: **Node.js 22 LTS**.

## Objetivo

Generar fixtures que, para cualquier combinación válida de jugadores, canchas y
rondas:

- nunca asignen un jugador dos veces dentro de la misma ronda;
- equilibren partidos jugados y descansos;
- permitan elegir entre parejas rotativas y parejas fijas al crear el torneo;
- en modo rotativo, maximicen la cantidad de parejas diferentes y eviten
  repeticiones mientras queden combinaciones nuevas;
- en modo fijo, mantengan cada equipo durante todo el torneo y maximicen la
  variedad de cruces entre equipos;
- distribuyan los rivales, las canchas y los lados de manera equilibrada;
- produzcan siempre el mismo resultado para la misma configuración estructural,
  versión del generador, variante y contexto de generación;
- permitan extender un torneo activo considerando sus rondas y ediciones
  manuales.

Las garantías dependerán de la clase de solución:

- para una entrada `exact`, el generador deberá usar una construcción
  combinatoria validada que garantice las propiedades declaradas;
- para una entrada `optimal-known`, deberá alcanzar exactamente los objetivos
  para los cuales exista un límite inferior y un certificado reproducible;
- para una entrada `optimized`, deberá devolver el mejor fixture encontrado
  dentro de un presupuesto determinístico, sin afirmar optimalidad global.

Toda configuración formalmente válida deberá producir al menos un fixture
estructuralmente válido mediante una construcción segura determinística. Agotar
el presupuesto del optimizador podrá reducir la calidad de una salida
`optimized`, pero no será motivo para dejar una configuración válida sin
fixture. Los errores quedarán reservados para entradas inválidas, cancelación o
fallos de ejecución.

## Estado

- `[x]` Completado
- `[~]` En curso
- `[ ]` Pendiente
- `[!]` Bloqueado o requiere una decisión

Estado inicial de esta migración: `[ ]` Pendiente.

## Alcance

Incluido:

- selección del modo de parejas al crear el torneo;
- configuración de los equipos cuando se eligen parejas fijas;
- generación inicial del fixture;
- regeneración explícita mediante una nueva variante del fixture;
- agregado y eliminación de rondas;
- configuraciones de 4 a 16 jugadores;
- dominio preparado para todas las canchas posibles:
  `C = 1..floor(N / 4)`;
- interfaz inicialmente limitada a dos canchas mediante configuración, no
  mediante restricciones del generador;
- entre 1 y 100 rondas;
- métricas de cobertura y calidad;
- sincronización de fixtures nuevos por Firebase;
- versionado del generador y del catálogo;
- identidad estable de rondas, partidos y operaciones remotas;
- autorización explícita de lectura y escritura;
- tests unitarios, de propiedades, integración y regresión.

La migración será un **corte limpio**: no se conservará compatibilidad con
torneos, fixtures ni archivos exportados por versiones anteriores. Los torneos
anteriores deberán eliminarse, archivarse fuera de la aplicación o reemplazarse
por torneos v2 nuevos; no se regenerarán en el lugar.

Fuera de alcance:

- cambiar las reglas deportivas del sistema de puntuación;
- rediseñar la estructura de un partido más allá de agregar su `matchId`
  estable;
- cambiar la cantidad de jugadores, la cantidad de canchas o el modo de parejas
  después de crear un torneo;
- migrar datos, fixtures o resultados de versiones anteriores;
- mantener compatibilidad con archivos JSON exportados antes de esta migración;
- incorporar una dependencia pesada o un servicio externo para calcular el
  fixture.

## Preparación para más de dos canchas

La primera entrega puede conservar un máximo visible de dos canchas, pero esa
restricción pertenecerá exclusivamente a la interfaz. El dominio se diseñará
desde el inicio para cualquier cantidad válida:

```text
1 <= C <= floor(N / 4)
```

Con el alcance actual de 4 a 16 jugadores, esto significa soportar internamente
hasta cuatro canchas.

Reglas arquitectónicas:

- `generator.js`, el analizador y el optimizador recibirán `numCourts` como
  dato, sin un valor máximo fijo de dos;
- no existirán `pairOne`, `pairTwo`, `pairEight` ni ramas equivalentes según una
  cantidad rígida de partidos;
- una ronda será siempre una colección de `C` partidos;
- toda validación recorrerá `round.matches` y comprobará que su tamaño sea `C`;
- matrices de cancha, métricas y renderizado usarán estructuras dinámicas;
- el dominio validará que `numCourts` esté dentro del rango permitido y
  rechazará el valor si no lo está; no aplicará `min()`, clamping ni otra
  corrección silenciosa;
- el optimizador construirá una ronda agregando partidos disjuntos de forma
  incremental, evitando enumerar de antemano todas las rondas completas;
- los límites de búsqueda podrán depender de `N`, `C` y `R`, pero no cambiarán
  las garantías estructurales;
- Firebase guardará `numCourts` como número sin asumir un máximo de dos.

`numCourts` se elegirá durante la creación y formará parte de la configuración
estructural inmutable. Después de confirmar:

- no se podrá aumentar ni reducir;
- todas las rondas existentes y nuevas usarán exactamente esa cantidad;
- regenerar conservará la misma cantidad;
- para utilizar otra cantidad de canchas se deberá crear otro torneo.

El límite inicial de producto se expresará mediante una configuración de UI,
por ejemplo:

```js
uiMaxCourts: 2
```

No se usará como valor predeterminado ni como límite dentro de
`generateSchedule()`, `normalizeState()` o `validateSchedule()`.

Cuando se decida habilitar más canchas, el cambio debería consistir en:

1. aumentar o eliminar `uiMaxCourts`;
2. validar el layout con más partidos por ronda;
3. ejecutar la matriz ya existente para 3 y 4 canchas;
4. revisar benchmarks del optimizador;
5. publicar sin reescribir el núcleo del fixture.

La ampliación sólo afectará el selector de creación de torneos nuevos. Los
torneos existentes conservarán su `numCourts` original.

## Diagnóstico de la lógica actual

La generación actual se encuentra en
`src/features/fixture/generator.js`.

Para ocho jugadores:

1. `getActivePlayers()` rota la lista completa según el índice de ronda.
2. `pairEight()` combina siempre las mismas posiciones relativas:
   `[0,7]`, `[3,4]`, `[1,6]` y `[2,5]`.
3. Al rotar esas posiciones se recorren solamente dos clases de distancia
   cíclica entre jugadores.
4. Como una pareja no tiene orientación, el patrón vuelve a empezar después de
   cuatro rondas.

En la configuración de 8 jugadores, 7 rondas y 2 canchas:

- la ronda 5 repite las parejas de la ronda 1;
- la ronda 6 repite las parejas de la ronda 2;
- la ronda 7 repite las parejas de la ronda 3;
- sólo aparecen 16 de las 28 parejas posibles.

Los tests actuales verifican que los jugadores sean válidos y no estén
duplicados dentro de una ronda, pero no miden la cobertura ni las repeticiones
entre rondas.

El problema arquitectónico principal es que cada ronda se construye de forma
aislada. La calidad de una ronda depende del historial completo, por lo que el
fixture debe planificarse globalmente o extenderse usando las rondas anteriores
como contexto.

## Modos de parejas

El torneo deberá guardar una estrategia explícita:

```js
pairingMode: 'rotating' | 'fixed'
```

La elección se realizará durante la creación del torneo, antes de generar el
fixture.

### Parejas rotativas

Es el modo desarrollado en el resto de este plan:

- los compañeros cambian entre rondas;
- se maximiza la cantidad de parejas diferentes;
- si la configuración lo permite, cada jugador comparte equipo una vez con
  todos los demás;
- después de completar la cobertura, las repeticiones se distribuyen
  uniformemente.

Texto sugerido para la interfaz:

```text
Parejas rotativas
Los compañeros cambian para que todos jueguen con la mayor variedad posible.
```

Será el valor predeterminado.

### Parejas fijas

Cada jugador pertenece a un único equipo durante todo el torneo:

```js
fixedTeams: [
  { id: 'team-0-3', playerIds: [0, 3] },
  { id: 'team-1-2', playerIds: [1, 2] }
]
```

Reglas:

- `N` debe ser par;
- cada jugador debe aparecer exactamente en un equipo;
- ningún jugador puede aparecer en dos equipos;
- una pareja fija nunca puede separarse dentro de una ronda;
- juegan y descansan los dos integrantes juntos;
- la optimización se realiza sobre cruces entre equipos, descansos, canchas y
  lados;
- repetir compañeros no se considera un defecto: es la definición del modo.

Texto sugerido para la interfaz:

```text
Parejas fijas
Cada equipo se mantiene durante todo el torneo y rota contra los demás.
```

Después de elegir este modo se mostrará un editor de equipos. La propuesta
inicial puede agrupar jugadores consecutivos —1+2, 3+4, etc.—, pero el usuario
podrá reorganizarlos antes de confirmar la creación.

Antes de guardar, `fixedTeams` se convertirá a una representación canónica:

1. validar que todos los valores sean IDs de jugador válidos y que cada jugador
   aparezca exactamente una vez;
2. ordenar de menor a mayor los dos integrantes de cada equipo;
3. ordenar los equipos lexicográficamente por sus integrantes;
4. asignar a cada equipo un ID estable derivado de esos integrantes, por ejemplo
   `team-0-3`;
5. persistir exclusivamente IDs, nunca nombres.

La configuración canónica será la única entrada admitida por el generador, la
sincronización, las reglas y los tests. Los nombres podrán cambiar sin alterar
la identidad de un jugador ni de su equipo.

### Cantidad impar de jugadores en modo fijo

No es posible asignar una pareja fija a todos los jugadores cuando `N` es
impar. No se agregará un jugador comodín porque convertiría el modo fijo en una
variante rotativa difícil de explicar y verificar.

La interfaz deberá:

- deshabilitar “Parejas fijas” cuando `N` sea impar.

Se recomienda la primera opción, acompañada por el mensaje:
```text
Las parejas fijas requieren una cantidad par de jugadores.
```

### Cambio de modo

La elección forma parte de la identidad estructural del torneo:

- durante el asistente de creación se puede alternar entre rotativo y fijo;
- después de confirmar la creación, `pairingMode` queda bloqueado;
- un torneo fijo no puede convertirse en rotativo;
- un torneo rotativo no puede convertirse en fijo;
- para usar otro modo se debe crear un torneo nuevo.

### Bloqueo de cantidad de jugadores

En ambos modos, `numPlayers` queda bloqueado al confirmar la creación:

- no se puede aumentar ni reducir la cantidad de jugadores;
- el control de cantidad quedará en modo sólo lectura;
- cambiar nombres sigue permitido y no se considera cambiar la cantidad;
- cualquier intento de guardar un estado con otro `numPlayers` será rechazado
  por la validación del dominio;
- para utilizar otra cantidad se debe crear un torneo nuevo.

Se considera que el torneo fue creado cuando el usuario confirma la
configuración y se guarda atómicamente su primer fixture. Mientras el asistente
siga en modo borrador, jugadores, cantidad, canchas, modo y equipos fijos pueden
editarse.

### Bloqueo de cantidad de canchas

En ambos modos, `numCourts` queda bloqueado junto con `numPlayers`:

- no se puede cambiar durante un torneo activo, aunque todavía no haya
  resultados;
- agregar rondas reutiliza siempre la cantidad confirmada;
- regenerar una variante no modifica las canchas;
- el control queda en modo sólo lectura después de crear;
- para usar otra cantidad se debe crear un torneo nuevo.

### Operaciones permitidas después de crear

En modo rotativo:

- se pueden cambiar los jugadores asignados a un partido sin puntajes;
- si el cambio desplaza a un jugador que ya estaba activo en otro partido de la
  ronda, ambos partidos se consideran afectados y deben estar sin scores;
- un participante no puede cambiar jugadores;
- los cambios de jugadores o los intercambios entre dos partidos quedan reservados a owner, admin o
  superadmin;
- se pueden modificar las parejas de una ronda sólo cuando todos los partidos
  afectados tienen ambos scores vacíos;
- se pueden agregar rondas;
- se pueden cambiar nombres y resultados;
- un jugador/participante sólo puede cambiar scores en los partidos que tiene asignados;
- se puede cambiar `gamesPerSet` sólo si todavía no existe ningún score cargado;
- se puede regenerar una variante, con confirmación si se perderán resultados;
- no se puede cambiar `numPlayers`, `numCourts` ni `pairingMode`.

En modo fijo:

- `fixedTeams` queda inmutable;
- no se pueden cambiar jugadores asignados a los partidos;
- no se pueden modificar, separar ni reemplazar parejas;
- se pueden agregar rondas, siempre reutilizando los mismos equipos;
- se pueden cambiar nombres y resultados;
- un jugador/participante sólo puede cambiar scores en los partidos que tiene asignados;
- se puede cambiar `gamesPerSet` sólo si todavía no existe ningún score cargado;
- se puede regenerar una variante de cruces sin modificar los equipos;
- no se puede cambiar `numPlayers`, `numCourts` ni `pairingMode`;
- para cambiar una pareja se debe crear un torneo nuevo.

### Límites formales de configuración

La configuración del torneo deberá cumplir:

- `numPlayers` será un entero entre 4 y 16;
- en modo `fixed`, `numPlayers` deberá ser par;
- en modo `rotating`, se permitirán cantidades pares e impares;
- `numCourts` será un entero entre 1 y `floor(numPlayers / 4)`;
- `numRounds` será un entero entre 1 y 100;
- `pairingMode` será exclusivamente `rotating` o `fixed`;
- en modo fijo deberán existir exactamente `numPlayers / 2` equipos;
- cada equipo fijo tendrá exactamente dos IDs de jugador;
- cada jugador deberá aparecer exactamente una vez en `fixedTeams`;
- todos los IDs deberán pertenecer al rango `0..numPlayers - 1`.
- `fixtureGeneratorVersion` y `catalogVersion` serán enteros positivos
  soportados por la aplicación.

`numPlayers`, `numCourts`, `pairingMode`, `fixedTeams`,
`fixtureGeneratorVersion` y `catalogVersion` formarán parte de la configuración
estructural inmutable. La cantidad de rondas pertenecerá al estado mutable
porque podrá incrementarse o reducirse después de crear el torneo.

La UI podrá aplicar límites temporales más restrictivos, como mostrar
inicialmente un máximo de dos canchas, pero esos límites no deberán propagarse
al dominio.

El dominio rechazará valores inválidos. No deberá corregir silenciosamente una
configuración guardada mediante clamping, coerción o normalización. La
canonicalización de `fixedTeams` sólo ordenará una configuración que ya haya
pasado todas las validaciones.

### Límites formales del estado mutable

- `players` tendrá exactamente `numPlayers` elementos;
- cada nombre será un string ya recortado, no vacío y de hasta 60 caracteres;
- `gamesPerSet` será un entero entre 1 y 20;
- cada score será un entero entre 0 (valor default) y `gamesPerSet`;
- `tournamentName` será un string ya recortado de 1 a 100 caracteres;
- `tournamentDate` será `''` o una fecha calendario válida en formato
  `YYYY-MM-DD`;
- `revision`, `scheduleRevision` y `fixtureVariant` serán enteros seguros no
  negativos;
- `operationId` y `creationRequestId` codificarán al menos 128 bits aleatorios
  en formato UUID o base64url y tendrán como máximo 64 caracteres;
- `roundId` y `matchId` serán strings ASCII determinísticos de hasta 96
  caracteres;
- `scheduleFingerprint` será un SHA-256 canónico en hexadecimal o base64url.

La UI podrá recortar texto antes de enviar una mutación, pero el dominio
rechazará un payload remoto no canónico. Ninguna lectura persistida se corregirá
silenciosamente.

## Terminología y métricas

Para este documento:

- `N`: cantidad de jugadores.
- `C`: cantidad efectiva de canchas.
- `R`: cantidad de rondas.
- `T = N / 2`: cantidad de equipos en modo fijo.
- `A = 4 × C`: jugadores activos por ronda.
- `D = N - A`: jugadores que descansan por ronda.
- `S = 2 × C × R`: lugares totales de pareja en el fixture.
- `P = N × (N - 1) / 2`: parejas diferentes posibles.
- `M = C × R`: partidos disponibles.
- `E = T × (T - 1) / 2`: cruces diferentes posibles entre equipos fijos.

Cada partido consume cuatro jugadores, crea dos parejas y genera cuatro cruces
entre rivales.

### Cobertura de parejas rotativas

La cobertura completa requiere, como condición necesaria:

```text
2 × C × R >= N × (N - 1) / 2
```

La cantidad mínima de rondas determinada sólo por capacidad es:

```text
minimumRoundsForPairCapacity = ceil(P / (2 × C))
```

Esta es una cota inferior, no una garantía. Los descansos, la necesidad de
armar partidos completos y la distribución por ronda pueden requerir rondas
adicionales o alguna repetición.

### Cobertura de equipos fijos

En modo fijo, la cobertura completa significa que todos los equipos se
enfrentaron al menos una vez:

```text
C × R >= T × (T - 1) / 2
```

La cota de capacidad es:

```text
minimumRoundsForTeamCoverage = ceil(E / C)
```

También es una condición necesaria y no siempre suficiente. Un equipo no puede
jugar dos veces en la misma ronda, por lo que el solver deberá considerar
simultáneamente capacidad de canchas y descansos.

### Participación

El fixture contiene `4 × C × R` participaciones individuales. La distribución
ideal por jugador es:

```text
floor(4 × C × R / N) o ceil(4 × C × R / N)
```

La diferencia entre el jugador que más juega y el que menos juega debería ser
como máximo uno siempre que la configuración lo permita.

### Calidad de parejas

En modo rotativo se medirán:

- cantidad de parejas diferentes;
- cantidad total de repeticiones, definida como
  `sum(max(0, frecuencia - 1))` para todas las parejas;
- frecuencia máxima de una pareja;
- frecuencia mínima calculada sobre las `P` parejas posibles, incluidas las de
  frecuencia cero;
- diferencia entre la pareja más frecuente y la menos frecuente sobre ese mismo
  universo;
- cantidad de jugadores que todavía no fueron compañeros de cada jugador.

En modo fijo estas métricas se reemplazan por:

- equipos que se enfrentaron al menos una vez;
- cruces de equipos repetidos, definidos como
  `sum(max(0, frecuencia - 1))`;
- frecuencia máxima y mínima sobre los `E` cruces posibles, incluyendo cero;
- partidos y descansos por equipo;
- canchas y lados utilizados por cada equipo.

`side` significará exclusivamente equipo 1 o equipo 2 dentro del partido; el
orden de los dos integrantes dentro de una pareja será un desempate de
presentación y no una dimensión deportiva de calidad.

### Calidad de rivales

Se medirán:

- cantidad de rivales diferentes por jugador;
- frecuencia máxima y mínima de cada par no ordenado de jugadores rivales,
  incluyendo frecuencia cero;
- suma de desviaciones respecto de la frecuencia ideal;
- enfrentamientos consecutivos repetidos.

En modo rotativo, la prioridad de los rivales será menor que la de las parejas.
Nunca se deberá sacrificar una pareja nueva sólo para mejorar un cruce entre
rivales, salvo que la participación o la validez de la ronda lo exijan.

En modo fijo, la variedad de cruces entre equipos será la prioridad principal
después de la validez y el equilibrio de participación.

## Garantías por tipo de configuración

### Clases de solución

La clasificación de la solución estará separada del estado de cobertura:

- `exact`: construcción validada perteneciente a una familia combinatoria con
  garantías demostradas para la combinación concreta de jugadores, canchas y
  rondas;
- `optimal-known`: fixture del catálogo que alcanza un límite inferior
  demostrado para uno o más objetivos identificados explícitamente, aunque no
  se afirme optimalidad para todas las dimensiones de calidad;
- `optimized`: mejor resultado encontrado por el optimizador acotado, sin
  afirmar optimalidad.

La categoría nunca se asignará únicamente por `N`. La clave de catálogo será,
como mínimo:

```text
pairingMode × numPlayers × numCourts × numRounds
    × fixtureGeneratorVersion × catalogVersion
```

`fixtureVariant` no formará parte de la identidad de la entrada: seleccionará
una alternativa dentro del conjunto finito declarado por esa entrada o por el
constructor. Cada entrada publicará `variantCount`. Si no quedan variantes
distintas, la UI deshabilitará la regeneración y la mutación devolverá
`NO_MORE_FIXTURE_VARIANTS` sin modificar el torneo.

Para configuraciones `optimized`, la versión 1 evaluará como máximo ocho
permutaciones determinísticas (`MAX_OPTIMIZED_VARIANTS_V1 = 8`). Sólo contarán
las salidas con JSON distinto; el `variantCount` efectivo será la cantidad de
resultados únicos validados dentro de esas ocho semillas. La semilla es el
índice de variante y nunca provendrá de azar, timestamps o revision.

Cada entrada `optimal-known` deberá incluir:

- fixture o constructor determinístico validado;
- `provenObjectives`, por ejemplo `['partnerRepetitions']`;
- límite inferior usado como prueba para cada objetivo;
- valor alcanzado para cada objetivo probado;
- métricas esperadas;
- referencia o certificado reproducible de la prueba.

Si falta cualquiera de esos elementos, la combinación se clasificará como
`optimized`, aunque produzca un fixture aparentemente perfecto.

La etiqueta `optimal-known` no significará “óptimo en todos los criterios”. En
la primera versión, las entradas 6, 7, 10 y 11 sólo demostrarán optimalidad para
`partnerRepetitions`; participación, rivales, canchas y lados seguirán siendo
métricas validadas contra umbrales, pero no objetivos matemáticamente probados.

### Catálogo rotativo validado

La primera versión deberá contener diseños validados de referencia para
`N = 4..13` y `N = 16`. Las configuraciones de 14 y 15 jugadores quedarán
soportadas por el optimizador hasta disponer de certificados.

Las configuraciones base exactas serán:

| Jugadores | Canchas | Ciclo | Descanso | Garantía |
| ---: | ---: | ---: | ---: | --- |
| 4 | 1 | 3 rondas | Nadie | Cada pareja una vez y cada cruce dos veces. |
| 5 | 1 | 5 rondas | Uno por ronda | Cada pareja una vez y cada cruce dos veces. |
| 8 | 2 | 7 rondas | Nadie | Cada pareja una vez y cada cruce dos veces. |
| 9 | 2 | 9 rondas | Uno por ronda | Cada pareja una vez y cada cruce dos veces. |
| 12 | 3 | 11 rondas | Nadie | Cada pareja una vez y cada cruce dos veces. |
| 13 | 3 | 13 rondas | Uno por ronda | Cada pareja una vez y cada cruce dos veces. |
| 16 | 4 | 15 rondas | Nadie | Cada pareja una vez y cada cruce dos veces. |

Son casos de diseños tipo torneo Whist:

- `N = 4 × C`: todos juegan y el ciclo perfecto tiene `N - 1` rondas.
- `N = 4 × C + 1`: descansa uno por ronda y el ciclo perfecto tiene `N`
  rondas.

También podrán clasificarse como `exact` otras cantidades de canchas o rondas
para esos valores de `N`, pero sólo cuando exista una entrada o constructor
validado para la combinación concreta.

Para las cantidades restantes dentro de `N = 4..12`, el catálogo deberá incluir
como objetivos iniciales:

| Jugadores | Canchas | Rondas de referencia | Clase | Límite inferior de repeticiones |
| ---: | ---: | ---: | --- | ---: |
| 6 | 1 | 8 | `optimal-known` | 1 |
| 7 | 1 | 11 | `optimal-known` | 1 |
| 10 | 2 | 12 | `optimal-known` | 3 |
| 11 | 2 | 14 | `optimal-known` | 1 |

Esos límites se obtienen de `max(0, S - P)`. Para activar cada entrada como
`optimal-known`, el fixture validado deberá cubrir las `P` parejas y alcanzar
exactamente ese límite de `partnerRepetitions`; de lo contrario la etapa del
catálogo permanecerá bloqueada y la combinación se tratará como `optimized`.

Las configuraciones base 13×3×13 y 16×4×15 se incorporarán como `exact`.
También se validarán sus empaquetados físicos 13×1×39, 16×1×60 y 16×2×30,
porque conservan los bloques del diseño y sólo distribuyen menos partidos por
ronda. Las combinaciones de 14 y 15 jugadores, y cualquier otra combinación
sin constructor o certificado concreto, se clasificarán como `optimized`. El
optimizador genérico será el respaldo, pero nunca podrá promover por sí solo una
solución a `exact` u `optimal-known`.

### Menos rondas que el ciclo exacto

Si se piden menos rondas que las necesarias para completar el ciclo:

- se debe usar un prefijo balanceado del diseño;
- no se deben repetir parejas dentro de ese prefijo;
- los descansos parciales deben diferir como máximo en uno;
- la interfaz podrá informar que la cobertura es parcial.

Ejemplo: con 8 jugadores, 2 canchas y 5 rondas hay 20 lugares de pareja. El
fixture deberá contener 20 parejas diferentes, sin repeticiones, aunque todavía
falten 8 de las 28 posibles.

### Más rondas que el ciclo exacto

Después de cubrir todas las parejas, las repeticiones son inevitables.

El generador deberá:

- completar primero el ciclo sin repeticiones;
- comenzar un nuevo ciclo sólo después de terminar el anterior;
- mantener la diferencia entre frecuencias de pareja en cero o uno;
- aplicar una permutación determinística entre ciclos si mejora la variedad de
  rivales, canchas o lados;
- evitar que las primeras rondas del ciclo siguiente reproduzcan exactamente
  los mismos partidos de las rondas inmediatamente anteriores.

Ejemplo: con 8 jugadores, 2 canchas y 9 rondas se completan primero las 7 rondas
perfectas. En las dos rondas adicionales cada jugador tendrá dos parejas
repetidas, distribuidas de manera uniforme.

### Jugadores impares

Una cantidad impar de jugadores no es un error. Se resuelve planificando
descansos.

Los casos `N = 4 × C + 1`, como 5 jugadores en una cancha o 9 jugadores en dos,
son exactos: descansa uno distinto por ronda y cada jugador participa `N - 1`
veces.

Para otras cantidades impares puede haber varios descansos por ronda. La
cobertura completa dependerá de la cantidad de rondas.

Ejemplo con 7 jugadores, 1 cancha y 7 rondas:

```text
lugares de pareja = 2 × 1 × 7 = 14
parejas posibles = 7 × 6 / 2 = 21
```

No es posible cubrir las 21 parejas. El objetivo será utilizar 14 parejas
diferentes, repartir cuatro partidos y tres descansos por jugador, y balancear
los rivales dentro de esa restricción.

### Cantidad impar de rondas

No requiere ningún tratamiento especial. El caso perfecto de 8 jugadores usa
justamente 7 rondas.

La paridad de `R` no determina por sí sola la calidad. El generador deberá
calcular la capacidad, la participación y el estado del ciclo sin asumir que
una cantidad par o impar es mejor.

### Capacidad insuficiente

Cuando `S < P`, la cobertura total es matemáticamente imposible.

Ejemplos con los valores predeterminados actuales:

| Jugadores | Canchas | Rondas | Lugares de pareja | Parejas posibles | Cobertura completa |
| ---: | ---: | ---: | ---: | ---: | --- |
| 6 | 1 | 6 | 12 | 15 | No |
| 7 | 1 | 7 | 14 | 21 | No |
| 8 | 2 | 7 | 28 | 28 | Sí |
| 9 | 2 | 9 | 36 | 36 | Sí |
| 10 | 2 | 10 | 40 | 45 | No |

La aplicación no debe presentar una repetición inevitable como un error del
usuario. Debe generar el mejor fixture posible y, si se incorpora el indicador
de cobertura, informar cuántas rondas hacen falta como cota inferior.

### Capacidad suficiente sin diseño validado

Cuando `S >= P` pero la configuración no coincide con una entrada validada, el
solver intentará cubrir todas las parejas. Como el solver acotado no constituye
una prueba de optimalidad:

- conservará el mejor fixture válido encontrado;
- asignará `solutionClass: 'optimized'`;
- nunca devolverá una ronda inválida;
- expondrá métricas para que los tests y la interfaz no confundan “no
  encontrado” con “matemáticamente imposible”.

### Escenarios con parejas fijas

En modo fijo el problema se transforma en un round-robin de equipos. El objetivo
del ciclo base es que cada equipo se enfrente una vez con todos los demás.

| Jugadores | Equipos | Canchas | Ciclo de referencia | Distribución |
| ---: | ---: | ---: | ---: | --- |
| 4 | 2 | 1 | 1 ronda | Un único cruce. |
| 6 | 3 | 1 | 3 rondas | Un equipo descansa por ronda. |
| 8 | 4 | 2 | 3 rondas | Todos juegan; seis cruces diferentes. |
| 8 | 4 | 1 | 6 rondas | Juegan dos equipos y descansan dos por ronda. |
| 10 | 5 | 2 | 5 rondas | Un equipo descansa por ronda. |
| 12 | 6 | 3 | 5 rondas | Todos juegan; quince cruces diferentes. |
| 14 | 7 | 3 | 7 rondas | Un equipo descansa por ronda. |
| 16 | 8 | 4 | 7 rondas | Todos juegan; veintiocho cruces diferentes. |

Para `T` equipos:

- si `T` es par y hay suficientes canchas, el round-robin clásico usa `T - 1`
  rondas;
- si `T` es impar y hay suficientes canchas, usa `T` rondas y descansa un
  equipo por ronda;
- si hay menos canchas que partidos simultáneos posibles, el solver distribuye
  los `E` cruces en más rondas sin asignar un equipo dos veces en la misma;
- si se solicitan menos rondas que las necesarias, maximiza cruces diferentes;
- si se solicitan más, completa todos los cruces antes de repetirlos y mantiene
  sus frecuencias con diferencia máxima de uno cuando sea posible.

Los dos integrantes de un equipo deben tener siempre exactamente la misma
cantidad de partidos, descansos y asignaciones de cancha.

La clasificación en modo fijo seguirá las mismas reglas formales:

- `exact`: round-robin o empaquetado validado para la combinación concreta de
  equipos, canchas y rondas; puede ser un ciclo completo, un prefijo certificado
  sin repeticiones o una extensión balanceada certificada;
- `optimal-known`: sólo se utilizará si en el futuro se incorpora un límite
  inferior y un certificado para objetivos concretos;
- `optimized`: cualquier configuración fija resuelta por el optimizador sin
  certificado de optimalidad.

Un round-robin completo con capacidad suficiente no se declarará `exact` sólo
por usar el algoritmo circular: el constructor y el empaquetado de partidos en
`C` canchas deberán estar validados para la combinación concreta.

La cantidad recomendada de rondas también dependerá del modo:

- rotativo: se usa el ciclo de compañeros o la mejor cota disponible;
- fijo: se usa la menor cantidad de rondas encontrada para cubrir los `E`
  cruces sin repetir equipos dentro de una ronda;
- si el usuario ya eligió manualmente otra cantidad, se respeta y se informa si
  la cobertura será parcial o extendida.

Por lo tanto, `getNumRounds()` deberá reemplazarse o evolucionar a:

```js
getRecommendedRoundCount(configuration)
```

Ejemplos: 8 jugadores y 2 canchas recomiendan 7 rondas en modo rotativo y 3 en
modo fijo.

## Arquitectura propuesta

### 1. Analizador de configuración

Crear un módulo puro, por ejemplo:

```text
src/features/fixture/analysis.js
```

Responsabilidades:

- validar `N`, `C`, `R` y `pairingMode` sin corregirlos silenciosamente;
- calcular `availableCourts = floor(N / 4)` sin consultar un máximo de UI;
- validar y canonicalizar `fixedTeams` cuando corresponda;
- calcular jugadores activos y descansos;
- calcular `S`, `P`, `M`, `E` y las cotas mínimas aplicables;
- buscar una entrada validada por la clave completa;
- calcular `solutionClass`, `coverageStatus`, `proofStatus` y `cycleStatus` como
  dimensiones independientes;
- calcular las métricas finales de un fixture;
- validar que una solución declarada `exact` u `optimal-known` alcance las
  métricas y la prueba registradas en el catálogo;
- producir un `scheduleFingerprint` canónico para detectar que un score apunta
  a otra generación o asignación;
- validar que las versiones de generador y catálogo estén soportadas.

Interfaz sugerida:

```js
analyzeFixtureRequest({
  configuration,
  numRounds,
  fixtureVariant,
  generationContext
})
analyzeSchedule(schedule, { configuration, numRounds })
validateSchedule(schedule, { configuration, numRounds })
```

En estas APIs, `configuration` será siempre la configuración estructural
inmutable. Los datos mutables necesarios para generar se agruparán en una
solicitud separada:

```js
{
  configuration,
  numRounds,
  fixtureVariant,
  generationContext,
  sourceRevision,
  sourceScheduleRevision
}
```

`sourceRevision` será exclusivamente una precondición de concurrencia y no
participará como semilla ni desempate. Por eso una extensión secuencial mantiene
el mismo resultado aunque cada paso remoto incremente la revisión. Una creación
o regeneración completa usará `generationContext: { type: 'fresh' }`; sólo una
extensión usará `generationContext: { type: 'extension', immutableHistory }`.
El fixture que será reemplazado nunca participará como historial de una
regeneración.

### 2. Esquema v2 y representación normalizada

Las comparaciones deben ser independientes del orden:

```js
pairKey(a, b) // menor ID primero
```

El estado de búsqueda deberá mantener:

```text
partnerCount[a][b]
opponentCount[a][b]
teamOpponentCount[teamA][teamB]
gamesPlayed[player]
rests[player]
consecutiveRests[player]
courtCount[player][court]
sideCount[player][side]
```

La dimensión de `courtCount` dependerá de `C`; no se crearán campos especiales
para cancha 1 y cancha 2.

Un partido candidato se representa con dos parejas:

```js
{
  team1: [a, b],
  team2: [c, d]
}
```

Una ronda contiene exactamente `C` partidos candidatos sin jugadores
repetidos.

El formato final conservará la forma actual y agregará una identidad estable a
cada partido:

```js
{
  id, // roundId determinístico
  matches: [{
    id, // matchId determinístico
    court,
    t1_p1,
    t1_p2,
    t2_p1,
    t2_p2,
    score1: '',
    score2: ''
  }]
}
```

Los IDs se derivarán de la versión del generador, la variante, el índice de
ronda y la cancha. No dependerán de `revision`, timestamps ni datos aleatorios,
para que la extensión directa e incremental produzcan el mismo JSON. Una
operación de score también enviará la firma esperada de los cuatro jugadores y
la revisión del schedule; por eso un ID eventualmente reutilizado no alcanzará
para escribir sobre otra asignación.

`scheduleFingerprint` será SHA-256 de una serialización canónica que incluye
versión, variante, IDs, canchas y los cuatro IDs de jugador de cada partido en
orden. Excluirá nombres, scores, revisiones, actividad y timestamps. Por eso
cambia ante cualquier modificación del fixture y permanece estable al cargar
un resultado o renombrar.

El esquema general evolucionará a la versión 2. La configuración estructural,
la metadata y el estado mutable compartido se guardarán por separado de los
datos privados de acceso e idempotencia:

```js
tournaments/{tournamentId}: {
  public: {
    schemaVersion: 2,
    configuration: {
      numPlayers,
      numCourts,
      pairingMode: 'rotating' | 'fixed',
      fixedTeams: [], // representación canónica; vacío en rotating
      fixtureGeneratorVersion: 1,
      catalogVersion: 1
    },
    metadata: {
      tournamentName,
      tournamentDate,
      ownerUid,
      createdAt,
      updatedAt
    },
    state: {
      players, // exactamente N nombres; el índice es el ID estable
      gamesPerSet,
      numRounds,
      schedule,
      fixtureVariant: 0,
      scheduleRevision: 0,
      scheduleFingerprint,
      revision: 0
    },
    activity
  },
  _server: {
    operationReceipts
  }
}

tournamentAccess/{tournamentId}: {
  members,
  claims,
  invitationHashes,
  accessRevision,
  accessActivity,
  accessOperationReceipts
}
```

`collapsedRounds`, el estado de paneles abiertos y cualquier preferencia visual
serán datos locales por usuario o dispositivo. No se sincronizarán, no
incrementarán `revision` y no formarán parte de una exportación de dominio.

La existencia de `public.configuration` en un torneo v2 confirmado es el
bloqueo. No se usará un booleano mutable `configurationLocked` como fuente de
verdad.

Reglas:

- `schemaVersion` y `configuration` se escriben una sola vez;
- Firebase Rules impedirá cualquier modificación o eliminación directa
  posterior de `configuration`, incluso por owner, admin o superadmin;
- las Cloud Functions repetirán la validación y no confiarán sólo en las Rules;
- `state.players` tendrá exactamente `configuration.numPlayers` strings,
  conservará el orden de IDs y no admitirá inserciones, eliminaciones ni
  reordenamientos;
- cada nombre será un string dentro de los límites de longitud y caracteres que
  defina el dominio; renombrar nunca cambiará un ID;
- `state.numRounds`, `state.schedule`, `state.fixtureVariant`, nombres,
  `gamesPerSet` y resultados podrán mutar sólo mediante las operaciones
  tipadas y según permisos;
- `gamesPerSet` sólo podrá cambiar si todos los scores están vacíos;
- `state.numRounds` será siempre igual a `state.schedule.length`;
- `state.fixtureVariant` y `state.revision` serán enteros seguros no negativos y
  sólo podrán avanzar mediante las mutaciones definidas;
- `state.fixtureVariant` será siempre menor que el `variantCount` efectivo de la
  solicitud;
- `state.scheduleRevision` será un entero seguro no negativo y aumentará en cada
  operación que cambie rondas, partidos o jugadores asignados; renombrar o
  cambiar un score no lo incrementará;
- `state.scheduleFingerprint` se recalculará y validará en toda mutación del
  fixture;
- `state.revision` aumentará en cada mutación remota confirmada de dominio;
- `fixedTeams` canónico será la fuente de verdad del modo fijo y no se inferirá
  desde una ronda;
- los nombres no forman parte del bloqueo: se puede renombrar a una persona sin
  cambiar su ID ni su equipo;
- `clearScores`, regeneración, importación y snapshots remotos pasarán por el
  mismo validador de esquema e invariantes; localStorage y URL/hash sólo podrán
  contener borradores o preferencias locales;
- el undo local se vaciará al confirmar la creación y no podrá restaurar
  snapshots de un torneo compartido; una corrección posterior será siempre una
  nueva mutación remota;
- `operationReceipts` conservará recibos idempotentes acotados por operación,
  no copias completas del estado.

El formato actual de `schedule`, rondas y partidos se conservará salvo por el
`match.id` aditivo requerido para identidad. Esto reduce cambios en renderizado,
scoring y estadísticas. No se ofrecerá compatibilidad con estados, torneos o
exportaciones v1.

### Inventario autoritativo de campos

| Categoría | Campos | Persistencia y mutación |
| --- | --- | --- |
| Configuración estructural | `numPlayers`, `numCourts`, `pairingMode`, `fixedTeams`, versiones | Remota, write-once. |
| Metadata | nombre, fecha, owner y timestamps | Remota; sólo mediante operaciones autorizadas. |
| Dominio mutable | nombres, `gamesPerSet`, rondas, schedule, scores, variantes y revisiones | Remota; sólo mediante Cloud Functions. |
| Acceso privado | `members`, `claims`, hashes de invitación | Raíz separada; escrita por servidor y no legible como parte del fixture. |
| Auditoría | `activity` sanitizada | Remota; legible por miembros y escrita por servidor. |
| Idempotencia privada | `_server.operationReceipts`, recibos de acceso y `creationRequests` | Hijos privados o raíz separada; sólo servidor. |
| UI local | rondas colapsadas, progreso, selección, operación pendiente | Local por dispositivo; nunca se sincroniza como dominio. |
| Derivado | métricas, diagnóstico y estadísticas recalculables | No es fuente de verdad; puede cachearse con fingerprint. |

La representación mínima de acceso será:

```js
members: {
  [uid]: { role: 'spectator' | 'participant' | 'admin' }
},
claims: {
  [playerId]: { uid }
}
```

Owner seguirá identificado exclusivamente en metadata, admins en `members` y
superadmin mediante custom claim de plataforma. Un participante sólo tendrá
permiso sobre un jugador si existe un claim unívoco y vigente. Los tokens de
invitación se persistirán únicamente como hashes del lado servidor, tendrán
propósito y vencimiento, y nunca aparecerán en el estado legible del torneo.

Rules permitirá a un miembro leer `tournaments/{tournamentId}/public` como un
snapshot coherente consultando `tournamentAccess`, pero no concederá lectura al
nodo raíz del torneo ni a `_server`. Tampoco concederá lectura general de
`tournamentAccess` ni `creationRequests`. Una Function podrá devolver al usuario
su propio rol y claim sanitizados. La actividad visible no incluirá tokens,
hashes, emails ni UIDs que no sean necesarios para la interfaz.

Las versiones de generador y catálogo no se actualizarán dentro de un torneo
existente. Cada deployment deberá conservar las implementaciones referenciadas
por torneos activos. Retirar una versión exige que ya no exista ningún torneo
activo que la use; para adoptar otra versión se crea un torneo nuevo.

`creationRequestId` se conservará durante toda la vida de la cuenta creadora.
Los recibos de mutaciones ordinarias tendrán una ventana idempotente publicada,
inicialmente de 30 días. El cliente nunca reintentará automáticamente una
operación después de esa ventana; una corrección tardía requerirá un
`operationId` nuevo y confirmación del usuario.

### 3. Catálogo de diseños validados

Crear un módulo, por ejemplo:

```text
src/features/fixture/validated-designs.js
```

Deberá contener construcciones y fixtures puros, determinísticos y versionados
para las clases `exact` y `optimal-known`. No se dejará la elección abierta
entre “construcción general o catálogo”: la primera entrega utilizará este
catálogo validado.

Cada construcción deberá validarse al inicializarse en desarrollo o mediante
tests:

- todos los jugadores son válidos;
- ningún jugador aparece dos veces por ronda;
- las frecuencias de pareja y rivales coinciden con las métricas declaradas;
- las repeticiones coinciden con el límite inferior registrado;
- los descansos cumplen la dispersión declarada;
- todas las canchas tienen un partido.

Cada entrada tendrá una clave completa, `variantCount`, una o más variantes
determinísticas, `provenObjectives` y metadata de prueba. Los casos `4`, `5`,
`8`, `9`, `12`, `13` y `16` usarán entradas `exact` cuando coincida la
combinación validada; `6`, `7`, `10` y `11` usarán entradas `optimal-known`
para sus configuraciones de referencia. Cualquier combinación sin entrada irá
al optimizador.

El caso de 8 jugadores deberá usar una distribución equivalente a:

| Ronda | Cancha 1 | Cancha 2 |
| ---: | --- | --- |
| 1 | 1+2 vs 3+4 | 5+8 vs 6+7 |
| 2 | 1+3 vs 5+6 | 2+4 vs 7+8 |
| 3 | 1+4 vs 5+7 | 2+3 vs 6+8 |
| 4 | 1+7 vs 2+6 | 3+8 vs 4+5 |
| 5 | 1+8 vs 3+7 | 2+5 vs 4+6 |
| 6 | 1+5 vs 2+8 | 3+6 vs 4+7 |
| 7 | 1+6 vs 4+8 | 2+7 vs 3+5 |

Los números de la tabla son posiciones de jugador y se convertirán a IDs
base cero.

El mismo módulo, o uno separado como
`src/features/fixture/team-round-robin.js`, deberá generar el ciclo de cruces
para parejas fijas. La entrada será la lista validada de equipos, no la lista de
jugadores sueltos.

### 4. Optimizador genérico

Crear un módulo, por ejemplo:

```text
src/features/fixture/optimizer.js
```

No conviene usar búsqueda exhaustiva sin límites para todas las configuraciones.
La propuesta es un algoritmo híbrido:

1. Generar estados candidatos ronda por ronda.
2. Priorizar los jugadores con menos partidos y más tiempo desde su último
   partido.
3. Generar emparejamientos posibles sólo para los mejores conjuntos de
   jugadores activos.
4. Descartar inmediatamente rondas inválidas.
5. Puntuar cada estado parcial con una función lexicográfica.
6. Conservar un ancho de búsqueda limitado (*beam search*).
7. Al terminar, aplicar mejoras locales determinísticas mediante intercambios
   de jugadores, parejas o partidos entre rondas.
8. Validar el fixture antes de devolverlo.

Para más de dos canchas, un candidato de ronda no se generará como una
combinación monolítica. Se agregará un partido por vez, descartando jugadores
ya utilizados y aplicando poda después de cada cancha. Esto evita que el
crecimiento combinatorio de `C` vuelva impracticable el generador.

La búsqueda deberá ser determinística:

- no usar `Math.random()`;
- ordenar jugadores, parejas y candidatos por ID como último desempate;
- no usar orden dependiente de locale, hora, plataforma ni recorrido de claves
  no canonicalizado;
- representar la tupla de costo con enteros para evitar divergencias por punto
  flotante entre runtimes;
- usar límites fijos de estados;
- producir el mismo JSON ante la misma configuración, versiones,
  `fixtureVariant` y contexto de generación;
- construir primero un candidato seguro estructuralmente válido y mejorarlo sin
  perderlo;
- declarar un `variantCount` finito por versión y configuración.

La función de costo deberá respetar este orden:

1. Fixture estructuralmente válido.
2. Diferencia mínima de partidos jugados y descansos.
3. Objetivo principal del modo:
   - rotativo: máxima cantidad de parejas diferentes;
   - fijo: máxima cantidad de cruces diferentes entre equipos.
4. Menor frecuencia máxima del elemento repetido:
   - pareja en modo rotativo;
   - cruce de equipos en modo fijo.
5. Menor cantidad total de repeticiones.
6. Menos descansos consecutivos.
7. Mayor variedad y menor repetición de rivales.
8. Mejor distribución de canchas y lados.

Los criterios se implementarán como una tupla lexicográfica, no como una suma
arbitraria de pesos. Así una mejora pequeña de rivales nunca podrá justificar
una repetición de pareja evitable.

### Ejecución del optimizador y respuesta de la interfaz

Los diseños `exact` u `optimal-known` del catálogo se generarán directamente en
el hilo principal porque su costo es acotado y predecible.

El optimizador genérico puede evaluar una cantidad elevada de candidatos. Para
evitar que la aplicación deje de responder, deberá ejecutarse dentro de un Web
Worker. Durante la generación, la interfaz deberá continuar permitiendo
renderizado, animaciones, cancelación y recepción de actualizaciones remotas.

El Worker deberá:

- recibir datos serializables, sin referencias al DOM ni al estado mutable;
- aplicar un presupuesto determinístico de estados y operaciones;
- informar progreso de forma acotada;
- aceptar una señal de cancelación;
- descartar su respuesta si cambió la revisión, configuración o variante que
  originó el trabajo;
- devolver el mejor fixture válido confirmado dentro del presupuesto; si no
  logra mejorar el candidato seguro, devolver ese candidato con
  `fallbackUsed: true`;
- devolver error tipado sólo por entrada inválida, cancelación o fallo de
  ejecución; agotar el presupuesto no será un error de dominio;
- terminarse y liberarse al cancelar, cambiar de torneo o cerrar la sesión.

El núcleo del generador será un módulo puro compartido por navegador, Worker y
Cloud Functions. El servidor será la única autoridad sobre el fixture
persistido:

```text
UI
    -> ejecuta el núcleo en Worker para progreso y previsualización
    -> envía sólo request, expectedRevision y operationId
Cloud Function
    -> valida request, versión, permisos e idempotencia
    -> ejecuta el mismo núcleo de forma autoritativa
    -> valida schedule, métricas y fingerprint
    -> confirma por transacción si la revisión sigue vigente
UI
    -> reemplaza la previsualización por la respuesta confirmada
```

El servidor no aceptará como verdad un schedule ni métricas calculados por el
cliente. Podrá usar un caché por fingerprint exacto de la solicitud para evitar
trabajo repetido, pero nunca una propuesta no verificada. Las salidas del Worker
y de la Function deberán ser byte a byte iguales para la misma versión y
solicitud; una diferencia se tratará como error de despliegue
`GENERATOR_VERSION_MISMATCH`.

En Functions el optimizador se ejecutará fuera del callback de la transacción.
Después se abrirá una transacción corta que vuelve a verificar
`expectedRevision`, aplica el resultado ya validado y registra actividad. Si la
revisión cambió durante el cálculo, se descartará el resultado sin escribir.

Cancelar será posible durante la previsualización local. Después de confirmar y
enviar una mutación autoritativa, la UI no prometerá cancelarla: mostrará estado
pendiente hasta recibir commit, conflicto o error. Cerrar la pestaña tampoco
impedirá que una Function ya aceptada confirme la operación. `operationId`
permitirá recuperar su resultado al volver a abrir.

### 5. Orquestador del generador

`src/features/fixture/generator.js` seguirá siendo la API pública del dominio,
pero `generateSchedule()` deberá planificar el conjunto completo.

Flujo:

```text
request de generación
    -> selección de pairingMode
    -> validación de fixedTeams, si corresponde
    -> análisis de factibilidad
    -> catálogo validado o round-robin de equipos
    -> optimizador genérico en Web Worker, en los demás casos
    -> validación estructural
    -> análisis de calidad
    -> schedule en el formato actual
```

`createAutomaticRound(numPlayers, roundIndex, requestedCourts)` no tiene
contexto suficiente para optimizar una ronda agregada. Se deberá:

- reemplazar su uso para extensiones por una función que reciba el fixture
  existente; o
- hacer que seleccione la ronda desde un ciclo completo ya generado.

Interfaz sugerida:

```js
generateSchedule({
  configuration,
  numRounds,
  fixtureVariant,
  generationContext: { type: 'fresh' }
})

extendScheduleSequentially({
  immutableHistory,
  targetCount,
  configuration,
  fixtureVariant,
  sourceRevision,
  sourceScheduleRevision
})
```

La extensión tendrá un contrato estrictamente secuencial. Para pasar de `R` a
`R + K`, `extendScheduleSequentially()` ejecutará exactamente `K` pasos de una
ronda. Cada paso:

1. analiza el prefijo real, incluidas ediciones manuales y resultados;
2. genera y valida una sola ronda nueva;
3. incorpora esa ronda al historial usado por el paso siguiente;
4. no modifica ningún byte de las rondas anteriores.

El optimizador recibirá el prefijo como `immutableHistory`, separado del sufijo
candidato. Las mejoras locales sólo podrán operar sobre rondas creadas dentro
del paso actual; intentar intercambiar elementos con el prefijo será un error
del dominio.

Por definición, extender directamente hasta `R + K` deberá producir el mismo
JSON que invocar la extensión de una ronda `K` veces sobre el mismo estado
inicial, variante y revisión. No se realizará una optimización conjunta del
sufijo que pueda cambiar decisiones anteriores.

### 6. Diagnóstico obligatorio del dominio y opcional en la interfaz

Los campos de diagnóstico usarán enums cerrados:

```text
solutionClass: exact | optimal-known | optimized
coverageStatus: impossible-by-capacity | partial | complete
proofStatus: catalog-verified | constructor-verified |
             lower-bound-certified | heuristic-only
cycleStatus: partial | complete | extended | not-applicable
fallbackUsed: boolean
```

Relaciones obligatorias:

- `exact` requiere `catalog-verified` o `constructor-verified`;
- `optimal-known` requiere `lower-bound-certified` y
  `provenObjectives.length > 0`;
- `optimized` usa `heuristic-only`;
- `coverageStatus: complete` sólo describe cobertura observada y no promueve la
  clase de solución;
- `fallbackUsed: true` sólo es válido con `solutionClass: optimized`.

El dominio deberá devolver o calcular información como:

```js
{
  pairingMode: 'rotating',
  solutionClass: 'exact',
  coverageStatus: 'complete',
  proofStatus: 'catalog-verified',
  provenObjectives: ['partnerCoverage', 'partnerRepetitions'],
  cycleStatus: 'complete',
  fallbackUsed: false,
  fixtureVariant: 0,
  uniquePartners: 28,
  possiblePartners: 28,
  partnerSlots: 28,
  repeatedPartners: 0,
  minimumRoundsForPairCapacity: 7,
  gamesSpread: 0,
  restsSpread: 0
}
```

En modo fijo el diagnóstico equivalente será:

```js
{
  pairingMode: 'fixed',
  solutionClass: 'exact',
  coverageStatus: 'complete',
  proofStatus: 'constructor-verified',
  provenObjectives: ['teamMatchupCoverage', 'teamMatchupRepetitions'],
  cycleStatus: 'complete',
  fallbackUsed: false,
  fixtureVariant: 0,
  uniqueTeamMatchups: 6,
  possibleTeamMatchups: 6,
  repeatedTeamMatchups: 0,
  gamesSpread: 0,
  restsSpread: 0
}
```

Una mejora posterior de la interfaz podría mostrar:

```text
28 de 28 parejas cubiertas · distribución perfecta
```

o:

```text
40 de 45 parejas posibles · se necesitan al menos 12 rondas para cubrir todas
```

Para parejas fijas:

```text
6 de 6 cruces entre equipos · todos contra todos completo
```

Mostrar el indicador no es requisito para reemplazar el generador, pero producir
y verificar las métricas sí es obligatorio.

### Errores de dominio tipados

Las capas compartirán un conjunto cerrado de códigos, sin depender del texto
traducido:

```text
INVALID_CONFIGURATION
INVALID_STATE
UNSUPPORTED_SCHEMA_VERSION
UNSUPPORTED_GENERATOR_VERSION
GENERATOR_VERSION_MISMATCH
FORBIDDEN
NOT_FOUND
REVISION_CONFLICT
SCHEDULE_IDENTITY_MISMATCH
HAS_RECORDED_SCORES
NO_MORE_FIXTURE_VARIANTS
IDEMPOTENCY_KEY_REUSED
GENERATION_CANCELLED
GENERATION_RUNTIME_FAILURE
```

Cada error indicará si es reintentable. Conflictos nunca se reintentarán sin
leer el estado nuevo; validación y permisos no se reintentarán; fallos
transitorios podrán reintentarse con el mismo `operationId`.

## Corte de versión y comportamiento de la aplicación

### Datos anteriores al despliegue

No habrá una migración de compatibilidad. Los torneos anteriores se eliminarán
o reemplazarán por torneos v2 nuevos y toda la validación se concentrará en
torneos creados con la nueva versión.

Todo torneo, estado local, hash, importación o snapshot remoto sin
`schemaVersion: 2` será rechazado explícitamente. No se completarán campos
faltantes con defaults porque eso podría convertir un torneo anterior en un
torneo v2 desbloqueado.

Antes del corte se generará un backup administrativo fuera de la aplicación y
se eliminarán de la base activa todos los torneos v1. El backup será sólo para
recuperación manual; ninguna versión productiva v2 intentará leerlo o migrarlo.

El deployment se realizará con una ventana de mantenimiento:

1. bloquear temporalmente nuevas escrituras del cliente v1;
2. crear y verificar el backup;
3. eliminar o archivar fuera de la ruta activa los datos v1;
4. desplegar Functions v2 y sus validadores;
5. desplegar Rules v2, que niegan escrituras directas de dominio;
6. desplegar el cliente v2;
7. ejecutar un smoke test de creación, score, extensión y lectura con roles;
8. reabrir la aplicación.

Antes de crear el primer torneo v2 todavía será posible volver al release v1.
Después de aceptar datos v2, un rollback sólo podrá apuntar a un artefacto que
entienda schema v2; volver a un cliente exclusivamente v1 queda prohibido. Ante
un defecto posterior al corte se aplicará un forward-fix o el último release
v2-compatible.

### Creación del torneo

El flujo de creación deberá pedir, antes de generar las rondas:

1. cantidad y nombres de jugadores;
2. tipo de parejas: rotativas o fijas;
3. composición de equipos, sólo para parejas fijas;
4. cantidad de canchas y rondas, con recomendación según el modo;
5. confirmación y generación.

La creación no podrá continuar si la configuración viola cualquiera de los
límites formales. En modo fijo también se rechazará si:

- la cantidad de jugadores es impar;
- falta un jugador en `fixedTeams`;
- un jugador aparece más de una vez;
- un equipo no tiene exactamente dos integrantes.

Después de validar y canonicalizar la configuración, el servidor deberá crear
el torneo mediante una única operación atómica que escriba:

- metadata inicial con owner;
- `schemaVersion: 2`;
- `configuration` completa e inmutable;
- `state` con nombres, `gamesPerSet`, rondas, schedule,
  `fixtureVariant: 0`, `scheduleRevision: 0`, fingerprint y `revision: 0`;
- `tournamentAccess` con membresía inicial y claims;
- recibo permanente de `creationRequestId`;
- actividad inicial y timestamp, cuando corresponda.

No existirá un estado remoto intermedio sin fixture ni una ventana con
configuración desbloqueada. La escritura se implementará mediante una Cloud
Function y una transacción o actualización multipath atómica. Rules bloqueará
los intentos directos del cliente, mientras la Function aplicará
autoritativamente permisos e invariantes. Si cualquier validación o escritura
falla, no se creará ninguna parte del torneo.

La solicitud incluirá un `creationRequestId` criptográficamente aleatorio y
estable durante retries. El servidor mantendrá de forma atómica:

```text
creationRequests/{ownerUid}/{creationRequestId} -> tournamentId
```

Si recibe nuevamente una solicitud idéntica, devolverá el mismo torneo. Si el
mismo ID llega con un payload diferente, rechazará con
`IDEMPOTENCY_KEY_REUSED`. Un doble clic, retry de red o timeout no podrá crear
dos torneos.

La Function recibirá la configuración y la intención, no un schedule
autoritativo del cliente. Ejecutará la versión inmutable del generador indicada
en `configuration`, validará el resultado y recién entonces realizará la
escritura atómica.

### Regeneración

El nuevo algoritmo se aplicará cuando:

- se crea un torneo;
- se reinicia el fixture conservando su configuración estructural;
- el usuario confirma “Regenerar fixture”;
- se crea un torneo compartido nuevo y se inicializa su fixture sin resultados.

No se podrá regenerar como consecuencia de cambiar canchas porque `numCourts`
es inmutable. Las confirmaciones para no perder resultados de un torneo activo
deberán conservarse.

Cada regeneración explícita:

1. recibe `operationId`, `expectedRevision` y `expectedScheduleRevision`;
2. busca la siguiente variante disponible y distinta;
3. genera en el servidor con `generationContext: { type: 'fresh' }`;
4. valida estructura, métricas, equipos, IDs y fingerprint;
5. reemplaza schedule, limpia resultados y aumenta `fixtureVariant`,
   `scheduleRevision` y `revision` dentro de una única transacción;
6. falla con conflicto si el estado remoto cambió durante el cálculo.

Dos generaciones con la misma configuración, versiones, cantidad de rondas y
`fixtureVariant` producirán exactamente el mismo JSON. El schedule anterior no
forma parte de esa entrada. Una variante nueva deberá seleccionar una
alternativa determinística distinta. En modo rotativo podrá cambiar
asignaciones y parejas; en modo fijo sólo podrá cambiar orden, cancha o lado de
los mismos cruces y nunca la composición de `fixedTeams`.

El diagnóstico expondrá `variantCount` y la UI deshabilitará la acción cuando
no haya otra variante distinta. Si no puede producirse un JSON distinto y
válido, la operación fallará con `NO_MORE_FIXTURE_VARIANTS` sin incrementar
ninguna revisión ni modificar el estado. No se presentará como una regeneración
exitosa un fixture idéntico.

“Reiniciar” no volverá a abrir la configuración estructural: conservará
`numPlayers`, `numCourts`, `pairingMode` y, en modo fijo, `fixedTeams`. La única
forma de cambiar esos valores será crear otro torneo.

### Cambio de cantidad de rondas

- Al reducir rondas sólo se podrán eliminar rondas finales.
- Una ronda se considera que tiene resultados si cualquier score es distinto de
  cadena vacía; no se usará `isMatchDone` para esta decisión.
- Si las rondas afectadas no tienen resultados, se eliminarán después de la
  confirmación normal del cambio.
- Si cualquiera tiene un score cargado, se mostrará una confirmación reforzada
  indicando que se eliminarán resultados y cambiarán las métricas. Sólo una
  confirmación explícita permitirá continuar.
- Al agregar rondas no se deberán modificar las rondas anteriores.
- Las rondas nuevas deberán optimizarse considerando las ediciones manuales y
  resultados existentes.
- Toda extensión usará `extendScheduleSequentially()`: extender directamente
  hasta el mismo total ejecutará internamente los mismos pasos de una ronda y
  producirá exactamente el mismo JSON que agregarlas una por una.
- La mutación completa se confirmará contra la `revision` de origen para no
  pisar resultados o ediciones remotas.

### Ediciones manuales

Una edición manual puede romper la perfección del diseño. No se intentará
reordenar silenciosamente rondas ya editadas.

En modo rotativo:

- antes de mutar se calculará `affectedMatches`: el partido destino y, si el
  jugador seleccionado ya estaba activo, el partido de origen;
- sólo se podrá cambiar un jugador o pareja si los dos scores de todos los
  partidos afectados están vacíos;
 - Una edición manual sólo puede modificar asignaciones de la ronda seleccionada. Nunca modificará partidos de otras rondas, tengan o no resultados.
El partido elegido deberá tener ambos scores vacíos.
Si el jugador seleccionado estaba descansando, sólo se modificará el partido elegido.
Si ya estaba asignado a otro partido de la misma ronda, se realizará un intercambio entre ambos partidos y los dos deberán tener sus scores vacíos.
Si cualquiera de esos partidos tiene algún score, el cambio completo será rechazado.
Los partidos ya jugados de rondas anteriores permanecerán inmutables.
Los puntos de cada jugador en partidos previos ya jugados, permanecen inmutables.
- un participante sólo podrá anotar puntos en un partido propio; no podrá alterar directa ni indirectamente otro
  partido;
- owner, admin y superadmin podrán intercambiar jugadores entre partidos de la
  misma ronda si todos los partidos afectados están sin scores;
- la restricción se aplicará en UI y dominio, y la Cloud Function será la
  autoridad semántica; Firebase Rules negará la escritura directa completa;
- si cualquier partido afectado tiene al menos un score no vacío, o el actor no
  tiene permiso sobre todo el conjunto afectado, el cambio se rechazará sin
  alterar fixture, resultado, estadísticas ni actividad;
- una mutación aceptada incrementará `scheduleRevision`, recalculará el
  fingerprint e invalidará cualquier score request preparado contra la
  asignación anterior;
- al extender el torneo:
  - el analizador tomará esas parejas como historial real;
  - las rondas nuevas intentarán compensar la repetición;
  - el fixture seguirá siendo válido aunque ya no pueda clasificarse como
    exacto.

En modo fijo:

- `canEditPairing()` devolverá siempre `false`;
- `canEditScore()` seguirá evaluándose de forma independiente y permitirá
  cargar resultados según el rol;
- los selectores individuales quedarán deshabilitados sin deshabilitar los
  controles de puntaje;
- tampoco se podrá reemplazar un equipo completo dentro de una ronda;
- `fixedTeams` no tendrá editor después de confirmar la creación;
- extender o regenerar deberá validar que todos los partidos usen exactamente
  los equipos originales;
- cambiar una pareja exige crear un torneo nuevo.

La UI no reutilizará una única bandera `editable` para pairing y scoring. Como
mínimo deberá distinguir:

```js
canEditPairing(context)
canEditScore(context)
canEditTournamentConfiguration(context)
canChangeRoundCount(context)
canRegenerateFixture(context)
canChangeGamesPerSet(context)
canEditTournamentMetadata(context)
```

### Modelo explícito de permisos

Owner, admin y superadmin compartirán los permisos funcionales sobre el fixture.
Ser superadmin no permitirá modificar la configuración estructural inmutable.

Un usuario autenticado ajeno al torneo no tendrá acceso implícito. El link
compartido contendrá un token de invitación opaco; `joinTournament` lo validará
y registrará al usuario como `spectator` o `participant` antes de que las Rules
permitan la lectura. Conocer o adivinar un `tournamentId` no será autorización.
Los usuarios anónimos tampoco podrán leer.

| Acción después de crear | Espectador | Participante | Owner/Admin/Superadmin | Restricción |
| --- | --- | --- | --- | --- |
| Ver fixture y métricas | Sí | Sí | Sí | Debe ser miembro autorizado. |
| Cargar resultado | No | Sólo en partido propio | En cualquier partido | Ambos modos. |
| Corregir pareja con jugador descansando | No | Sólo en partido propio | Sí | Sólo `rotating`, todos los afectados sin scores. |
| Intercambiar jugadores entre partidos | No | No | Sí | Sólo `rotating`, ambos partidos sin scores. |
| Cambiar nombres | No | Sólo nombre propio        | Sí | Ambos modos. |
| Cambiar `gamesPerSet` | No | No | Sí | Sólo si no existe ningún score. |
| Cambiar nombre o fecha del torneo | No | No | Sí | Ambos modos. |
| Agregar o reducir rondas | No | No | Sí | Ambos modos. |
| Regenerar una variante | No | No | Sí | Ambos modos y si queda una variante distinta. |
| Borrar resultados | No | Sólo en partido propio | Sí | Confirmación explícita. |
| Invitar o cambiar rol de miembros | No | No | Sí | No puede alterar owner ni custom claims. |
| Eliminar torneo | No | No | Sólo owner/superadmin | Admin común no puede eliminarlo. |
| Cambiar `numPlayers` | No | No | No | Inmutable. |
| Cambiar `numCourts` | No | No | No | Inmutable. |
| Cambiar `pairingMode` | No | No | No | Inmutable. |
| Cambiar `fixedTeams` | No | No | No | Inmutable. |

La misma matriz deberá cumplirse en los controles de UI, las funciones de
dominio y las Cloud Functions. Firebase Rules no intentará reproducir la lógica
combinatoria: negará toda escritura directa sobre configuración, metadata de
dominio, estado, schedule, scores, revisión, acceso privado, actividad y
recibos, incluso para owner, admin o superadmin. Sólo las Functions podrán
persistir mutaciones.

En particular, `updateParticipantPairing` rechazará siempre modo fijo, cualquier
partido afectado con al menos un score no vacío y todo intento de desplazar a un
jugador activo en otro partido. `updateParticipantScore` seguirá disponible en
ambos modos.

### Sincronización transaccional y resolución de conflictos

La sincronización v2 no escribirá el objeto `state` completo desde el cliente
mediante last-write-wins. Toda mutación remota tendrá un tipo explícito y se
aplicará sobre el estado más reciente:

- `updateScore`;
- `updateRotatingPairing`;
- `renamePlayer`;
- `updateGamesPerSet`;
- `updateTournamentMetadata`;
- `changeRoundCount`;
- `regenerateFixture`;
- `clearScores`.

Acceso y ciclo de vida usarán comandos separados:

- `joinTournament`;
- `updateMemberRole`;
- `revokeMember`;
- `deleteTournament`.

`resetFixture` no será una operación ambigua: regenerar se realizará mediante
`regenerateFixture` y borrar solamente resultados mediante `clearScores`. No
habrá una escritura genérica de “estado restaurado”.

Toda mutación de dominio, incluidos scores y metadata, recibirá:

```js
{
  operationId,
  expectedRevision,
  type,
  payload
}
```

Las operaciones que dependan de un partido o fixture también recibirán
`expectedScheduleRevision`, `roundId`, `matchId`,
`expectedPlayerIds` y `expectedScheduleFingerprint`. Una Cloud Function
ejecutará una transacción que:

1. vuelve a validar permisos, esquema y configuración inmutable;
2. busca un recibo previo para `operationId`;
3. si existe con el mismo payload, devuelve el resultado anterior sin volver a
   mutar; si el payload difiere, rechaza el reuso;
4. verifica que `state.revision === expectedRevision`;
5. cuando corresponda, verifica revisión, fingerprint, IDs y jugadores
   esperados del schedule;
6. aplica únicamente la operación solicitada sobre el estado actual;
7. valida el estado y el schedule resultantes;
8. incrementa `revision` exactamente una vez y `scheduleRevision` sólo cuando
   cambió el fixture;
9. actualiza estado, fingerprint, timestamp, actividad y recibo idempotente de
   manera atómica.

El callback transaccional será puro y repetible: no generará IDs, no enviará
notificaciones y no realizará efectos externos. `operationId` determinará el ID
estable de la actividad. Cualquier efecto posterior se disparará desde el
commit confirmado y también se deduplicará por ese ID.

La transacción de dominio se ejecutará sobre
`tournaments/{tournamentId}` para poder confirmar conjuntamente estado,
metadata, actividad y `_server.operationReceipts`. El cliente no tendrá lectura
del nodo raíz ni del hijo `_server`; escuchará un único snapshot coherente del
hijo `public`.

Las operaciones de acceso se transaccionarán sobre
`tournamentAccess/{tournamentId}` y usarán `expectedAccessRevision`,
`accessOperationReceipts` y auditoría privada. No incrementarán la revisión del
fixture. `joinTournament` será idempotente por usuario y token. Una notificación
visible de acceso, si se decide mostrarla, será una proyección posterior
idempotente y no fuente de verdad.

Eliminar un torneo será una operación especial de owner o superadmin:

1. crea un tombstone idempotente y bloquea nuevas mutaciones;
2. elimina mediante update multipath torneo, acceso e índices;
3. conserva fuera de esas rutas el recibo mínimo de eliminación;
4. un retry completa los paths faltantes en lugar de revivir datos.

Los scores nunca se escribirán por índice. Una solicitud típica será:

```js
{
  operationId,
  expectedRevision,
  expectedScheduleRevision,
  expectedScheduleFingerprint,
  roundId,
  matchId,
  expectedPlayerIds: [0, 3, 5, 7],
  field: 'score1',
  value: 4
}
```

El servidor localizará por IDs y comprobará la firma de jugadores. Esto impide
que una respuesta retrasada se aplique sobre un partido regenerado o editado.
`expectedPlayerIds` respetará siempre el orden
`[t1_p1, t1_p2, t2_p1, t2_p2]`; no será un conjunto no ordenado. Como cada
score también requiere `expectedRevision`, dos cambios concurrentes,
incluidas dos escrituras sobre el mismo campo que lleguen invertidas, producirán
un único commit y un conflicto explícito para la operación obsoleta.

Las operaciones de fixture se calcularán fuera de la transacción a partir de
una revisión confirmada y se confirmarán mediante una transacción corta. Una
operación estructural nunca podrá sobrescribir silenciosamente un score
confirmado por otro cliente.

Ante un conflicto:

- el cliente descartará su copia calculada;
- recibirá el estado remoto más reciente;
- una extensión podrá recalcularse explícitamente sobre esa revisión;
- una regeneración requerirá nueva confirmación si ahora existen resultados;
- nunca se fusionarán schedules por índice de manera automática.

El cliente mantendrá dos conceptos separados:

```text
confirmedState  // último snapshot aceptado del servidor
pendingOperation // intención local aún no confirmada
```

Sólo habrá una mutación pendiente por torneo y dispositivo; las siguientes se
encolarán. La UI podrá mostrar el valor optimista, pero estadísticas,
exportación y nuevas mutaciones se basarán en `confirmedState`. Al confirmar se
elimina la operación pendiente. Ante conflicto o rechazo se restaura el estado
confirmado, se muestra el error y nunca se reintenta automáticamente una
operación estructural o destructiva. Un score podrá reintentarse sólo después
de que el usuario confirme el nuevo estado.

El listener remoto sólo aplicará snapshots v2 válidos y con revisión no menor a
la local confirmada. Una revisión nueva invalida cualquier previsualización,
cancela el Worker activo y marca como obsoleta toda respuesta tardía mediante un
`requestToken` local.

### Undo, importación y correcciones

El undo basado en snapshots existirá únicamente en el asistente local anterior
a la creación. Al confirmar, se vaciará y se deshabilitará para el torneo
compartido.

Después de crear:

- corregir un score, nombre o metadata será una nueva mutación normal contra la
  revisión actual;
- regeneración, extensión, reducción y borrado de scores no tendrán undo;
- la actividad conservará quién hizo cada cambio, pero no será un mecanismo
  para restaurar estado;
- importar un archivo v2 iniciará una creación nueva mediante Cloud Function:
  se validarán configuración y nombres, se descartarán schedule, scores, owner,
  miembros, revisiones, actividad y recibos del archivo, y el servidor generará
  un fixture nuevo antes de guardar;
- la UI advertirá expresamente que importar no restaura resultados ni ediciones
  manuales; un export completo seguirá sirviendo como archivo de auditoría, no
  como snapshot escribible;
- exportar nunca incluirá `_server`, `tournamentAccess`, hashes, tokens,
  `creationRequests` ni recibos idempotentes;
- localStorage y URL/hash sólo podrán contener un borrador de creación o
  preferencias locales, nunca reemplazar un torneo remoto confirmado.

## Tests propuestos

Los tests del fixture seguirán en `test/fixture.test.js` o se separarán en:

```text
test/fixture-analysis.test.js
test/fixture-designs.test.js
test/fixture-optimizer.test.js
test/fixture-integration.test.js
test/tournament-schema-v2.test.js
test/tournament-permissions.test.js
test/tournament-concurrency.test.js
test/fixture-worker.test.js
test/fixture-properties.test.js
test/fixture-authority.test.js
test/tournament-cutover.test.js
test/functions-fixture-v2.test.js
```

### Helpers de test

Agregar utilidades para:

- obtener los jugadores de una ronda;
- normalizar una pareja;
- validar y canonicalizar equipos fijos;
- contar parejas por frecuencia;
- contar cruces entre equipos por frecuencia;
- contar rivales por frecuencia;
- contar partidos y descansos por jugador;
- contar canchas y lados por jugador;
- comparar dos schedules completos;
- verificar que todos los scores nuevos sean cadenas vacías;
- detectar cualquier score no vacío, incluso si el partido no está terminado;
- comparar configuraciones y equipos canónicos;
- calcular y comparar fingerprints;
- localizar rondas y partidos por ID, nunca sólo por índice;
- crear `operationId` y `creationRequestId` determinísticos para tests;
- generar historias aleatorias con una semilla imprimible y reproducible;
- ejecutar operaciones remotas contra Firebase Emulator con roles diferentes;
- controlar un Web Worker falso de forma determinística;
- ejecutar el mismo núcleo en Worker y Functions y comparar bytes.

### Tests de análisis matemático

- `[ ]` Calcula correctamente `S`, `P` y la cota mínima de rondas.
- `[ ]` Calcula correctamente `T`, `E` y la cota de cruces entre equipos.
- `[ ]` Recomienda 7 rondas para 8×2 rotativo y 3 para 8×2 fijo.
- `[ ]` Recomienda 3 rondas para 6×1 fijo y 5 para 10×2 fijo.
- `[ ]` Clasifica 8×2×7 con `solutionClass: 'exact'` y
  `coverageStatus: 'complete'`.
- `[ ]` Clasifica 8×2×5 como `exact` y cobertura `partial`.
- `[ ]` Clasifica 8×2×9 como `exact` y ciclo `extended`.
- `[ ]` Clasifica las entradas validadas de 6, 7, 10 y 11 como
  `optimal-known`.
- `[ ]` Esas entradas declaran exclusivamente
  `provenObjectives: ['partnerRepetitions']` salvo que su certificado pruebe
  objetivos adicionales.
- `[ ]` Nunca clasifica una salida del Worker como `exact` u `optimal-known`.
- `[ ]` Clasifica 7×1×7 y 10×2×10 como capacidad insuficiente.
- `[ ]` No interpreta una cantidad impar de rondas como error.
- `[ ]` Rechaza modo fijo con una cantidad impar de jugadores.
- `[ ]` Rechaza equipos fijos incompletos, duplicados o con más de dos
  integrantes.
- `[ ]` Rechaza `numPlayers` no entero, menor que 4 o mayor que 16.
- `[ ]` Rechaza `numRounds` no entero, menor que 1 o mayor que 100.
- `[ ]` Rechaza `pairingMode` fuera de `rotating` y `fixed`.
- `[ ]` Rechaza `numCourts` no entero, menor que 1 o mayor que
  `floor(N / 4)`.
- `[ ]` No aplica clamping, coerción ni defaults a una configuración inválida.
- `[ ]` El dominio acepta 3 canchas con 12 jugadores y 4 con 16 jugadores aunque
  la UI inicial sólo permita seleccionar hasta 2.
- `[ ]` Rechaza configuraciones donde `C > floor(N / 4)`.
- `[ ]` Rechaza IDs fijos fuera de rango o no enteros.
- `[ ]` Canonicalizar `fixedTeams` es idempotente.
- `[ ]` Los integrantes quedan ordenados, los equipos quedan en orden
  lexicográfico y sus IDs estables no dependen de nombres.
- `[ ]` Rechaza `fixtureVariant` o `revision` negativos, fraccionarios o fuera
  del rango de enteros seguros.
- `[ ]` Rechaza versiones de generador o catálogo no soportadas.
- `[ ]` Rechaza cantidad incorrecta de nombres, nombres vacíos/no canónicos o
  mayores a 60 caracteres.
- `[ ]` Rechaza `gamesPerSet` fuera de 1–20 y scores fuera de
  `'' | 0..gamesPerSet`.
- `[ ]` Rechaza nombre de torneo vacío/no canónico o mayor a 100 caracteres y
  fechas calendario inválidas.
- `[ ]` Rechaza combinaciones incompatibles de `solutionClass`,
  `proofStatus`, `coverageStatus`, `cycleStatus` y `fallbackUsed`.
- `[ ]` Toda falla de dominio usa un código cerrado y una política de retry
  coherente; el texto localizado no participa de la lógica.
- `[ ]` Clasifica 13×3×13 y 16×4×15 como `exact`.
- `[ ]` Distingue cobertura completa observada de optimalidad demostrada.

### Tests estructurales para todas las configuraciones

Para `N = 4..16`, cada modo permitido,
`C = 1..floor(N / 4)` y una selección de rondas cortas, predeterminadas y
extendidas:

- `[ ]` Genera exactamente `R` rondas.
- `[ ]` Cada ronda contiene exactamente `C` partidos.
- `[ ]` Cada partido contiene cuatro jugadores diferentes.
- `[ ]` Ningún jugador aparece dos veces en la misma ronda.
- `[ ]` Todos los IDs están entre `0` y `N - 1`.
- `[ ]` Cada partido comienza sin resultado.
- `[ ]` La diferencia de partidos jugados es como máximo uno cuando sea
  combinatoriamente posible.
- `[ ]` Generar dos veces la misma configuración, versiones, variante y contexto
  produce un schedule profundamente igual.
- `[ ]` Cambiar `fixtureGeneratorVersion` impide comparar resultados como si
  pertenecieran al mismo contrato.
- `[ ]` Cada ronda y partido tiene un ID estable y único.
- `[ ]` Los IDs no dependen de revision, timestamps ni orden de ejecución.
- `[ ]` El fingerprint cambia al modificar jugadores, rondas o partidos y no
  cambia al editar nombres o scores.
- `[ ]` El validador rechaza fixtures corruptos preparados por el test.
- `[ ]` En modo fijo cada jugador conserva el mismo compañero en todas sus
  apariciones.
- `[ ]` En modo fijo los integrantes de un equipo juegan y descansan juntos.
- `[ ]` En modo fijo todos los partidos utilizan equipos pertenecientes a
  `fixedTeams`.
- `[ ]` Ningún test auxiliar ni estructura de resultado asume un máximo de dos
  partidos por ronda.
- `[ ]` Un candidato seguro válido existe antes de comenzar la optimización para
  cada configuración formalmente válida.

### Tests del catálogo validado

#### 4 jugadores, 1 cancha, 3 rondas

- `[ ]` Aparecen las 6 parejas exactamente una vez.
- `[ ]` Cada cruce aparece exactamente dos veces.
- `[ ]` Todos juegan las 3 rondas.

#### 5 jugadores, 1 cancha, 5 rondas

- `[ ]` Aparecen las 10 parejas exactamente una vez.
- `[ ]` Cada cruce aparece exactamente dos veces.
- `[ ]` Cada jugador juega 4 rondas y descansa una.
- `[ ]` Descansa un jugador diferente en cada ronda.

#### 8 jugadores, 2 canchas, 7 rondas

- `[ ]` Aparecen las 28 parejas exactamente una vez.
- `[ ]` Cada cruce aparece exactamente dos veces.
- `[ ]` Todos juegan las 7 rondas.
- `[ ]` La ronda 5 no repite las parejas de la ronda 1.
- `[ ]` La distribución coincide con el diseño validado, salvo
  transformaciones equivalentes explícitamente aceptadas.

#### 9 jugadores, 2 canchas, 9 rondas

- `[ ]` Aparecen las 36 parejas exactamente una vez.
- `[ ]` Cada cruce aparece exactamente dos veces.
- `[ ]` Cada jugador juega 8 rondas y descansa una.
- `[ ]` Descansa un jugador diferente en cada ronda.

#### 12 jugadores, 3 canchas, 11 rondas

- `[ ]` Aparecen las 66 parejas exactamente una vez.
- `[ ]` Cada cruce aparece exactamente dos veces.
- `[ ]` Todos juegan las 11 rondas.
- `[ ]` Cada ronda contiene exactamente 3 partidos.

#### Diseños exactos con menos canchas físicas

- `[ ]` 8×1×14 cubre las 28 parejas exactamente una vez.
- `[ ]` 9×1×18 cubre las 36 parejas exactamente una vez.
- `[ ]` 12×1×33 cubre las 66 parejas exactamente una vez.
- `[ ]` 13×1×39 cubre las 78 parejas exactamente una vez.
- `[ ]` 16×1×60 y 16×2×30 cubren las 120 parejas exactamente una vez.
- `[ ]` Cada entrada conserva las frecuencias de rivales declaradas por su
  certificado y usa exactamente `C` partidos por ronda.

#### 13 y 16 jugadores

- `[ ]` 13×3×13 cubre las 78 parejas exactamente una vez, cada cruce dos veces y
  asigna un descanso por jugador.
- `[ ]` 16×4×15 cubre las 120 parejas exactamente una vez y cada cruce dos
  veces.
- `[ ]` Sus empaquetados con menos canchas conservan las métricas certificadas.
- `[ ]` Cada constructor declara y respeta su `variantCount`.

#### Diseños `optimal-known`

- `[ ]` 6×1×8 cubre las 15 parejas y tiene exactamente una repetición.
- `[ ]` 7×1×11 cubre las 21 parejas y tiene exactamente una repetición.
- `[ ]` 10×2×12 cubre las 45 parejas y tiene exactamente tres repeticiones.
- `[ ]` 11×2×14 cubre las 55 parejas y tiene exactamente una repetición.
- `[ ]` Cada entrada alcanza su límite inferior registrado.
- `[ ]` Alterar el fixture de referencia hace fallar la validación del
  certificado.
- `[ ]` Una entrada sin certificado completo no puede cargarse como
  `optimal-known`.

#### Configuraciones todavía no certificadas

- `[ ]` Configuraciones seleccionadas de 14 y 15 jugadores generan fixtures
  estructuralmente válidos mediante candidato seguro y optimización.
- `[ ]` Se clasifican como `optimized`, aunque el resultado alcance cobertura
  completa.
- `[ ]` Incorporar en el futuro un certificado para esas combinaciones permite
  promoverlas sin cambiar el contrato del generador.

### Tests de parejas fijas

#### 4 jugadores, 2 equipos, 1 cancha

- `[ ]` Genera un único partido.
- `[ ]` Mantiene intactas las dos parejas.
- `[ ]` No declara pendientes otros cruces.

#### 6 jugadores, 3 equipos, 1 cancha

- `[ ]` Genera un ciclo de 3 rondas.
- `[ ]` Cada par de equipos se enfrenta exactamente una vez.
- `[ ]` Cada equipo juega dos rondas y descansa una.
- `[ ]` Los dos integrantes de un equipo siempre comparten partido y descanso.

#### 8 jugadores, 4 equipos, 2 canchas

- `[ ]` Genera un ciclo de 3 rondas.
- `[ ]` Cubre los 6 cruces entre equipos exactamente una vez.
- `[ ]` Todos los equipos juegan las 3 rondas.
- `[ ]` Ninguna pareja fija se separa o cambia de integrante.

#### 8 jugadores, 4 equipos, 1 cancha

- `[ ]` Genera un ciclo de referencia de 6 rondas.
- `[ ]` Cubre los 6 cruces exactamente una vez.
- `[ ]` Cada equipo juega tres rondas y descansa tres.
- `[ ]` Se minimizan descansos consecutivos.

#### 10 jugadores, 5 equipos, 2 canchas

- `[ ]` Genera un ciclo de 5 rondas.
- `[ ]` Cubre los 10 cruces exactamente una vez.
- `[ ]` Cada equipo juega cuatro rondas y descansa una.
- `[ ]` Descansa un equipo diferente en cada ronda.

#### 12 jugadores, 6 equipos, 3 canchas

- `[ ]` Genera un ciclo de 5 rondas.
- `[ ]` Cubre los 15 cruces exactamente una vez.
- `[ ]` Todos los equipos juegan las 5 rondas.

#### 14 jugadores, 7 equipos, 3 canchas

- `[ ]` Genera un ciclo de 7 rondas.
- `[ ]` Cubre los 21 cruces exactamente una vez.
- `[ ]` Cada equipo juega seis rondas y descansa una.

#### 16 jugadores, 8 equipos, 4 canchas

- `[ ]` Genera un ciclo de 7 rondas.
- `[ ]` Cubre los 28 cruces exactamente una vez.
- `[ ]` Todos los equipos juegan las 7 rondas.

#### Ciclos parciales y extendidos

- `[ ]` Un ciclo parcial no repite cruces mientras queden cruces utilizables.
- `[ ]` Un ciclo extendido completa todos los cruces antes de repetir.
- `[ ]` La frecuencia de cruces difiere como máximo en uno cuando sea posible.
- `[ ]` La distribución de canchas y lados queda balanceada por equipo.
- `[ ]` Un round-robin completo validado se clasifica `exact` con
  `proofStatus: 'constructor-verified'`.
- `[ ]` Un prefijo o ciclo extendido sólo se clasifica `exact` si el constructor
  registra un certificado para esa combinación concreta.
- `[ ]` Una salida fija sin certificado se clasifica `optimized`, aunque cubra
  todos los cruces.

### Tests de ciclos parciales y extendidos

- `[ ]` 8×2×1 a 8×2×7 no repite parejas.
- `[ ]` 8×2×9 completa las 28 parejas antes de repetir.
- `[ ]` En 8×2×9 la frecuencia de pareja difiere como máximo en uno.
- `[ ]` Dos ciclos completos de 8×2 distribuyen cada pareja exactamente dos
  veces.
- `[ ]` Un ciclo parcial de 9×2 mantiene descansos con diferencia máxima de
  uno.
- `[ ]` Al superar un ciclo, no se repite inmediatamente el mismo partido
  completo si existe una alternativa equivalente.

### Tests de capacidad insuficiente

- `[ ]` 7×1×7 genera como máximo 14 lugares y no declara cobertura perfecta.
- `[ ]` 10×2×10 genera como máximo 40 lugares y no declara cobertura perfecta.
- `[ ]` El resultado nunca contiene más parejas únicas que `min(S, P)`.
- `[ ]` Las repeticiones evitables se comparan contra fixtures de referencia
  para escenarios seleccionados.
- `[ ]` Aumentar rondas no reduce la cantidad de parejas diferentes si se
  preservan las rondas anteriores.

No se deberá afirmar que el optimizador es globalmente óptimo sólo porque
alcanzó un buen resultado. Para escenarios sin una prueba matemática, los tests
compararán contra límites conocidos o fixtures de referencia versionados.

### Tests de descansos

- `[ ]` Todos los jugadores descansan la misma cantidad o con diferencia máxima
  de uno.
- `[ ]` 5×1×5 y 9×2×9 asignan exactamente un descanso por jugador.
- `[ ]` Se minimizan descansos consecutivos cuando existe una alternativa con
  la misma cobertura de parejas.
- `[ ]` En prefijos de un ciclo exacto la diferencia de descansos no supera uno.

### Tests de extensión y edición manual

- `[ ]` Agregar rondas preserva el JSON de las rondas existentes.
- `[ ]` El optimizador recibe el prefijo como inmutable y rechaza cualquier
  mejora local que intente modificarlo.
- `[ ]` Extender directamente de `R` a `R + K` produce exactamente el mismo JSON
  que ejecutar `K` extensiones de una ronda.
- `[ ]` La igualdad secuencial se mantiene después de ediciones manuales.
- `[ ]` Reducir rondas vacías elimina únicamente un sufijo.
- `[ ]` Un score parcial se detecta como resultado existente.
- `[ ]` Reducir una ronda con cualquier score exige confirmación reforzada.
- `[ ]` Cancelar la confirmación conserva schedule, scores y métricas.
- `[ ]` Extender después de una pareja editada usa esa edición como historial.
- `[ ]` Las rondas nuevas evitan repetir la pareja editada si hay alternativas.
- `[ ]` Extender en modo fijo conserva `fixedTeams`.
- `[ ]` No se puede separar una pareja fija desde un selector individual.
- `[ ]` No se puede reemplazar un equipo fijo completo dentro de una ronda.
- `[ ]` No existe un editor de `fixedTeams` después de crear el torneo.
- `[ ]` Regenerar en modo fijo conserva exactamente los equipos originales.
- `[ ]` En modo rotativo se pueden cambiar jugadores y parejas de un partido sin
  scores.
- `[ ]` Cambiar por un jugador activo identifica los dos partidos afectados.
- `[ ]` No se puede cambiar ningún jugador si `score1` o `score2` de cualquiera
  de los partidos afectados no está vacío.
- `[ ]` Un participante puede incorporar a un jugador descansando en un partido
  propio, pero no desplazar a alguien de otro partido.
- `[ ]` Owner, admin y superadmin pueden intercambiar jugadores entre dos
  partidos sólo si ambos están sin scores.
- `[ ]` El rechazo conserva fixture, resultado, estadísticas y actividad.
- `[ ]` Los scores cargados en rondas existentes no se modifican.
- `[ ]` Una edición aceptada incrementa `scheduleRevision`, cambia el
  fingerprint y conserva los IDs de los partidos existentes.
- `[ ]` El undo por snapshots queda deshabilitado después de crear.
- `[ ]` Corregir una acción confirmada exige una nueva mutación contra la
  revisión vigente.
- `[ ]` Confirmar la creación vacía el undo del borrador.

### Tests de integración del flujo nuevo

- `[ ]` Crear un torneo exige elegir rotativas o fijas.
- `[ ]` El valor predeterminado es `rotating`.
- `[ ]` Elegir parejas fijas muestra el editor de equipos.
- `[ ]` La opción fija queda deshabilitada o bloqueada para `N` impar.
- `[ ]` Crear escribe mediante multipath atómico torneo, acceso privado, recibo
  de creación, configuración canónica, fixture y revisiones.
- `[ ]` Un fallo durante la creación no deja un torneo parcial.
- `[ ]` Repetir una creación con el mismo `creationRequestId` devuelve el mismo
  torneo y no crea actividad duplicada.
- `[ ]` Reusar `creationRequestId` con otro payload se rechaza.
- `[ ]` Dos clicks de confirmación simultáneos crean un solo torneo.
- `[ ]` `configuration` se guarda separada de `state`.
- `[ ]` Metadata, acceso, actividad y preferencias locales quedan en las
  categorías definidas por el inventario autoritativo.
- `[ ]` `players` contiene exactamente `numPlayers` nombres, no se puede
  reordenar y rechaza longitudes distintas.
- `[ ]` Nombre y fecha del torneo sobreviven a creación, sincronización y
  exportación v2.
- `[ ]` `collapsedRounds` no viaja por Firebase ni altera revision.
- `[ ]` Después de crear, no se puede cambiar la cantidad de jugadores en ningún
  modo.
- `[ ]` Después de crear, no se puede cambiar la cantidad de canchas.
- `[ ]` Después de crear, no se puede cambiar el modo.
- `[ ]` En modo rotativo se pueden cambiar jugadores asignados y parejas sólo
  bajo las reglas de todos los partidos afectados, y agregar rondas.
- `[ ]` En modo fijo sólo se pueden cambiar nombres, rondas y resultados.
- `[ ]` No existe flujo de cambio de canchas para un torneo creado.
- `[ ]` Agregar rondas conserva exactamente `configuration.numCourts`.
- `[ ]` El límite visible de dos canchas no se propaga al dominio ni altera un
  estado válido de 3 o 4 canchas.
- `[ ]` El renderizado crea una tarjeta de partido por cada cancha configurada.
- `[ ]` “Regenerar fixture” incrementa `fixtureVariant`, mantiene nombres y
  elimina resultados después de confirmar.
- `[ ]` Dos generaciones con la misma variante son idénticas.
- `[ ]` Dos variantes consecutivas producen schedules distintos y métricas
  equivalentes para las configuraciones del catálogo.
- `[ ]` Al agotar `variantCount`, la UI deshabilita regenerar y el servidor
  devuelve `NO_MORE_FIXTURE_VARIANTS` sin cambios.
- `[ ]` Una regeneración usa contexto `fresh` y no depende del schedule que
  reemplaza.
- `[ ]` Un torneo compartido nuevo sincroniza el fixture generado sin cambiar el
  resultado calculado.
- `[ ]` Dos clientes que generan la misma configuración y variante obtienen el
  mismo schedule.
- `[ ]` Worker y Function producen exactamente el mismo JSON para la misma
  versión y request.
- `[ ]` El servidor ignora un schedule o métricas maliciosos enviados por el
  cliente y genera el resultado autoritativo.
- `[ ]` Una diferencia de versión entre cliente y servidor falla con
  `GENERATOR_VERSION_MISMATCH`.
- `[ ]` Un estado, importación, localStorage o hash v1 se rechaza explícitamente.
- `[ ]` Importar v2 crea un torneo nuevo, descarta identidad y auditoría del
  archivo, schedule, scores y ediciones, y vuelve a generar el fixture en el
  servidor después de advertirlo.
- `[ ]` Exportar omite acceso privado, tokens, hashes y recibos.
- `[ ]` `clearScores` conserva configuración y fixture; `regenerateFixture`
  conserva configuración pero reemplaza el fixture.
- `[ ]` `gamesPerSet` se puede cambiar sin scores y se rechaza después de
  cualquier score parcial o completo.

### Tests de permisos y Firebase Rules

Ejecutar contra Firebase Emulator:

- `[ ]` Usuario anónimo no puede leer un torneo.
- `[ ]` Usuario autenticado ajeno no puede leer aunque conozca el ID.
- `[ ]` Un token de invitación válido registra al usuario como espectador o
  participante y recién entonces permite leer.
- `[ ]` Espectador puede leer pero no invocar ninguna mutación de dominio.
- `[ ]` Participante puede cargar un resultado de su propio partido en ambos
  modos.
- `[ ]` Participante no puede cargar resultados de partidos ajenos.
- `[ ]` Participante puede corregir su pairing sólo en modo rotativo y sin
  scores.
- `[ ]` Participante no puede cambiar pairing fijo invocando directamente la
  Cloud Function.
- `[ ]` Owner, admin y superadmin no pueden modificar ni eliminar
  `schemaVersion` ni `configuration`.
- `[ ]` Escrituras directas sobre metadata, state, schedule, scores, revision,
  acceso privado, actividad y recibos fallan para participante, owner, admin y
  superadmin.
- `[ ]` Un miembro no puede listar la raíz privada de acceso ni recibos; sólo
  obtiene su rol y claim sanitizados mediante Function.
- `[ ]` Ningún rol puede cambiar `numPlayers`, `numCourts`, `pairingMode` o
  `fixedTeams`, versiones o IDs después de crear.
- `[ ]` Sólo owner, admin o superadmin pueden cambiar rondas, regenerar o
  renombrar.
- `[ ]` Sólo owner, admin o superadmin pueden cambiar metadata o `gamesPerSet`,
  y este último se rechaza si existe cualquier score.
- `[ ]` Admin puede gestionar miembros pero no cambiar owner ni eliminar el
  torneo; owner y superadmin sí pueden eliminar con confirmación.
- `[ ]` Dos cambios de membresía con `expectedAccessRevision` obsoleto no se
  pisan y no alteran la revisión del fixture.
- `[ ]` `joinTournament` repetido con el mismo token y usuario no duplica
  membresía ni auditoría.
- `[ ]` UI, dominio y Functions producen la misma decisión semántica para cada
  fila de la matriz; Rules niega todas las escrituras directas.
- `[ ]` Los tests puros de la Function y los tests de Rules se ejecutan por
  separado, además del flujo integrado con ambos emuladores.

### Tests de sincronización y concurrencia

- `[ ]` Un score confirmado mientras otro cliente calcula una extensión no se
  pierde.
- `[ ]` Una extensión con `expectedRevision` obsoleta falla y no escribe nada.
- `[ ]` Un score preparado contra `scheduleRevision`, fingerprint o firma de
  jugadores anteriores a una regeneración se rechaza.
- `[ ]` Una escritura por `roundIndex`/`matchIndex` sin IDs se rechaza.
- `[ ]` Dos actualizaciones del mismo score que llegan invertidas no dejan
  persistido silenciosamente el valor obsoleto.
- `[ ]` Scores concurrentes en partidos diferentes producen un commit y un
  conflicto reintentable explícito, nunca pérdida de datos.
- `[ ]` Dos admins extendiendo simultáneamente producen un commit y un conflicto,
  nunca rondas duplicadas ni sobrescritas.
- `[ ]` Regeneración vs score obliga a revalidar y volver a confirmar.
- `[ ]` Dos regeneraciones simultáneas no reutilizan ni pierden una variante.
- `[ ]` Cada mutación de dominio incrementa `revision` exactamente una vez;
  mutaciones de acceso incrementan sólo `accessRevision`.
- `[ ]` Sólo una mutación de fixture incrementa `scheduleRevision`.
- `[ ]` Repetir el mismo `operationId` y payload devuelve el recibo anterior sin
  incrementar revisiones ni duplicar actividad.
- `[ ]` Reusar `operationId` con otro payload se rechaza.
- `[ ]` Reejecutar el callback transaccional no genera IDs ni efectos laterales
  duplicados.
- `[ ]` Estado, timestamp y actividad se escriben atómicamente.
- `[ ]` Un snapshot con revisión menor no reemplaza el estado local confirmado.
- `[ ]` Una actualización remota cancela el cálculo activo del Worker.
- `[ ]` Una respuesta tardía del Worker con `requestToken` obsoleto se descarta.
- `[ ]` Una operación pendiente rechazada restaura `confirmedState` y no deja
  valores optimistas fantasma.
- `[ ]` Las mutaciones del mismo dispositivo se serializan y no se basan en un
  estado optimista no confirmado.
- `[ ]` No existe undo por snapshot después de crear; una corrección genera
  actividad y revisión nuevas.
- `[ ]` Reintentar una eliminación completa paths faltantes y nunca revive un
  nodo ya borrado.

### Tests de rendimiento

- `[ ]` Definir un límite fijo de estados explorados por el optimizador.
- `[ ]` Verificar que todas las configuraciones 4–16 seleccionadas para la
  matriz devuelven un fixture válido dentro del límite de operaciones; cancelar
  no cuenta como éxito de generación.
- `[ ]` Medir por separado los escenarios típicos y el peor caso.
- `[ ]` Incluir 12×3×100 y 16×4×100 en los benchmarks informativos.
- `[ ]` Los diseños de catálogo no crean un Worker.
- `[ ]` Las configuraciones `optimized` se ejecutan dentro de un Worker.
- `[ ]` La UI continúa procesando renderizado y snapshots remotos mientras el
  Worker calcula.
- `[ ]` Cancelar termina el Worker y no aplica su respuesta tardía.
- `[ ]` Cancelar la previsualización no envía ninguna mutación.
- `[ ]` Una mutación ya enviada no se presenta como cancelada; al reabrir se
  recupera su resultado por `operationId`.
- `[ ]` Cambiar revisión, variante o torneo descarta una respuesta obsoleta.
- `[ ]` Agotar el presupuesto devuelve el candidato seguro validado con
  `fallbackUsed: true`, no un error ni un fixture parcial.
- `[ ]` El candidato seguro alcanza umbrales mínimos versionados de
  participación y validez.
- `[ ]` La cancelación se reconoce dentro de una cantidad máxima de operaciones,
  independientemente de la velocidad del equipo.
- `[ ]` Validar manualmente en un teléfono de gama media que regenerar el
  fixture no congele la interfaz.

Los tests automáticos no deberían depender únicamente de milisegundos, porque
son sensibles al entorno de CI. Es preferible probar límites de estados y dejar
los tiempos como benchmark informativo.

### Tests generativos y de propiedades

Usar un generador pseudoaleatorio determinístico. Toda falla imprimirá la
semilla, configuración e historial reducido para poder reproducirla.

- `[ ]` Recorrer `N = 4..16`, ambos modos válidos,
  `C = 1..floor(N / 4)` y bordes `R = 1` y `R = 100`.
- `[ ]` Generar valores inválidos alrededor de cada límite formal y comprobar
  rechazo sin coerción.
- `[ ]` Generar secuencias de renombres, scores parciales, swaps permitidos,
  extensión y reducción sin romper invariantes.
- `[ ]` Generar permutaciones equivalentes de `fixedTeams` y comprobar una única
  representación canónica.
- `[ ]` Repetir cada caso con la misma semilla y exigir JSON idéntico.
- `[ ]` Reducir automáticamente el caso al fallar, conservando la semilla en el
  mensaje de CI.
- `[ ]` Comprobar como propiedad que extensión nunca modifica el prefijo.
- `[ ]` Comprobar como propiedad que ninguna mutación rechazada cambia estado,
  revisión, actividad o recibos.

### Tests de corte y rollback

- `[ ]` Un cliente v1 queda bloqueado para escribir durante mantenimiento.
- `[ ]` Un estado v1 no puede aparecer bajo la ruta productiva después del
  corte.
- `[ ]` Functions y Rules v2 se verifican antes de reabrir la aplicación.
- `[ ]` El smoke test cubre creación, lectura autorizada, score y extensión.
- `[ ]` Antes del primer torneo v2 se puede restaurar v1 desde el backup.
- `[ ]` Después del primer torneo v2 sólo puede desplegarse un release
  v2-compatible.
- `[ ]` El procedimiento de forward-fix conserva los torneos v2 existentes.

## Etapas de migración

### 0. Línea de base

Estado: `[ ]` Pendiente.

- `[ ]` Ejecutar `npm test`.
- `[ ]` Ejecutar `npm run build`.
- `[ ]` Guardar como fixture de regresión el resultado defectuoso actual de
  8×2×7.
- `[ ]` Agregar localmente un test activo que reproduzca el defecto esperando 28
  parejas diferentes.
- `[ ]` No publicar ni integrar un commit con la suite roja.
- `[ ]` Incorporar el test activo al repositorio en el mismo commit que corrige
  el generador, de modo que cada commit publicado mantenga la suite completa en
  verde.
- `[ ]` Registrar métricas actuales para una matriz representativa de
  configuraciones.

Criterio de finalización: el defecto queda reproducido localmente, existe una
línea de base verificable y la rama publicada continúa verde.

### 1. Métricas, análisis y validación

Estado: `[ ]` Pendiente.

- `[ ]` Implementar claves normalizadas de parejas.
- `[ ]` Incorporar `schemaVersion: 2`, `configuration` separada y `state`
  mutable al modelo.
- `[ ]` Incorporar metadata, acceso, actividad, recibos idempotentes y
  preferencias locales según el inventario autoritativo.
- `[ ]` Persistir `fixtureGeneratorVersion` y `catalogVersion` como
  configuración write-once.
- `[ ]` Incorporar `scheduleRevision`, IDs estables y fingerprint.
- `[ ]` Validar que `players` tenga exactamente `numPlayers` nombres en orden de
  ID.
- `[ ]` Implementar todos los límites formales sin coerción ni clamping.
- `[ ]` Implementar validación y canonicalización idempotente de `fixedTeams`.
- `[ ]` Rechazar explícitamente estados, imports, hashes y snapshots v1.
- `[ ]` Implementar un único gateway para creación, mutaciones tipadas,
  importación v2 y snapshots remotos; dejar undo y preferencias en el borrador
  local.
- `[ ]` Implementar conteo de parejas, cruces de equipos, rivales, partidos y
  descansos.
- `[ ]` Implementar el análisis de factibilidad.
- `[ ]` Separar `solutionClass`, `coverageStatus`, `proofStatus` y
  `cycleStatus`.
- `[ ]` Implementar enums cerrados y `provenObjectives`.
- `[ ]` Separar `uiMaxCourts` de la cantidad válida para el dominio.
- `[ ]` Eliminar defaults o clamps de dos canchas en módulos de estado y
  fixture.
- `[ ]` Implementar el validador estructural.
- `[ ]` Agregar los tests matemáticos y estructurales.
- `[ ]` No cambiar todavía el generador productivo.

Criterio de finalización: cualquier fixture v2 puede analizarse y validarse sin
depender del DOM; una entrada v1 o inválida falla de forma explícita.

### 2. Catálogo validado

Estado: `[ ]` Pendiente.

- `[ ]` Implementar el catálogo determinístico versionado.
- `[ ]` Incorporar y validar las entradas `exact` para 4, 5, 8, 9, 12, 13 y 16
  cuando la combinación de canchas y rondas corresponda.
- `[ ]` Incorporar 8×1×14, 9×1×18, 12×1×33, 13×1×39, 16×1×60 y 16×2×30
  como entradas exactas.
- `[ ]` Incorporar y validar las entradas `optimal-known` de referencia:
  6×1×8, 7×1×11, 10×2×12 y 11×2×14.
- `[ ]` Registrar límite inferior, repeticiones alcanzadas, métricas y
  certificado para cada entrada `optimal-known`, limitando
  `provenObjectives` a lo realmente demostrado.
- `[ ]` Implementar prefijos de ciclos.
- `[ ]` Implementar repetición balanceada de ciclos completos y parciales.
- `[ ]` Conectar primero el caso 8×2 como corrección del defecto reportado.
- `[ ]` Verificar que ninguna salida sin certificado pueda declararse `exact` u
  `optimal-known`.
- `[ ]` Implementar round-robin determinístico para equipos fijos.
- `[ ]` Implementar ciclos parciales y extendidos de cruces entre equipos.
- `[ ]` Mantener 14, 15 y cualquier combinación sin certificado como
  `optimized`.
- `[ ]` Declarar `variantCount` y probar agotamiento de variantes en cada
  entrada.

Criterio de finalización: todos los tests del catálogo y sus certificados pasan;
el test activo de 8×2×7 se integra junto con la corrección y la suite queda
verde.

### 3. Optimizador genérico

Estado: `[ ]` Pendiente.

- `[ ]` Implementar generación y poda de candidatos.
- `[ ]` Construir candidatos agregando una cancha por vez.
- `[ ]` Implementar la puntuación lexicográfica.
- `[ ]` Implementar beam search con límites explícitos.
- `[ ]` Implementar mejoras locales determinísticas.
- `[ ]` Construir y conservar primero un candidato seguro válido.
- `[ ]` Implementar funciones de costo separadas para rotativas y fijas.
- `[ ]` Ejecutar toda configuración sin catálogo dentro de un Web Worker.
- `[ ]` Compartir el mismo núcleo puro con Cloud Functions y verificar igualdad
  byte a byte.
- `[ ]` Hacer que Functions regenere autoritativamente y no acepte schedules o
  métricas del cliente.
- `[ ]` Implementar progreso, cancelación, descarte por revisión y liberación
  del Worker.
- `[ ]` Aplicar un presupuesto determinístico de estados y operaciones.
- `[ ]` Agregar fixtures de referencia para configuraciones `optimized`.
- `[ ]` Validar jugadores pares, impares y múltiples descansos en modo
  rotativo.
- `[ ]` Validar cantidades pares y descansos por equipo en modo fijo.

Criterio de finalización: todas las configuraciones válidas soportadas generan
un fixture válido y determinístico, aun al agotar el presupuesto; entradas
inválidas, cancelación y fallos de ejecución producen errores tipados sin
bloquear el hilo principal.

### 4. Integración con generación y rondas

Estado: `[ ]` Pendiente.

- `[ ]` Hacer que `generateSchedule()` planifique globalmente.
- `[ ]` Reemplazar `getNumRounds()` por una recomendación dependiente del modo.
- `[ ]` Incorporar `extendScheduleSequentially()` con historial real y
  equivalencia JSON entre extensión directa e incremental.
- `[ ]` Separar `immutableHistory` del sufijo optimizable y prohibir cambios en
  el prefijo.
- `[ ]` Adaptar `src/features/fixture/rounds.js`.
- `[ ]` Adaptar los llamados de `src/app.js`.
- `[ ]` Reemplazar `MAX_COURTS = 2` por configuración exclusiva de UI.
- `[ ]` Pasar `pairingMode` y `fixedTeams` a generación y extensión.
- `[ ]` Hacer que renderizado, métricas y controles recorran `C` dinámicamente.
- `[ ]` Preservar rondas anteriores al agregar nuevas.
- `[ ]` Detectar scores parciales mediante `hasAnyScore`.
- `[ ]` Mantener confirmaciones, scores y nombres; vaciar y deshabilitar undo
  por snapshots después de crear.
- `[ ]` Deshabilitar el control de cantidad de jugadores después de crear.
- `[ ]` Deshabilitar el control de cantidad de canchas después de crear.
- `[ ]` Deshabilitar el cambio de modo después de crear.
- `[ ]` Mantener la edición de jugadores y parejas en modo rotativo sólo para
  partidos sin scores.
- `[ ]` Separar `canEditPairing()` de `canEditScore()`.
- `[ ]` Deshabilitar toda edición de jugadores y parejas en modo fijo sin
  deshabilitar resultados.
- `[ ]` Implementar `fixtureVariant` e incrementar una variante por
  regeneración.
- `[ ]` Deshabilitar regeneración al agotar `variantCount`.
- `[ ]` Implementar `gamesPerSet` mutable sólo mientras no existan scores.

Criterio de finalización: la interfaz usa el nuevo generador con esquema raíz
v2 y conserva el formato actual de `schedule`, rondas y partidos.

### 5. Corte de versión y sincronización

Estado: `[ ]` Pendiente.

- `[ ]` Ejecutar el procedimiento de mantenimiento, backup y eliminación de
  torneos v1 antes de publicar v2.
- `[ ]` Implementar la creación atómica de metadata, configuración y estado.
- `[ ]` Implementar `creationRequestId` y recibos idempotentes.
- `[ ]` Proteger `configuration` como write-once mediante Firebase Rules.
- `[ ]` Repetir invariantes estructurales en Cloud Functions.
- `[ ]` Reemplazar escrituras completas de `state` por mutaciones tipadas.
- `[ ]` Denegar mediante Rules toda escritura directa al dominio, incluso para
  roles administrativos.
- `[ ]` Incorporar `operationId`, `expectedRevision`, identidad de partido y
  transacciones para cada mutación.
- `[ ]` Implementar membresía explícita y token opaco para espectadores y
  participantes; eliminar la lectura para cualquier autenticado.
- `[ ]` Implementar `confirmedState`, cola de operación pendiente y descarte de
  respuestas tardías.
- `[ ]` Implementar la matriz semántica en UI, dominio y Functions, y las
  barreras de membresía/denegación directa en Rules.
- `[ ]` Probar dos sesiones con el mismo link y las carreras definidas.
- `[ ]` Ejecutar por separado tests puros, Rules Emulator, Functions Emulator y
  flujos integrados de concurrencia.

Criterio de finalización: los torneos v2 se crean y sincronizan sin estados
intermedios, duplicados, escrituras perdidas, lecturas no autorizadas ni
posibilidad de cambiar su configuración.

### 6. Experiencia y diagnóstico

Estado: `[ ]` Pendiente.

- `[ ]` Incorporar el selector “Parejas rotativas / Parejas fijas” al flujo de
  creación.
- `[ ]` Incorporar el editor de equipos fijos.
- `[ ]` Bloquear modo fijo para cantidades impares con un mensaje claro.
- `[ ]` Mostrar la estrategia elegida en la configuración del torneo.
- `[ ]` Mostrar la cantidad de jugadores como sólo lectura después de crear.
- `[ ]` Mostrar la cantidad de canchas como sólo lectura después de crear.
- `[ ]` Ocultar el editor de equipos fijos después de la confirmación.
- `[ ]` Mantener visibles los controles de asignación sólo en modo rotativo.
- `[ ]` Decidir si se muestra la cobertura en la interfaz.
- `[ ]` Si se muestra, diferenciar cobertura de parejas y cobertura de cruces
  entre equipos.
- `[ ]` Mostrar por separado clase de solución, cobertura y estado del ciclo.
- `[ ]` Informar la cota mínima de rondas sin prometer que siempre sea
  suficiente.
- `[ ]` Mantener la interfaz compacta en celular.
- `[ ]` Definir el layout de rondas con 3 y 4 partidos aunque todavía no se
  habiliten desde el selector.
- `[ ]` No mostrar advertencias alarmistas cuando una repetición sea inevitable.

Criterio de finalización: el usuario puede entender la calidad del fixture sin
necesitar conocer la matemática interna.

### 7. Validación final

Estado: `[ ]` Pendiente.

- `[ ]` Ejecutar `npm test`.
- `[ ]` Ejecutar `npm run build`.
- `[ ]` Ejecutar la matriz completa de fixtures.
- `[ ]` Verificar manualmente 5×1, 7×1, 8×2, 9×2 y 10×2.
- `[ ]` Verificar mediante tests y preview 12×3, 13×3 y 16×4.
- `[ ]` Verificar manualmente parejas fijas en 6×1, 8×1, 8×2 y 10×2.
- `[ ]` Verificar parejas fijas en 12×3, 14×3 y 16×4.
- `[ ]` Verificar selección y edición de equipos durante la creación.
- `[ ]` Verificar que jugadores, canchas, modo y equipos fijos estructurales
  queden bloqueados al confirmar.
- `[ ]` Verificar edición de jugadores y parejas sin scores en modo rotativo.
- `[ ]` Verificar que esas ediciones estén bloqueadas en modo fijo.
- `[ ]` Verificar agregado y eliminación de rondas con y sin resultados.
- `[ ]` Verificar edición manual y extensión posterior.
- `[ ]` Verificar un cambio que afecta dos partidos, con y sin scores.
- `[ ]` Verificar conflictos score/extensión y score/regeneración con dos
  sesiones.
- `[ ]` Verificar score obsoleto por ID, fingerprint y firma de jugadores.
- `[ ]` Verificar creación y mutaciones idempotentes ante retry.
- `[ ]` Verificar que usuarios ajenos no puedan leer y espectadores no puedan
  escribir.
- `[ ]` Verificar que ni administradores puedan escribir state directamente.
- `[ ]` Verificar igualdad entre Worker y Function para la misma versión.
- `[ ]` Verificar cancelación y respuesta obsoleta del Worker.
- `[ ]` Ejecutar los tests generativos registrando sus semillas.
- `[ ]` Verificar rechazo de estados e importaciones v1.
- `[ ]` Ensayar mantenimiento, smoke test y rollback v2-compatible.
- `[ ]` Verificar uso responsive.
- `[ ]` Comparar las métricas finales contra la línea de base.

Criterio de finalización: no quedan regresiones conocidas y el caso 8×2×7
alcanza 28 parejas únicas sin repeticiones.

## Estrategia de commits y reversión

La migración debería dividirse en commits independientes:

1. métricas de línea de base, sin publicar tests rojos;
2. esquema v2, versiones, identidades, configuración canónica y validadores;
3. catálogo validado y corrección 8×2 junto con su test activo;
4. round-robin de equipos fijos;
5. candidato seguro, optimizador genérico y Web Worker;
6. núcleo compartido y generación autoritativa en Functions;
7. extensión secuencial, variantes finitas y capacidades de UI;
8. creación idempotente, mutaciones transaccionales, Rules y permisos;
9. diagnóstico visual, cutover, documentación y validación final.

Cada commit publicado deberá mantener `npm test` y `npm run build` en verde. El
test que reproduce 8×2×7 puede existir temporalmente en el working tree mientras
se implementa la corrección, pero no se publicará separado de ella.

Mientras se integra el nuevo generador se puede conservar temporalmente la
implementación anterior como fallback interno. Antes de publicar:

- el fallback nunca debe devolver rondas inválidas;
- su uso debe ser detectable por tests o métricas;
- no debe quedar como camino silencioso para configuraciones que tienen diseño
  exacto;
- deberá eliminarse o quedar inaccesible para todo torneo v2 antes del corte.

La reversión de código se ensayará en dos momentos:

- antes del primer torneo v2, se puede restaurar el release v1 y el backup
  administrativo;
- después del primer torneo v2, sólo se puede volver a un release
  v2-compatible. No se revertirán aisladamente commits de esquema, Rules,
  Functions o cliente si eso deja contratos incompatibles.

El tag existente `PLAN-pre-fixed-mode` identifica el código anterior a esta
migración y sirve como referencia o recuperación previa al corte. No es un
rollback de datos válido después de crear torneos v2.

## Riesgos y mitigaciones

### Explosión combinatoria

Riesgo: intentar todas las combinaciones para 16 jugadores y 100 rondas puede
bloquear el navegador.

Mitigación:

- diseños directos para casos exactos;
- construcción incremental de una ronda, cancha por cancha;
- poda temprana;
- beam search con ancho fijo;
- límite determinístico de estados y operaciones;
- mejoras locales acotadas;
- ejecución obligatoria en Web Worker para configuraciones sin catálogo;
- cancelación y descarte de respuestas obsoletas;
- benchmark en dispositivo real.

### El límite de UI se filtra al dominio

Riesgo: conservar `MAX_COURTS = 2` en normalización o generación obliga a
reescribir el núcleo al habilitar una tercera cancha.

Mitigación:

- usar `uiMaxCourts` sólo en controles de interfaz;
- validar el dominio contra `floor(N / 4)`;
- ejecutar desde ahora tests de 12×3 y 16×4;
- prohibir ramas que generen específicamente “cancha 1” y “cancha 2”.

### Un algoritmo greedy queda atrapado

Riesgo: elegir la mejor pareja o cruce de equipos de la ronda actual puede
impedir una solución perfecta en rondas posteriores.

Mitigación:

- planificar ciclos exactos globalmente;
- conservar varios estados parciales en el optimizador;
- usar una función lexicográfica;
- validar el resultado completo.

### Extensión inconsistente

Riesgo: agregar rondas con una función aislada reintroduce repeticiones
evitables.

Mitigación:

- reemplazar `createAutomaticRound()` por
  `extendScheduleSequentially()` para ese flujo;
- analizar el historial real, incluidas ediciones manuales;
- hacer que toda extensión múltiple ejecute los mismos pasos unitarios;
- comparar igualdad JSON entre extensión directa e incremental.

### Una edición separa una pareja fija

Riesgo: los selectores actuales permiten cambiar un jugador individual y
convertir una ronda fija en rotativa.

Mitigación:

- validar cada ronda contra `fixedTeams`;
- separar `canEditPairing()` de `canEditScore()`;
- deshabilitar cambios individuales en modo fijo sin bloquear resultados;
- deshabilitar también reemplazos de equipos completos;
- ocultar el editor de `fixedTeams` después de confirmar;
- rechazar en el dominio cualquier cambio de composición.

### Cambio de configuración después de crear

Riesgo: modificar `numPlayers`, `numCourts`, `pairingMode` o `fixedTeams`
invalida IDs, equipos, descansos, permisos, fixture y resultados.

Mitigación:

- guardar `configuration` separada de `state`;
- permitir su escritura una sola vez;
- impedir cambios posteriores mediante Rules y Cloud Functions, incluso para
  administradores;
- bloquear los controles en ambos modos;
- exigir un torneo nuevo para usar otra configuración.

### Configuración fija inválida

Riesgo: una cantidad impar, un jugador duplicado o un equipo incompleto produce
un fixture incoherente.

Mitigación:

- bloquear modo fijo para `N` impar;
- validar que `fixedTeams` sea una partición exacta de los jugadores;
- canonicalizar integrantes, equipos e IDs estables antes de guardar;
- impedir la creación hasta corregir la configuración;
- repetir la validación en el dominio y no depender sólo de la interfaz.

### Declarar una solución perfecta sin demostrarlo

Riesgo: confundir una buena heurística con una garantía matemática.

Mitigación:

- validar las frecuencias antes de asignar `solutionClass`;
- exigir catálogo y certificado para `exact` y `optimal-known`;
- separar clase de solución, cobertura, prueba y estado del ciclo;
- no basar el mensaje de la interfaz únicamente en la cantidad de rondas.

### Cambios simultáneos en un torneo compartido

Riesgo: una extensión o regeneración calculada sobre un estado viejo pisa
scores, rondas o cambios de otro cliente.

Mitigación:

- abandonar las escrituras completas de `state` desde el cliente;
- usar mutaciones tipadas, `operationId`, `expectedRevision` y transacciones;
- incrementar la revisión también al guardar scores;
- localizar scores por identidad, fingerprint y firma de jugadores;
- confirmar estado, timestamp y actividad atómicamente;
- cancelar Workers al recibir una revisión nueva;
- probar todas las carreras críticas con Firebase Emulator.

### Creación parcial o estado anterior interpretado como v2

Riesgo: una creación en varios pasos o un estado v1 normalizado con defaults
puede quedar visible como torneo nuevo desbloqueado.

Mitigación:

- crear metadata, configuración y estado v2 en una única operación atómica;
- rechazar cualquier entrada sin `schemaVersion: 2`;
- no completar configuraciones persistidas mediante defaults;
- limpiar el undo al confirmar;
- aplicar el mismo gateway de invariantes a `clearScores`, regeneración,
  importación y snapshots;
- limitar localStorage y URL/hash a borradores o preferencias locales.

### Edición de pairing con resultados

Riesgo: cambiar jugadores después de cargar un score reasigna el resultado y
las estadísticas a otras personas.

Mitigación:

- definir `hasAnyScore` como cualquier score no vacío;
- calcular todos los partidos afectados antes de autorizar;
- rechazar el cambio en UI, dominio y Function, mientras Rules niega la
  escritura directa;
- conservar sin cambios resultado, fixture, estadísticas y actividad;
- cubrir scores parciales en tests.

### El cliente propone un fixture de menor calidad

Riesgo: un cliente modificado omite el optimizador o envía métricas falsas y
persiste un schedule estructuralmente válido pero deliberadamente malo.

Mitigación:

- compartir un núcleo puro y versionado entre Worker y Functions;
- enviar al servidor la solicitud, no un schedule autoritativo;
- volver a generar y validar en Functions;
- comparar Worker y servidor byte a byte en tests;
- rechazar diferencias de versión antes de escribir.

### Una edición de pairing afecta otro partido

Riesgo: seleccionar a un jugador ya activo lo intercambia con otro partido que
puede tener score o estar fuera del permiso del participante.

Mitigación:

- calcular `affectedMatches` antes de mutar;
- exigir scores vacíos en todo el conjunto;
- permitir al participante sólo jugadores que estaban descansando;
- reservar intercambios entre partidos para roles administrativos;
- confirmar todo el swap en una única transacción.

### Score atrasado aplicado a otro fixture

Riesgo: un score enviado por índices después de regenerar o editar termina en un
partido con otros jugadores.

Mitigación:

- usar `roundId`, `matchId`, `scheduleRevision` y fingerprint;
- enviar la firma esperada de jugadores;
- exigir `expectedRevision` también en scores;
- rechazar cualquier discrepancia sin buscar una coincidencia aproximada;
- probar respuestas demoradas y orden invertido.

### Versiones o variantes divergentes

Riesgo: dos deployments producen JSON distinto para la misma variante o el
usuario solicita más alternativas que las que existen.

Mitigación:

- guardar versiones de generador y catálogo en la configuración;
- conservar implementaciones compatibles mientras existan torneos que las
  referencian;
- declarar `variantCount`;
- deshabilitar regeneración al agotarlo;
- no usar revision, timestamps ni azar como semilla.

### Retry duplica una creación o actividad

Riesgo: un timeout, doble click o reejecución transaccional crea dos torneos,
incrementa dos veces una revisión o duplica actividad.

Mitigación:

- usar `creationRequestId` y `operationId`;
- guardar recibos de forma atómica;
- hacer puro el callback transaccional;
- derivar el ID de actividad desde `operationId`;
- rechazar la reutilización de una clave con otro payload.

### Estado optimista queda visible después de un conflicto

Riesgo: una respuesta remota pisa una edición pendiente o una operación
rechazada deja valores fantasma en la interfaz.

Mitigación:

- separar `confirmedState` de `pendingOperation`;
- serializar mutaciones por dispositivo;
- restaurar el confirmado ante rechazo;
- no reintentar automáticamente operaciones estructurales;
- descartar Workers y respuestas por `requestToken`.

### Lectura de torneos ajenos

Riesgo: requerir únicamente una sesión permite que cualquier usuario
autenticado lea un torneo cuyo ID conoce.

Mitigación:

- exigir membresía explícita en Rules;
- usar tokens opacos de invitación procesados por `joinTournament`;
- modelar `spectator` sin permisos de escritura;
- probar usuario anónimo, autenticado ajeno y miembro válido.

### Cambio de `gamesPerSet` invalida resultados

Riesgo: reducir el objetivo después de cargar scores deja resultados fuera del
contrato del torneo.

Mitigación:

- permitir el cambio únicamente si todos los scores están vacíos;
- validar esta condición en la Function;
- tratar un score parcial como resultado existente;
- conservar la operación como mutación tipada y auditada.

### Rollback posterior al corte

Riesgo: desplegar nuevamente un cliente v1 después de aceptar torneos v2 los
vuelve ilegibles o habilita escrituras incompatibles.

Mitigación:

- usar una ventana de mantenimiento y backup previo;
- desplegar backend, Rules y cliente en el orden documentado;
- permitir rollback a v1 sólo antes del primer dato v2;
- conservar siempre un artefacto v2-compatible;
- preferir forward-fix después del corte.

## Criterios de aceptación

La migración estará terminada cuando:

- al crear un torneo se pueda elegir entre parejas rotativas y fijas;
- el modo fijo sólo se habilite para cantidades pares y permita configurar los
  equipos antes de generar;
- el torneo se cree atómicamente con `schemaVersion: 2`, configuración separada
  y estado mutable;
- repetir la creación con el mismo `creationRequestId` devuelva el mismo torneo;
- configuración incluya versiones write-once de generador y catálogo;
- metadata, dominio, acceso, auditoría y preferencias locales respeten el
  inventario autoritativo;
- `players` contenga exactamente `numPlayers` nombres en IDs estables;
- después de crear, `numPlayers`, `numCourts`, `pairingMode` y `fixedTeams` no
  puedan cambiarse bajo ningún rol;
- `fixedTeams` use la representación canónica basada exclusivamente en IDs;
- en modo rotativo se puedan cambiar jugadores asignados y parejas sólo cuando
  todos los partidos afectados estén sin scores y el actor tenga permiso sobre
  la operación completa;
- un participante no pueda desplazar a un jugador activo en otro partido;
- en modo fijo `fixedTeams` permanezca inmutable y sólo se puedan cambiar
  nombres, rondas y resultados;
- bloquear pairing fijo no bloquee la carga de resultados;
- extender un torneo fijo reutilice exactamente los mismos equipos;
- extender varias rondas sea exactamente equivalente a agregarlas una por una;
- toda ronda agregada use la cantidad de canchas elegida al crear;
- 8 jugadores, 2 canchas y 7 rondas produzcan las 28 parejas exactamente una
  vez;
- en ese caso cada par de jugadores se enfrente exactamente dos veces;
- 5 y 9 jugadores distribuyan un descanso por persona y cubran todas las
  parejas en sus ciclos exactos;
- los escenarios con capacidad insuficiente no se declaren perfectos;
- en modo fijo ninguna pareja se separe y los cruces se distribuyan mediante
  round-robin;
- 6 jugadores fijos en una cancha cubran sus 3 cruces en 3 rondas;
- 8 jugadores fijos en dos canchas cubran sus 6 cruces en 3 rondas;
- 10 jugadores fijos en dos canchas cubran sus 10 cruces en 5 rondas;
- 4, 5, 8, 9 y 12 pasen las garantías `exact` de sus entradas validadas;
- 13×3×13 y 16×4×15, junto con sus empaquetados validados con menos canchas,
  pasen garantías `exact`;
- 6×1×8, 7×1×11, 10×2×12 y 11×2×14 alcancen el mínimo probado de repeticiones
  y se clasifiquen `optimal-known` exclusivamente para los objetivos
  certificados;
- las configuraciones sin certificado se clasifiquen `optimized`, incluso si
  alcanzan cobertura completa;
- 12×3, 14×3 y 16×4 pasen las garantías del round-robin fijo;
- el dominio, el estado y el renderizado acepten
  `C = 1..floor(N / 4)` sin asumir un máximo de dos;
- aumentar `uiMaxCourts` no requiera modificar el algoritmo de generación;
- se rechacen valores fuera de los límites formales, sin corrección silenciosa;
- la participación quede balanceada para todas las configuraciones soportadas;
- agregar rondas preserve las anteriores y considere su historial real;
- regenerar incremente `fixtureVariant` y produzca una alternativa
  determinística hasta agotar `variantCount`;
- las configuraciones sin catálogo se calculen en Web Worker sin bloquear la UI;
- toda configuración válida disponga de un candidato seguro y agotar el
  presupuesto nunca produzca una ronda inválida;
- Worker y Function compartan versión y produzcan el mismo JSON, pero sólo la
  Function confirme el fixture autoritativo;
- los torneos nuevos se sincronicen mediante revisión y transacciones sin perder
  scores;
- scores se dirijan por IDs, revisión, fingerprint y firma de jugadores;
- toda mutación sea idempotente mediante `operationId`;
- escrituras directas de dominio estén denegadas para todos los roles;
- usuarios ajenos no puedan leer y espectadores autorizados no puedan escribir;
- la matriz de permisos se cumpla en UI, dominio y Functions, con Rules como
  barrera de lectura y escritura directa;
- undo por snapshots no exista después de crear;
- `gamesPerSet` no pueda cambiar después de cualquier score;
- el cliente separe estado confirmado de operación pendiente y descarte
  respuestas obsoletas;
- los estados y exportaciones v1 se rechacen explícitamente;
- el corte y rollback v2-compatible estén ensayados antes de producción;
- pasen los tests generativos con semillas reproducibles;
- pasen los tests, la build de producción y la validación manual responsive.

## Decisiones recomendadas

- `[x]` Ofrecer parejas rotativas y parejas fijas durante la creación.
- `[x]` Usar parejas rotativas como opción predeterminada.
- `[x]` Exigir una cantidad par de jugadores para parejas fijas.
- `[x]` Guardar `fixedTeams` canónico y basado en IDs como fuente de verdad.
- `[x]` Guardar la configuración estructural separada del estado mutable.
- `[x]` Usar esquema general v2 sin compatibilidad con torneos anteriores.
- `[x]` Bloquear `numPlayers`, `numCourts`, `pairingMode` y `fixedTeams` después
  de crear.
- `[x]` Permitir cambios de jugadores y parejas sólo en modo rotativo y sin
  scores.
- `[x]` Hacer `fixedTeams` completamente inmutable después de crear.
- `[x]` Deshabilitar cambios individuales y reemplazos completos de equipos en
  modo fijo.
- `[x]` Permitir agregar rondas en ambos modos.
- `[x]` Mantener `numCourts` inmutable y exigir otro torneo para cambiarlo.
- `[x]` Usar un catálogo validado para los casos certificados de `N = 4..16`.
- `[x]` Clasificar 4, 5, 8, 9, 12, 13 y 16 como `exact` cuando coincida la
  combinación validada.
- `[x]` Clasificar las entradas comprobadas de 6, 7, 10 y 11 como
  `optimal-known` sólo para sus `provenObjectives`.
- `[x]` Clasificar cualquier combinación sin prueba como `optimized`.
- `[x]` Usar round-robin de equipos para el ciclo base de parejas fijas.
- `[x]` Diseñar el dominio para `C = 1..floor(N / 4)`.
- `[x]` Mantener el máximo inicial de dos canchas sólo como configuración de UI.
- `[x]` Incluir tests de 3 y 4 canchas desde la primera implementación.
- `[x]` Construir candidatos del optimizador cancha por cancha.
- `[x]` Usar un optimizador determinístico y acotado para las demás
  configuraciones.
- `[x]` Ejecutar el optimizador genérico dentro de un Web Worker.
- `[x]` Construir siempre un candidato seguro antes de optimizar.
- `[x]` Compartir el núcleo versionado entre Worker y Functions.
- `[x]` Hacer que Functions genere y confirme el fixture autoritativo.
- `[x]` Usar una cantidad finita y declarada de variantes determinísticas.
- `[x]` Usar extensión estrictamente secuencial.
- `[x]` En modo rotativo, tratar la cobertura de parejas como prioridad
  superior al balance de rivales.
- `[x]` En modo fijo, tratar la cobertura de cruces entre equipos como prioridad
  superior al balance de canchas y lados.
- `[x]` Realizar un corte limpio sin migrar fixtures o resultados anteriores.
- `[x]` Preservar las rondas de un torneo activo cuando solamente se agregan
  rondas.
- `[x]` Crear el torneo v2 en una operación atómica.
- `[x]` Hacer creación y mutaciones idempotentes.
- `[x]` Usar mutaciones tipadas, IDs, fingerprints, revisiones y transacciones
  para sincronización.
- `[x]` Denegar todas las escrituras directas de dominio.
- `[x]` Exigir membresía explícita para leer un torneo compartido.
- `[x]` Separar estado confirmado de operación pendiente.
- `[x]` Deshabilitar undo por snapshots después de crear.
- `[x]` Permitir cambiar `gamesPerSet` sólo sin scores.
- `[x]` Separar permisos de pairing y scoring.
- `[x]` Aplicar la matriz semántica en UI, dominio y Functions, con Rules como
  barrera de membresía y escritura directa.
- `[x]` Separar clase de solución, cobertura, prueba y ciclo.
- `[x]` Versionar generador y catálogo dentro de la configuración inmutable.
- `[x]` Usar rollback v2-compatible después de aceptar el primer torneo v2.
- `[ ]` Decidir si la primera entrega incluye el indicador visual de cobertura
  o si queda para una segunda entrega.
