# PRD: Hardening — red de seguridad, privacidad local y trabajo que no se pierde

## Overview

La app funciona de punta a punta (explorar transcripciones → extraer tareas → crearlas en Linear), pero descansa sobre una base sin verificación: no hay tests, la única puerta de calidad es `tsc --noEmit`. Al mismo tiempo hay tres fugas concretas que ya muerden hoy:

1. El servidor de desarrollo escucha en toda la red local sin ninguna autenticación. Cualquiera en la misma wifi puede entrar a `/settings`, apuntar la carpeta de contexto a cualquier ruta absoluta de la máquina, leer los `.md` que haya ahí y crear issues en el Linear del usuario con su API key.
2. `.data/config.json` guarda las API keys de Linear y Anthropic en texto plano con permisos `0644`.
3. Los borradores de tareas viven solo en memoria de React (`useTaskDrafts`). Un F5, un hot-reload o un reinicio del server borra toda la curación manual — que es justo el trabajo caro del flujo.

Este PRD cierra esas cuatro cosas: batería de tests sobre la lógica pura, bind local, permisos del config y persistencia de los borradores. No añade ninguna funcionalidad de producto.

## Goals

- Tener un gate de calidad real: `pnpm typecheck && pnpm test` cubriendo la lógica que hoy nadie verifica (guarda de path traversal, parseo de frontmatter, normalización de la respuesta del modelo, cliente de Linear, store de configuración).
- Que el servidor no sea alcanzable desde la red local por defecto.
- Que las credenciales en disco no sean legibles por otros usuarios de la máquina.
- Que los borradores de tareas sobrevivan a una recarga, a un hot-reload y a un reinicio del servidor.
- Que el README describa cómo arrancar y configurar la app de verdad.

## Quality Gates

Estos comandos deben pasar en cada user story:
- `pnpm typecheck` — comprobación de tipos (`next typegen && tsc --noEmit`)
- `pnpm test` — batería de tests (`vitest run`)

Nota: el script `pnpm test` lo crea US-001. Para esa historia, el criterio es que el comando exista y pase.

Sin verificación en navegador: las historias con UI se validan con tests y typecheck.

## User Stories

### US-001: Montar Vitest y el script `test`
**Description:** Como desarrollador, quiero un runner de tests configurado para poder verificar la lógica pura del proyecto en cada cambio.

**Acceptance Criteria:**
- [ ] `vitest` instalado como devDependency con pnpm
- [ ] `package.json` expone `"test": "vitest run"` (modo no interactivo, apto para CI y para agentes)
- [ ] `package.json` expone `"test:watch": "vitest"` para desarrollo local
- [ ] Los tests se ubican junto al código como `lib/**/*.test.ts` y esa convención queda documentada en `AGENTS.md`
- [ ] La configuración usa el alias `@/` igual que `tsconfig.json`, de modo que `import { getConfig } from '@/lib/store'` funciona dentro de un test
- [ ] El entorno de test es `node` (ninguna de las historias de este PRD testea componentes de React)
- [ ] Existe al menos un test real que pasa (por ejemplo `normalizeRelPath` o `titleFromFileName`), no un test placeholder vacío
- [ ] `pnpm test` termina con código de salida 0 y no queda en modo watch

### US-002: Tests de la guarda de path traversal
**Description:** Como desarrollador, quiero cubrir con tests la única barrera que impide leer archivos fuera de la carpeta de contexto, para que un refactor no la abra sin que nadie se entere.

**Acceptance Criteria:**
- [ ] Tests para `resolveInsideRoot` en `lib/transcripts.test.ts`, sobre un directorio temporal creado en el propio test (`fs.mkdtempSync`) y borrado al terminar
- [ ] Una ruta relativa normal dentro de la raíz resuelve a la ruta absoluta esperada
- [ ] `../fuera.md`, `sub/../../fuera.md` y variantes con múltiples `..` lanzan `PathEscapesRootError`
- [ ] Una ruta absoluta (`/etc/passwd`) no escapa: se interpreta como relativa a la raíz y por tanto no alcanza el archivo real
- [ ] Un symlink creado dentro de la raíz que apunta fuera de ella lanza `PathEscapesRootError`
- [ ] Un symlink dentro de la raíz que apunta a otro archivo dentro de la raíz resuelve correctamente
- [ ] `''`, `'.'` y `'/'` resuelven a la raíz misma
- [ ] Backslashes (`sub\nota.md`) se normalizan a `/` y no escapan
- [ ] Un path inexistente no lanza `PathEscapesRootError` (el ENOENT lo surface el llamador)

