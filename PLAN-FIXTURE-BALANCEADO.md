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
- produzcan siempre el mismo resultado para la misma configuración;
- permitan extender un torneo activo considerando sus rondas y ediciones
  manuales.

Cuando la configuración permita una solución perfecta, el generador deberá
encontrarla o usar una construcción combinatoria que la garantice. Cuando no sea
matemáticamente posible, deberá producir la mejor distribución posible y poder
explicar la limitación.

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
- regeneración al cambiar canchas o solicitar un nuevo fixture;
- agregado y eliminación de rondas;
- configuraciones de 4 a 16 jugadores;
- dominio preparado para todas las canchas posibles:
  `C = 1..floor(N / 4)`;
- interfaz inicialmente limitada a dos canchas mediante configuración, no
  mediante restricciones del generador;
- entre 1 y 50 rondas;
- métricas de cobertura y calidad;
- sincronización de fixtures nuevos por Firebase;
- tests unitarios, de propiedades, integración y regresión.

La migración será un **corte limpio**: no se conservará compatibilidad con
torneos, fixtures ni archivos exportados por versiones anteriores. Los torneos
anteriores podrán reiniciarse, regenerarse o eliminarse después del despliegue.

Fuera de alcance:

- modificar el sistema de puntuación;
- cambiar la estructura de un partido guardado;
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
- la cantidad efectiva será `min(requestedCourts, floor(N / 4))`;
- el optimizador construirá una ronda agregando partidos disjuntos de forma
  incremental, evitando enumerar de antemano todas las rondas completas;
- los límites de búsqueda podrán depender de `N`, `C` y `R`, pero no cambiarán
  las garantías estructurales;
- Firebase guardará `numCourts` como número sin asumir un máximo de dos.

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
  [playerA, playerB],
  [playerC, playerD]
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

### Cantidad impar de jugadores en modo fijo

No es posible asignar una pareja fija a todos los jugadores cuando `N` es
impar. No se agregará un jugador comodín porque convertiría el modo fijo en una
variante rotativa difícil de explicar y verificar.

La interfaz deberá:

- deshabilitar “Parejas fijas” cuando `N` sea impar; o
- permitir seleccionarlo y pedir que se agregue o quite un jugador antes de
  continuar.

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
- el control de cantidad quedará oculto, deshabilitado o en modo sólo lectura;
- cambiar nombres sigue permitido y no se considera cambiar la cantidad;
- cualquier intento de guardar un estado con otro `numPlayers` será rechazado
  por la validación del dominio;
- para utilizar otra cantidad se debe crear un torneo nuevo.

Se considera que el torneo fue creado cuando el usuario confirma la
configuración y se guarda su primer fixture. Mientras el asistente siga en modo
borrador, jugadores, cantidad, modo y equipos fijos pueden editarse.

### Operaciones permitidas después de crear

En modo rotativo:

- se pueden cambiar los jugadores asignados a los partidos;
- se pueden modificar las parejas de una ronda;
- se pueden agregar rondas;
- se pueden cambiar nombres, canchas y resultados;
- no se puede cambiar `numPlayers` ni `pairingMode`.

En modo fijo:

- `fixedTeams` queda inmutable;
- no se pueden cambiar jugadores asignados a los partidos;
- no se pueden modificar, separar ni reemplazar parejas;
- se pueden agregar rondas, siempre reutilizando los mismos equipos;
- se pueden cambiar nombres, canchas y resultados;
- no se puede cambiar `numPlayers` ni `pairingMode`;
- para cambiar una pareja se debe crear un torneo nuevo.

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
- cantidad total de repeticiones;
- frecuencia máxima de una pareja;
- diferencia entre la pareja más frecuente y la menos frecuente;
- cantidad de jugadores que todavía no fueron compañeros de cada jugador.

En modo fijo estas métricas se reemplazan por:

- equipos que se enfrentaron al menos una vez;
- cruces de equipos repetidos;
- frecuencia máxima y mínima de cada cruce;
- partidos y descansos por equipo;
- canchas y lados utilizados por cada equipo.

### Calidad de rivales

Se medirán:

