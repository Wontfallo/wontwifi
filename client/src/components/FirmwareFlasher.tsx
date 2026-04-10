/**
 * FirmwareFlasher.tsx — Firmware flashing interface using esptool-js
 * Design: Scientific Instrument / RF Lab Dashboard
 *
 * Allows users to select a .bin firmware file and flash it to ESP32-S3
 */

import { useFirmwareFlasher } from "@/hooks/useFirmwareFlasher";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { AlertCircle, CheckCircle2, Download, Zap, AlertTriangle, Info } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export default function FirmwareFlasher({ onSuccessClose }: { onSuccessClose?: () => void }) {
  const { status, progress, message, error, selectedFile, handleFileSelect, flashSelectedFile, reset } = useFirmwareFlasher();

  const isFlashing = status === "connecting" || status === "flashing";
  const isSuccess = status === "success";
  const isError = status === "error";

  return (
    <div className="space-y-4">
      {/* Main flashing card */}
      <div className="rf-panel p-6 rounded-lg" style={{ background: "#141e2e", border: "1px solid rgba(56,189,248,0.15)" }}>
        <div className="flex items-start gap-4 mb-4">
          <div className="w-12 h-12 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: "rgba(56,189,248,0.1)", border: "1px solid rgba(56,189,248,0.3)" }}>
            <Zap className="w-6 h-6" style={{ color: "#38bdf8" }} />
          </div>
          <div>
            <h2 className="text-lg font-semibold" style={{ fontFamily: "'Space Grotesk', sans-serif", color: "#e2e8f0" }}>
              Flash Firmware
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Upload and flash the Wi-Fi analyzer firmware to your ESP32-S3 board
            </p>
          </div>
        </div>

        {/* Status message */}
        <div className="mb-4 p-3 rounded-lg"
          style={{
            background: isSuccess ? "rgba(74,222,128,0.08)" : isError ? "rgba(248,113,113,0.08)" : "rgba(56,189,248,0.06)",
            border: isSuccess ? "1px solid rgba(74,222,128,0.2)" : isError ? "1px solid rgba(248,113,113,0.2)" : "1px solid rgba(56,189,248,0.15)",
          }}>
          <div className="flex items-start gap-2">
            {isSuccess ? (
              <CheckCircle2 className="w-5 h-5 mt-0.5 shrink-0" style={{ color: "#4ade80" }} />
            ) : isError ? (
              <AlertCircle className="w-5 h-5 mt-0.5 shrink-0" style={{ color: "#f87171" }} />
            ) : (
              <Info className="w-5 h-5 mt-0.5 shrink-0" style={{ color: "#38bdf8" }} />
            )}
            <div className="flex-1">
              <p className="text-sm font-mono"
                style={{
                  color: isSuccess ? "#4ade80" : isError ? "#f87171" : "#e2e8f0",
                }}>
                {message || "Ready to flash firmware"}
              </p>
              {error && (
                <p className="text-xs text-destructive mt-1">{error}</p>
              )}
            </div>
          </div>
        </div>

        {/* Progress bar */}
        {isFlashing && (
          <div className="mb-4 space-y-2">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Flashing progress</span>
              <span className="font-mono" style={{ color: "#38bdf8" }}>{progress}%</span>
            </div>
            <Progress value={progress} className="h-2" style={{ background: "rgba(56,189,248,0.1)" }} />
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-2">
          <input
            type="file"
            id="firmware-upload"
            className="hidden"
            accept=".bin,.elf"
            onChange={handleFileSelect}
          />
          {!selectedFile ? (
            <Button
              onClick={() => document.getElementById("firmware-upload")?.click()}
              className="flex-1 h-10"
              style={{
                background: "rgba(56,189,248,0.15)",
                borderColor: "rgba(56,189,248,0.3)",
                color: "#38bdf8",
              }}
              variant="outline"
            >
              <Download className="w-4 h-4 mr-2" />
              Select Firmware File
            </Button>
          ) : (
            <Button
              onClick={flashSelectedFile}
              disabled={isFlashing || isSuccess}
              className="flex-1 h-10"
              style={{
                background: isSuccess ? "rgba(74,222,128,0.15)" : "rgba(56,189,248,0.15)",
                borderColor: isSuccess ? "rgba(74,222,128,0.3)" : "rgba(56,189,248,0.3)",
                color: isSuccess ? "#4ade80" : "#38bdf8",
              }}
              variant="outline"
            >
              <Zap className="w-4 h-4 mr-2" />
              {isFlashing ? "Flashing..." : isSuccess ? "Flashed!" : `Flash ${selectedFile.name.length > 20 ? selectedFile.name.substring(0,20) + '...' : selectedFile.name}`}
            </Button>
          )}

          {(isSuccess || isError || selectedFile) && !isFlashing && (
            <Button
              onClick={() => {
                reset();
                const el = document.getElementById("firmware-upload") as HTMLInputElement;
                if (el) el.value = "";
              }}
              variant="outline"
              className="h-10"
              style={{ borderColor: "rgba(56,189,248,0.2)", color: "#64748b" }}
            >
              Reset
            </Button>
          )}
        </div>
      </div>

      {/* Instructions */}
      <div className="space-y-3">
        <div className="p-4 rounded-lg" style={{ background: "rgba(56,189,248,0.06)", border: "1px solid rgba(56,189,248,0.15)" }}>
          <h3 className="text-sm font-semibold mb-2" style={{ color: "#38bdf8", fontFamily: "'Space Grotesk', sans-serif" }}>
            How to Flash
          </h3>
          <ol className="text-xs text-muted-foreground space-y-1.5 leading-relaxed">
            <li><span className="font-mono text-xs" style={{ color: "#38bdf8" }}>1.</span> Build the firmware in Arduino IDE (Sketch → Export compiled Binary)</li>
            <li><span className="font-mono text-xs" style={{ color: "#38bdf8" }}>2.</span> Connect your ESP32-S3 via USB-C cable</li>
            <li><span className="font-mono text-xs" style={{ color: "#38bdf8" }}>3.</span> Click "Select & Flash" and choose the .bin file</li>
            <li><span className="font-mono text-xs" style={{ color: "#38bdf8" }}>4.</span> Wait for the progress bar to complete</li>
            <li><span className="font-mono text-xs" style={{ color: "#38bdf8" }}>5.</span> Switch to "Scan" tab and start analyzing!</li>
          </ol>
        </div>

        <div className="p-4 rounded-lg" style={{ background: "rgba(251,191,36,0.06)", border: "1px solid rgba(251,191,36,0.15)" }}>
          <div className="flex gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" style={{ color: "#fbbf24" }} />
            <div className="text-xs text-muted-foreground">
              <p className="font-semibold mb-1" style={{ color: "#fbbf24" }}>Important:</p>
              <p>The device will reboot after flashing. Make sure your USB cable stays connected during the entire process.</p>
            </div>
          </div>
        </div>

        <div className="p-4 rounded-lg" style={{ background: "rgba(74,222,128,0.06)", border: "1px solid rgba(74,222,128,0.15)" }}>
          <h4 className="text-sm font-semibold mb-2" style={{ color: "#4ade80", fontFamily: "'Space Grotesk', sans-serif" }}>
            Pre-built Firmware
          </h4>
          <p className="text-xs text-muted-foreground mb-3">
            If you don't want to compile the firmware yourself, you can download a pre-built binary:
          </p>
          <Button
            variant="outline"
            size="sm"
            className="w-full text-xs h-8"
            style={{ borderColor: "rgba(74,222,128,0.3)", color: "#4ade80", background: "rgba(74,222,128,0.08)" }}
            asChild
          >
            <a href="/esp32s3_wifi_scanner_v2.bin" download="esp32s3_wifi_scanner_v2.bin">
              <Download className="w-3 h-3 mr-1.5" />
              Download Pre-built Firmware
            </a>
          </Button>
        </div>
      </div>

      <AlertDialog open={isSuccess}>
        <AlertDialogContent className="border-emerald-500/30 bg-slate-950">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-emerald-400">
              <CheckCircle2 className="w-5 h-5" />
              Firmware Flashed Successfully
            </AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              The ESP32-S3 has been successfully updated and is rebooting. Click 'Okay' to return to the dashboard and connect via USB.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction 
              onClick={() => {
                reset();
                if (onSuccessClose) onSuccessClose();
              }}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              Okay
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
