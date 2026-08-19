# tasks-app

Una app local para convertir transcripciones de reuniones en issues de Linear.
Apuntas la app a una carpeta con tus notas en Markdown, navegas el árbol y abres
una transcripción; un motor de extracción —un modelo local de **Ollama** o
**Claude** a través de la API de Anthropic— la lee y propone una lista de tareas
con título, descripción y prioridad. Esa lista es una tabla editable: corriges
lo que haga falta, descartas lo que sobre y empujas lo que quede a **Linear**,
opcionalmente agrupadas bajo una tarea padre que representa la reunión. Todo
—configuración, claves, borradores e historial de lo ya empujado— vive en disco
en tu máquina, y el servidor solo escucha en `127.0.0.1`.

## Arranque

```bash
pnpm install
pnpm dev
```

La app queda en **http://localhost:3300**.

Para una build de producción, `pnpm build` y `pnpm start` (también en el 3300).

## Requisitos previos

Necesitas **al menos uno** de los dos motores de extracción:

- **Ollama** corriendo en local con un modelo ya descargado. El servidor se
  espera en `http://127.0.0.1:11434` y el modelo sugerido es `qwen3:8b`:

  ```bash
  ollama serve
  ollama pull qwen3:8b
  ```

  Es la opción gratuita y la que no saca nada de tu ordenador. `/settings` lista
  los modelos que Ollama tiene instalados, así que si la lista sale vacía es que
  falta el `pull`.

- **Una API key de Anthropic**, si prefieres extraer con Claude. Es más rápido y
  suele acertar más en transcripciones largas, pero la transcripción sale de tu
  máquina y las llamadas se facturan.

Para empujar a Linear hace falta además una **API key de Linear**, que se crea
en Linear en Settings → Security & access → API keys. Sin ella puedes extraer y
editar tareas, pero no crearlas.

## Configuración inicial en `/settings`

La primera vez hay que rellenar tres cosas, cada una en su propia tarjeta:

1. **Carpeta de contexto** — la ruta absoluta de la carpeta que contiene tus
   transcripciones en Markdown. Es la raíz del explorador y nada fuera de ella
   es accesible. La app recuerda las últimas carpetas usadas para poder
   cambiar entre ellas de un clic.
2. **Motor de extracción** — Ollama (y cuál de los modelos instalados) o Claude
   (y su API key de Anthropic). Es estado del servidor: el navegador nunca ve la
   clave guardada, solo si existe o no.
3. **API key de Linear** — con un botón «Probar» que hace una llamada real y
   responde con el nombre de tu workspace, para confirmar que la clave sirve
   antes de intentar el primer push.

## Variables de entorno

Las tres son *overrides* opcionales: si no las defines, la app usa el valor por
defecto. Sirven para apuntar la app a otro sitio —un Ollama en otra máquina o
en otro puerto, o un stub local con el que probar sin gastar llamadas ni crear
issues de verdad—.

| Variable            | Por defecto                             | Para qué                                                              |
| ------------------- | --------------------------------------- | --------------------------------------------------------------------- |
| `OLLAMA_URL`        | `http://127.0.0.1:11434`                | Dónde escucha Ollama: listar modelos y extraer.                        |
| `ANTHROPIC_API_URL` | `https://api.anthropic.com/v1/messages` | Endpoint de la Messages API que usa la extracción con Claude.          |
| `LINEAR_API_URL`    | `https://api.linear.app/graphql`        | Endpoint GraphQL de Linear: verificar la clave, listar destinos, crear issues. |

Se leen al arrancar el proceso, así que hay que reiniciar el servidor tras
cambiarlas:

```bash
OLLAMA_URL=http://192.168.1.50:11434 pnpm dev
```

## Dónde se guardan tus datos

Todo el estado local vive en `.data/`, junto a la raíz del proyecto:

- `config.json` — carpeta de contexto y carpetas recientes, motor elegido y
  modelo, **la API key de Anthropic y la de Linear**, y el historial de pushes
  (qué issues se crearon desde cada nota y cuándo).
- `drafts.json` — los borradores de la tabla de tareas, para que lo que estabas
  editando siga ahí después de recargar.

`.data/` está en `.gitignore`, así que **nunca se commitea**. La carpeta se crea
con permisos `0700` y los ficheros se escriben con `0600` (solo tu usuario
puede leerlos), porque ahí dentro están las claves. Si borras la carpeta pierdes
la configuración y el historial, no tus transcripciones.

## Calidad

```bash
pnpm typecheck   # next typegen + tsc --noEmit
pnpm test        # Vitest, una pasada no interactiva
```

`pnpm test:watch` para desarrollo. Los tests cubren la lógica pura de `lib/`;
las convenciones están en [AGENTS.md](AGENTS.md).

## Seguridad: la app no tiene autenticación

No hay login, ni usuarios, ni tokens. Cualquiera que llegue al puerto puede leer
tus transcripciones, ver la configuración y usar tus claves de Anthropic y de
Linear para gastar y crear issues en tu nombre. Por eso `dev` y `start` arrancan
con `-H 127.0.0.1`: el servidor solo acepta conexiones desde tu propia máquina y
es inalcanzable desde la red local, aunque Next por defecto escucharía en
`0.0.0.0`.

Si aun así quieres exponerla a propósito —por ejemplo para abrirla desde el
móvil en tu red de casa— añade el flag al final; el último `-H` gana sobre el
del script:

```bash
pnpm dev -H 0.0.0.0
```

Hazlo solo en una red en la que confíes, y no lo dejes puesto: mientras esté así
la app queda accesible, sin ninguna credencial, para todo el que comparta la red.
