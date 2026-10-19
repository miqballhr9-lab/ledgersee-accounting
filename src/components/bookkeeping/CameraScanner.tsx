"use client";

import { useEffect, useRef, useState } from "react";
import { Camera } from "lucide-react";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface CameraScannerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with each barcode read; the same code isn't repeated within two and a half seconds. */
  onCode: (code: string) => void;
}

interface DetectedBarcode { rawValue: string }
interface NativeDetector { detect: (source: HTMLVideoElement) => Promise<DetectedBarcode[]> }
interface ZxingControls { reset: () => void }
interface ZxingReader {
  decodeFromConstraints: (constraints: MediaStreamConstraints, video: HTMLVideoElement, callback: (result: { getText: () => string } | null) => void) => Promise<void>;
  reset: () => void;
}
type ZxingGlobal = { BrowserMultiFormatReader: new () => ZxingReader };

// ZXing (MIT licence), served from this app so scanning doesn't depend on an outside CDN.
const ZXING_URL = "/vendor/zxing-library-0.21.3.min.js";

/** Loads the ZXing barcode reader once, for browsers without a built-in barcode detector (Safari, Firefox). */
function loadZxing(): Promise<ZxingGlobal> {
  const existing = (window as unknown as { ZXing?: ZxingGlobal }).ZXing;
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = ZXING_URL;
    script.async = true;
    script.onload = () => {
      const loaded = (window as unknown as { ZXing?: ZxingGlobal }).ZXing;
      if (loaded) resolve(loaded);
      else reject(new Error("The barcode reader didn't load."));
    };
    script.onerror = () => reject(new Error("The barcode reader couldn't be downloaded."));
    document.head.appendChild(script);
  });
}

/** A short beep, so the cashier hears each scan. */
function beep() {
  try {
    const AudioCtor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return;
    const context = new AudioCtor();
    const oscillator = context.createOscillator();
    oscillator.frequency.value = 1200;
    oscillator.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.08);
    oscillator.onended = () => void context.close();
  } catch {
    // Sound is a nicety; scanning works without it.
  }
}

/**
 * Reads product barcodes with the phone's or laptop's camera. Uses the
 * browser's own barcode detector where there is one (Chrome, Edge, Android)
 * and the ZXing reader elsewhere. Cameras need the site on https.
 */
export default function CameraScanner({ open, onOpenChange, onCode }: CameraScannerProps) {
  // The video sits in the dialog, so it exists only once the dialog has opened.
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [videoReady, setVideoReady] = useState(false);
  const onCodeRef = useRef(onCode);
  const [status, setStatus] = useState("Starting the camera…");

  useEffect(() => {
    onCodeRef.current = onCode;
  }, [onCode]);

  useEffect(() => {
    const element = videoRef.current;
    if (!open || !videoReady || !element) return;
    const player: HTMLVideoElement = element;
    let stopped = false;
    let stream: MediaStream | null = null;
    let reader: ZxingReader | ZxingControls | null = null;
    let frame = 0;
    let last = { code: "", at: 0 };
    const found = (code: string) => {
      const now = Date.now();
      if (!code || (code === last.code && now - last.at < 2500)) return;
      last = { code, at: now };
      beep();
      onCodeRef.current(code);
    };

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus("This browser can't use the camera here. Open the site over https, or use a USB barcode scanner.");
        return;
      }
      const Native = (window as unknown as { BarcodeDetector?: new (options?: { formats: string[] }) => NativeDetector }).BarcodeDetector;
      try {
        if (Native) {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
          if (stopped) return;
          player.srcObject = stream;
          await player.play();
          const detector = new Native({ formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "qr_code", "itf", "codabar"] });
          setStatus("Point the camera at a barcode.");
          const tick = async () => {
            if (stopped) return;
            try {
              const codes = await detector.detect(player);
              if (codes[0]?.rawValue) found(codes[0].rawValue.trim());
            } catch {
              // A frame that can't be read; try the next one.
            }
            frame = window.setTimeout(() => void tick(), 180);
          };
          void tick();
        } else {
          setStatus("Loading the barcode reader…");
          const zxing = await loadZxing();
          if (stopped) return;
          const zxingReader = new zxing.BrowserMultiFormatReader();
          reader = zxingReader;
          setStatus("Point the camera at a barcode.");
          await zxingReader.decodeFromConstraints({ video: { facingMode: "environment" } }, player, (result) => {
            if (result && !stopped) found(result.getText().trim());
          });
        }
      } catch (error) {
        const name = error instanceof Error ? error.name : "";
        setStatus(name === "NotAllowedError" ? "Camera permission was refused. Allow the camera for this site and try again." : name === "NotFoundError" ? "No camera was found on this device." : error instanceof Error && error.message ? error.message : "The camera couldn't be started.");
      }
    }

    void start();
    return () => {
      stopped = true;
      window.clearTimeout(frame);
      reader?.reset();
      stream?.getTracks().forEach((track) => track.stop());
      if (player.srcObject instanceof MediaStream) player.srcObject.getTracks().forEach((track) => track.stop());
      player.srcObject = null;
    };
  }, [open, videoReady]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Camera size={18} className="text-primary" />Scan with camera</DialogTitle>
          <DialogDescription>{status}</DialogDescription>
        </DialogHeader>
        <div className="relative overflow-hidden rounded-lg bg-black">
          <video ref={(node) => { videoRef.current = node; setVideoReady(Boolean(node)); }} className="aspect-[4/3] w-full object-cover" muted playsInline />
          <div className="pointer-events-none absolute inset-x-8 top-1/2 h-0.5 -translate-y-1/2 bg-red-500/80 shadow-[0_0_8px_rgba(239,68,68,0.9)]" />
        </div>
        <p className="text-xs text-muted-foreground">Each product read is added to the sale. Keep scanning, then close this window.</p>
      </DialogContent>
    </Dialog>
  );
}
