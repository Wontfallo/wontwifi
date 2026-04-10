/**
 * useWebSerial - React hook for WebSerial API communication with ESP32-S3
 *
 * Design: Scientific Instrument / RF Lab Dashboard
 * Handles port selection, connection lifecycle, line-buffered reading,
 * JSON parsing of ESP32 scan data, and command sending.
 */

import { useCallback, useEffect, useRef, useState } from "react";

// ---- Types ----

export type EncryptionType = 0 | 1 | 2 | 3 | 4 | 5;

export const ENC_LABELS: Record<EncryptionType, string> = {
  0: "Open",
  1: "WEP",
  2: "WPA",
  3: "WPA2",
  4: "WPA/WPA2",
  5: "WPA3",
};

export interface AccessPoint {
  ssid: string;
  bssid: string;
  ch: number;
  rssi: number;
  enc: EncryptionType;
  band: "2.4" | "5";
}

export interface ScanResult {
  type: "scan";
  ts: number;
  count: number;
  aps: AccessPoint[];
}

export type ConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "scanning"
  | "error";

export interface SerialMessage {
  type: string;
  [key: string]: unknown;
}

export interface UseWebSerialReturn {
  connectionState: ConnectionState;
  isSupported: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  sendCommand: (cmd: string) => void;
  scanResults: ScanResult | null;
  lastScanTime: Date | null;
  scanCount: number;
  autoScan: boolean;
  setAutoScan: (enabled: boolean) => void;
  scanInterval: number;
  setScanInterval: (seconds: number) => void;
  triggerScan: () => void;
  consoleLog: string[];
  clearConsole: () => void;
  firmwareInfo: { fw: string; chip: string; sdk?: string; heap?: number } | null;
  errorMessage: string | null;
}

// ---- Hook ----