### US-003: Tests del scanner de transcripciones
**Description:** Como desarrollador, quiero cubrir el parseo de los `.md` para que un cambio en el frontmatter no rompa silenciosamente los metadatos que ve el modelo.

**Acceptance Criteria:**
- [ ] Tests para `readTranscript` y `listFolder` en `lib/transcripts.test.ts`, sobre un directorio temporal con archivos de fixture escritos por el propio test
- [ ] Frontmatter válido: `title`, `date` y `attendees` (lista YAML) se leen y el body vuelve sin el bloque `---`
- [ ] `attendees` como línea única separada por comas produce el mismo array que la lista YAML
- [ ] Frontmatter con YAML malformado se trata como texto del body y `hasFrontmatter` es `false`, sin lanzar
- [ ] Un frontmatter que es un escalar o una secuencia (YAML válido pero sin campos) también da `hasFrontmatter: false`
- [ ] Sin frontmatter: el título sale del nombre de archivo (`2026-08-09 Weekly sync.md` → `Weekly sync`) y la fecha del prefijo `YYYY-MM-DD`
- [ ] `date` como objeto `Date` del parser YAML se normaliza a `YYYY-MM-DD`
- [ ] Un BOM al principio del archivo no impide detectar el frontmatter
- [ ] `listFolder` devuelve solo `.md`, omite dotfiles y `node_modules`, y no recursiona
- [ ] `listFolder` ordena los archivos por fecha descendente y, a igualdad, por título; los que no tienen fecha van al final
- [ ] Un archivo ilegible no rompe el listado del resto de la carpeta

### US-004: Tests de la normalización de la respuesta del modelo
**Description:** Como desarrollador, quiero cubrir `normalizeTasks` para que ninguna respuesta rara de un modelo local llegue a la tabla o a Linear.

**Acceptance Criteria:**
- [ ] Tests en `lib/extractors/task.test.ts`
- [ ] Acepta el envoltorio `{ tasks: [...] }` y también un array pelado en la raíz
- [ ] Cualquier otro payload (`null`, string, número, objeto sin `tasks`) devuelve array vacío sin lanzar
- [ ] Una fila sin título, con título vacío o con título solo de espacios se descarta
- [ ] Una prioridad desconocida, `null` o numérica se normaliza a `none`; las cinco válidas se conservan
- [ ] La prioridad llega en mayúsculas (`"HIGH"`) y se normaliza a `high`
- [ ] `mentioned` vacío o solo espacios se normaliza a `null`; un nombre se conserva recortado
- [ ] Campos numéricos o booleanos donde se esperaba string se convierten a string en vez de descartarse
- [ ] `buildUserPrompt` incluye la fecha y los asistentes solo cuando existen

### US-005: Tests del cliente de Linear
**Description:** Como desarrollador, quiero cubrir el parseo de las respuestas de Linear y la construcción del cuerpo del issue, sin tocar el workspace real.

