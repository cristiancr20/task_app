# PRD: Memoria de reuniones — estado de vuelta, compromisos abiertos y lo que no es una tarea

## Overview

Hoy la app es un embudo de una sola dirección: lees una transcripción, extraes tareas, las creas en Linear y ahí se acaba la relación. Nunca vuelve nada. El historial local sabe *qué* issues se crearon, pero no *qué fue de ellos*, y de todo lo que dice una reunión solo se conserva lo que es un compromiso.

Este PRD cierra el ciclo en tres movimientos que se apoyan entre sí:

1. **Estado de vuelta desde Linear.** El historial ya guarda el id de cada issue creado. Consultarlos permite decir, en la nota y en la lista de archivos: *«8 tareas · 5 hechas · 2 en curso · 1 sin empezar»*. La app deja de ser un cargador de issues y pasa a ser el seguimiento de las reuniones.

2. **Compromisos que siguen abiertos.** Al abrir una nota, un panel con lo que quedó pendiente de reuniones *anteriores* enviadas al mismo proyecto de Linear. Es exactamente lo que uno olvida preguntar en la siguiente reunión, y sale casi gratis del punto 1.

3. **Decisiones, riesgos y preguntas abiertas.** El modelo ya lee la reunión entera para sacar los compromisos; pedirle tres listas más cuesta lo mismo. Las decisiones son lo primero que se pierde de una reunión y hoy se tiran. Se muestran en la app y se pueden copiar; no se envían a ningún sitio.

## Goals

- Ver el estado real en Linear de todo lo que una nota produjo, sin salir de la app.
- Que ese estado se mantenga fresco solo, sin que el usuario tenga que refrescar nada.
- Que al abrir una nota se vea lo que sigue pendiente de reuniones anteriores del mismo proyecto.
- Capturar decisiones, riesgos y preguntas abiertas en el mismo pase de extracción, sin coste adicional.
- Que nada de esto bloquee el flujo actual: sin API key, sin proyecto o con Linear caído, la app funciona exactamente como hoy.

## Quality Gates

Estos comandos deben pasar en cada user story:
- `pnpm typecheck` — comprobación de tipos (`next typegen && tsc --noEmit`)
- `pnpm test` — batería de tests (`vitest run`)

Sin verificación en navegador: las historias con UI se validan con tests y typecheck.

## User Stories

### US-001: Cliente de Linear — consultar el estado de issues por id
**Description:** Como desarrollador, quiero preguntarle a Linear en qué estado están unos issues concretos, para poder informar de lo que produjo cada nota.

**Acceptance Criteria:**
- [ ] Nueva función `fetchIssueStates(apiKey, ids)` en `lib/linear.ts` que devuelve, por issue: `id`, `identifier`, `title`, `url`, el nombre del estado y su tipo
- [ ] El tipo de estado se expone como una unión propia (`triage`, `backlog`, `unstarted`, `started`, `completed`, `canceled`) y cualquier valor desconocido de Linear cae en `unstarted` en vez de romper el parseo
- [ ] La consulta filtra por los ids pedidos en una sola petición por lote, no una petición por issue
- [ ] Los ids se parten en lotes de tamaño acotado y comentado, con el mismo criterio de complejidad de query documentado en `listTeamsAndProjects`
- [ ] La conexión se pagina con el patrón existente: tope de `MAX_PAGES` y corte cuando el cursor no avanza
- [ ] Un id que Linear ya no conoce (issue borrado) simplemente no aparece en el resultado, sin lanzar
- [ ] Una lista de ids vacía devuelve un resultado vacío sin llegar a hacer ninguna petición
- [ ] Nodos con campos faltantes se descartan como hacen `readTeam` y `readProject`
- [ ] Tests en `lib/linear.test.ts` con `fetch` stubeado: lote único, varios lotes, paginación, id inexistente, estado desconocido y error de Linear traducido

### US-002: Ruta y wrapper de cliente para el estado de una nota
**Description:** Como frontend, quiero pedir el estado de los issues de una transcripción sin conocer la API key, para poder mostrarlo en la interfaz.

**Acceptance Criteria:**
- [ ] Nueva ruta `POST /api/linear/issue-states` que recibe `{ path }` y responde `{ states }`
- [ ] La ruta lee del historial de esa nota los ids ya creados, en el servidor: el navegador manda la ruta de la nota, nunca la lista de ids ni la credencial
- [ ] Valida que `path` acabe en `.md` con `requireMarkdownPath` y usa `requireContextRoot()` y `errorResponse` de `lib/api.ts`, como el resto de rutas
- [ ] Sin API key guardada responde 400 con mensaje en español, sin llamar a Linear
- [ ] Una nota sin historial responde `{ states: [] }` con 200, no un error
- [ ] Wrapper en `lib/issue-states-client.ts` con su guarda de forma `isX()`, siguiendo el patrón del resto de `lib/*-client.ts`
- [ ] Tests del wrapper: respuesta válida, respuesta con forma inesperada y error del servidor propagado con su texto