- cantidad de rivales diferentes por jugador;
- frecuencia máxima y mínima de cada cruce;
- suma de desviaciones respecto de la frecuencia ideal;
- enfrentamientos consecutivos repetidos.

En modo rotativo, la prioridad de los rivales será menor que la de las parejas.
Nunca se deberá sacrificar una pareja nueva sólo para mejorar un cruce entre
rivales, salvo que la participación o la validez de la ronda lo exijan.

En modo fijo, la variedad de cruces entre equipos será la prioridad principal
después de la validez y el equilibrio de participación.

## Garantías por tipo de configuración

### Configuraciones rotativas exactas

Dentro del alcance actual hay cuatro configuraciones base para las que se puede
usar un diseño combinatorio exacto:

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

La implementación no deberá limitarse a plantillas para una o dos canchas.
Deberá usar una construcción determinística general para los diseños soportados
o un catálogo validado que incluya, como mínimo, 4×1, 5×1, 8×2, 9×2, 12×3,
13×3 y 16×4. El solver genérico será el respaldo para las configuraciones que
no coincidan con esos ciclos exactos.

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

### Capacidad suficiente sin diseño exacto conocido

Cuando `S >= P` pero la configuración no coincide con un ciclo exacto conocido,
el solver intentará cubrir todas las parejas. Si no puede demostrar una
solución dentro de su límite de búsqueda:

- conservará el mejor fixture válido encontrado;
- marcará internamente el resultado como optimizado, no como perfecto;
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

- normalizar `N`, `C`, `R` y `pairingMode`;
- calcular `availableCourts = floor(N / 4)` sin consultar un máximo de UI;
- validar `fixedTeams` cuando corresponda;
- calcular jugadores activos y descansos;
- calcular `S`, `P`, `M`, `E` y las cotas mínimas aplicables;
- detectar un diseño exacto soportado;
- clasificar la configuración:
  - `exact`;
  - `partial`;
  - `extended`;
  - `optimized`;
- calcular las métricas finales de un fixture;
- validar que una solución que se declara exacta realmente lo sea.

Interfaz sugerida:

```js
analyzeFixtureConfiguration({
  numPlayers,
  numCourts,
  roundCount,
  pairingMode,
  fixedTeams
})
analyzeSchedule(schedule, configuration)
validateSchedule(schedule, configuration)
```

### 2. Representación normalizada

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

El formato final seguirá siendo el actual:

