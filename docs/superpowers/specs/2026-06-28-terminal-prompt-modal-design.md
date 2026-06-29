# Detección de prompts de permisos/preguntas de Claude/Codex → Modal accionable

**Fecha:** 2026-06-28
**Estado:** Diseño aprobado, pendiente de plan de implementación

## Objetivo

Cuando una herramienta de IA (Claude Code, Codex) ejecutándose dentro de una
terminal de vibeTerm muestra un prompt que espera input del usuario —un permiso
para editar archivos, ejecutar comandos, una confirmación, o cualquier pregunta—
el sistema lo detecta y abre un modal global que muestra:

1. **La pregunta** extraída del prompt.
2. **La pestaña de origen** (de qué terminal viene), aunque no sea la activa.
3. **Una lista de botones** con las opciones que el modelo pidió.

Hacer clic en un botón envía la respuesta correspondiente a la terminal donde se
hizo la pregunta, reflejando el cambio en ese PTY.

## Alcance

- **Cualquier pregunta del modelo**, incluyendo:
  - Prompts con lista de opciones numeradas/seleccionables (`select`).
  - Confirmaciones simples y/n (`confirm`).
  - Preguntas en lenguaje libre sin opciones (`freeform`) → el modal muestra un
    campo de texto.
- Herramientas objetivo: **Claude Code** y **Codex** (extensible vía tabla de
  detectores).
- Funciona igual en modo **Tauri** (escritorio) y **web/remoto** — la detección
  es 100% en el cliente sobre el buffer de xterm.

## Decisiones de diseño (del brainstorming)

| Decisión | Elección |
|---|---|
| Alcance de detección | Cualquier pregunta del modelo (select + confirm + freeform) |
| Comportamiento del modal | Modal global inmediato; cola interna si hay varios |
| Envío de la respuesta | Híbrido: tecla directa (número/letra) con fallback a flechas + Enter |
| Mecanismo de detección | Escaneo del buffer renderizado de xterm (cliente) |
| Salto a pestaña de origen | Al **responder** (no al abrir), para no robar foco |

## Arquitectura

Cuatro unidades desacopladas:

### 1. `src/prompt-detection/detectors.ts` (lógica pura)

Funciones puras, sin React ni DOM. Reciben las líneas de texto visibles de una
terminal y devuelven `DetectedPrompt | null`. Una tabla de detectores ejecutados
en orden; el primero que casa gana.

```ts
type PromptKind = "select" | "confirm" | "freeform";

interface PromptOption {
  label: string;   // texto mostrado en el botón
  send: string;    // secuencia que se escribe al PTY al elegirlo
}

interface DetectedPrompt {
  tool: "claude" | "codex" | "generic";
  kind: PromptKind;
  question: string;
  options: PromptOption[];   // vacío si freeform
  signature: string;         // hash de question+options para dedupe
}

// Cada detector:
interface Detector {
  name: string;
  detect(lines: string[]): DetectedPrompt | null;
}

export function detectPrompt(lines: string[]): DetectedPrompt | null;
```

**Detectores incluidos:**

- **Lista de opciones (`select`)** — Claude/Codex dibujan una caja (bordes
  `╭─╮` / `│`) con un marcador de selección (`❯` / `›` / `>`) y líneas numeradas
  (`1. Yes`, `2. Yes, and don't ask again…`, `3. No`). La **pregunta** es la(s)
  línea(s) inmediatamente anteriores a la lista. Cada opción → `send` = su número.
- **Confirmación (`confirm`)** — patrón `(y/n)`, `[Y/n]`, `[y/N]` → dos opciones
  Sí→`y`, No→`n`.
- **Pregunta libre (`freeform`)** — caja de input visible (`│ >` o equivalente)
  precedida de una línea que termina en `?`, sin opciones detectadas →
  `kind: "freeform"`, `options: []`. El modal mostrará textarea; al enviar,
  `send` = texto del usuario + `\r`.

**Híbrido de envío:** cada opción `select` lleva su `send` directo (número/letra).
Para listas resaltadas **sin** número visible, el detector calcula la posición
del marcador `❯` respecto al índice objetivo y genera la secuencia de flechas
(`\x1b[A` / `\x1b[B`) + `\r` como `send` alternativo.

### 2. `usePromptDetection(term, tabId)` (hook en TerminalView)

- Se engancha al flujo de datos del PTY que ya existe en `TerminalView`
  (`transport.onPtyData`).
- Mantiene un **debounce de ~350ms**: cuando el PTY deja de emitir datos durante
  ese tiempo (señal de "esperando input"), dispara un escaneo.
- Escaneo: lee las últimas ~30 líneas del buffer activo de xterm
  (`term.buffer.active`), las normaliza (recorta espacios finales) y llama a
  `detectPrompt(lines)`.