### US-003: Resumen de estado en la nota abierta
**Description:** Como usuario, quiero ver de un vistazo qué fue de las tareas que creé desde esta reunión, para saber si hay que insistir en algo.

**Acceptance Criteria:**
- [ ] Nuevo hook `app/use-issue-states.ts` con el estado keyed por ruta de transcripción, como el resto de hooks del explorador
- [ ] La consulta se lanza al abrir una nota que tiene historial, y el resultado se cachea en memoria durante la sesión
- [ ] El componente `PushedHistory` (o el que ocupe su lugar) muestra el recuento agrupado: hechas, en curso, sin empezar y canceladas
- [ ] Cada issue del historial muestra su estado actual junto a su `identifier` y sigue enlazando a Linear
- [ ] Una nota sin historial no muestra el bloque y no lanza ninguna consulta
- [ ] Sin API key el bloque muestra el historial como hoy, sin estados y sin error
- [ ] Un fallo de la consulta deja el historial visible con un aviso discreto y un «Reintentar»; nunca sustituye al historial por un error
- [ ] Una respuesta que llega tarde no escribe sobre otra nota
- [ ] La función que agrupa los estados en recuentos es pura, vive fuera del componente y está cubierta por tests

### US-004: El estado se refresca solo en segundo plano
**Description:** Como usuario, quiero que el estado se mantenga al día mientras tengo la app abierta, para no tener que refrescar a mano.

**Acceptance Criteria:**
- [ ] El estado de la nota abierta se vuelve a consultar cada cierto intervalo, definido en una constante con nombre y comentada
- [ ] El refresco se detiene cuando la pestaña no está visible (`document.visibilityState`) y se reanuda al volver, para no consumir cuota de Linear en segundo plano
- [ ] Nunca hay dos consultas solapadas de la misma nota: si una sigue en vuelo, el tick se salta
- [ ] Cambiar de nota cancela el ciclo de la anterior
- [ ] Una nota sin historial o sin API key no programa ningún refresco
- [ ] Un fallo del refresco automático no muestra error a pantalla completa ni borra el estado ya conocido; el último estado bueno se mantiene
- [ ] Existe además un control manual de «Actualizar» que fuerza la consulta sin esperar al intervalo
- [ ] El temporizador se limpia al desmontar, sin fugas

### US-005: El progreso también se ve en la lista de archivos
**Description:** Como usuario, quiero distinguir en la lista qué reuniones ya están resueltas y cuáles siguen coleando, sin abrirlas una por una.

**Acceptance Criteria:**
- [ ] El distintivo de nota ya procesada de `app/file-list.tsx` incorpora el progreso: cuántas de sus tareas están cerradas
- [ ] Una nota con todo cerrado se distingue visualmente de una con trabajo pendiente
- [ ] Los estados de las notas de la carpeta visible se piden en una sola petición, no una por archivo
- [ ] Sin API key, el distintivo sigue mostrando lo de hoy (que la nota ya se envió) sin hueco ni error
- [ ] Mientras los estados no han llegado, el distintivo no parpadea entre dos formas: muestra lo que ya sabía y se completa cuando llegan
- [ ] Los colores salen de los tokens existentes; no se introduce ninguna variante `dark:` ni ningún color literal

### US-006: El historial recuerda a qué proyecto se envió
**Description:** Como desarrollador, quiero saber a qué equipo y proyecto de Linear fue cada envío, para poder filtrar los pendientes por el proyecto que el usuario tiene delante.

**Acceptance Criteria:**
- [ ] `HistoryEntry` en `lib/store.ts` incorpora `teamId: string | null` y `projectId: string | null`
- [ ] La ruta de push guarda ambos al escribir la entrada del historial, tomándolos del plan ya validado
- [ ] La normalización trata una entrada antigua sin esos campos como `null` en vez de descartarla: el historial existente no se pierde ni se corrompe
- [ ] `addHistoryEntry` y `getHistory` siguen funcionando igual para quien no mire los campos nuevos
- [ ] Tests en `lib/store.test.ts`: entrada nueva con proyecto, entrada antigua sin él, y campos con el tipo equivocado normalizados a `null`

### US-007: Selector de compromisos pendientes
**Description:** Como desarrollador, quiero una función pura que decida qué pendientes mostrar en una nota, para que la regla esté en un sitio y se pueda testear.

