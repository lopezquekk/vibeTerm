interface NumberFieldProps {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
}

export function NumberField({ value, onChange, min, max, step = 1, disabled }: NumberFieldProps) {
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      onChange={(e) => {
        const n = Number(e.target.value);
        if (!Number.isNaN(n)) onChange(clamp(n));
      }}
      className="w-20 bg-zinc-900 text-zinc-100 text-sm rounded border border-border px-2 py-1 outline-none focus:border-accent disabled:opacity-40"
    />
  );
}
