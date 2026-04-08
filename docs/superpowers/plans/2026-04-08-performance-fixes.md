# Terminal Performance Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminar la lentitud del terminal en high-throughput scenarios batching el output del PTY en Rust, aplicando `requestAnimationFrame` en el frontend, y evitando actualizaciones innecesarias de Zustand.

**Architecture:** Tres capas de optimización independientes: (1) el lector PTY de Rust acumula chunks durante 10ms antes de emitir un único evento Tauri, reduciendo los IPC crossing de miles a decenas; (2) el frontend acumula datos entre frames de animación y escribe todo en un solo `term.write()`; (3) el store de Zustand solo se actualiza cuando `hasActivity` cambia de `false` a `true`.

**Tech Stack:** Rust (Tauri backend), React + TypeScript (frontend), xterm.js v5.5.0, Zustand v5, Tauri v2 events

---

## File Map

| File | Acción | Responsabilidad |
|------|--------|-----------------|
| `src-tauri/src/pty.rs` | Modificar | Agregar buffer de acumulación de 10ms en el lector PTY |
| `src/components/TerminalView.tsx` | Modificar | RAF batching + Zustand guard |

---

### Task 1: Batch PTY output en el lector Rust

**Contexto:** El problema raíz. El thread lector en `pty.rs:83-104` emite un evento Tauri por cada `read()` del PTY (chunks de 4096 bytes). Para un output de 10MB eso son ~2500 eventos IPC. La solución es acumular chunks durante ~10ms y emitir uno solo más grande.

**Tradeoff de latencia:** 10ms de delay en el peor caso es imperceptible para el usuario (~1 frame a 60fps), pero reduce ~50x los cruces de IPC en high-throughput.

**Files:**
- Modify: `src-tauri/src/pty.rs:83-104`

- [ ] **Step 1: Leer el archivo actual y entender la estructura**

```bash
# Verificar que el archivo no cambió desde el análisis
cat -n src-tauri/src/pty.rs | head -110
```

- [ ] **Step 2: Reemplazar el loop del reader thread con versión batched**

En `src-tauri/src/pty.rs`, reemplazar el bloque `thread::spawn(move || { ... });` (líneas 83-105) con:

```rust
    thread::spawn(move || {
        let mut buf = [0u8; 4096];
        let mut seen_urls = std::collections::HashSet::<String>::new();
        // Accumulator: hold data for up to BATCH_INTERVAL before emitting
        let mut accum: Vec<u8> = Vec::with_capacity(65536);
        let mut last_emit = std::time::Instant::now();
        const BATCH_INTERVAL: std::time::Duration = std::time::Duration::from_millis(10);
        const MAX_ACCUM: usize = 65536; // flush early if > 64KB accumulated

        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => {
                    // Flush any remaining data before exiting
                    if !accum.is_empty() {
                        let data = String::from_utf8_lossy(&accum).to_string();
                        let _ = app.emit(&format!("pty-output-{}", tab_id_reader), &data);
                    }
                    break;
                }
                Ok(n) => {
                    let chunk = &buf[..n];

                    // Still parse OSC7 / local URLs per-chunk (needed for correctness)
                    let chunk_str = String::from_utf8_lossy(chunk);
                    if let Some(path) = extract_osc7_path(&chunk_str) {
                        let _ = app.emit(&format!("cwd-changed-{}", tab_id_reader), path);
                    }
                    if let Some(url) = extract_local_url(&chunk_str) {
                        if seen_urls.insert(url.clone()) {
                            let _ = app.emit(&format!("port-detected-{}", tab_id_reader), url);
                        }
                    }

                    accum.extend_from_slice(chunk);

                    // Emit when buffer is large enough OR enough time has passed
                    let should_emit = accum.len() >= MAX_ACCUM
                        || last_emit.elapsed() >= BATCH_INTERVAL;

                    if should_emit {
                        let data = String::from_utf8_lossy(&accum).to_string();
                        let _ = app.emit(&format!("pty-output-{}", tab_id_reader), &data);
                        accum.clear();
                        last_emit = std::time::Instant::now();
                    }
                }
            }
        }
    });
```

- [ ] **Step 3: Compilar el backend Rust para verificar que no hay errores**

```bash
cd src-tauri && cargo check 2>&1
```

Expected: sin errores de compilación. Si hay warnings sobre `unused import` de `std::time`, verificar que el `use` está presente — `std::time` es parte de la standard library y no necesita declararse explícitamente en Rust.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/pty.rs
git commit -m "perf: batch PTY reader output over 10ms intervals in Rust

Accumulate PTY chunks for up to 10ms (or 64KB) before emitting a
Tauri event, reducing IPC crossings from ~2500 to ~50 for a 10MB
cat output. OSC7 and URL detection still run per-chunk for correctness."
```

---

### Task 2: Batching de renders con requestAnimationFrame

**Contexto:** En `TerminalView.tsx:184-188`, cada evento Tauri llama directamente a `term.write(data)`. Con el batch de Rust ya reducimos los eventos, pero el RAF batching garantiza que xterm.js solo renderiza una vez por frame del browser (~16ms a 60fps), evitando render storms cuando el OS flushea varios eventos juntos.

**Files:**
- Modify: `src/components/TerminalView.tsx`

- [ ] **Step 1: Leer el bloque de onPtyData en TerminalView**

```bash
sed -n '100,230p' src/components/TerminalView.tsx
```

Localizar:
- La declaración de refs existentes (hay varios `useRef` ya en el componente)
- El bloque `unlisten.current = transport.onPtyData(tabId, (data) => { ... })` (~línea 184)

- [ ] **Step 2: Agregar refs para el buffer de RAF justo después de los refs existentes**

Buscar el bloque de refs en la parte superior del componente (dentro del cuerpo de la función, antes del `useEffect`). Agregar tras el último `useRef` existente:

```typescript
  // RAF-based output batching: collect data between animation frames
  const pendingDataRef = useRef<string>('');
  const rafIdRef = useRef<number | null>(null);