**Acceptance Criteria:**
- [ ] Nuevo módulo `lib/pending-commitments.ts`, sin dependencias de servidor, importable desde el navegador
- [ ] Exporta una función que recibe el historial completo, los estados conocidos de los issues, la ruta de la nota abierta y el `projectId` seleccionado, y devuelve los pendientes a mostrar
- [ ] Solo entran issues cuyo estado **no** es `completed` ni `canceled`
- [ ] Solo entran issues enviados al mismo `projectId` que está seleccionado ahora
- [ ] Las entradas antiguas del historial sin `projectId` quedan fuera cuando hay un proyecto seleccionado, para no mezclar clientes distintos
- [ ] Los issues de la propia nota abierta quedan fuera: esos ya se ven en su propio bloque de estado
- [ ] El resultado se ordena por antigüedad, del más viejo al más reciente, y cada elemento lleva la ruta y el título de la nota de la que salió
- [ ] Sin `projectId` seleccionado la función devuelve lista vacía en vez de devolverlo todo
- [ ] Tests en `lib/pending-commitments.test.ts` cubriendo cada regla por separado, incluido el historial mixto con entradas antiguas

### US-008: Panel «Pendiente de reuniones anteriores»
**Description:** Como usuario, quiero ver al abrir una reunión qué quedó sin cerrar de las anteriores, para acordarme de preguntarlo.

**Acceptance Criteria:**
- [ ] Nuevo componente que lista los pendientes que devuelve `lib/pending-commitments.ts`
- [ ] Cada fila muestra: `identifier` enlazado a Linear, título, la persona que la transcripción puso al mando cuando la hay, cuánto tiempo lleva abierta y su estado actual
- [ ] Cada fila indica de qué reunión salió, y hacer clic en ese origen abre esa nota
- [ ] El panel no aparece cuando no hay pendientes, en vez de mostrar un bloque vacío
- [ ] El panel se puede plegar, y si la lista es larga se limita a un número razonable con un «ver todas» que muestra el resto
- [ ] Sin API key o sin proyecto seleccionado el panel no aparece
- [ ] Los estados que alimentan el panel se reutilizan de la caché de sesión: abrir una nota no vuelve a consultar lo que ya se consultó
- [ ] Los colores salen de los tokens existentes

### US-009: El modelo extrae decisiones, riesgos y preguntas abiertas
**Description:** Como usuario, quiero que la extracción capture también lo que no es una tarea, porque las decisiones son lo primero que se pierde de una reunión.

**Acceptance Criteria:**
- [ ] `TASKS_JSON_SCHEMA` en `lib/extractors/task.ts` incorpora tres listas más: decisiones, riesgos y preguntas abiertas, dentro del subconjunto de JSON Schema que aceptan tanto Ollama como Anthropic
- [ ] Cada elemento de las tres listas lleva su propio texto y su `evidence`: la frase de la transcripción que lo prueba, copiada literal en su idioma original
- [ ] Una decisión lleva además quién la tomó cuando la transcripción lo dice, o `null`
- [ ] Un riesgo lleva además a qué afecta cuando se dice, o `null`
- [ ] `SYSTEM_PROMPT` define los tres conceptos y deja claro que una decisión no es una tarea, que las tres listas pueden venir vacías y que **no se inventa nada**, con la misma contundencia que la regla de las tareas
- [ ] El tipo que devuelve la extracción pasa a ser un resultado con las cuatro listas, y ambos extractores lo producen sin divergir
- [ ] La normalización descarta elementos sin texto, recorta espacios y trata las tres listas ausentes como vacías
- [ ] `/api/extract` responde las cuatro listas y la respuesta sigue siendo válida para un cliente que solo mire las tareas
- [ ] Tests en `lib/extractors/task.test.ts` para la normalización de las tres listas nuevas: elementos vacíos, campos del tipo equivocado, listas ausentes y payload sin ninguna de ellas

### US-010: Decisiones, riesgos y preguntas en la interfaz
**Description:** Como usuario, quiero leer y copiar lo que se decidió, lo que preocupa y lo que quedó en el aire, sin que se mezcle con las tareas que voy a enviar.

**Acceptance Criteria:**
- [ ] Las tres listas se muestran en la columna de tareas, claramente separadas de la tabla que se envía a Linear
- [ ] Cada elemento muestra su texto y permite ver la evidencia que lo respalda
- [ ] Cada lista se puede copiar al portapapeles como Markdown, y hay un control para copiarlas todas juntas
- [ ] Una lista vacía no ocupa espacio con un bloque vacío
- [ ] Nada de esto se envía a Linear ni entra en el recuento del botón de envío
- [ ] Las tres listas se persisten junto a los borradores de la nota y se restauran al recargar
- [ ] Regenerar la extracción las reemplaza junto con las tareas, y el aviso de cambios manuales sigue contando solo las filas de la tabla
- [ ] La función que convierte una lista en Markdown es pura y está cubierta por tests

## Functional Requirements