**Acceptance Criteria:**
- [ ] Tests en `lib/linear.test.ts` con `global.fetch` stubeado (`vi.stubGlobal`), sin ninguna petición de red real
- [ ] `buildIssueDescription` sin `source` devuelve el body tal cual
- [ ] `buildIssueDescription` con `source` completo emite el separador `---`, la línea `**Source:**` con título y fecha, `**Mentioned:**` y la evidencia como blockquote
- [ ] Una evidencia de varias líneas se prefija con `>` en todas ellas
- [ ] Con `source` pero sin ningún campo con contenido, no se añade bloque vacío
- [ ] `createIssue` mapea las prioridades a la escala de Linear (`urgent`→1, `high`→2, `medium`→3, `low`→4, `none`→0)
- [ ] `createIssue` lanza `LinearApiError` cuando la respuesta trae `success: false` aunque el HTTP sea 200
- [ ] `createIssue` omite `projectId` y `parentId` del input cuando llegan vacíos o nulos
- [ ] `listTeamsAndProjects` sigue el cursor de equipos y el de proyectos hasta agotarlos y devuelve todo agregado y ordenado por nombre
- [ ] Un cursor que no avanza no produce bucle infinito (se corta en `MAX_PAGES`)
- [ ] Un 401 de Linear se traduce a `LinearApiError` con status 401; un 400 con `errors` se traduce a 502 conservando el mensaje de Linear
- [ ] Un fallo de red (fetch que rechaza) produce `LinearUnreachableError`

### US-006: Tests del store de configuración
**Description:** Como desarrollador, quiero cubrir la lectura, la normalización y la escritura atómica del config para que un archivo corrupto nunca tumbe una petición.

**Acceptance Criteria:**
- [ ] Tests en `lib/store.test.ts` apuntando `.data` a un directorio temporal (variable de entorno o mock de `lib/data-dir`), sin tocar el `.data` real del desarrollador
- [ ] Un archivo inexistente devuelve la config por defecto
- [ ] Un archivo con JSON inválido devuelve la config por defecto en vez de lanzar
- [ ] Un archivo con campos del tipo equivocado (`recentFolders` como string, `history` como array) devuelve los valores por defecto de esos campos y conserva los válidos
- [ ] `provider` con un valor desconocido cae a `'ollama'`
- [ ] `updateConfig` fusiona el parcial sobre lo guardado y persiste el resultado
- [ ] `addHistoryEntry` añade al final (más reciente último) y no pierde las entradas previas
- [ ] Una entrada de historial sin `pushedAt` o sin `issues` se descarta al normalizar
- [ ] `getPushSummaries` omite las notas cuyo historial no tiene ningún issue y cuenta bien issues y pushes de las demás
- [ ] Tras una escritura no queda ningún archivo `.tmp` en el directorio

### US-007: El servidor solo escucha en localhost
**Description:** Como usuario, quiero que la app no sea alcanzable desde la red local, para que nadie más pueda leer mis notas ni usar mi API key de Linear.

**Acceptance Criteria:**
- [ ] El script `dev` de `package.json` incluye `-H 127.0.0.1`
- [ ] El script `start` de `package.json` incluye `-H 127.0.0.1`
- [ ] Al arrancar, la salida de Next ya no anuncia una URL `Network:` con la IP de la LAN
- [ ] `http://localhost:3300` sigue respondiendo 200
- [ ] El README documenta cómo exponerlo a propósito (`-H 0.0.0.0`) y advierte de que no hay autenticación

### US-008: Las credenciales en disco no son legibles por otros usuarios
**Description:** Como usuario, quiero que el archivo con mis API keys tenga permisos restrictivos, para que otro usuario de la máquina no pueda leerlas.

**Acceptance Criteria:**
- [ ] `writeConfig` en `lib/store.ts` escribe el archivo temporal con `mode: 0o600` antes del rename
- [ ] Tras el rename, el archivo final queda en `0600` (verificar explícitamente, ya que el rename conserva el modo del temporal)
- [ ] Si el archivo ya existía con permisos más laxos, la siguiente escritura lo deja en `0600`
- [ ] `ensureDataDir` en `lib/data-dir.ts` crea `.data/` con `mode: 0o700`
- [ ] Hay un test que escribe la config en un directorio temporal y comprueba `fs.statSync(file).mode & 0o777 === 0o600`
- [ ] El test se salta a sí mismo en Windows (`process.platform === 'win32'`), donde el modo POSIX no aplica

### US-009: Capa de persistencia de los borradores de tareas
**Description:** Como desarrollador, quiero guardar los borradores de tareas en disco por transcripción, para que la curación manual no dependa de la memoria del navegador.

