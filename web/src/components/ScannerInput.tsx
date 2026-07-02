import { useEffect, useRef, useState } from 'react';

/**
 * Capture SKUs from a hardware barcode scanner (keyboard-wedge: types the code
 * then sends Enter) OR manual keyboard entry. The input stays focused so an
 * operator can fire scans back-to-back without touching the screen.
 */
export function ScannerInput({
  onScan,
  disabled,
  placeholder = 'Scan or type a barcode / SKU...',
}: {
  onScan: (sku: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [value, setValue] = useState('');
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!disabled) ref.current?.focus();
  }, [disabled]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const sku = value.trim();
    if (!sku) return;
    onScan(sku);
    setValue('');
    ref.current?.focus();
  };

  return (
    <form onSubmit={submit} className="inline" style={{ gap: 10 }}>
      <input
        ref={ref}
        className="input big"
        style={{ flex: 1 }}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        // Refocus if the operator taps away (keeps the wedge scanner working).
        onBlur={() => {
          if (!disabled) setTimeout(() => ref.current?.focus(), 120);
        }}
      />
      <button type="submit" className="btn btn-primary btn-lg" disabled={disabled}>
        Add
      </button>
    </form>
  );
}
