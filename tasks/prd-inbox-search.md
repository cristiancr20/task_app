# PRD: Bandeja de entrada, proceso por lotes y búsqueda

## Overview

La app sabe trabajar con **una** transcripción a la vez. Para todo lo demás no tiene respuesta: no hay forma de saber qué notas quedan sin procesar sin abrirlas una por una, no hay forma de procesar varias seguidas, y no hay ni un campo de filtro — mucho menos una búsqueda que responda *«¿cuándo hablamos del endpoint de pagos?»*.

Eso se nota justo cuando más duele: vuelves de una semana fuera con doce reuniones acumuladas y el flujo actual te obliga a doce rondas completas de navegar, abrir, extraer, revisar y enviar.

Este PRD añade tres cosas que se apoyan en el mismo cimiento (un escaneo recursivo de la carpeta de contexto): una **bandeja de entrada** con lo que falta por procesar, una **cola de extracción por lotes**, y **búsqueda de texto completo** sobre todas las notas.

## Goals

- Saber de un vistazo qué transcripciones no se han procesado nunca, sin recorrer carpetas.
- Extraer varias notas seguidas sin supervisar cada una, y revisarlas después.
- Encontrar cualquier reunión por lo que se dijo en ella, no solo por su nombre de archivo.
- Filtrar rápido dentro de la carpeta en la que ya estás.
- Que nada de esto cargue en memoria toda la carpeta de contexto ni bloquee la interfaz.

## Quality Gates

Estos comandos deben pasar en cada user story:
- `pnpm typecheck` — comprobación de tipos (`next typegen && tsc --noEmit`)
- `pnpm test` — batería de tests (`vitest run`)

Sin verificación en navegador: las historias con UI se validan con tests y typecheck.

## User Stories

### US-001: Escaneo recursivo de la carpeta de contexto
**Description:** Como desarrollador, quiero recorrer todas las transcripciones bajo la raíz, para que la bandeja y la búsqueda tengan de dónde leer.

**Acceptance Criteria:**
- [ ] Nueva función `walkTranscripts(root)` en `lib/transcripts.ts` que recorre la raíz en profundidad y devuelve la metadata de cada `.md`
- [ ] Respeta las mismas exclusiones que `listFolder`: dotfiles y `node_modules`
- [ ] Aplica la misma guarda de salida de la raíz que el resto del scanner; un symlink que apunta fuera no se sigue
- [ ] Un symlink que crea un ciclo dentro de la raíz no cuelga el recorrido
- [ ] Hay un límite de profundidad y un límite de número de archivos, ambos como constantes con nombre y comentadas; al alcanzarlos el recorrido para y lo indica en el resultado en vez de truncar en silencio
- [ ] Un archivo o carpeta ilegible se omite sin romper el recorrido entero
- [ ] La metadata de cada archivo es la misma que ya produce `listFolder`, sin duplicar la lógica de parseo
- [ ] Tests en `lib/transcripts.test.ts` sobre un árbol temporal: anidamiento de varios niveles, exclusiones, ciclo por symlink, límite de profundidad alcanzado y archivo ilegible

### US-002: Índice en memoria con invalidación
**Description:** Como desarrollador, quiero que el recorrido no se repita en cada petición, para que la bandeja y la búsqueda respondan rápido sin releer el disco continuamente.

**Acceptance Criteria:**
- [ ] Nuevo módulo `lib/transcript-index.ts` que guarda en memoria del servidor el resultado de `walkTranscripts`
- [ ] El índice se invalida cuando cambia la carpeta de contexto configurada
- [ ] El índice caduca por tiempo, con una constante con nombre y comentada, para que una nota nueva en disco aparezca sin reiniciar el servidor
- [ ] Existe una forma explícita de forzar la reconstrucción, que es lo que usa el botón de recargar de la interfaz
- [ ] Dos peticiones simultáneas con el índice frío no disparan dos recorridos: la segunda espera al primero
- [ ] El índice guarda metadata, nunca el cuerpo de las transcripciones, para no crecer sin control
- [ ] Tests del ciclo de vida: construcción, reutilización dentro de la ventana, caducidad, invalidación por cambio de raíz y llamadas concurrentes

