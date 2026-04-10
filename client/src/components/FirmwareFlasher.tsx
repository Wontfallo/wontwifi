/**
 * FirmwareFlasher.tsx — Firmware flashing interface using esptool-js
 */

import { useFirmwareFlasher } from "@/hooks/useFirmwareFlasher";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { AlertCircle, CheckCircle2, Download, Zap, AlertTriangle, Info, Cpu, Monitor } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const FIRMWARES = [
  {
    id: "serial",
    label: "WontWiFi Serial / Web",
    version: "v1.5.1",
    description: "For ESP32-S3 boards. Controlled via this web UI over USB.",
    icon: Monitor,
    url: "/api/firmware/wontwifi-v1.5.1.bin",
    filename: "wontwifi-v1.5.1.bin",
    offset: 0x10000,
    color: "#38bdf8",
    badge: "Recommended",
  },
  {
    id: "tft",
    label: "WontWiFi TFT Standalone",
    version: "v1.1.0",
    description: "For Hosyond 2.8\" ILI9341 Black CYD. Touchscreen + web UI both active.",
    icon: Cpu,
    url: "/api/firmware/wontwifi-tft-v1.1.0.bin",
    filename: "wontwifi-tft-v1.1.0.bin",
    offset: 0x0,
    color: "#a78bfa",
    badge: "Merged (4MB)",
  },
];

