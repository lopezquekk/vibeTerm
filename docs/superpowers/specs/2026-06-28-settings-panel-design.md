# Panel de configuración básica (Spec 1)

**Fecha:** 2026-06-28
**Estado:** Diseño aprobado, pendiente de plan de implementación

> Esta es la **Spec 1** de dos. La **Spec 2** (posterior) cubrirá el gestor de
> conexiones remotas (lista de clientes conectados + desconectarlos), que es un
> subsistema server-side independiente.

## Objetivo

Añadir un panel de configuración (modal) que permita parametrizar
comportamientos de vibeTerm para mejorar la experiencia de usuario. El primer
requisito concreto es **hacer opcional la detección de prompts de IA**; alrededor
de eso se añaden ajustes de apariencia del terminal, notificaciones y
comportamiento/seguridad.

**Principio rector:** los valores por defecto reproducen exactamente el
comportamiento actual. Introducir el panel **no cambia nada** hasta que el
usuario ajusta algo → cero regresión.

## Alcance

Cuatro grupos de ajustes, todos **del lado cliente**:

- **A — Detección de prompts de IA**
- **B — Apariencia del terminal**
- **C — Notificaciones**
- **D — Comportamiento / seguridad**

Fuera de alcance (Spec 2): gestión de conexiones remotas.

## Decisiones de diseño (del brainstorming)

| Decisión | Elección |
|---|---|
| Forma del panel | Modal con secciones, abierto desde un engranaje (⚙) en la cabecera del sidebar |
| Persistencia | `zustand/persist`, clave `vibeterm-settings` (mismo patrón que `tabStore`) |
| Notificaciones | Web Notifications API (funciona en webview Tauri y navegador) |
| Aplicar cambios | Al instante; sin botón "Guardar". Apariencia se aplica en vivo |
| `defaultSidebarMode` | Descartado: `sidebarMode` ya se persiste en `tabStore` (sería redundante) |

## Modelo de ajustes

`src/store/settingsStore.ts` — zustand + `persist` (clave `vibeterm-settings`),
un campo por ajuste, una acción genérica `set(key, value)` y `reset()`.

```ts
interface Settings {
  // A — Detección de prompts
  promptDetectionEnabled: boolean;   // default true
  detectFreeform: boolean;           // default true  — desactiva solo el detector freeform
  focusTabOnAnswer: boolean;         // default true  — saltar a la pestaña de origen al responder
  promptScanDebounceMs: number;      // default 350   — avanzado
  // B — Apariencia del terminal
  fontSize: number;                  // default 13
  cursorBlink: boolean;              // default true
  scrollback: number;                // default 5000
  // C — Notificaciones
  notifyOnPrompt: boolean;           // default false — notificación de escritorio al detectar prompt
  notifyOnlyWhenBackground: boolean; // default true  — solo si la pestaña no está activa
  notifySound: boolean;              // default false — sonido al detectar
  // D — Comportamiento / seguridad
  confirmTabClose: boolean;          // default false — pedir confirmación al cerrar pestaña
  portDetection: boolean;            // default true  — botón de puerto detectado
  cwdTracking: boolean;              // default true  — seguir el cwd vía OSC7
}

interface SettingsStore extends Settings {
  set: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  reset: () => void;
}
```

Los defaults coinciden con los valores actuales del código (`fontSize: 13`,
`cursorBlink: true`, `scrollback: 5000` en `TerminalView`).

## Arquitectura — cableado de cada ajuste

Cada ajuste se conecta en su punto de uso leyendo del `settingsStore` con un
selector. Unidades pequeñas y aisladas.

### A — Detección de prompts
- `promptDetectionEnabled`: en `TerminalView`, si es `false` **no** se programa el
  escaneo con debounce (no se llama a `scanLines`).
- `detectFreeform`: en `scanLines` (glue), si el prompt detectado es
  `kind === "freeform"` y el ajuste es `false`, se trata como "sin prompt". Los
  detectores siguen **puros**; el filtro vive en el glue.
- `focusTabOnAnswer`: en `PermissionModal.send`, el `setActiveTab(baseTabId)` solo
  se ejecuta si es `true`.
- `promptScanDebounceMs`: `TerminalView` lee el valor vía `getState()` al programar
  el timer, para que un cambio aplique en el siguiente escaneo.

### B — Apariencia del terminal (en `TerminalView`)
- En `new Terminal({...})` se leen `fontSize`, `cursorBlink`, `scrollback` del store
  (en lugar de literales), vía `useSettingsStore.getState()` en el momento de crear.
- **Aplicación en vivo:** un `useEffect` suscrito a esos tres ajustes aplica los
  cambios sobre `termRef.current` (`term.options.fontSize` / `cursorBlink` /
  `scrollback`) y re-ajusta (`fitAddon.fit()` + `transport.ptyResize`). Aplica a
  todas las terminales montadas al instante.

