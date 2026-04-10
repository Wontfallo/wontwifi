/**
 * SerialConsole.tsx - Raw serial communication terminal
 * Design: Scientific Instrument / RF Lab Dashboard
 */

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Trash2, Send, Terminal, Copy } from "lucide-react";
import { toast } from "sonner";

interface Props {
  logs: string[];
  onClear: () => void;
  onSend: (cmd: string) => void;
  isConnected: boolean;
}

const QUICK_COMMANDS = [
  { label: "PING", cmd: "PING", desc: "Check connection" },
  { label: "SCAN", cmd: "SCAN", desc: "Trigger scan" },
  { label: "INFO", cmd: "INFO", desc: "Firmware info" },
  { label: "AUTO ON", cmd: "AUTO_ON", desc: "Enable auto-scan" },
  { label: "AUTO OFF", cmd: "AUTO_OFF", desc: "Disable auto-scan" },
  { label: "INT 5s", cmd: "INTERVAL 5", desc: "Set 5s interval" },
  { label: "INT 10s", cmd: "INTERVAL 10", desc: "Set 10s interval" },
];

export default function SerialConsole({ logs, onClear, onSend, isConnected }: Props) {
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const handleSend = () => {
    const cmd = input.trim();
    if (!cmd) return;
    onSend(cmd);
    setHistory((h) => [cmd, ...h].slice(0, 50));
    setHistoryIdx(-1);
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSend();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const idx = Math.min(historyIdx + 1, history.length - 1);
      setHistoryIdx(idx);
      setInput(history[idx] ?? "");
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      const idx = Math.max(historyIdx - 1, -1);
      setHistoryIdx(idx);
      setInput(idx === -1 ? "" : history[idx] ?? "");
    }
  };

  const copyLogs = () => {
    navigator.clipboard.writeText(logs.join("\n")).then(() => {
      toast.success("Console log copied to clipboard");
    });
  };

  const getLineColor = (line: string) => {
    if (line.includes("→")) return "#38bdf8";        // sent command
    if (line.includes('"type":"scan"')) return "#4ade80";
    if (line.includes('"type":"error"')) return "#f87171";
    if (line.includes('"type":"ready"')) return "#fbbf24";
    if (line.includes("← ")) return "#94a3b8";       // received
    if (line.startsWith("[DEMO]")) return "#fbbf24";
    return "#64748b";
  };

  return (
    <div className="flex flex-col h-full gap-3">
      {/* Quick Commands */}
      <div className="flex flex-wrap gap-1.5">
        {QUICK_COMMANDS.map(({ label, cmd, desc }) => (
          <button
            key={cmd}
            onClick={() => onSend(cmd)}
            disabled={!isConnected}
            title={desc}
            className="text-xs px-2.5 py-1 rounded font-mono transition-all"
            style={{
              background: isConnected ? "rgba(56,189,248,0.08)" : "rgba(56,189,248,0.03)",
              border: "1px solid rgba(56,189,248,0.2)",
              color: isConnected ? "#38bdf8" : "#374151",
              cursor: isConnected ? "pointer" : "not-allowed",
            }}
          >
            {label}
          </button>
        ))}
        <div className="flex-1" />
        <button onClick={copyLogs} className="text-xs px-2.5 py-1 rounded font-mono flex items-center gap-1"
          style={{ background: "rgba(56,189,248,0.08)", border: "1px solid rgba(56,189,248,0.2)", color: "#38bdf8" }}>
          <Copy className="w-3 h-3" />Copy
        </button>
        <button onClick={onClear} className="text-xs px-2.5 py-1 rounded font-mono flex items-center gap-1"
          style={{ background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)", color: "#f87171" }}>
          <Trash2 className="w-3 h-3" />Clear
        </button>
      </div>

      {/* Log Output */}
      <div className="flex-1 overflow-y-auto rounded-lg p-3 font-mono text-xs leading-relaxed"
        style={{ background: "#080d14", border: "1px solid rgba(56,189,248,0.15)", minHeight: "200px" }}>
        {logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
            <Terminal className="w-8 h-8 opacity-30" />
            <p>No serial output yet</p>
            {isConnected && <p className="text-xs opacity-60">Send a command or trigger a scan</p>}
          </div>
        ) : (
          <>
            {logs.map((line, i) => (
              <div key={i} style={{ color: getLineColor(line), marginBottom: "1px" }}>
                {line}
              </div>
            ))}
            <div ref={bottomRef} />
          </>
        )}
      </div>

      {/* Input */}
      <div className="flex gap-2">
        <div className="flex-1 relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-mono" style={{ color: "#4ade80" }}>
            &gt;
          </span>
          <Input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isConnected ? "Enter command (↑↓ for history)…" : "Not connected"}
            disabled={!isConnected}
            className="pl-7 font-mono text-xs h-9"
            style={{ background: "#080d14", borderColor: "rgba(56,189,248,0.25)", color: "#e2e8f0" }}
          />
        </div>
        <Button
          onClick={handleSend}
          disabled={!isConnected || !input.trim()}
          size="sm"
          className="h-9 px-3"
          style={{ background: "rgba(74,222,128,0.15)", borderColor: "rgba(74,222,128,0.3)", color: "#4ade80" }}
          variant="outline"
        >
          <Send className="w-3.5 h-3.5" />
        </Button>
      </div>

      {/* Status */}
      <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground">
        <div className="w-1.5 h-1.5 rounded-full" style={{
          background: isConnected ? "#4ade80" : "#374151",
          boxShadow: isConnected ? "0 0 4px #4ade80" : "none"
        }} />
        <span>{isConnected ? "Serial port open · 115200 baud · 8N1" : "Not connected"}</span>
        <span className="ml-auto">{logs.length} lines</span>
      </div>
    </div>
  );
}
