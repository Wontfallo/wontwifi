/**
 * useFirmwareFlasher — React hook for ESP32-S3 firmware flashing via esptool-js
 *
 * Design: Scientific Instrument / RF Lab Dashboard
 * Handles binary file upload, flashing progress, and error handling.
 */

import { useCallback, useState } from "react";
import { ESPLoader, Transport } from "esptool-js";

export type FlashStatus = "idle" | "selecting" | "connecting" | "flashing" | "success" | "error";

export interface UseFirmwareFlasherReturn {
  status: FlashStatus;
  progress: number;
  message: string;
  error: string | null;
  selectedFile: File | null;
  handleFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  flashSelectedFile: () => void;
  flashFromUrl: (url: string, filename: string, offset?: number) => void;
  reset: () => void;
}

export function useFirmwareFlasher(): UseFirmwareFlasherReturn {
  const [status, setStatus] = useState<FlashStatus>("idle");
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setStatus("idle");
      setMessage(`Selected: ${file.name}. Ready to flash.`);
      setError(null);
    }
  }, []);

  const flash = useCallback(async (getBinary: () => Promise<string>, filename: string, offset: number) => {
    setStatus("connecting");
    setMessage("Waiting for device selection...");
    setProgress(0);
    setError(null);

    let transport: Transport | null = null;

    try {
      const port = await navigator.serial.requestPort();
      setMessage("Connecting to ESP32-S3...");
      setProgress(10);

      transport = new Transport(port);
      const espLoader = new ESPLoader({ transport, baudrate: 115200, romBaudrate: 115200 });

      setMessage("Connecting to bootloader...");
      await espLoader.connect();
      setProgress(20);

      setMessage("Processing firmware binary...");
      const binString = await getBinary();
      setProgress(35);

      setMessage("Erasing flash (this may take a moment)...");
      setProgress(40);

      await espLoader.writeFlash({
        fileArray: [{ data: binString, address: offset }] as any,
        flashSize: "keep",
        flashMode: "keep",
        flashFreq: "keep",
        eraseAll: false,
        compress: true,
        reportProgress: (_fileIndex: number, written: number, total: number) => {
          setProgress(40 + Math.round((written / total) * 55));
        },
      } as any);

      setProgress(96);
      setMessage("Resetting device...");
      await espLoader.softReset(false);
      setProgress(100);
      setStatus("success");
      setMessage(`✓ ${filename} flashed! Device is rebooting.`);
      if (transport) await transport.disconnect();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setStatus("error");
      setMessage(`Flashing failed: ${msg}`);
      setProgress(0);
      if (transport) { try { await transport.disconnect(); } catch (_) {} }
    }
  }, []);

  const flashSelectedFile = useCallback(async () => {
    if (!selectedFile) return;
    await flash(
      () => new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target?.result as string);
        reader.onerror = (e) => reject(e);
        reader.readAsBinaryString(selectedFile);
      }),
      selectedFile.name,
      0x10000
    );
  }, [selectedFile, flash]);

  const flashFromUrl = useCallback(async (url: string, filename: string, offset = 0x10000) => {
    await flash(
      async () => {
        setMessage(`Downloading ${filename}...`);
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Download failed: ${response.statusText}`);
        const buffer = await response.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        let binary = "";
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        return binary;
      },
      filename,
      offset
    );
  }, [flash]);

  const reset = useCallback(() => {
    setStatus("idle");
    setProgress(0);
    setMessage("");
    setError(null);
  }, []);

  return {
    status,
    progress,
    message,
    error,
    selectedFile,
    handleFileSelect,
    flashSelectedFile,
    flashFromUrl,
    reset,
  };
}