### C — Notificaciones
- Nuevo `src/notifications.ts` con `notifyPrompt(isActiveTab: boolean, prompt)`:
  - Si `notifyOnPrompt` y (`!notifyOnlyWhenBackground` o `!isActiveTab`) → muestra
    una notificación con la Web Notifications API.
  - Si `notifySound` → reproduce un pitido corto (`AudioContext`).
- Se invoca desde `scanLines` justo tras un `enqueue` que **insertó** un prompt
  nuevo (no duplicado). Para saberlo, `enqueue` devuelve `boolean` (insertó o no).
- El permiso de notificación se solicita al **activar** `notifyOnPrompt` en el panel.

### D — Comportamiento / seguridad
- `confirmTabClose`: en `Sidebar`, el botón ✕ pide confirmación (`window.confirm`)
  antes de `removeTab` si es `true`.
- `portDetection`: en `TerminalView`, el handler `onPortDetected` ignora el puerto
  si es `false` (el botón no aparece).
- `cwdTracking`: en `TerminalView`, el handler `onCwdChanged` no actualiza el path
  si es `false`.

## UI del modal

**Apertura:** icono de engranaje (⚙) en la cabecera del sidebar, junto a los
botones existentes (+, pin, colapsar). Abre `SettingsModal`.

`src/components/SettingsModal.tsx` (montado en la raíz, como `PermissionModal`):
- Overlay semitransparente + tarjeta centrada con scroll. `Esc` y botón ✕ cierran.
- Cuatro secciones con cabecera: *Detección de prompts*, *Apariencia*,
  *Notificaciones*, *Comportamiento*.
- Controles reutilizables:
  - `Toggle` para booleanos.
  - `NumberField` (min/max/paso) para `fontSize` (10–24), `scrollback`
    (500–50000) y `promptScanDebounceMs` (100–2000, bajo "Avanzado").
- **Dependencias visuales:** si `promptDetectionEnabled` es `false`, el resto de A
  se muestra deshabilitado/atenuado. Las opciones de C dependen de `notifyOnPrompt`.
- Al activar `notifyOnPrompt` se solicita permiso; si se deniega, aviso y el toggle
  vuelve a `false`.
- Botón **"Restablecer valores por defecto"** → `reset()`.
- Cada cambio se aplica al instante (el store persiste); sin botón "Guardar".

**Componentes nuevos:**
- `src/components/SettingsModal.tsx`
- `src/components/ui/Toggle.tsx`
- `src/components/ui/NumberField.tsx`

## Manejo de errores

- Permiso de notificación denegado → aviso visible + toggle revertido a `false`.
  Notificar es best-effort: cualquier fallo de la API se captura y no rompe nada.
- Aplicación en vivo de apariencia envuelta en `try/catch` (terminal podría estar
  dispuesta); nunca debe romper el render.
- Valores numéricos fuera de rango se recortan (clamp) en `NumberField`.

## Testing

- **`settingsStore` (TDD)** — `src/test/settingsStore.test.ts`: defaults correctos
  (= comportamiento actual), `set(key, value)` actualiza solo ese campo, `reset()`
  vuelve a defaults, persistencia round-trip (patrón de `tabStore.test.ts`).
- **`promptStore`** — `enqueue` devuelve `boolean` (insertó / duplicado); test en
  `src/test/promptStore.test.ts`.
- **`scanLines` con ajustes** — ampliar `src/test/promptScan.test.ts`: con
  `promptDetectionEnabled: false` no encola; con `detectFreeform: false` un prompt
  freeform se ignora pero select/confirm sí se encolan.
- **Controles UI** — `src/test/Toggle.test.tsx`, `src/test/NumberField.test.tsx`
  con `@testing-library/react`: render, cambio, clamp de min/max.
- **Notificaciones** — `notifyPrompt` con la Web Notifications API mockeada: no
  dispara si el ajuste está off; respeta `notifyOnlyWhenBackground`.
- **Validación manual** — abrir el modal; cambiar tamaño de fuente (aplica en vivo);
  desactivar la detección de prompts (el modal de permisos deja de aparecer);
  activar notificaciones.

**No-regresión:** como los defaults = comportamiento actual, los 74 tests
existentes siguen verdes; los puntos que ahora leen ajustes devuelven por defecto
los mismos valores que antes.

## Fuera de alcance (YAGNI)

- Gestión de conexiones remotas (Spec 2).
- Temas de color / familia de fuente configurable (se puede añadir luego; el modelo
  lo admite).
- Notificación nativa de Tauri (el helper `notifications.ts` lo permitiría cambiar
  de forma aislada más adelante).
- Sincronización de ajustes entre dispositivos.