export default function FirmwareFlasher({ onSuccessClose }: { onSuccessClose?: () => void }) {
  const { status, progress, message, error, selectedFile, handleFileSelect, flashSelectedFile, flashFromUrl, reset } = useFirmwareFlasher();

  const isFlashing = status === "connecting" || status === "flashing";
  const isSuccess = status === "success";
  const isError = status === "error";
  const isBusy = isFlashing || isSuccess;

  return (
    <div className="space-y-4">
      {/* Status bar */}
      {(isFlashing || isSuccess || isError || message) && (
        <div className="p-3 rounded-lg"
          style={{
            background: isSuccess ? "rgba(74,222,128,0.08)" : isError ? "rgba(248,113,113,0.08)" : "rgba(56,189,248,0.06)",
            border: isSuccess ? "1px solid rgba(74,222,128,0.2)" : isError ? "1px solid rgba(248,113,113,0.2)" : "1px solid rgba(56,189,248,0.15)",
          }}>
          <div className="flex items-start gap-2">
            {isSuccess ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" style={{ color: "#4ade80" }} />
              : isError ? <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" style={{ color: "#f87171" }} />
              : <Info className="w-4 h-4 mt-0.5 shrink-0" style={{ color: "#38bdf8" }} />}
            <div className="flex-1">
              <p className="text-sm font-mono"
                style={{ color: isSuccess ? "#4ade80" : isError ? "#f87171" : "#e2e8f0" }}>
                {message}
              </p>
              {error && <p className="text-xs text-destructive mt-1">{error}</p>}
            </div>
            {(isSuccess || isError) && (
              <Button size="sm" variant="ghost" className="h-6 text-xs px-2" onClick={reset}
                style={{ color: "#64748b" }}>
                Dismiss
              </Button>
            )}
          </div>
          {isFlashing && (
            <div className="mt-2 space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Progress</span>
                <span className="font-mono" style={{ color: "#38bdf8" }}>{progress}%</span>
              </div>
              <Progress value={progress} className="h-2" style={{ background: "rgba(56,189,248,0.1)" }} />
            </div>
          )}
        </div>
      )}

      {/* Pre-built firmware cards */}
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#64748b" }}>
          Pre-built Firmware
        </p>
        {FIRMWARES.map((fw) => {
          const Icon = fw.icon;
          return (
            <div key={fw.id} className="p-4 rounded-lg flex items-center gap-4"
              style={{ background: "#141e2e", border: `1px solid rgba(${fw.id === "tft" ? "167,139,250" : "56,189,248"},0.2)` }}>
              <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
                style={{ background: `rgba(${fw.id === "tft" ? "167,139,250" : "56,189,248"},0.1)`, border: `1px solid rgba(${fw.id === "tft" ? "167,139,250" : "56,189,248"},0.3)` }}>
                <Icon className="w-5 h-5" style={{ color: fw.color }} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold" style={{ color: "#e2e8f0", fontFamily: "'Space Grotesk', sans-serif" }}>
                    {fw.label}
                  </span>
                  <span className="text-xs font-mono px-1.5 py-0.5 rounded"
                    style={{ background: `rgba(${fw.id === "tft" ? "167,139,250" : "56,189,248"},0.1)`, color: fw.color }}>
                    {fw.version}
                  </span>
                  <span className="text-xs px-1.5 py-0.5 rounded"
                    style={{ background: "rgba(100,116,139,0.15)", color: "#64748b" }}>
                    {fw.badge}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{fw.description}</p>
              </div>
              <div className="flex gap-2 shrink-0">
                <Button size="sm" variant="outline" className="h-8 text-xs"
                  style={{ borderColor: `rgba(${fw.id === "tft" ? "167,139,250" : "56,189,248"},0.3)`, color: fw.color }}
                  asChild>
                  <a href={fw.url} download={fw.filename}>
                    <Download className="w-3 h-3 mr-1" />
                    Save
                  </a>
                </Button>
                <Button size="sm" variant="outline" className="h-8 text-xs"
                  disabled={isBusy}
                  style={{ borderColor: `rgba(${fw.id === "tft" ? "167,139,250" : "56,189,248"},0.3)`, color: fw.color, background: `rgba(${fw.id === "tft" ? "167,139,250" : "56,189,248"},0.08)` }}
                  onClick={() => flashFromUrl(fw.url, fw.filename, fw.offset)}>
                  <Zap className="w-3 h-3 mr-1" />
                  Flash
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Custom file */}
      <div className="p-4 rounded-lg" style={{ background: "#141e2e", border: "1px solid rgba(100,116,139,0.2)" }}>
        <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "#64748b" }}>
          Custom Firmware File
        </p>
        <input type="file" id="firmware-upload" className="hidden" accept=".bin" onChange={handleFileSelect} />
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1 h-9 text-xs"
            style={{ borderColor: "rgba(100,116,139,0.3)", color: "#94a3b8" }}
            onClick={() => document.getElementById("firmware-upload")?.click()}>
            <Download className="w-3 h-3 mr-1.5" />
            {selectedFile ? selectedFile.name.substring(0, 28) + (selectedFile.name.length > 28 ? "…" : "") : "Choose .bin file…"}
          </Button>
          {selectedFile && (
            <Button variant="outline" className="h-9 text-xs"
              disabled={isBusy}
              style={{ borderColor: "rgba(100,116,139,0.3)", color: "#94a3b8", background: "rgba(100,116,139,0.08)" }}
              onClick={flashSelectedFile}>
              <Zap className="w-3 h-3 mr-1" />
              Flash @ 0x10000
            </Button>
          )}
        </div>
      </div>

      {/* Warning */}
      <div className="p-3 rounded-lg flex gap-2" style={{ background: "rgba(251,191,36,0.06)", border: "1px solid rgba(251,191,36,0.15)" }}>
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" style={{ color: "#fbbf24" }} />
        <p className="text-xs text-muted-foreground">
          <span className="font-semibold" style={{ color: "#fbbf24" }}>Note: </span>
          Disconnect the web dashboard serial connection before flashing. The device will reboot automatically when done.
        </p>
      </div>

      <AlertDialog open={isSuccess}>
        <AlertDialogContent className="border-emerald-500/30 bg-slate-950">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-emerald-400">
              <CheckCircle2 className="w-5 h-5" />
              Firmware Flashed Successfully
            </AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              The ESP32-S3 has been updated and is rebooting. Click OK to return to the dashboard.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => { reset(); onSuccessClose?.(); }}
              className="bg-emerald-600 hover:bg-emerald-700 text-white">
              OK
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
