/**
 * Home.tsx — Main dashboard page
 * Design: Scientific Instrument / RF Lab Dashboard
 *
 * Layout: Fixed left sidebar + main content area with tabbed panels
 * Tabs: Spectrum View | Channel Analysis | AP Table | Signal History | Console
 */

import { useState, useEffect, useCallback } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  Wifi, WifiOff, Usb, RefreshCw,
  Activity, BarChart2, List, Terminal, Zap, Info,
  Radio, Signal, TrendingUp, AlertTriangle, Power
} from "lucide-react";
import { useWebSerial } from "@/hooks/useWebSerial";
import SpectrumChart from "@/components/SpectrumChart";
import ChannelAnalysis from "@/components/ChannelAnalysis";
import APTable from "@/components/APTable";
import SignalHistory from "@/components/SignalHistory";
import SerialConsole from "@/components/SerialConsole";
import FirmwareFlasher from "@/components/FirmwareFlasher";
import OffensiveTab from "@/components/OffensiveTab";
import type { ScanResult } from "@/hooks/useWebSerial";

const LOGO_URL = "https://d2xsxph8kpxj0f.cloudfront.net/310519663439230273/MSw96Nvxh3jyynzErCcWR5/wifi-logo-icon-nqkbzXYz5X5oxPn6jKfLXF.webp";