- Si hay resultado y su `signature` no está ya activa/encolada → `promptStore.enqueue({ tabId, prompt })`.
- Re-escaneo: si la `signature` del prompt actualmente mostrado ya **no** aparece
  en el buffer (el usuario respondió a mano en la terminal), llama a
  `promptStore.dismissIfStale(signature)`.
- Todo el escaneo va en `try/catch`; un fallo nunca rompe la terminal.

### 3. `src/store/promptStore.ts` (zustand)

```ts
interface PendingPrompt {
  tabId: string;
  prompt: DetectedPrompt;
}

interface PromptStore {
  queue: PendingPrompt[];
  current: PendingPrompt | null;
  handledSignatures: Set<string>;   // para no reabrir lo ya resuelto/descartado
  enqueue(p: PendingPrompt): void;   // dedupe por signature
  resolve(): void;                   // marca handled, avanza al siguiente
  dismiss(): void;                   // cierra sin enviar, marca handled
  dismissIfStale(signature: string): void;
}
```

- `enqueue`: ignora si la `signature` ya está en `current`, en `queue`, o en
  `handledSignatures`. Si no hay `current`, lo promueve a `current`.
- `resolve` / `dismiss`: añaden a `handledSignatures`, vacían `current` y
  promueven el siguiente de `queue`.

### 4. `src/components/PermissionModal.tsx` (UI, montado en App.tsx)

- Overlay semitransparente + tarjeta modal centrada; visible cuando
  `promptStore.current != null`.
- **Cabecera:** alias de la pestaña de origen + su color/icono de tipo
  (reutiliza `TYPE_COLORS` / `TYPE_ICONS`).
- **Pregunta:** texto del prompt en monoespaciado.
- **Opciones:**
  - `select` / `confirm`: un botón por opción; la opción resaltada (`❯`) se
    estiliza como primaria.
  - `freeform`: `<textarea>` + botón **Enviar**.
- **Al elegir:** `transport.ptyWrite(tabId, send)` → `setActiveTab(tabId)` →
  `promptStore.resolve()`. (freeform: `send` = texto + `\r`.)
- **Cerrar sin responder:** botón "Responder en la terminal" + tecla `Esc` →
  `promptStore.dismiss()`.
- **Error:** si `ptyWrite` lanza, muestra aviso y mantiene el modal abierto.
- **Indicador en Sidebar:** las pestañas con prompt pendiente se marcan
  reutilizando el punto de actividad/estado existente.

## Flujo de datos

```
PTY data (onPtyData)
  → TerminalView: acumula + debounce 350ms
  → scan buffer xterm (últimas ~30 líneas)
  → detectPrompt(lines)            [detectors.ts, puro]
  → promptStore.enqueue({tabId, prompt})
  → PermissionModal muestra current
  → usuario hace clic / escribe + Enviar
  → transport.ptyWrite(tabId, option.send)
  → setActiveTab(tabId)
  → promptStore.resolve() → siguiente de la cola
```

## Manejo de errores

- Detección *best-effort*: todo en `try/catch`; nunca debe interrumpir la
  terminal ni el render.
- `ptyWrite` fallido: aviso visible, el modal permanece.
- Prompt obsoleto (respondido en terminal): auto-cierre vía `dismissIfStale`.
- Dedupe por `signature` para evitar parpadeo/reapertura en cada re-escaneo.

## Testing

- **`src/test/promptDetectors.test.ts` (TDD):** fixtures reales del buffer
  (volcado de permisos reales de Claude y Codex). Casos: lista numerada,
  confirmación y/n, pregunta libre, y **negativos** (texto normal que NO debe
  disparar → evitar falsos positivos). Verifica `question`, `options`, `send`,
  `signature`.
- **`src/test/promptStore.test.ts`:** `enqueue` deduplica por `signature`;
  `resolve` avanza la cola; `dismiss` no reabre; `dismissIfStale` cierra solo el
  obsoleto.
- **Validación manual:** ejecutar Claude/Codex reales en la app y confirmar que
  el modal detecta y que el clic responde en la terminal correcta.

## Riesgos conocidos

- **Patrones de los CLIs:** los formatos exactos de Claude/Codex deben
  confirmarse contra salida real. Mitigación: capturar fixtures reales durante la
  implementación y construir los detectores con TDD sobre ellas. La tabla de
  detectores es extensible/mantenible si un CLI cambia su UI.
- **Falsos positivos en freeform:** es el caso más ambiguo. Mitigación: exigir
  señales fuertes (caja de input visible + línea que termina en `?` + idle) y
  cubrirlo con tests negativos.

## Fuera de alcance (YAGNI)

- Soporte para CLIs distintos de Claude/Codex (la tabla permite añadirlos luego).
- Historial/log de prompts respondidos.
- Configuración de usuario para activar/desactivar la detección (se puede añadir
  después si molesta).
