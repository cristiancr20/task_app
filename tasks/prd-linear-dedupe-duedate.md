# PRD: Fechas de vencimiento y detección de duplicados contra Linear

## Overview

Hoy el push a Linear crea issues con título, descripción, prioridad, proyecto y padre. Dos cosas quedan fuera y ambas cuestan trabajo manual después:

1. **Fechas de vencimiento.** El prompt ya obliga al modelo a razonar sobre urgencia («high cuando hay una fecha límite cercana»), pero esa fecha nunca se captura: se disuelve en la prioridad y en el texto de la descripción. Quien luego mira Linear no tiene ninguna fecha con la que ordenar.

2. **Duplicados entre transcripciones distintas.** La app ya avisa cuando *una misma nota* fue enviada antes: el historial está guardado por ruta y la vista lo muestra. Lo que no cubre es el caso real y frecuente: dos reuniones distintas hablan del mismo compromiso («hay que migrar el endpoint de pagos»), y la segunda extracción crea un issue duplicado del que ya existe en Linear. El historial local no puede verlo, porque el issue vino de otro archivo.

Este PRD añade el campo `dueDate` de punta a punta (modelo → tabla editable → Linear) y una comprobación de duplicados que consulta los issues que ya existen en el proyecto de destino y compara por similitud de texto, marcando las filas sospechosas antes de crear nada.

## Goals

- Capturar la fecha de vencimiento que la transcripción expresa y enviarla a Linear como `dueDate`.
- Que el usuario pueda corregir esa fecha en la tabla antes de enviar, igual que corrige la prioridad.
- Detectar, antes de crear, que una tarea ya existe como issue en el proyecto de destino aunque venga de otra transcripción.
- Que un duplicado detectado sea visible, enlazable y no se envíe por accidente — pero que el usuario pueda forzarlo si sabe que es distinto.
- Que la comparación sea determinista y testeable, sin depender de una segunda llamada al modelo.

## Quality Gates

Estos comandos deben pasar en cada user story:
- `pnpm typecheck` — comprobación de tipos (`next typegen && tsc --noEmit`)
- `pnpm test` — batería de tests (`vitest run`)

Sin verificación en navegador: las historias con UI se validan con tests y typecheck.

**Dependencia:** `pnpm test` lo crea el PRD de hardening (US-001). Este PRD asume que ya existe.

## User Stories

### US-001: El modelo extrae la fecha de vencimiento
**Description:** Como usuario, quiero que la extracción capture la fecha límite que la reunión menciona, para no tener que ponerla a mano en cada issue.

**Acceptance Criteria:**
- [ ] `TASKS_JSON_SCHEMA` en `lib/extractors/task.ts` incluye `dueDate` de tipo `['string', 'null']`, requerido como el resto de campos y dentro del subconjunto que aceptan tanto Ollama como Anthropic
- [ ] La descripción del campo en el schema pide una fecha absoluta en formato `YYYY-MM-DD`, o `null` cuando la transcripción no fija ninguna
- [ ] `SYSTEM_PROMPT` instruye explícitamente: resolver las fechas relativas («el viernes», «en dos semanas», «antes de fin de mes») contra la fecha de la reunión, y devolver `null` en vez de inventar una fecha cuando no se menciona ninguna
- [ ] `buildUserPrompt` deja clara cuál es la fecha de la reunión para que sirva de ancla; cuando la nota no tiene fecha, el prompt indica que las fechas relativas no se pueden resolver y deben quedar en `null`
- [ ] `ExtractedTask` incorpora `dueDate: string | null`
- [ ] `normalizeTasks` valida el formato: solo se conserva `YYYY-MM-DD` con mes y día en rango; cualquier otra cosa (texto libre, timestamp ISO completo, fecha imposible como `2026-02-31`, número) pasa a `null`
- [ ] Un timestamp ISO completo (`2026-08-19T00:00:00Z`) se recorta a `2026-08-19` en vez de descartarse
- [ ] Tests en `lib/extractors/task.test.ts` cubriendo formato válido, formato inválido, fecha imposible, timestamp completo y ausencia del campo

### US-002: Columna de vencimiento editable en la tabla
**Description:** Como usuario, quiero ver y corregir la fecha de vencimiento de cada tarea antes de enviarla, para arreglar lo que el modelo interpretó mal.