- FR-1: El sistema debe poder consultar a Linear el estado actual de los issues que él mismo creó, a partir de los ids del historial.
- FR-2: El navegador nunca recibe la API key; pide el estado por la ruta de la nota y el servidor resuelve los ids.
- FR-3: El estado de la nota abierta debe refrescarse periódicamente sin intervención, y detenerse cuando la pestaña no está visible.
- FR-4: Dos consultas de la misma nota no pueden solaparse.
- FR-5: El historial debe registrar el equipo y el proyecto de cada envío, sin invalidar las entradas que ya existen.
- FR-6: Los pendientes mostrados en una nota deben ser issues abiertos, del mismo proyecto seleccionado, creados desde otras notas, ordenados del más antiguo al más reciente.
- FR-7: Sin proyecto seleccionado no se muestran pendientes.
- FR-8: La extracción debe producir, además de las tareas, decisiones, riesgos y preguntas abiertas, cada una con su evidencia literal.
- FR-9: El modelo no debe inventar ninguna de las tres listas nuevas; vacías es una respuesta correcta.
- FR-10: Las tres listas nuevas no se envían a Linear ni afectan al recuento del envío.
- FR-11: Sin API key, sin proyecto o con Linear caído, todo lo anterior se degrada en silencio y el flujo de extraer y enviar sigue funcionando igual que hoy.

## Non-Goals (Out of Scope)

- Modificar, cerrar o reasignar issues desde la app. El estado se lee, nunca se escribe.
- Publicar las decisiones, riesgos o preguntas en Linear (como comentario, documento o issue). Solo se ven y se copian.
- Escribir de vuelta nada en el archivo `.md` original.
- Asignar responsables (`assigneeId`), etiquetas, estimaciones o ciclos.
- Notificaciones, recordatorios o avisos fuera de la app.
- Vista de pendientes agrupada por persona, o que cruce todos los proyectos a la vez.
- Generar la agenda de la próxima reunión.
- Bandeja de entrada, proceso por lotes y búsqueda: van en su propio PRD.

## Technical Considerations

- El historial ya guarda `id`, `identifier`, `url` y `title` por issue (`lib/store.ts`), así que la consulta de estado no necesita ninguna migración: los ids ya están ahí. Lo único que falta es el proyecto, que añade US-006.
- `lib/linear.ts` documenta que Linear puntúa la complejidad de la query de forma multiplicativa: el tamaño de lote de la consulta de estados hay que medirlo contra la API real, no contra una query simplificada.
- Los tipos que cruzan al navegador no pueden arrastrar módulos de servidor: `lib/linear.ts` lee `process.env`, así que el cliente importa sus tipos con `import type`, y cualquier valor compartido vive en un módulo que solo importa tipos, como `lib/push-events.ts`. `lib/pending-commitments.ts` debe cumplir eso.
- El estado por nota se guarda keyed por ruta porque los paneles no se desmontan al cambiar de selección: un resultado asíncrono debe escribirse bajo la ruta que capturó, no bajo la que esté en pantalla — el patrón de `useTaskDrafts`, `usePushOptions` y `usePushRun`.
- La caché de estados es de sesión y se comparte entre el bloque de la nota, el panel de pendientes y los distintivos de la lista: los tres miran lo mismo, y consultarlo tres veces gastaría cuota para nada.
- El refresco periódico necesita limpiar su temporizador al desmontar y al cambiar de nota; una fuga aquí multiplica las peticiones en silencio.
- La columna de tareas ya va justa de ancho: el panel de pendientes y los tres bloques nuevos tienen que caber con el árbol de carpetas abierto.
- Los borradores persistidos ganan tres listas; la normalización defensiva del store debe tratar un borrador antiguo sin ellas como listas vacías en vez de descartarlo.

## Success Metrics

- Abrir una nota enviada hace semanas muestra, sin tocar nada, cuántas de sus tareas siguen abiertas.
- Cerrar un issue en Linear se refleja en la app sin recargar la página.
- Abrir la nota de hoy recuerda el compromiso de hace tres semanas que nadie había vuelto a mirar.
- Una reunión que solo tomó decisiones y no generó compromisos deja de parecer una reunión sin resultado.
- Quitar la API key de Linear deja la app funcionando exactamente igual que antes de este PRD.

## Open Questions

- ¿Cada cuánto conviene refrescar? Un minuto es cómodo para el usuario pero puede ser mucha cuota con la app abierta todo el día; hay que elegir un valor inicial y ajustarlo con el uso real.
- ¿Los pendientes deberían tener un tope de antigüedad, o algo abierto desde hace seis meses sigue siendo relevante?
- ¿Debería poder marcarse un pendiente como «ya no aplica» sin tocar Linear?
- ¿Los estados consultados merecen guardarse en `.data` para que la primera pintura tras recargar no salga vacía?