export function useWebSerial(): UseWebSerialReturn {
  const isSupported = "serial" in navigator;

  const [connectionState, setConnectionState] = useState<ConnectionState>("disconnected");
  const [scanResults, setScanResults] = useState<ScanResult | null>(null);
  const [lastScanTime, setLastScanTime] = useState<Date | null>(null);
  const [scanCount, setScanCount] = useState(0);
  const [autoScan, setAutoScanState] = useState(false);
  const [scanInterval, setScanIntervalState] = useState(5);
  const [consoleLog, setConsoleLog] = useState<string[]>([]);
  const [firmwareInfo, setFirmwareInfo] = useState<UseWebSerialReturn["firmwareInfo"]>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const portRef = useRef<SerialPort | null>(null);
  const writerRef = useRef<WritableStreamDefaultWriter<Uint8Array> | null>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const readLoopRef = useRef<boolean>(false);
  const lineBufferRef = useRef<string>("");

  const addLog = useCallback((msg: string) => {
    const ts = new Date().toLocaleTimeString("en-US", { hour12: false });
    setConsoleLog((prev) => {
      const next = [...prev, `[${ts}] ${msg}`];
      return next.length > 500 ? next.slice(-500) : next;
    });
  }, []);

  const handleMessage = useCallback(
    (raw: string) => {
      addLog(`← ${raw}`);
      let msg: SerialMessage;
      try {
        msg = JSON.parse(raw);
      } catch {
        // Non-JSON line - log it and ignore
        return;
      }

      window.dispatchEvent(new CustomEvent("serial-message", { detail: msg }));

      switch (msg.type) {
        case "ready":
        case "info":
          setFirmwareInfo({
            fw: (msg.fw as string) ?? "unknown",
            chip: (msg.chip as string) ?? "ESP32-S3",
            sdk: msg.sdk as string | undefined,
            heap: msg.heap as number | undefined,
          });
          setConnectionState("connected");
          break;

        case "scan":
          setScanResults(msg as unknown as ScanResult);
          setLastScanTime(new Date());
          setScanCount((c) => c + 1);
          setConnectionState("connected");
          break;

        case "status":
          if (msg.msg === "scanning") {
            setConnectionState("scanning");
          } else if (msg.msg === "auto_on") {
            setAutoScanState(true);
            setConnectionState("connected");
          } else if (msg.msg === "auto_off") {
            setAutoScanState(false);
            setConnectionState("connected");
          }
          break;

        case "pong":
          setConnectionState("connected");
          break;

        case "error":
          setErrorMessage((msg.msg as string) ?? "Unknown error");
          setConnectionState("connected");
          break;

        default:
          break;
      }
    },
    [addLog]
  );

  const readLoop = useCallback(async () => {
    if (!readerRef.current) return;
    const decoder = new TextDecoder();
    readLoopRef.current = true;

    try {
      while (readLoopRef.current) {
        const { value, done } = await readerRef.current.read();
        if (done) break;
        if (!value) continue;

        const chunk = decoder.decode(value, { stream: true });
        lineBufferRef.current += chunk;

        // Process complete lines
        let nl: number;
        while ((nl = lineBufferRef.current.indexOf("\n")) !== -1) {
          const line = lineBufferRef.current.slice(0, nl).replace(/\r$/, "");
          lineBufferRef.current = lineBufferRef.current.slice(nl + 1);

          if (line.trim()) handleMessage(line.trim());
        }
      }
    } catch (err) {
      if (readLoopRef.current) {
        addLog(`Read error: ${err}`);
        setConnectionState("error");
        setErrorMessage("Serial read error - device may have disconnected.");
      }
    }
  }, [handleMessage, addLog]);

  const sendCommand = useCallback(
    (cmd: string) => {
      if (!writerRef.current) return;
      const encoder = new TextEncoder();
      writerRef.current.write(encoder.encode(cmd + "\n")).catch((err) => {
        addLog(`Send error: ${err}`);
      });
      addLog(`→ ${cmd}`);
    },
    [addLog]
  );

  const connect = useCallback(async () => {
    if (!isSupported) {
      setErrorMessage("WebSerial API is not supported in this browser. Use Chrome or Edge.");
      return;
    }

    setConnectionState("connecting");
    setErrorMessage(null);

    try {
      const port = await navigator.serial.requestPort();

      await port.open({ baudRate: 115200, dataBits: 8, stopBits: 1, parity: "none" });

      portRef.current = port;
      writerRef.current = port.writable!.getWriter();
      readerRef.current = port.readable!.getReader();

      addLog("Serial port opened at 115200 baud");
      setConnectionState("connected");

      // Start read loop
      readLoop();

      // Request firmware info
      setTimeout(() => sendCommand("INFO"), 500);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("No port selected") || msg.includes("cancelled")) {
        setConnectionState("disconnected");
      } else {
        setConnectionState("error");
        setErrorMessage(`Connection failed: ${msg}`);
        addLog(`Connection error: ${msg}`);
      }
    }
  }, [isSupported, addLog, readLoop, sendCommand]);

  const disconnect = useCallback(() => {
    readLoopRef.current = false;

    try {
      readerRef.current?.cancel();
    } catch {
      // ignore
    }
    try {
      writerRef.current?.close();
    } catch {
      // ignore
    }

    portRef.current?.close().catch(() => {});
    portRef.current = null;
    writerRef.current = null;
    readerRef.current = null;
    lineBufferRef.current = "";

    setConnectionState("disconnected");
    setAutoScanState(false);
    addLog("Disconnected from serial port");
  }, [addLog]);

  const setAutoScan = useCallback(
    (enabled: boolean) => {
      sendCommand(enabled ? "AUTO_ON" : "AUTO_OFF");
    },
    [sendCommand]
  );

  const setScanInterval = useCallback(
    (seconds: number) => {
      setScanIntervalState(seconds);
      sendCommand(`INTERVAL ${seconds}`);
    },
    [sendCommand]
  );

  const triggerScan = useCallback(() => {
    sendCommand("SCAN");
  }, [sendCommand]);

  const clearConsole = useCallback(() => {
    setConsoleLog([]);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      readLoopRef.current = false;
      portRef.current?.close().catch(() => {});
    };
  }, []);

  return {
    connectionState,
    isSupported,
    connect,
    disconnect,
    sendCommand,
    scanResults,
    lastScanTime,
    scanCount,
    autoScan,
    setAutoScan,
    scanInterval,
    setScanInterval,
    triggerScan,
    consoleLog,
    clearConsole,
    firmwareInfo,
    errorMessage,
  };
}