**Acceptance Criteria:**
- [ ] `TaskDraft` en `app/use-task-drafts.ts` incorpora `dueDate: string | null`
- [ ] Las filas creadas por extracción toman el `dueDate` del modelo; las añadidas a mano empiezan con `null`
- [ ] `app/task-table.tsx` muestra una columna «Vence» con un `<input type="date">` por fila, con los mismos estilos de token que el resto de campos (`FIELD`)
- [ ] Un campo vacío guarda `null`, no cadena vacía
- [ ] La columna se deshabilita durante un push en curso, igual que el resto de campos editables
- [ ] Editar la fecha cuenta como cambio manual en `countManualChanges` (una fila con la fecha cambiada aparece como editada)
- [ ] `sameDraft` compara también `dueDate`
- [ ] Los borradores persistidos incluyen `dueDate` y lo restauran al recargar
- [ ] Tests de `countManualChanges` verificando que un cambio solo de fecha se cuenta como edición

### US-003: La fecha viaja hasta Linear
**Description:** Como usuario, quiero que el issue creado en Linear lleve la fecha de vencimiento, para poder ordenar y filtrar por ella allí.

**Acceptance Criteria:**
- [ ] `CreateIssueInput` en `lib/linear.ts` acepta `dueDate?: string | null`
- [ ] `createIssue` incluye `dueDate` en el `IssueCreateInput` de la mutación solo cuando trae valor, con el mismo patrón de omisión condicional que `projectId` y `parentId`
- [ ] `PushTaskInput` en `lib/push-events.ts` incorpora `dueDate: string | null`
- [ ] La ruta `POST /api/linear/push` lee y valida `dueDate` de cada tarea del cuerpo: un formato inválido se descarta a `null` en vez de rechazar toda la petición, coherente con cómo trata el resto de campos
- [ ] `lib/linear-push.ts` pasa el `dueDate` de cada tarea a `createIssue`
- [ ] El issue padre nunca lleva `dueDate`: representa la reunión, no un compromiso
- [ ] Tests en `lib/linear.test.ts` con `fetch` stubeado: la mutación incluye `dueDate` cuando hay fecha y omite la clave por completo cuando es `null`
- [ ] Verificado contra un stub local de Linear (`LINEAR_API_URL`) siguiendo el patrón ya documentado en `.ralph-tui/progress.md`, sin tocar el workspace real

### US-004: Cliente de Linear — listar los issues que ya existen
**Description:** Como desarrollador, quiero poder traer los issues existentes del proyecto de destino, para poder compararlos con las tareas que están a punto de crearse.

**Acceptance Criteria:**
- [ ] Nueva función `listIssuesForDuplicateCheck(apiKey, { teamId, projectId })` en `lib/linear.ts`
- [ ] Consulta los issues del proyecto cuando hay `projectId`; cuando no lo hay, los del equipo
- [ ] Devuelve por issue: `id`, `identifier`, `title`, `url`, el nombre del estado y si ese estado es de tipo completado o cancelado
- [ ] La conexión se pagina con el mismo patrón que `listTeamsAndProjects`: tamaño de página conservador, tope de `MAX_PAGES` y corte cuando el cursor no avanza
- [ ] Los tamaños de página se eligen sin disparar el «Query too complex» de Linear, y la elección queda comentada como en las consultas existentes
- [ ] Nodos con campos faltantes se descartan en vez de romper el listado, igual que `readTeam` y `readProject`
- [ ] Nueva ruta `GET /api/linear/issues?teamId=…&projectId=…` que devuelve `{ issues }`, leyendo la API key del store en el servidor y usando `errorResponse` de `lib/api.ts`
- [ ] La ruta responde 400 cuando falta `teamId`, con mensaje en español
- [ ] Wrapper de cliente en `lib/linear-client.ts` con su guarda de forma, siguiendo el patrón del resto de `lib/*-client.ts`
- [ ] Tests con `fetch` stubeado: paginación completa, respuesta parcial, y traducción de errores de Linear

### US-005: Módulo de similitud de texto
**Description:** Como desarrollador, quiero una función pura que puntúe cuánto se parecen dos tareas, para poder decidir si una ya existe sin llamar a ningún modelo.