**Acceptance Criteria:**
- [ ] Nuevo módulo `lib/drafts-store.ts` que persiste en `.data/drafts.json`, con la misma escritura atómica y el mismo `0600` que `lib/store.ts`
- [ ] La forma guardada está keyed por la ruta relativa a la carpeta de contexto, igual que `history`
- [ ] Por cada nota se guarda: las filas (`id`, `title`, `description`, `priority`, `mentioned`, `evidence`, `include`), el `baseline` de la última extracción y el flag `extracted`
- [ ] No se persiste el estado transitorio: `generating`, `error` ni `confirming`
- [ ] Exporta `getDrafts(relPath)`, `saveDrafts(relPath, state)` y `clearDrafts(relPath)`
- [ ] Un archivo ausente, corrupto o con filas malformadas devuelve vacío en vez de lanzar, con la misma normalización defensiva que `lib/store.ts`
- [ ] Nueva ruta `GET /api/drafts?path=…` que devuelve los borradores guardados de una nota
- [ ] Nueva ruta `PUT /api/drafts` con `{ path, rows, baseline, extracted }` que los guarda
- [ ] Ambas rutas validan que `path` acabe en `.md` y usan `requireContextRoot()` y el manejo de errores de `lib/api.ts`, como el resto de rutas
- [ ] Tests de `lib/drafts-store.ts` cubriendo guardado, lectura, archivo corrupto y normalización de filas inválidas

### US-010: Los borradores sobreviven a una recarga
**Description:** Como usuario, quiero que las tareas que edité sigan ahí después de recargar la página o reiniciar el servidor, para no perder el trabajo de curación.

**Acceptance Criteria:**
- [ ] Al seleccionar una transcripción, `useTaskDrafts` carga sus borradores guardados si aún no tiene estado en memoria para esa ruta
- [ ] Mientras carga, la tabla muestra un estado de carga y no un «sin tareas» falso
- [ ] Cada cambio en las filas (editar, añadir, borrar, marcar/desmarcar «incluir») se guarda con debounce de ~500 ms, no en cada pulsación de tecla
- [ ] El resultado de una extracción nueva se guarda junto con su `baseline`
- [ ] Recargar la página con una nota seleccionada muestra exactamente las filas y las marcas que había antes
- [ ] Reiniciar el servidor de desarrollo y volver a abrir la nota muestra lo mismo
- [ ] `countManualChanges` sigue dando el mismo resultado tras recargar, porque el `baseline` también se persiste
- [ ] Un fallo al guardar no rompe la edición: se registra y la UI sigue usable con el estado en memoria
- [ ] Un fallo al cargar muestra un aviso con «Reintentar» y no borra lo que hubiera en memoria

### US-011: README real
**Description:** Como persona nueva en el repo, quiero un README que explique qué es esto y cómo arrancarlo, en vez del boilerplate de create-next-app.

**Acceptance Criteria:**
- [ ] Explica en un párrafo qué hace la app: explorar transcripciones `.md`, extraer tareas con Ollama o Claude, y crearlas como issues en Linear
- [ ] Documenta el arranque: `pnpm install` y `pnpm dev` en `http://localhost:3300`
- [ ] Documenta los requisitos previos: Ollama corriendo en local con un modelo descargado, o una API key de Anthropic
- [ ] Documenta la configuración inicial en `/settings`: carpeta de contexto, proveedor de extracción, API key de Linear
- [ ] Documenta las variables de entorno de override que ya existen: `OLLAMA_URL`, `ANTHROPIC_API_URL`, `LINEAR_API_URL` (y para qué sirven: apuntar a un stub en pruebas)
- [ ] Documenta que `.data/` guarda la configuración, las claves y el historial en local y que está en `.gitignore`
- [ ] Documenta los comandos de calidad: `pnpm typecheck` y `pnpm test`
- [ ] Advierte de que la app no tiene autenticación y por eso escucha solo en `127.0.0.1`
- [ ] No queda ningún resto del README de create-next-app

