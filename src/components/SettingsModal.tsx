// src/components/SettingsModal.tsx
import { useEffect, useState } from "react";
import { useUiStore } from "../store/uiStore";
import { useSettingsStore } from "../store/settingsStore";
import { requestNotificationPermission } from "../notifications";
import { Toggle } from "./ui/Toggle";
import { NumberField } from "./ui/NumberField";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="px-5 py-4 border-b border-border last:border-b-0">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400 mb-3">{title}</h3>
      <div className="flex flex-col gap-3">{children}</div>
    </div>
  );
}

function Row({ label, hint, disabled, children }: { label: string; hint?: string; disabled?: boolean; children: React.ReactNode }) {
  return (
    <div className={`flex items-center justify-between gap-4 ${disabled ? "opacity-40" : ""}`}>
      <div className="min-w-0">
        <div className="text-sm text-zinc-100">{label}</div>
        {hint && <div className="text-xs text-zinc-500">{hint}</div>}
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  );
}

export default function SettingsModal() {
  const open = useUiStore((s) => s.settingsOpen);
  const close = useUiStore((s) => s.closeSettings);
  const s = useSettingsStore();
  const [notifyError, setNotifyError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); close(); } };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, close]);

  if (!open) return null;

  const onToggleNotify = async (v: boolean) => {
    if (v) {
      const ok = await requestNotificationPermission();
      if (!ok) { setNotifyError("Permiso de notificaciones denegado"); return; }
      setNotifyError(null);
    }
    s.set("notifyOnPrompt", v);
  };

  return (
    <div className="absolute inset-0 z-[100] flex items-center justify-center bg-black/60" onClick={close}>
      <div
        className="w-[34rem] max-w-[92vw] max-h-[85vh] overflow-y-auto rounded-lg border border-border bg-sidebar shadow-2xl shadow-black/60"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-border sticky top-0 bg-sidebar">
          <span className="text-sm font-semibold text-zinc-100">Ajustes</span>
          <button className="text-zinc-500 hover:text-zinc-200 text-sm" onClick={close}>✕</button>
        </div>

        <Section title="Detección de prompts">
          <Row label="Detectar prompts de IA" hint="Muestra un modal cuando una IA pide permiso o hace una pregunta">
            <Toggle checked={s.promptDetectionEnabled} onChange={(v) => s.set("promptDetectionEnabled", v)} />
          </Row>
          <Row label="Detectar preguntas de texto libre" hint="El caso más propenso a falsos positivos" disabled={!s.promptDetectionEnabled}>
            <Toggle checked={s.detectFreeform} onChange={(v) => s.set("detectFreeform", v)} disabled={!s.promptDetectionEnabled} />
          </Row>
          <Row label="Saltar a la pestaña al responder" disabled={!s.promptDetectionEnabled}>
            <Toggle checked={s.focusTabOnAnswer} onChange={(v) => s.set("focusTabOnAnswer", v)} disabled={!s.promptDetectionEnabled} />
          </Row>
          <Row label="Retardo de detección (ms)" hint="Avanzado · tiempo de inactividad antes de escanear" disabled={!s.promptDetectionEnabled}>
            <NumberField value={s.promptScanDebounceMs} onChange={(v) => s.set("promptScanDebounceMs", v)} min={100} max={2000} step={50} disabled={!s.promptDetectionEnabled} />
          </Row>
        </Section>

        <Section title="Apariencia">
          <Row label="Tamaño de fuente">
            <NumberField value={s.fontSize} onChange={(v) => s.set("fontSize", v)} min={10} max={24} />
          </Row>
          <Row label="Parpadeo del cursor">
            <Toggle checked={s.cursorBlink} onChange={(v) => s.set("cursorBlink", v)} />
          </Row>
          <Row label="Scrollback (líneas)">
            <NumberField value={s.scrollback} onChange={(v) => s.set("scrollback", v)} min={500} max={50000} step={500} />
          </Row>
        </Section>

        <Section title="Notificaciones">
          <Row label="Avisar al detectar un prompt">
            <Toggle checked={s.notifyOnPrompt} onChange={onToggleNotify} />
          </Row>
          <Row label="Solo en pestañas en segundo plano" disabled={!s.notifyOnPrompt}>
            <Toggle checked={s.notifyOnlyWhenBackground} onChange={(v) => s.set("notifyOnlyWhenBackground", v)} disabled={!s.notifyOnPrompt} />
          </Row>
          <Row label="Sonido al detectar" disabled={!s.notifyOnPrompt}>
            <Toggle checked={s.notifySound} onChange={(v) => s.set("notifySound", v)} disabled={!s.notifyOnPrompt} />
          </Row>
          {notifyError && <p className="text-xs text-red-400">{notifyError}</p>}
        </Section>

        <Section title="Comportamiento">
          <Row label="Confirmar antes de cerrar una pestaña">
            <Toggle checked={s.confirmTabClose} onChange={(v) => s.set("confirmTabClose", v)} />
          </Row>
          <Row label="Detectar puertos de servidores">
            <Toggle checked={s.portDetection} onChange={(v) => s.set("portDetection", v)} />
          </Row>
          <Row label="Seguir el directorio de trabajo (OSC7)">
            <Toggle checked={s.cwdTracking} onChange={(v) => s.set("cwdTracking", v)} />
          </Row>
        </Section>

        <div className="px-5 py-3 border-t border-border">
          <button className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors" onClick={() => s.reset()}>
            Restablecer valores por defecto
          </button>
        </div>
      </div>
    </div>
  );
}