**Acceptance Criteria:**
- [ ] Nuevo módulo `lib/similarity.ts`, sin dependencias externas y sin importar nada de servidor
- [ ] Exporta `normalizeForMatch(text)`: minúsculas, sin acentos ni diacríticos, sin puntuación, espacios colapsados
- [ ] La normalización descarta palabras vacías frecuentes en español y en inglés y los verbos de encabezado que aportan poco («hacer», «revisar», «do», «check») solo cuando sobra contenido, para que un título corto no quede vacío
- [ ] Exporta `similarity(a, b)` con resultado entre 0 y 1: 1 para textos idénticos tras normalizar, 0 cuando no comparten nada
- [ ] La medida combina solapamiento de tokens y de bigramas de caracteres, de modo que «Migrar endpoint de pagos» y «Migración del endpoint de pagos» puntúan alto pese a no compartir la forma exacta de las palabras
- [ ] Exporta `bestMatch(candidate, existing[])` que devuelve el elemento más parecido y su puntuación, o `null` cuando la lista está vacía
- [ ] Exporta un umbral con nombre (`DUPLICATE_THRESHOLD`) comentado con el criterio con el que se eligió
- [ ] Tests en `lib/similarity.test.ts`: idénticos → 1; solo diferencias de mayúsculas, acentos o puntuación → 1; misma tarea reformulada → por encima del umbral; tareas claramente distintas → por debajo; cadena vacía contra cualquier cosa → 0; textos largos no degradan a puntuaciones altas por casualidad

### US-006: Comprobación de duplicados por transcripción
**Description:** Como usuario, quiero que la app compare mis tareas con lo que ya hay en el proyecto, para enterarme antes de crear un issue repetido.

**Acceptance Criteria:**
- [ ] Nuevo hook `app/use-duplicate-check.ts`, con el estado keyed por ruta de transcripción como el resto de hooks del explorador
- [ ] Los issues existentes se piden una vez por proyecto seleccionado y se reutilizan para todas las notas mientras no cambie el destino
- [ ] La comprobación se ejecuta al terminar una extracción, al cambiar el proyecto de destino y a petición desde un botón «Buscar duplicados»
- [ ] Cada fila obtiene: ninguna coincidencia, o la mejor coincidencia con su puntuación, su `identifier`, su `title`, su `url` y si el issue está ya completado o cancelado
- [ ] Solo se marca como duplicado la coincidencia que supera `DUPLICATE_THRESHOLD`
- [ ] Un issue en estado completado o cancelado se marca aparte: sigue siendo información útil, pero no bloquea el envío por sí solo
- [ ] Editar el título de una fila invalida su resultado y vuelve a comprobarla, con debounce
- [ ] Si no hay API key, no hay proyecto elegido o la consulta falla, la comprobación queda en un estado no concluyente y **nunca** bloquea el envío; el error se muestra sin ser modal
- [ ] Una respuesta que llega tarde no escribe sobre otra nota ni sobre otro proyecto
- [ ] Las filas ya creadas en este push (`state === 'created'`) no se comprueban

### US-007: La tabla marca los duplicados y los excluye del envío
**Description:** Como usuario, quiero ver qué fila ya existe en Linear y decidir yo si la envío igual, para no crear ruido pero tampoco perder una tarea legítima.

**Acceptance Criteria:**
- [ ] Una fila con duplicado detectado muestra un distintivo «Ya existe» con el `identifier` del issue y enlace a su URL, que abre en una pestaña nueva
- [ ] El distintivo indica el grado de coincidencia de forma legible para una persona (no un decimal crudo)
- [ ] Un duplicado cuyo issue está completado o cancelado se distingue visualmente del que está abierto, y su texto lo dice
- [ ] Al detectarse, la fila se desmarca automáticamente de «incluir» una sola vez; si el usuario vuelve a marcarla, la app no la desmarca otra vez
- [ ] Una fila remarcada a mano se envía con normalidad y muestra que se está forzando
- [ ] El resumen del panel de envío refleja las filas excluidas por duplicado, de forma que la cuenta del botón coincide con lo que realmente se va a crear
- [ ] Mientras la comprobación está en curso, la tabla lo indica y el botón de envío no se bloquea por ello
- [ ] Los colores usan los tokens existentes (`warn` para el aviso, `muted` para el issue ya cerrado); no se introduce ninguna variante `dark:` ni ningún color literal
- [ ] Sin API key o sin proyecto, la columna no aparece en vez de mostrar un estado de error permanente

## Functional Requirements