### US-003: Búsqueda de texto completo
**Description:** Como usuario, quiero buscar una frase y ver en qué reuniones se dijo, para recuperar contexto sin acordarme del archivo.

**Acceptance Criteria:**
- [ ] Nuevo módulo `lib/search.ts` con la lógica pura: normaliza la consulta y el texto (minúsculas, sin acentos), decide si un documento coincide y extrae el fragmento de contexto
- [ ] El fragmento devuelto incluye texto antes y después de la coincidencia, con las posiciones exactas de lo que hay que resaltar, sin insertar HTML
- [ ] Una nota puede devolver varias coincidencias, hasta un tope por archivo definido como constante
- [ ] La búsqueda cubre el cuerpo de la nota y también su título
- [ ] Una consulta de menos de dos caracteres no busca y lo indica
- [ ] Los resultados se ordenan por número de coincidencias y, a igualdad, por fecha descendente
- [ ] Nueva ruta `GET /api/search?q=` que recorre las notas del índice, lee cada cuerpo bajo demanda y responde `{ results, truncated }`
- [ ] La ruta acota el trabajo: tope de archivos inspeccionados y de resultados devueltos, y `truncated` avisa cuando se quedó corta
- [ ] Wrapper en `lib/search-client.ts` con su guarda de forma, como el resto de `lib/*-client.ts`
- [ ] Tests de `lib/search.ts`: coincidencia exacta, sin acentos, sin distinguir mayúsculas, coincidencia en el título, varias coincidencias en un archivo, fragmento en el borde del texto y consulta demasiado corta

### US-004: Interfaz de búsqueda
**Description:** Como usuario, quiero un campo de búsqueda siempre a mano y resultados con el fragmento donde aparece lo que busco.

**Acceptance Criteria:**
- [ ] Campo de búsqueda en la cabecera de la aplicación, accesible desde cualquier punto del explorador
- [ ] La consulta se lanza con debounce, no en cada pulsación
- [ ] Cada resultado muestra el título de la nota, su fecha, su carpeta y el fragmento con la coincidencia resaltada
- [ ] Hacer clic en un resultado abre esa nota en el explorador y deja la carpeta correcta seleccionada
- [ ] Estados explícitos y distinguibles: buscando, sin resultados, y resultados recortados por el tope
- [ ] Se puede salir de la búsqueda y volver a la vista normal sin perder la nota que estaba abierta
- [ ] El campo se puede vaciar con Escape
- [ ] Un fallo de la búsqueda se muestra en su sitio con «Reintentar», sin romper el explorador
- [ ] Una respuesta que llega tarde no pisa los resultados de una consulta más reciente

### US-005: Filtro rápido en la lista de archivos
**Description:** Como usuario, quiero filtrar los archivos de la carpeta en la que estoy, que es distinto de buscar en todas.

**Acceptance Criteria:**
- [ ] Campo de filtro en la cabecera de `app/file-list.tsx`, que filtra solo la carpeta seleccionada
- [ ] Filtra por título y por nombre de archivo, sin distinguir mayúsculas ni acentos
- [ ] El filtro se limpia al cambiar de carpeta
- [ ] Con el filtro puesto, la cabecera indica cuántos de cuántos archivos se están mostrando
- [ ] Ningún resultado muestra un mensaje claro, no una lista vacía sin explicación
- [ ] El filtrado ocurre en el navegador sobre la lista ya cargada: no genera peticiones

### US-006: Bandeja de entrada de notas sin procesar
**Description:** Como usuario, quiero una vista con todo lo que aún no he procesado, para no ir carpeta por carpeta buscándolo.