export default function Home() {
  const serial = useWebSerial();
  const [activeScanData, setActiveScanData] = useState<ScanResult | null>(null);
  const [scanHistory, setScanHistory] = useState<ScanResult[]>([]);
  const [activeTab, setActiveTab] = useState("console");
  const [showFlasher, setShowFlasher] = useState(false);

  // Merge real serial data into activeScanData
  useEffect(() => {
    if (serial.scanResults) {
      setActiveScanData(serial.scanResults);
      setScanHistory((h) => {
        const next = [serial.scanResults!, ...h].slice(0, 50);
        return next;
      });
    }
  }, [serial.scanResults]);

  const handleConnect = useCallback(async () => {
    await serial.connect();
  }, [serial]);

  const handleDisconnect = useCallback(() => {
    serial.disconnect();
    toast.info("Disconnected from serial port");
  }, [serial]);

  const handleTriggerScan = useCallback(() => {
    serial.triggerScan();
    toast.info("Scan requested", { description: "Waiting for ESP32-S3 to search channels..." });
  }, [serial]);

  const handleAutoScanToggle = useCallback((enabled: boolean) => {
    serial.setAutoScan(enabled);
  }, [serial]);

  const connectionState = serial.connectionState;
  const isConnected = connectionState === "connected" || connectionState === "scanning";
  const isScanning = connectionState === "scanning";
  const autoScanActive = serial.autoScan;
  const currentInterval = serial.scanInterval;

  const apCount = activeScanData?.count ?? 0;
  const lastScanTime = serial.lastScanTime;

  return (
    <div className="min-h-screen bg-background flex flex-col" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
      {/* ── Top Header Bar ── */}
      <header className="h-14 border-b border-border flex items-center px-4 gap-4 shrink-0"
        style={{ background: "linear-gradient(90deg, #0f1623 0%, #141e2e 100%)", borderBottomColor: "rgba(56,189,248,0.2)" }}>
        <div className="flex items-center gap-2.5">
          <img src={LOGO_URL} alt="Wi-Fi Analyzer" className="w-8 h-8 object-contain" />
          <div>
            <h1 className="text-sm font-semibold leading-none" style={{ fontFamily: "'Space Grotesk', sans-serif", color: "#38bdf8" }}>
              ESP32-S3 Wi-Fi Analyzer
            </h1>
            <p className="text-xs text-muted-foreground leading-none mt-0.5">RF Spectrum Analysis Tool</p>
          </div>
        </div>

        <div className="w-px h-8 bg-border mx-1" />

        {/* Connection Status */}
        <div className="flex items-center gap-2">
          <ConnectionIndicator state={connectionState} />
        </div>

        <div className="flex-1" />

        {/* Firmware Info */}
        {serial.firmwareInfo && (
          <div className="hidden md:flex items-center gap-2 text-xs text-muted-foreground font-mono">
            <span className="text-xs px-2 py-0.5 rounded" style={{ background: "rgba(56,189,248,0.1)", color: "#38bdf8" }}>
              {serial.firmwareInfo.chip} · FW {serial.firmwareInfo.fw}
            </span>
            {serial.firmwareInfo.heap && (
              <span>Heap: {(serial.firmwareInfo.heap / 1024).toFixed(0)}KB</span>
            )}
          </div>
        )}

        {/* Stats pills */}
        {activeScanData && (
          <div className="hidden sm:flex items-center gap-2">
            <StatPill icon={<Wifi className="w-3 h-3" />} label={`${apCount} APs`} color="green" />
            {lastScanTime && (
              <StatPill icon={<Activity className="w-3 h-3" />} label={lastScanTime.toLocaleTimeString()} color="blue" />
            )}
          </div>
        )}
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* ── Left Sidebar ── */}
        <aside className="w-64 border-r border-border flex flex-col shrink-0 overflow-y-auto"
          style={{ background: "#0f1623", borderRightColor: "rgba(56,189,248,0.15)" }}>

          {/* Connection Controls */}
          <div className="p-4 border-b border-border" style={{ borderBottomColor: "rgba(56,189,248,0.1)" }}>
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
              Connection
            </p>

            {!isConnected ? (
              <div className="space-y-2">
                <Button
                  className="w-full text-sm h-9"
                  onClick={handleConnect}
                  disabled={serial.connectionState === "connecting"}
                  style={{ background: "rgba(56,189,248,0.15)", borderColor: "rgba(56,189,248,0.3)", color: "#38bdf8" }}
                  variant="outline"
                >
                  <Usb className="w-4 h-4 mr-2" />
                  {serial.connectionState === "connecting" ? "Connecting…" : "Connect USB"}
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <Button
                  className="w-full text-sm h-9"
                  onClick={handleDisconnect}
                  variant="outline"
                  style={{ borderColor: "rgba(248,113,113,0.3)", color: "#f87171", background: "rgba(248,113,113,0.08)" }}
                >
                  <WifiOff className="w-4 h-4 mr-2" />
                  Disconnect
                </Button>
              </div>
            )}

            {serial.errorMessage && (
              <p className="text-xs text-destructive mt-2 leading-tight">{serial.errorMessage}</p>
            )}

            {!serial.isSupported && (
              <p className="text-xs mt-2 leading-tight" style={{ color: "#fbbf24" }}>
                WebSerial not supported. Use Chrome or Edge.
              </p>
            )}
          </div>

          {/* Scan Controls */}
          <div className="p-4 border-b border-border" style={{ borderBottomColor: "rgba(56,189,248,0.1)" }}>
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
              Scan Controls
            </p>

            <Button
              className="w-full text-sm h-9 mb-3"
              onClick={handleTriggerScan}
              disabled={!isConnected || isScanning}
              style={isConnected
                ? { background: "rgba(74,222,128,0.15)", borderColor: "rgba(74,222,128,0.4)", color: "#4ade80" }
                : {}
              }
              variant="outline"
            >
              {isScanning ? (
                <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Scanning…</>
              ) : (
                <><Radio className="w-4 h-4 mr-2" />Scan Now</>
              )}
            </Button>

            {/* Auto-scan toggle */}
            <div className="flex items-center justify-between mb-3">
              <Label className="text-xs text-muted-foreground">Auto-scan</Label>
              <Switch
                checked={autoScanActive}
                onCheckedChange={handleAutoScanToggle}
                disabled={!isConnected}
              />
            </div>

            {/* Interval slider */}
            <div className="space-y-1.5">
              <div className="flex justify-between">
                <Label className="text-xs text-muted-foreground">Interval</Label>
                <span className="text-xs font-mono" style={{ color: "#38bdf8" }}>{currentInterval}s</span>
              </div>
              <Slider
                min={2} max={60} step={1}
                value={[currentInterval]}
                onValueChange={([v]) => serial.setScanInterval(v)}
                disabled={!isConnected}
                className="w-full"
              />
            </div>
          </div>

          {/* Scan Stats */}
          <div className="p-4 border-b border-border" style={{ borderBottomColor: "rgba(56,189,248,0.1)" }}>
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
              Statistics
            </p>
            <div className="space-y-2">
              <SidebarStat label="APs Found" value={apCount.toString()} color="green" />
              <SidebarStat label="Scans Done" value={serial.scanCount.toString()} color="blue" />
              <SidebarStat
                label="2.4 GHz APs"
                value={(activeScanData?.aps.filter(a => a.band === "2.4").length ?? 0).toString()}
                color="green"
              />
              <SidebarStat
                label="5 GHz APs"
                value={(activeScanData?.aps.filter(a => a.band === "5").length ?? 0).toString()}
                color="blue"
              />
              <SidebarStat
                label="Best RSSI"
                value={activeScanData ? `${Math.max(...activeScanData.aps.map(a => a.rssi))} dBm` : "—"}
                color="green"
              />
              <SidebarStat
                label="Worst RSSI"
                value={activeScanData ? `${Math.min(...activeScanData.aps.map(a => a.rssi))} dBm` : "—"}
                color="red"
              />
            </div>
          </div>

          {/* ESP32 Device Image */}
          <div className="p-4 mt-auto">
            <div className="rounded-lg overflow-hidden opacity-60 hover:opacity-80 transition-opacity">
              <img
                src="https://d2xsxph8kpxj0f.cloudfront.net/310519663439230273/MSw96Nvxh3jyynzErCcWR5/esp32-device-6dJ9yM69jBCzLtVReCMgoo.webp"
                alt="ESP32-S3 Device"
                className="w-full object-cover"
                style={{ maxHeight: "120px", objectPosition: "center" }}
              />
            </div>
            <p className="text-xs text-muted-foreground text-center mt-2">ESP32-S3 via USB-C</p>
          </div>
        </aside>

        {/* ── Main Content ── */}
        <main className="flex-1 overflow-hidden flex flex-col">
          {showFlasher ? (
            <div className="flex-1 flex flex-col h-full bg-slate-950/50 p-6 overflow-auto relative">
              <Button 
                variant="outline" 
                className="w-fit mb-6 absolute top-6 right-6 z-10" 
                style={{ borderColor: "rgba(56,189,248,0.3)", color: "#38bdf8" }}
                onClick={() => setShowFlasher(false)}
              >
                ← Back to Dashboard
              </Button>
              <div className="max-w-4xl mx-auto w-full pt-12">
                <FirmwareFlasher onSuccessClose={() => setShowFlasher(false)} />
              </div>
            </div>
          ) : !isConnected ? (
            <NoDataState
              isConnected={isConnected}
              isScanning={isScanning}
              onConnect={handleConnect}
              onScan={handleTriggerScan}
              onFlash={() => {
                if (isConnected) handleDisconnect();
                setShowFlasher(true);
              }}
              isSupported={serial.isSupported}
            />
          ) : (
            <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col flex-1 overflow-hidden">
              <div className="px-4 pt-3 pb-0 shrink-0 border-b border-border" style={{ borderBottomColor: "rgba(56,189,248,0.15)" }}>
                <TabsList className="h-9 bg-transparent gap-1 p-0">
                  {[
                    { id: "spectrum",  icon: <Activity className="w-3.5 h-3.5" />,  label: "Spectrum" },
                    { id: "channels",  icon: <BarChart2 className="w-3.5 h-3.5" />, label: "Channels" },
                    { id: "aps",       icon: <List className="w-3.5 h-3.5" />,       label: "AP List" },
                    { id: "history",   icon: <TrendingUp className="w-3.5 h-3.5" />, label: "History" },
                    { id: "console",   icon: <Terminal className="w-3.5 h-3.5" />,   label: "Console" },
                    { id: "flash",     icon: <Zap className="w-3.5 h-3.5" />,        label: "Flash" },
                    { id: "offensive", icon: <Power className="w-3.5 h-3.5" />,      label: "Offensive" },
                  ].map(({ id, icon, label }) => (
                    <TabsTrigger
                      key={id}
                      value={id}
                      className="h-8 px-3 text-xs rounded-none border-b-2 border-transparent data-[state=active]:border-b-2 data-[state=active]:bg-transparent"
                      style={{
                        borderBottomColor: activeTab === id ? "#4ade80" : "transparent",
                        color: activeTab === id ? "#4ade80" : undefined,
                      }}
                    >
                      <span className="flex items-center gap-1.5">{icon}{label}</span>
                    </TabsTrigger>
                  ))}
                </TabsList>
              </div>

              <div className="flex-1 overflow-auto p-4">
                <TabsContent value="spectrum" className="mt-0 h-full">
                  {activeScanData ? <SpectrumChart scanData={activeScanData} /> : <p className="text-muted-foreground text-sm p-4">Run a scan to see spectrum data.</p>}
                </TabsContent>
                <TabsContent value="channels" className="mt-0 h-full">
                  {activeScanData ? <ChannelAnalysis scanData={activeScanData} /> : <p className="text-muted-foreground text-sm p-4">Run a scan to see channel analysis.</p>}
                </TabsContent>
                <TabsContent value="aps" className="mt-0 h-full">
                  {activeScanData ? <APTable scanData={activeScanData} /> : <p className="text-muted-foreground text-sm p-4">Run a scan to see AP list.</p>}
                </TabsContent>
                <TabsContent value="history" className="mt-0 h-full">
                  <SignalHistory history={scanHistory} />
                </TabsContent>
                <TabsContent value="console" className="mt-0 h-full">
                  <SerialConsole
                    logs={serial.consoleLog}
                    onClear={serial.clearConsole}
                    onSend={serial.sendCommand}
                    isConnected={isConnected}
                  />
                </TabsContent>
                <TabsContent value="flash" className="mt-0 h-full">
                  <div className="max-w-4xl mx-auto">
                    <FirmwareFlasher onSuccessClose={() => setActiveTab("spectrum")} />
                  </div>
                </TabsContent>
                <TabsContent value="offensive" className="mt-0 h-full">
                  <OffensiveTab 
                    sendCommand={serial.sendCommand}
                    isConnected={isConnected}
                    scanResults={activeScanData}
                  />
                </TabsContent>
              </div>
            </Tabs>
          )}
        </main>
      </div>
    </div>
  );
}