- FR-1: El schema de extracción debe incluir `dueDate` como fecha absoluta `YYYY-MM-DD` o `null`, y ambos extractores (Ollama y Claude) deben producirla sin divergir.
- FR-2: El sistema no debe inventar fechas: si la transcripción no fija ninguna, `dueDate` es `null`.
- FR-3: Una fecha relativa debe resolverse contra la fecha de la reunión; sin fecha de reunión, queda en `null`.
- FR-4: Toda fecha que no cumpla `YYYY-MM-DD` válido debe normalizarse a `null` antes de llegar a la UI.
- FR-5: El usuario debe poder editar o borrar la fecha de cualquier fila antes de enviar.
- FR-6: El issue creado en Linear debe llevar `dueDate` cuando la fila la tiene, y no llevar la clave cuando no.
- FR-7: Antes de un envío, el sistema debe poder consultar los issues existentes del proyecto de destino y compararlos con cada fila.
- FR-8: La comparación debe ser determinista: los mismos textos dan siempre la misma puntuación, sin llamadas a ningún modelo.
- FR-9: Una fila con duplicado por encima del umbral debe quedar excluida del envío por defecto, señalada y enlazada al issue existente.
- FR-10: El usuario debe poder forzar el envío de una fila marcada como duplicada.
- FR-11: Un fallo de la comprobación de duplicados nunca debe impedir enviar.
- FR-12: La comprobación no debe volver a pedir la lista de issues en cada pulsación de tecla ni en cada cambio de nota con el mismo proyecto.

## Non-Goals (Out of Scope)

- Asignar responsables (`assigneeId`) a partir de `mentioned`. Queda para más adelante.
- Etiquetas, estimaciones, estado inicial o ciclo.
- Colgar las tareas de un issue padre ya existente.
- Comparación semántica con un modelo (embeddings o una segunda pasada del LLM). Esta versión es determinista por texto.
- Actualizar o fusionar el issue existente cuando se detecta un duplicado: solo se avisa y se excluye.
- Deshacer o archivar issues ya creados.
- Cambiar la clave del historial local de `relPath` a un identificador estable.
- Detección de duplicados entre las propias filas de una misma extracción.

## Technical Considerations

- `lib/linear.ts` ya documenta que Linear puntúa la complejidad de la query de forma multiplicativa y rechaza lo que se pasa de presupuesto: los tamaños de página de la nueva consulta hay que medirlos contra la API real, no contra una query simplificada.
- Los tipos que cruzan al navegador no pueden arrastrar módulos de servidor: `lib/linear.ts` lee `process.env`, así que el cliente importa sus tipos con `import type` y cualquier *valor* compartido (el umbral, por ejemplo) vive en un módulo que no importa nada más que tipos, como `lib/push-events.ts`.
- `lib/similarity.ts` debe ser importable desde el cliente, así que no puede tocar `node:` nada.
- El estado por nota se guarda keyed por ruta porque los paneles no se desmontan al cambiar de selección: un resultado asíncrono debe escribirse bajo la ruta que capturó, no bajo la que esté en pantalla — el mismo patrón que `useTaskDrafts`, `usePushOptions` y `usePushRun`.
- La lista de issues existentes puede ser grande en un proyecto vivo; conviene guardarla ya normalizada (`normalizeForMatch` aplicado una vez por issue) para no repetir el trabajo en cada comparación.
- La columna nueva de la tabla entra en un panel que ya va justo de ancho: revisar que «Vence» y el distintivo de duplicado no rompan el layout con el árbol de carpetas abierto.
- Los borradores persistidos ganan un campo; la normalización defensiva del store debe tratar un borrador antiguo sin `dueDate` como `null` en vez de descartar la fila.

## Success Metrics

- Una transcripción que dice «lo tengo para el viernes 28» produce un issue en Linear con `dueDate` correcto sin intervención manual.
- Una transcripción que no menciona ninguna fecha no produce ninguna fecha inventada.
- Extraer dos veces el mismo compromiso desde dos notas distintas marca la segunda como «Ya existe» y no crea el duplicado.
- Dos tareas que hablan de temas distintos no se marcan nunca como duplicadas entre sí.
- Con Linear caído o sin clave, el envío sigue funcionando exactamente como hoy.

## Open Questions

- ¿Qué umbral de similitud acierta en la práctica? Hay que calibrarlo contra las transcripciones reales del usuario; se elige un valor inicial y se ajusta con lo que se vea.
- ¿La comparación debe usar solo el título, o también la descripción y la evidencia? El título es más limpio; la descripción aporta contexto pero también ruido.
- ¿Conviene mirar más allá del proyecto de destino (todo el equipo) a costa de más round trips y más falsos positivos?
- ¿Se guarda en el historial local que una fila se descartó por duplicada, para no volver a proponerla en cada extracción?
- ¿Los issues completados hace mucho deberían quedar fuera de la comparación por antigüedad?
