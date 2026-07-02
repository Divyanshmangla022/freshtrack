import { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import type { IScannerControls } from '@zxing/browser';

/**
 * Camera-based barcode scanner (mobile device / webcam) using ZXing, which
 * decodes common 1-D product barcodes (EAN, UPC, Code128) plus QR. Repeated
 * reads of the same code are debounced so a barcode held in frame counts once
 * per interval, not on every video frame.
 */
export function CameraScanner({ onDetected }: { onDetected: (text: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastRef = useRef<{ text: string; at: number }>({ text: '', at: 0 });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let controls: IScannerControls | null = null;
    let cancelled = false;
    const reader = new BrowserMultiFormatReader();

    (async () => {
      try {
        controls = await reader.decodeFromVideoDevice(undefined, videoRef.current ?? undefined, (result) => {
          if (!result) return;
          const text = result.getText().trim();
          const now = Date.now();
          if (text && (text !== lastRef.current.text || now - lastRef.current.at > 1200)) {
            lastRef.current = { text, at: now };
            onDetected(text);
          }
        });
        if (cancelled) controls.stop();
      } catch (err) {
        setError(
          (err as Error)?.name === 'NotAllowedError'
            ? 'Camera permission denied. Allow camera access or use the scanner input.'
            : `Unable to start camera: ${(err as Error).message}`,
        );
      }
    })();

    return () => {
      cancelled = true;
      controls?.stop();
    };
  }, [onDetected]);

  if (error) return <div className="alert alert-warn">{error}</div>;

  return (
    <div className="camera-box">
      <video ref={videoRef} muted playsInline />
      <div className="reticle" />
    </div>
  );
}