**Acceptance Criteria:**
- [ ] Nueva vista de bandeja de entrada, accesible desde la cabecera, que lista todas las transcripciones sin historial de envío
- [ ] Cada fila muestra título, fecha, carpeta y tamaño aproximado de la nota
- [ ] La lista se ordena por fecha descendente, y las notas sin fecha van al final
- [ ] La cabecera muestra el número de notas pendientes
- [ ] Una nota que ya tiene borradores extraídos pero no enviados se distingue de una que no se ha tocado nunca
- [ ] Hacer clic en una fila la abre en el explorador
- [ ] Hay un control para reconstruir el índice y ver notas recién añadidas al disco
- [ ] Con la bandeja vacía se muestra un estado final claro, no una tabla vacía
- [ ] Si el recorrido alcanzó su límite, la vista lo dice en vez de aparentar que eso es todo

### US-007: Selección múltiple en la bandeja
**Description:** Como usuario, quiero elegir varias notas de la bandeja, para actuar sobre todas a la vez.

**Acceptance Criteria:**
- [ ] Cada fila de la bandeja tiene su casilla de selección
- [ ] Hay «seleccionar todo» y «no seleccionar nada», y el «seleccionar todo» solo alcanza a las filas visibles con el filtro puesto
- [ ] Una barra de acciones muestra cuántas hay seleccionadas y desaparece cuando no hay ninguna
- [ ] La selección sobrevive al desplazamiento de la lista y se limpia al salir de la vista
- [ ] La selección se limita a un número máximo por tanda, con una constante con nombre, y la interfaz lo explica al alcanzarlo

### US-008: Cola de extracción por lotes
**Description:** Como usuario, quiero extraer varias transcripciones seguidas sin quedarme mirando cada una, para procesar de una vez lo acumulado.

**Acceptance Criteria:**
- [ ] Desde la barra de acciones se lanza la extracción de todas las notas seleccionadas
- [ ] Las notas se procesan **de una en una**, nunca en paralelo: un modelo local no soporta varias extracciones simultáneas
- [ ] La cola muestra el progreso global y cuál se está procesando ahora
- [ ] El resultado de cada nota se guarda como sus borradores, exactamente igual que si se hubiera extraído a mano
- [ ] Una nota que falla no detiene la cola: se marca con su error y se sigue con la siguiente
- [ ] Varios fallos seguidos sí detienen la cola, con el mismo criterio y el mismo razonamiento que `MAX_CONSECUTIVE_FAILURES` en el envío a Linear
- [ ] La cola se puede cancelar; lo ya extraído se conserva y lo pendiente no se lanza
- [ ] Al terminar hay un resumen: cuántas se extrajeron, cuántas fallaron y cuántas tareas salieron en total
- [ ] Navegar a otra vista no cancela la cola, y volver muestra su estado real
- [ ] Cada nota procesada desaparece de la bandeja de «sin tocar» y pasa a «extraída, sin enviar»

### US-009: Revisar y enviar lo extraído
**Description:** Como usuario, quiero recorrer rápido lo que la cola extrajo y enviarlo, para cerrar la tanda sin volver a navegar carpeta por carpeta.

**Acceptance Criteria:**
- [ ] La bandeja permite ver solo las notas con borradores extraídos y sin enviar
- [ ] Desde una de esas filas se salta al explorador con la nota abierta y su tabla lista para revisar
- [ ] Hay una forma de pasar a la siguiente nota pendiente de revisar sin volver a la bandeja
- [ ] El envío a Linear sigue siendo por nota y con su panel actual: no se crea un envío masivo sin revisión
- [ ] La bandeja refleja el resultado del envío en cuanto termina, sin recargar la página
- [ ] El recuento de la cabecera se mantiene coherente con lo que se ve tras extraer y tras enviar

## Functional Requirements

