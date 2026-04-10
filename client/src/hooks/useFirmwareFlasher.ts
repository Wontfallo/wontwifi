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
  reset: () => void;
}

/**
 * Default firmware binary (pre-compiled for ESP32-S3)
 * In production, this would be fetched from a server or CDN.
 * For now, we'll provide instructions for users to supply their own .bin file.
 */
const DEFAULT_PARTITION_TABLE = {
  offset: 0x8000,
  data: new Uint8Array([
    // Minimal partition table for ESP32-S3
    // This is a placeholder — users will upload their own firmware
  ]),
};

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

  const flashSelectedFile = useCallback(async () => {
    if (!selectedFile) return;

    setStatus("connecting");
    setMessage("Waiting for device selection...");
    setProgress(0);
    setError(null);

    let transport: Transport | null = null;

    try {
      // Request serial port (Directly tied to User Gesture onClick)
      const port = await navigator.serial.requestPort();

      setMessage("Connecting to ESP32-S3...");
      setProgress(10);

      // Create transport and loader
      transport = new Transport(port);
      const espLoader = new ESPLoader({
        transport,
        baudrate: 115200,
        romBaudrate: 115200,
      });

      // Connect
      setMessage("Connecting to bootloader...");
      await espLoader.connect();
      setProgress(20);

      // Read firmware binary as a Binary String (Required by esptool-js 0.5.x)
      setMessage("Processing firmware binary...");
      const binString = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target?.result as string);
        reader.onerror = (e) => reject(e);
        reader.readAsBinaryString(selectedFile);
      });

      setMessage("Erasing flash (This might take a moment)...");
      setProgress(30);

      // Flash firmware at offset 0x10000 (standard ESP32-S3 app partition, NOT 0x1000)
      const fileArray = [
        {
          data: binString, // bStr.charCodeAt happens inside here in older esptool
          address: 0x10000, 
        },
      ];

      setProgress(50);

      // Write flash array payload
      await espLoader.writeFlash({
        fileArray: fileArray as any,
        flashSize: "keep",
        flashMode: "keep",
        flashFreq: "keep",
        eraseAll: false, // block erase instead of full chip wipe
        compress: true,
        reportProgress: (fileIndex: number, written: number, total: number) => {
          // Map 50 -> 95 for the write phase
          const pct = Math.round((written / total) * 100);
          setProgress(50 + (pct * 0.45));
        }
      } as any);

      setProgress(95);
      setMessage("Resetting device...");

      // Reset the device
      await espLoader.softReset(false);
      setProgress(100);

      setStatus("success");
      setMessage("✓ Flashed! Device has rebooted. Click 'Back to Dashboard' to connect.");

      // Close port properly via transport
      if (transport) {
        await transport.disconnect();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setStatus("error");
      setMessage(`Flashing failed: ${msg}`);
      setProgress(0);
      
      // Cleanup on error
      if (transport) {
        try { await transport.disconnect(); } catch (e) {}
      }
    }
  }, [selectedFile]);

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
    reset,
  };
}