// ── Sub-components ──

function ConnectionIndicator({ state }: { state: string }) {
  const configs: Record<string, { color: string; label: string; pulse: boolean }> = {
    disconnected: { color: "#6b7280", label: "Disconnected", pulse: false },
    connecting:   { color: "#fbbf24", label: "Connecting…",  pulse: true  },
    connected:    { color: "#4ade80", label: "Connected",    pulse: false },
    scanning:     { color: "#38bdf8", label: "Scanning…",    pulse: true  },
    error:        { color: "#f87171", label: "Error",        pulse: false },
  };
  const cfg = configs[state] ?? configs.disconnected;

  return (
    <div className="flex items-center gap-1.5">
      <div
        className="w-2 h-2 rounded-full"
        style={{
          background: cfg.color,
          boxShadow: `0 0 6px ${cfg.color}`,
          animation: cfg.pulse ? "phosphor-pulse 1.5s ease-in-out infinite" : "none",
        }}
      />
      <span className="text-xs font-mono" style={{ color: cfg.color }}>{cfg.label}</span>
    </div>
  );
}

function StatPill({ icon, label, color }: { icon: React.ReactNode; label: string; color: "green" | "blue" }) {
  const c = color === "green" ? "#4ade80" : "#38bdf8";
  return (
    <div className="flex items-center gap-1 text-xs px-2 py-1 rounded font-mono"
      style={{ background: `rgba(${color === "green" ? "74,222,128" : "56,189,248"},0.1)`, color: c }}>
      {icon}
      <span>{label}</span>
    </div>
  );
}

