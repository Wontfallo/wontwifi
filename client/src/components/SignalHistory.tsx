/**
 * SignalHistory.tsx — RSSI trend lines over multiple scans
 * Design: Scientific Instrument / RF Lab Dashboard
 */

import { useMemo, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend
} from "recharts";
import type { ScanResult } from "@/hooks/useWebSerial";
import { getSignalQuality, SIGNAL_COLORS } from "@/lib/wifiUtils";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

interface Props {
  history: ScanResult[];
}

// Distinct colors for up to 10 tracked APs
const LINE_COLORS = [
  "#4ade80", "#38bdf8", "#fbbf24", "#f87171", "#a78bfa",
  "#34d399", "#60a5fa", "#fb923c", "#f472b6", "#94a3b8",
];

export default function SignalHistory({ history }: Props) {
  const [maxAPs, setMaxAPs] = useState(8);

  // Collect all unique BSSIDs across history, sorted by most recent RSSI
  const trackedAPs = useMemo(() => {
    if (history.length === 0) return [];
    const latest = history[0];
    const sorted = [...latest.aps].sort((a, b) => b.rssi - a.rssi);
    return sorted.slice(0, maxAPs);
  }, [history, maxAPs]);

  // Build time-series data: one entry per scan
  const chartData = useMemo(() => {
    return [...history].reverse().map((scan, i) => {
      const entry: Record<string, number | string> = {
        scan: `#${i + 1}`,
        ts: new Date(scan.ts).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }),
      };
      for (const ap of trackedAPs) {
        const found = scan.aps.find(a => a.bssid === ap.bssid);
        if (found) entry[ap.ssid || ap.bssid] = found.rssi;
      }
      return entry;
    });
  }, [history, trackedAPs]);

  // Trend calculation for each AP
  const trends = useMemo(() => {
    if (history.length < 2) return {};
    const result: Record<string, { trend: "up" | "down" | "stable"; delta: number }> = {};
    for (const ap of trackedAPs) {
      const key = ap.ssid || ap.bssid;
      const latest = history[0].aps.find(a => a.bssid === ap.bssid)?.rssi;
      const prev = history[1]?.aps.find(a => a.bssid === ap.bssid)?.rssi;
      if (latest !== undefined && prev !== undefined) {
        const delta = latest - prev;
        result[key] = {
          trend: Math.abs(delta) < 2 ? "stable" : delta > 0 ? "up" : "down",
          delta,
        };
      }
    }
    return result;
  }, [history, trackedAPs]);

  if (history.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
        No scan history yet — trigger at least one scan to see trends.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* RSSI Trend Chart */}
      <div className="rf-panel p-4 rounded-lg" style={{ background: "#141e2e", border: "1px solid rgba(74,222,128,0.15)" }}>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold" style={{ fontFamily: "'Space Grotesk', sans-serif", color: "#4ade80" }}>
              RSSI History
            </h3>
            <p className="text-xs text-muted-foreground">{history.length} scans · Top {trackedAPs.length} APs by signal strength</p>
          </div>
          <div className="flex gap-1">
            {[5, 8, 10].map(n => (
              <button key={n}
                className="text-xs px-2 py-1 rounded font-mono"
                style={maxAPs === n
                  ? { background: "rgba(74,222,128,0.15)", color: "#4ade80", border: "1px solid rgba(74,222,128,0.3)" }
                  : { background: "transparent", color: "#64748b", border: "1px solid rgba(56,189,248,0.1)" }
                }
                onClick={() => setMaxAPs(n)}>
                Top {n}
              </button>
            ))}
          </div>
        </div>

        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(56,189,248,0.08)" />
            <XAxis dataKey="ts" tick={{ fill: "#64748b", fontSize: 10, fontFamily: "IBM Plex Mono" }} axisLine={false} tickLine={false} />
            <YAxis
              domain={[-100, -20]}
              tick={{ fill: "#64748b", fontSize: 10, fontFamily: "IBM Plex Mono" }}
              axisLine={false} tickLine={false} width={36}
              tickFormatter={(v) => `${v}`}
            />
            <Tooltip
              contentStyle={{ background: "#0f1623", border: "1px solid rgba(56,189,248,0.3)", borderRadius: "6px", fontSize: "11px", fontFamily: "IBM Plex Mono" }}
              labelStyle={{ color: "#38bdf8" }}
              itemStyle={{ color: "#e2e8f0" }}
              formatter={(v: number) => [`${v} dBm`]}
            />
            <Legend
              wrapperStyle={{ fontSize: "10px", fontFamily: "IBM Plex Mono", paddingTop: "8px" }}
            />
            {trackedAPs.map((ap, i) => {
              const key = ap.ssid || ap.bssid;
              return (
                <Line
                  key={ap.bssid}
                  type="monotone"
                  dataKey={key}
                  stroke={LINE_COLORS[i % LINE_COLORS.length]}
                  strokeWidth={1.5}
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 0 }}
                  connectNulls
                  style={{ filter: `drop-shadow(0 0 3px ${LINE_COLORS[i % LINE_COLORS.length]}60)` }}
                />
              );
            })}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* AP Trend Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {trackedAPs.map((ap, i) => {
          const key = ap.ssid || ap.bssid;
          const trend = trends[key];
          const quality = getSignalQuality(ap.rssi);
          const color = LINE_COLORS[i % LINE_COLORS.length];
          const TrendIcon = trend?.trend === "up" ? TrendingUp : trend?.trend === "down" ? TrendingDown : Minus;
          const trendColor = trend?.trend === "up" ? "#4ade80" : trend?.trend === "down" ? "#f87171" : "#64748b";

          return (
            <div key={ap.bssid} className="p-3 rounded-lg"
              style={{ background: "#141e2e", border: `1px solid ${color}25` }}>
              <div className="flex items-start justify-between mb-2">
                <div className="w-2 h-2 rounded-full mt-0.5" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
                {trend && (
                  <div className="flex items-center gap-0.5">
                    <TrendIcon className="w-3 h-3" style={{ color: trendColor }} />
                    <span className="text-xs font-mono" style={{ color: trendColor, fontSize: "10px" }}>
                      {trend.delta > 0 ? "+" : ""}{trend.delta}
                    </span>
                  </div>
                )}
              </div>
              <p className="text-xs font-medium truncate mb-1" style={{ color: "#e2e8f0" }}>
                {ap.ssid || "(Hidden)"}
              </p>
              <p className="text-xs font-mono font-bold" style={{ color }}>
                {ap.rssi} dBm
              </p>
              <p className="text-xs capitalize" style={{ color: SIGNAL_COLORS[quality], fontSize: "10px" }}>
                {quality}
              </p>
            </div>
          );
        })}
      </div>

      {/* Scan History Summary */}
      <div className="rf-panel p-4 rounded-lg" style={{ background: "#141e2e", border: "1px solid rgba(56,189,248,0.15)" }}>
        <h3 className="text-sm font-semibold mb-3" style={{ fontFamily: "'Space Grotesk', sans-serif", color: "#38bdf8" }}>
          Scan Log
        </h3>
        <div className="space-y-1.5 max-h-40 overflow-y-auto">
          {history.slice(0, 20).map((scan, i) => (
            <div key={scan.ts} className="flex items-center gap-3 text-xs font-mono"
              style={{ color: i === 0 ? "#e2e8f0" : "#64748b" }}>
              <span style={{ color: "#38bdf8", minWidth: "28px" }}>#{history.length - i}</span>
              <span>{new Date(scan.ts).toLocaleTimeString()}</span>
              <span style={{ color: "#4ade80" }}>{scan.count} APs</span>
              <span>Best: {Math.max(...scan.aps.map(a => a.rssi))} dBm</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