```js
{
  id,
  matches: [{
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

El formato final puede conservarse para minimizar cambios internos, pero no es
un requisito de compatibilidad. Si el nuevo generador necesita metadata
adicional, el estado y el esquema de Firebase podrán evolucionar sin migrar
torneos anteriores.

El estado del torneo deberá incorporar como mínimo:

```js
{
  pairingMode: 'rotating' | 'fixed',
  fixedTeams: [], // vacío en modo rotating
  configurationLocked: false
}
```

`fixedTeams` será la fuente de verdad del modo fijo. No deberá inferirse a
partir de la primera ronda porque esa ronda puede estar incompleta, editada o
eliminada.

Al confirmar la creación, `configurationLocked` pasa a `true`. Desde ese
momento una validación de transición deberá exigir:

```js
next.numPlayers === previous.numPlayers
next.pairingMode === previous.pairingMode
```

En modo fijo también deberá exigir:

```js
deepEqual(next.fixedTeams, previous.fixedTeams)
```

Los nombres de `players` no forman parte de este bloqueo: se puede renombrar a
una persona sin cambiar su ID ni su equipo.

### 3. Diseños exactos

Crear un módulo, por ejemplo:

```text
src/features/fixture/balanced-designs.js
```

Deberá contener construcciones puras y determinísticas para los ciclos exactos
soportados.

Cada construcción deberá validarse al inicializarse en desarrollo o mediante
tests:

- todos los jugadores son válidos;
- ningún jugador aparece dos veces por ronda;
- cada pareja aparece exactamente una vez;
- cada cruce entre rivales aparece exactamente dos veces;
- los descansos están perfectamente balanceados;
- todas las canchas tienen un partido.

Las construcciones deberán aceptar `C` como parámetro. Los casos de 12×3,
13×3 y 16×4 formarán parte de la misma batería de garantías que 8×2 y 9×2.

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
- usar límites fijos de estados;
- producir el mismo JSON ante la misma entrada.

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

### 5. Orquestador del generador

`src/features/fixture/generator.js` seguirá siendo la API pública del dominio,
pero `generateSchedule()` deberá planificar el conjunto completo.

Flujo:

```text
configuración
    -> selección de pairingMode
    -> validación de fixedTeams, si corresponde
    -> análisis de factibilidad
    -> diseño rotativo o round-robin de equipos
    -> optimizador genérico, en los demás casos
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
generateSchedule(configuration)
extendSchedule(schedule, targetCount, configuration)
```

`extendSchedule()` deberá analizar parejas, equipos, rivales y descansos reales
del fixture existente. Esto es importante porque las rondas anteriores pueden
haber sido editadas manualmente.

### 6. Diagnóstico opcional para la interfaz

El dominio puede devolver o calcular información como:

```js
{
  pairingMode: 'rotating',
  quality: 'exact',
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
  quality: 'exact',
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

El indicador no es requisito para reemplazar el generador, pero las métricas sí
son necesarias para verificarlo.

## Corte de versión y comportamiento de la aplicación

### Datos anteriores al despliegue

No habrá una migración de compatibilidad. Se asume que los torneos anteriores se
reiniciarán o eliminarán y toda la validación se concentrará en torneos creados
con la nueva versión.

### Creación del torneo

El flujo de creación deberá pedir, antes de generar las rondas:

1. cantidad y nombres de jugadores;
2. tipo de parejas: rotativas o fijas;
3. composición de equipos, sólo para parejas fijas;
4. cantidad de canchas y rondas, con recomendación según el modo;
5. confirmación y generación.

La creación no podrá continuar en modo fijo si:

- la cantidad de jugadores es impar;
- falta un jugador en `fixedTeams`;
- un jugador aparece más de una vez;
- un equipo no tiene exactamente dos integrantes.

El nombre, la configuración, `pairingMode` y `fixedTeams` deberán guardarse
antes de sincronizar el primer fixture. Inmediatamente después se marcará
`configurationLocked: true`.

### Regeneración

El nuevo algoritmo se aplicará cuando:

- se crea un torneo;
- se reinicia el fixture de un torneo conservando su configuración bloqueada;
- el usuario confirma “Regenerar fixture”;
- cambia la cantidad de canchas;
- se crea un torneo compartido nuevo y se inicializa su fixture sin resultados.

Las confirmaciones para no perder resultados de un torneo activo deberán
conservarse.

Regenerar un torneo rotativo puede producir nuevas asignaciones y parejas.
Regenerar uno fijo sólo puede reordenar los cruces de los mismos `fixedTeams`;
nunca podrá modificar su composición.

“Reiniciar” no volverá a abrir la configuración estructural: conservará
`numPlayers`, `pairingMode` y, en modo fijo, `fixedTeams`. La única forma de
cambiar esos valores será crear otro torneo.

### Cambio de cantidad de rondas

- Al reducir rondas se conservará el comportamiento actual: sólo se eliminan
  rondas finales sin resultados.
- Al agregar rondas no se deberán modificar las rondas anteriores.
- Las rondas nuevas deberán optimizarse considerando las ediciones manuales y
  resultados existentes.
- Agregar una ronda y luego otra deberá ser equivalente, en calidad, a extender
  directamente hasta el mismo total.

Cuando una equivalencia exacta no sea posible por haber preservado rondas
anteriores, se priorizará no modificar el historial.

### Ediciones manuales

Una edición manual puede romper la perfección del diseño. No se intentará
reordenar silenciosamente rondas ya editadas.

En modo rotativo, al extender el torneo:

- el analizador tomará esas parejas como historial real;
- las rondas nuevas intentarán compensar la repetición;
- el fixture seguirá siendo válido aunque ya no pueda clasificarse como exacto.

En modo fijo:

- los selectores individuales quedarán deshabilitados y no podrán separar una
  pareja;
- tampoco se podrá reemplazar un equipo completo dentro de una ronda;
- `fixedTeams` no tendrá editor después de confirmar la creación;
- extender o regenerar deberá validar que todos los partidos usen exactamente
  los equipos originales;
- cambiar una pareja exige crear un torneo nuevo.

## Tests propuestos

Los tests del fixture seguirán en `test/fixture.test.js` o se separarán en:

```text
test/fixture-analysis.test.js
test/fixture-designs.test.js
test/fixture-optimizer.test.js
test/fixture-integration.test.js
```

### Helpers de test

Agregar utilidades para:

- obtener los jugadores de una ronda;
- normalizar una pareja;
- validar y normalizar equipos fijos;
- contar parejas por frecuencia;
- contar cruces entre equipos por frecuencia;
- contar rivales por frecuencia;
- contar partidos y descansos por jugador;
- contar canchas y lados por jugador;
- comparar dos schedules completos;
- verificar que todos los scores nuevos sean cadenas vacías.

### Tests de análisis matemático

- `[ ]` Calcula correctamente `S`, `P` y la cota mínima de rondas.
- `[ ]` Calcula correctamente `T`, `E` y la cota de cruces entre equipos.
- `[ ]` Recomienda 7 rondas para 8×2 rotativo y 3 para 8×2 fijo.
- `[ ]` Recomienda 3 rondas para 6×1 fijo y 5 para 10×2 fijo.
- `[ ]` Clasifica 8×2×7 como exacto.
- `[ ]` Clasifica 8×2×5 como parcial.
- `[ ]` Clasifica 8×2×9 como extendido.
- `[ ]` Clasifica 7×1×7 y 10×2×10 como capacidad insuficiente.
- `[ ]` No interpreta una cantidad impar de rondas como error.
- `[ ]` Rechaza modo fijo con una cantidad impar de jugadores.
- `[ ]` Rechaza equipos fijos incompletos, duplicados o con más de dos
  integrantes.
- `[ ]` Una transición bloqueada rechaza cambios de `numPlayers` en ambos modos.
- `[ ]` Una transición bloqueada rechaza cambios de `pairingMode`.
- `[ ]` Una transición bloqueada rechaza cambios de `fixedTeams`.
- `[ ]` Renombrar un jugador no viola el bloqueo de configuración.
- `[ ]` Limita las canchas a las disponibles para la cantidad de jugadores.
- `[ ]` El dominio acepta 3 canchas con 12 jugadores y 4 con 16 jugadores aunque
  la UI inicial sólo permita seleccionar hasta 2.
- `[ ]` Rechaza o normaliza configuraciones donde `C > floor(N / 4)`.

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
- `[ ]` Generar dos veces la misma configuración produce un schedule
  profundamente igual.
- `[ ]` El validador rechaza fixtures corruptos preparados por el test.
- `[ ]` En modo fijo cada jugador conserva el mismo compañero en todas sus
  apariciones.
- `[ ]` En modo fijo los integrantes de un equipo juegan y descansan juntos.
- `[ ]` En modo fijo todos los partidos utilizan equipos pertenecientes a
  `fixedTeams`.
- `[ ]` Ningún test auxiliar ni estructura de resultado asume un máximo de dos
  partidos por ronda.

### Tests de diseños exactos

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

#### 13 jugadores, 3 canchas, 13 rondas

- `[ ]` Aparecen las 78 parejas exactamente una vez.
- `[ ]` Cada cruce aparece exactamente dos veces.
- `[ ]` Cada jugador juega 12 rondas y descansa una.
- `[ ]` Descansa un jugador diferente en cada ronda.

#### 16 jugadores, 4 canchas, 15 rondas

- `[ ]` Aparecen las 120 parejas exactamente una vez.
- `[ ]` Cada cruce aparece exactamente dos veces.
- `[ ]` Todos juegan las 15 rondas.
- `[ ]` Cada ronda contiene exactamente 4 partidos.

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
- `[ ]` Reducir rondas conserva el comportamiento y las validaciones actuales.
- `[ ]` Extender después de una pareja editada usa esa edición como historial.
- `[ ]` Las rondas nuevas evitan repetir la pareja editada si hay alternativas.
- `[ ]` Extender en modo fijo conserva `fixedTeams`.
- `[ ]` No se puede separar una pareja fija desde un selector individual.
- `[ ]` No se puede reemplazar un equipo fijo completo dentro de una ronda.
- `[ ]` No existe un editor de `fixedTeams` después de crear el torneo.
- `[ ]` Regenerar en modo fijo conserva exactamente los equipos originales.
- `[ ]` En modo rotativo se pueden cambiar jugadores y parejas de una ronda.
- `[ ]` Los scores cargados en rondas existentes no se modifican.
- `[ ]` Undo sigue restaurando el fixture anterior.

### Tests de integración del flujo nuevo

- `[ ]` Crear un torneo exige elegir rotativas o fijas.
- `[ ]` El valor predeterminado es `rotating`.
- `[ ]` Elegir parejas fijas muestra el editor de equipos.
- `[ ]` La opción fija queda deshabilitada o bloqueada para `N` impar.
- `[ ]` `pairingMode`, `fixedTeams` y `configurationLocked` se guardan y
  sincronizan.
- `[ ]` Después de crear, no se puede cambiar la cantidad de jugadores en ningún
  modo.
- `[ ]` Después de crear, no se puede cambiar el modo.
- `[ ]` En modo rotativo se pueden cambiar jugadores asignados, parejas y
  agregar rondas.
- `[ ]` En modo fijo sólo se pueden cambiar nombres, canchas, rondas y
  resultados.
- `[ ]` Cambiar canchas conserva la advertencia cuando existen resultados.
- `[ ]` El límite visible de dos canchas no se propaga al dominio ni altera un
  estado válido de 3 o 4 canchas.
- `[ ]` El renderizado crea una tarjeta de partido por cada cancha configurada.
- `[ ]` “Regenerar fixture” mantiene nombres y elimina resultados.
- `[ ]` Un torneo compartido nuevo sincroniza el fixture generado sin cambiar el
  resultado calculado.
- `[ ]` Dos clientes que generan la misma configuración obtienen el mismo
  schedule.

### Tests de rendimiento

- `[ ]` Definir un límite fijo de estados explorados por el optimizador.
- `[ ]` Verificar que las configuraciones 4–16 y 1–50 terminan sin bloquear el
  proceso en ambos modos válidos.
- `[ ]` Medir por separado los escenarios típicos y el peor caso.
- `[ ]` Incluir 12×3×50 y 16×4×50 en los benchmarks informativos.
- `[ ]` Validar manualmente en un teléfono de gama media que regenerar el
  fixture no congele la interfaz.

Los tests automáticos no deberían depender únicamente de milisegundos, porque
son sensibles al entorno de CI. Es preferible probar límites de estados y dejar
los tiempos como benchmark informativo.

## Etapas de migración

### 0. Línea de base

Estado: `[ ]` Pendiente.

- `[ ]` Ejecutar `npm test`.
- `[ ]` Ejecutar `npm run build`.
- `[ ]` Guardar como fixture de regresión el resultado defectuoso actual de
  8×2×7.
- `[ ]` Agregar un test que demuestre el defecto: actualmente debe fallar porque
  espera 28 parejas diferentes.
- `[ ]` Registrar métricas actuales para una matriz representativa de
  configuraciones.

Criterio de finalización: el defecto queda reproducido automáticamente y existe
una línea de base verificable.

### 1. Métricas, análisis y validación

Estado: `[ ]` Pendiente.

- `[ ]` Implementar claves normalizadas de parejas.
- `[ ]` Incorporar `pairingMode`, `fixedTeams` y `configurationLocked` al modelo
  del torneo.
- `[ ]` Implementar validación de equipos fijos.
- `[ ]` Implementar validación de transiciones para impedir cambios de
  `numPlayers`, `pairingMode` y `fixedTeams` después de crear.
- `[ ]` Implementar conteo de parejas, cruces de equipos, rivales, partidos y
  descansos.
- `[ ]` Implementar el análisis de factibilidad.
- `[ ]` Separar `uiMaxCourts` de la cantidad válida para el dominio.
- `[ ]` Eliminar defaults o clamps de dos canchas en módulos de estado y
  fixture.
- `[ ]` Implementar el validador estructural.
- `[ ]` Agregar los tests matemáticos y estructurales.
- `[ ]` No cambiar todavía el generador productivo.

Criterio de finalización: cualquier fixture actual puede analizarse y validarse
sin depender del DOM.

### 2. Diseños exactos

Estado: `[ ]` Pendiente.

- `[ ]` Implementar y validar los ciclos rotativos para 4×1, 5×1, 8×2, 9×2,
  12×3, 13×3 y 16×4.
- `[ ]` Implementar prefijos de ciclos.
- `[ ]` Implementar repetición balanceada de ciclos completos y parciales.
- `[ ]` Conectar primero el caso 8×2 como corrección del defecto reportado.
- `[ ]` Verificar que el caso 9×2 conserva la cobertura de parejas y mejora la
  distribución de rivales.
- `[ ]` Implementar round-robin determinístico para equipos fijos.
- `[ ]` Implementar ciclos parciales y extendidos de cruces entre equipos.

Criterio de finalización: todos los tests de diseños exactos pasan.

### 3. Optimizador genérico

Estado: `[ ]` Pendiente.

- `[ ]` Implementar generación y poda de candidatos.
- `[ ]` Construir candidatos agregando una cancha por vez.
- `[ ]` Implementar la puntuación lexicográfica.
- `[ ]` Implementar beam search con límites explícitos.
- `[ ]` Implementar mejoras locales determinísticas.
- `[ ]` Implementar funciones de costo separadas para rotativas y fijas.
- `[ ]` Agregar fixtures de referencia para configuraciones no exactas.
- `[ ]` Validar jugadores pares, impares y múltiples descansos en modo
  rotativo.
- `[ ]` Validar cantidades pares y descansos por equipo en modo fijo.

Criterio de finalización: todas las configuraciones soportadas generan un
fixture válido, balanceado y determinístico.

### 4. Integración con generación y rondas

Estado: `[ ]` Pendiente.

- `[ ]` Hacer que `generateSchedule()` planifique globalmente.
- `[ ]` Reemplazar `getNumRounds()` por una recomendación dependiente del modo.
- `[ ]` Incorporar `extendSchedule()` con historial real.
- `[ ]` Adaptar `src/features/fixture/rounds.js`.
- `[ ]` Adaptar los llamados de `src/app.js`.
- `[ ]` Reemplazar `MAX_COURTS = 2` por configuración exclusiva de UI.
- `[ ]` Pasar `pairingMode` y `fixedTeams` a generación y extensión.
- `[ ]` Hacer que renderizado, métricas y controles recorran `C` dinámicamente.
- `[ ]` Preservar rondas anteriores al agregar nuevas.
- `[ ]` Mantener confirmaciones, undo, scores y nombres.
- `[ ]` Deshabilitar el control de cantidad de jugadores después de crear.
- `[ ]` Deshabilitar el cambio de modo después de crear.
- `[ ]` Mantener la edición de jugadores y parejas en modo rotativo.
- `[ ]` Deshabilitar toda edición de jugadores y parejas en modo fijo.

Criterio de finalización: la interfaz usa el nuevo generador sin cambios en el
formato de estado.

### 5. Corte de versión y sincronización

Estado: `[ ]` Pendiente.

- `[ ]` Reiniciar o eliminar los torneos anteriores al publicar la nueva
  versión.
- `[ ]` Crear y sincronizar un torneo nuevo.
- `[ ]` Probar dos sesiones con el mismo link.
- `[ ]` Confirmar que `pairingMode`, `fixedTeams`, `configurationLocked` y
  cualquier metadata nueva se sincronizan correctamente.

Criterio de finalización: los torneos creados con la nueva versión se
sincronizan correctamente.

### 6. Experiencia y diagnóstico

Estado: `[ ]` Pendiente.

- `[ ]` Incorporar el selector “Parejas rotativas / Parejas fijas” al flujo de
  creación.
- `[ ]` Incorporar el editor de equipos fijos.
- `[ ]` Bloquear modo fijo para cantidades impares con un mensaje claro.
- `[ ]` Mostrar la estrategia elegida en la configuración del torneo.
- `[ ]` Mostrar la cantidad de jugadores como sólo lectura después de crear.
- `[ ]` Ocultar el editor de equipos fijos después de la confirmación.
- `[ ]` Mantener visibles los controles de asignación sólo en modo rotativo.
- `[ ]` Decidir si se muestra la cobertura en la interfaz.
- `[ ]` Si se muestra, diferenciar cobertura de parejas y cobertura de cruces
  entre equipos.
- `[ ]` Diferenciar perfecto, parcial, extendido y optimizado.
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
- `[ ]` Verificar que cantidad, modo y equipos fijos queden bloqueados al
  confirmar.
- `[ ]` Verificar edición de jugadores y parejas en modo rotativo.
- `[ ]` Verificar que esas ediciones estén bloqueadas en modo fijo.
- `[ ]` Verificar agregado y eliminación de rondas con y sin resultados.
- `[ ]` Verificar edición manual y extensión posterior.
- `[ ]` Verificar uso responsive.
- `[ ]` Comparar las métricas finales contra la línea de base.

Criterio de finalización: no quedan regresiones conocidas y el caso 8×2×7
alcanza 28 parejas únicas sin repeticiones.

## Estrategia de commits y reversión

La migración debería dividirse en commits independientes:

1. tests y métricas de línea de base;
2. modelo de `pairingMode` y `fixedTeams`;
3. analizador y validador;
4. diseños rotativos exactos y round-robin de equipos;
5. optimizador genérico;
6. integración con creación, rondas y aplicación;
7. diagnóstico visual, si se aprueba;
8. documentación y validación final.

Mientras se integra el nuevo generador se puede conservar temporalmente la
implementación anterior como fallback interno. Antes de publicar:

- el fallback nunca debe devolver rondas inválidas;
- su uso debe ser detectable por tests o métricas;
- no debe quedar como camino silencioso para configuraciones que tienen diseño
  exacto;
- si la migración necesita revertirse, se revertirán los commits de integración
  sin requerir una migración de datos anteriores.

## Riesgos y mitigaciones

### Explosión combinatoria

Riesgo: intentar todas las combinaciones para 16 jugadores y 50 rondas puede
bloquear el navegador.

Mitigación:

- diseños directos para casos exactos;
- construcción incremental de una ronda, cancha por cancha;
- poda temprana;
- beam search con ancho fijo;
- límite de estados;
- mejoras locales acotadas;
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

- reemplazar `createAutomaticRound()` por `extendSchedule()` para ese flujo;
- analizar el historial real, incluidas ediciones manuales;
- agregar tests de extensión incremental.

### Una edición separa una pareja fija

Riesgo: los selectores actuales permiten cambiar un jugador individual y
convertir una ronda fija en rotativa.

Mitigación:

- validar cada ronda contra `fixedTeams`;
- deshabilitar cambios individuales en modo fijo;
- deshabilitar también reemplazos de equipos completos;
- ocultar el editor de `fixedTeams` después de confirmar;
- rechazar en el dominio cualquier cambio de composición.

### Cambio de cantidad después de crear

Riesgo: modificar `numPlayers` invalida IDs, equipos, descansos, permisos y
resultados de un torneo activo.

Mitigación:

- bloquear el control en ambos modos;
- persistir `configurationLocked`;
- validar cada transición de estado;
- exigir un torneo nuevo para usar otra cantidad.

### Configuración fija inválida

Riesgo: una cantidad impar, un jugador duplicado o un equipo incompleto produce
un fixture incoherente.

Mitigación:

- bloquear modo fijo para `N` impar;
- validar que `fixedTeams` sea una partición exacta de los jugadores;
- impedir la creación hasta corregir la configuración;
- repetir la validación en el dominio y no depender sólo de la interfaz.

### Declarar una solución perfecta sin demostrarlo

Riesgo: confundir una buena heurística con una garantía matemática.

Mitigación:

- validar las frecuencias antes de asignar `quality: 'exact'`;
- usar diseños comprobados;
- distinguir capacidad, solución encontrada y optimalidad demostrada;
- no basar el mensaje de la interfaz únicamente en la cantidad de rondas.

### Cambios simultáneos en un torneo compartido

Riesgo: dos admins regeneran al mismo tiempo y compiten por guardar el estado.

Mitigación:

- mantener el generador determinístico;
- reutilizar el flujo de sincronización actual;
- registrar la regeneración en actividad;
- considerar en una etapa posterior un control de versión si se detectan
  conflictos reales.

## Criterios de aceptación

La migración estará terminada cuando:

- al crear un torneo se pueda elegir entre parejas rotativas y fijas;
- el modo fijo sólo se habilite para cantidades pares y permita configurar los
  equipos antes de generar;
- después de crear, `numPlayers` y `pairingMode` no puedan cambiarse en ningún
  modo;
- en modo rotativo se puedan cambiar jugadores asignados, parejas y cantidad de
  rondas;
- en modo fijo `fixedTeams` permanezca inmutable y sólo se puedan cambiar
  nombres, canchas, rondas y resultados;
- extender un torneo fijo reutilice exactamente los mismos equipos;
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
- 12×3, 13×3 y 16×4 pasen las garantías exactas del modo rotativo;
- 12×3, 14×3 y 16×4 pasen las garantías del round-robin fijo;
- el dominio, el estado y el renderizado acepten
  `C = 1..floor(N / 4)` sin asumir un máximo de dos;
- aumentar `uiMaxCourts` no requiera modificar el algoritmo de generación;
- la participación quede balanceada para todas las configuraciones soportadas;
- agregar rondas preserve las anteriores y considere su historial real;
- el resultado sea determinístico;
- los torneos nuevos puedan guardarse y sincronizarse;
- pasen los tests, la build de producción y la validación manual responsive.

## Decisiones recomendadas

- `[x]` Ofrecer parejas rotativas y parejas fijas durante la creación.
- `[x]` Usar parejas rotativas como opción predeterminada.
- `[x]` Exigir una cantidad par de jugadores para parejas fijas.
- `[x]` Guardar `fixedTeams` como fuente de verdad del modo fijo.
- `[x]` Bloquear `numPlayers` y `pairingMode` después de crear en ambos modos.
- `[x]` Permitir cambios de jugadores asignados y parejas sólo en modo rotativo.
- `[x]` Hacer `fixedTeams` completamente inmutable después de crear.
- `[x]` Deshabilitar cambios individuales y reemplazos completos de equipos en
  modo fijo.
- `[x]` Permitir agregar rondas en ambos modos.
- `[x]` Usar diseños rotativos exactos comprobados desde 1 hasta 4 canchas:
  4×1, 5×1, 8×2, 9×2, 12×3, 13×3 y 16×4.
- `[x]` Usar round-robin de equipos para el ciclo base de parejas fijas.
- `[x]` Diseñar el dominio para `C = 1..floor(N / 4)`.
- `[x]` Mantener el máximo inicial de dos canchas sólo como configuración de UI.
- `[x]` Incluir tests de 3 y 4 canchas desde la primera implementación.
- `[x]` Construir candidatos del optimizador cancha por cancha.
- `[x]` Usar un optimizador determinístico y acotado para las demás
  configuraciones.
- `[x]` En modo rotativo, tratar la cobertura de parejas como prioridad
  superior al balance de rivales.
- `[x]` En modo fijo, tratar la cobertura de cruces entre equipos como prioridad
  superior al balance de canchas y lados.
- `[x]` Realizar un corte limpio sin migrar fixtures o resultados anteriores.
- `[x]` Preservar las rondas de un torneo activo cuando solamente se agregan
  rondas.
- `[x]` Permitir que el esquema de estado evolucione si mejora la solución.
- `[ ]` Decidir si la primera entrega incluye el indicador visual de cobertura
  o si queda para una segunda entrega.