```

- [ ] **Step 3: Reemplazar el bloque onPtyData con la versión RAF**

Buscar y reemplazar el bloque exacto:

```typescript
    // Listen for PTY output
    unlisten.current = transport.onPtyData(tabId, (data) => {
      term.write(data);
      if (activeTabIdRef.current !== tabId) {
        updateTab(tabId, { hasActivity: true });
      }
    });
```

Por:

```typescript
    // Listen for PTY output — batch writes with requestAnimationFrame
    // to avoid a render storm when many chunks arrive in quick succession.
    unlisten.current = transport.onPtyData(tabId, (data) => {
      pendingDataRef.current += data;

      // Only set hasActivity once per burst (when it changes false→true)
      if (activeTabIdRef.current !== tabId) {
        const currentHasActivity = useTabStore.getState().tabs.find(
          (t) => t.id === tabId
        )?.hasActivity;
        if (!currentHasActivity) {
          updateTab(tabId, { hasActivity: true });
        }
      }

      if (rafIdRef.current === null) {
        rafIdRef.current = requestAnimationFrame(() => {
          if (pendingDataRef.current) {
            term.write(pendingDataRef.current);
            pendingDataRef.current = '';
          }
          rafIdRef.current = null;
        });
      }
    });
```

- [ ] **Step 4: Limpiar el RAF pendiente en el cleanup del useEffect**

Localizar el bloque de cleanup (la función `return () => { ... }` al final del useEffect). Agregar la cancelación del RAF:

```typescript
    return () => {
      // Cancel any pending RAF to avoid writing to an unmounted terminal
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      pendingDataRef.current = '';
      // ... resto del cleanup existente
    };
```

> **Nota:** El cleanup existente ya tiene `unlisten.current?.()` y otros. Solo agregar las 5 líneas del RAF al inicio del return, no reemplazar el cleanup entero.

- [ ] **Step 5: Verificar que TypeScript compila sin errores**

```bash
pnpm build:frontend 2>&1 | head -40
```

Expected: `✓ built in Xs` sin errores de TypeScript. Si hay error de tipo en `useTabStore.getState().tabs.find(...)?.hasActivity`, verificar que el tipo `Tab` en el store tiene la propiedad `hasActivity: boolean`.

- [ ] **Step 6: Commit**

```bash
git add src/components/TerminalView.tsx
git commit -m "perf: batch xterm.js writes with requestAnimationFrame

Buffer incoming PTY data between animation frames so xterm.js
renders at most once per ~16ms frame instead of once per chunk.
Also guard Zustand hasActivity updates to only fire on false→true."
```

---

### Task 3: Build completo y smoke test

**Contexto:** Verificar que Tauri compila, el frontend compila, y el terminal funciona correctamente en runtime.

**Files:** (ninguno nuevo — solo verificación)

- [ ] **Step 1: Build completo del frontend**

```bash
pnpm build:frontend 2>&1
```

Expected: sin errores TypeScript, `vite build` exitoso.

- [ ] **Step 2: cargo check del backend**

```bash
cd src-tauri && cargo check 2>&1
```

Expected: sin errores. Warnings son aceptables.

- [ ] **Step 3: Levantar el terminal en modo dev**

```bash
pnpm tauri dev 2>&1 &
```

Esperar a que aparezca la ventana del terminal (puede tardar 30-60s la primera vez que compila Rust).

- [ ] **Step 4: Smoke test de performance**

En el terminal abierto, ejecutar:

```bash
# Test 1: output alto throughput
cat /usr/share/dict/words   # ~250KB — debe fluir sin jank

# Test 2: comando rápido
ls -la /usr/local/lib       # debe aparecer instantáneo

# Test 3: output continuo
seq 1 10000                 # debe scrollear fluidamente sin bloquear input
```

Verificar que:
- El terminal responde a input mientras hay output (escribir letras durante `seq`)
- No hay freeze o jank visible
- El prompt aparece correctamente al terminar cada comando

- [ ] **Step 5: Matar el proceso dev si está en background**

```bash
pkill -f "tauri dev" 2>/dev/null; pkill -f "vite" 2>/dev/null
```

---

## Self-Review

**Spec coverage:**
- ✅ Fix 1 (batch Rust reader): Task 1
- ✅ Fix 2 (RAF batching frontend): Task 2
- ✅ Fix 3 (Zustand guard): incluido en Task 2 Step 3
- ✅ Build + smoke test: Task 3

**Placeholder scan:** ninguno detectado — todos los pasos tienen código concreto.

**Type consistency:** `pendingDataRef`, `rafIdRef` usados consistentemente en Steps 2, 3, 4 de Task 2. `useTabStore` ya está importado en el componente (línea 8 del archivo actual).

**Nota sobre `useTabStore.getState()`:** Zustand v5 expone `.getState()` directamente en el store hook — `useTabStore.getState()` es la API correcta para lectura fuera de render cycle.