function SidebarStat({ label, value, color }: { label: string; value: string; color: "green" | "blue" | "red" }) {
  const colors = { green: "#4ade80", blue: "#38bdf8", red: "#f87171" };
  return (
    <div className="flex justify-between items-center">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xs font-mono font-medium" style={{ color: colors[color] }}>{value}</span>
    </div>
  );
}

function NoDataState({ isConnected, isScanning, onConnect, onScan, onFlash, isSupported }: {
  isConnected: boolean;
  isScanning: boolean;
  onConnect: () => void;
  onScan: () => void;
  onFlash: () => void;
  isSupported: boolean;
}) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 text-center"
      style={{
        backgroundImage: `url(https://d2xsxph8kpxj0f.cloudfront.net/310519663439230273/MSw96Nvxh3jyynzErCcWR5/wifi-spectrum-bg-FwRyCGHFtSsgh4GVdTF6ZV.webp)`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}>
      <div className="max-w-md p-8 rounded-xl backdrop-blur-sm"
        style={{ background: "rgba(15,22,35,0.85)", border: "1px solid rgba(56,189,248,0.25)" }}>
        <div className="w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center"
          style={{ background: "rgba(56,189,248,0.1)", border: "1px solid rgba(56,189,248,0.3)" }}>
          <Radio className="w-8 h-8" style={{ color: "#38bdf8" }} />
        </div>
        <h2 className="text-xl font-semibold mb-2" style={{ fontFamily: "'Space Grotesk', sans-serif", color: "#e2e8f0" }}>
          No Scan Data
        </h2>
        <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
          Connect your ESP32-S3 via USB and trigger a scan.
        </p>

        <div className="space-y-3">
          {isConnected ? (
            <Button className="w-full h-12 text-md transition-all" onClick={onScan} disabled={isScanning}
              style={{ background: "rgba(74,222,128,0.2)", borderColor: "rgba(74,222,128,0.4)", color: "#4ade80" }}
              variant="outline">
              
              {isScanning ? (
                <><RefreshCw className="w-5 h-5 mr-3 animate-spin" /> Scanning Frequencies…</>
              ) : (
                <><Radio className="w-5 h-5 mr-3" /> Start Diagnostic Scan</>
              )}
            </Button>
          ) : (
            <>
              {isSupported && (
                <Button className="w-full" onClick={onConnect}
                  style={{ background: "rgba(56,189,248,0.15)", borderColor: "rgba(56,189,248,0.3)", color: "#38bdf8" }}
                  variant="outline">
                  <Usb className="w-4 h-4 mr-2" />
                  Connect ESP32-S3
                </Button>
              )}
              {isSupported && (
                <Button className="w-full" onClick={onFlash}
                  style={{ background: "rgba(248,113,113,0.1)", borderColor: "rgba(248,113,113,0.4)", color: "#f87171" }}
                  variant="outline">
                  <Zap className="w-4 h-4 mr-2" />
                  Flash Firmware
                </Button>
              )}
            </>
          )}
        </div>

        {!isSupported && (
          <div className="mt-4 flex items-start gap-2 text-left p-3 rounded-lg"
            style={{ background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.2)" }}>
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" style={{ color: "#fbbf24" }} />
            <p className="text-xs" style={{ color: "#fbbf24" }}>
              WebSerial API requires Chrome or Edge browser. Firefox is not supported.
            </p>
          </div>
        )}

        <div className="mt-4 flex items-start gap-2 text-left p-3 rounded-lg"
          style={{ background: "rgba(56,189,248,0.08)", border: "1px solid rgba(56,189,248,0.15)" }}>
          <Info className="w-4 h-4 mt-0.5 shrink-0" style={{ color: "#38bdf8" }} />
          <p className="text-xs text-muted-foreground">
            Flash the included Arduino sketch to your ESP32-S3, then connect via USB-C at 115200 baud.
          </p>
        </div>
      </div>
    </div>
  );
}