## Functional Requirements

- FR-1: El proyecto debe exponer un comando `pnpm test` que ejecute toda la batería una sola vez y devuelva un código de salida distinto de 0 si algo falla.
- FR-2: Ningún test puede hacer peticiones de red reales ni escribir fuera de un directorio temporal.
- FR-3: Ningún test puede leer ni modificar el `.data/` real del desarrollador.
- FR-4: Los scripts `dev` y `start` deben enlazar el servidor a `127.0.0.1`.
- FR-5: `.data/config.json` debe quedar con permisos `0600` y `.data/` con `0700` en sistemas POSIX.
- FR-6: El sistema debe persistir en disco las filas de tareas y su `baseline` por transcripción, y restaurarlas al volver a abrir esa transcripción.
- FR-7: Los guardados de borradores deben agruparse con debounce para que editar un título no genere una escritura por tecla.
- FR-8: Un fallo de persistencia no debe impedir seguir editando ni enviando a Linear.
- FR-9: El README debe permitir a alguien sin contexto arrancar la app y configurarla sin leer el código.

## Non-Goals (Out of Scope)

- Autenticación o multiusuario. La app sigue siendo de un solo usuario en local.
- Cifrado de las claves o integración con el llavero del sistema. Solo se restringen los permisos del archivo.
- Tests de componentes de React o end-to-end en navegador. Este PRD cubre solo lógica pura y de servidor.
- Añadir un linter. El gate se queda en typecheck + tests.
- Cancelar una extracción en vuelo.
- Cambiar la clave del historial de `relPath` a un identificador estable (renombrar una nota sigue desligándola de su historial).
- Cualquier funcionalidad nueva de producto: campos nuevos en Linear, detección de duplicados, formatos de entrada nuevos.
- CI. Los comandos quedan listos para engancharlos, pero el workflow no entra aquí.

## Technical Considerations

- El repo ya declara `pnpm@11.15.1` como packageManager; las dependencias nuevas se instalan con pnpm.
- `lib/data-dir.ts` es el punto por el que pasa toda la escritura en `.data`; es el sitio natural para hacer inyectable la ruta en tests (variable de entorno o mock de Vitest).
- `lib/store.ts` ya tiene el patrón de escritura atómica y de normalización defensiva. `lib/drafts-store.ts` debe seguirlo en vez de inventar otro.
- Las rutas nuevas de `/api/drafts` deben seguir el patrón de las existentes: `requireContextRoot()`, guarda de `.md`, y `errorResponse` de `lib/api.ts` para que los mensajes en español lleguen tal cual al cliente.
- El wrapper de cliente correspondiente va en `lib/drafts-client.ts`, con su guarda de forma `isX()`, como el resto de `lib/*-client.ts`.
- `useTaskDrafts` ya está keyed por ruta; la carga y el guardado deben respetar esa clave, porque un guardado que llega tarde no puede escribir sobre la nota que el usuario tenga en pantalla.
- El estado del push (`usePushRun`) no entra en este PRD: los issues creados ya se persisten en `history` desde el servidor.

## Success Metrics

- `pnpm test` pasa y cubre las cinco áreas: path guard, scanner, normalización del modelo, cliente de Linear y store.
- Al arrancar, Next no anuncia URL de red.
- `ls -l .data/config.json` muestra `-rw-------`.
- Editar tareas, recargar la página y encontrarlas iguales, incluido el contador de cambios manuales.
- Alguien que no ha visto el repo arranca la app siguiendo solo el README.

## Open Questions

- ¿La ruta de `.data` en tests se inyecta con una variable de entorno (`TASKS_APP_DATA_DIR`) o mockeando `lib/data-dir`? La primera opción también sirve para correr varias instancias de la app.
- ¿Los borradores van todos en un `drafts.json` único o en un archivo por nota? Un archivo único es más simple; uno por nota escala mejor si alguien acumula cientos de transcripciones curadas.
- ¿Conviene purgar los borradores de notas que ya no existen en disco, y en ese caso cuándo?