- FR-1: El sistema debe poder enumerar todas las transcripciones bajo la carpeta de contexto, de forma recursiva y acotada.
- FR-2: El recorrido debe respetar la misma guarda de raíz, las mismas exclusiones y la misma metadata que el listado por carpeta, sin duplicar la lógica.
- FR-3: Los límites de profundidad y número de archivos deben ser explícitos, y alcanzarlos debe informarse al usuario, nunca truncar en silencio.
- FR-4: El resultado del recorrido debe cachearse en memoria del servidor, con caducidad, invalidación por cambio de raíz y reconstrucción manual.
- FR-5: La búsqueda debe encontrar coincidencias sin distinguir mayúsculas ni acentos, en el cuerpo y en el título.
- FR-6: Cada resultado debe incluir un fragmento de contexto y las posiciones a resaltar, sin que la capa de datos genere HTML.
- FR-7: La búsqueda debe acotar el trabajo y avisar cuando devuelve resultados recortados.
- FR-8: La bandeja debe listar las transcripciones sin historial de envío y distinguir las que ya tienen borradores extraídos.
- FR-9: La extracción por lotes debe ser estrictamente secuencial.
- FR-10: Un fallo aislado no detiene la cola; varios fallos seguidos sí.
- FR-11: La cola debe poder cancelarse conservando lo ya hecho.
- FR-12: El envío a Linear sigue siendo por nota, con revisión previa: este PRD no introduce ningún envío masivo sin revisar.

## Non-Goals (Out of Scope)

- Envío masivo a Linear sin revisar nota por nota.
- Extracciones en paralelo.
- Índice de búsqueda persistido en disco, invertido o incremental. El índice es de metadata y vive en memoria.
- Búsqueda con operadores, comodines, expresiones regulares o filtros por asistente y fecha.
- Vigilar la carpeta con `fs.watch` y refrescar solo; aquí la actualización es por caducidad o a petición.
- Formatos que no sean `.md`.
- Vista de calendario o cronología de reuniones.
- Cualquier cosa de estado de Linear, pendientes o decisiones: van en el PRD de memoria de reuniones.

## Technical Considerations

- `listFolder` ya construye la metadata de un `.md` a partir de su contenido; el recorrido recursivo tiene que reutilizar esa construcción, no reimplementarla, o los dos caminos divergirán.
- `resolveInsideRoot` es la única puerta que convierte entrada en ruta; el recorrido recursivo no puede saltársela, y el caso del symlink que cicla dentro de la raíz es nuevo — el scanner actual nunca recursiona, así que hoy no puede darse.
- El índice guarda metadata, no cuerpos: la carpeta de contexto puede tener cientos de notas y el cuerpo de cada una se lee bajo demanda durante la búsqueda.
- La búsqueda lee archivos en el servidor y es el punto más caro de la app después de la extracción; los topes no son adorno, son lo que evita que una consulta de dos letras recorra toda la carpeta.
- El estado de la cola vive en el cliente y sobrevive a cambiar de vista, así que no puede colgar del componente de la bandeja; sigue el patrón de estado por ruta que ya usan `useTaskDrafts` y `usePushRun`.
- La extracción por lotes reutiliza `/api/extract` tal cual, una petición por nota. No hace falta ninguna ruta nueva para ella.
- Los borradores ya se persisten por nota, así que lo que extrae la cola sobrevive a una recarga sin trabajo adicional.
- Los resultados de búsqueda devuelven posiciones, no marcado: el resaltado es cosa del componente, y así la capa de datos queda testeable sin DOM.

## Success Metrics

- Volver de una semana fuera y ver de un vistazo las doce notas pendientes, sin abrir ninguna carpeta.
- Lanzar la extracción de esas doce, irse a por un café y volver a revisarlas.
- Encontrar en segundos la reunión donde se habló de algo, sin recordar cuál era.
- Una carpeta con cientos de notas no vuelve lenta la interfaz ni infla la memoria del servidor.

## Open Questions

- ¿Qué cuenta exactamente como «sin procesar»: sin historial de envío, o tampoco sin borradores? El PRD las distingue, pero el filtro por defecto de la bandeja hay que elegirlo.
- ¿La búsqueda debería poder acotarse a la carpeta seleccionada, además de buscar en todo?
- ¿Cuánto debe durar el índice antes de caducar? Depende de con qué frecuencia aparecen notas nuevas en la carpeta.
- ¿Conviene mostrar en la bandeja las notas cuyos issues ya están todos cerrados, o esas ya no aportan?
