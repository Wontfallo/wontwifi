/**
 * ChannelAnalysis.tsx — Channel congestion, noise floor, and recommendations
 * Design: Scientific Instrument / RF Lab Dashboard
 */

import { useMemo } from "react";

import type { ScanResult } from "@/hooks/useWebSerial";
import {
  computeChannelStats, getCongestionLevel, CONGESTION_COLORS,
  recommendBestChannel24, recommendBestChannel5
} from "@/lib/wifiUtils";
import { CheckCircle2, AlertTriangle, XCircle, Wifi } from "lucide-react";
// radarData kept for future use

interface Props {
  scanData: ScanResult;
}

export default function ChannelAnalysis({ scanData }: Props) {
  const aps = scanData.aps;
  const stats24 = useMemo(() => computeChannelStats(aps.filter(a => a.band === "2.4")), [aps]);
  const stats5  = useMemo(() => computeChannelStats(aps.filter(a => a.band === "5")), [aps]);
  const rec24   = useMemo(() => recommendBestChannel24(aps), [aps]);
  const rec5    = useMemo(() => recommendBestChannel5(aps), [aps]);


  return (
    <div className="space-y-4">
      {/* Recommendations */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <RecommendationCard
          band="2.4 GHz"
          channel={rec24.channel}
          reason={rec24.reason}
          color="green"
        />
        <RecommendationCard
          band="5 GHz"
          channel={rec5.channel}
          reason={rec5.reason}
          color="blue"
        />
      </div>

      {/* 2.4 GHz Channel Grid */}
      <div className="rf-panel p-4 rounded-lg" style={{ background: "#141e2e", border: "1px solid rgba(74,222,128,0.15)" }}>
        <h3 className="text-sm font-semibold mb-3" style={{ fontFamily: "'Space Grotesk', sans-serif", color: "#4ade80" }}>
          2.4 GHz Channel Map
        </h3>
        <div className="grid grid-cols-13 gap-1.5" style={{ gridTemplateColumns: "repeat(13, 1fr)" }}>
          {Array.from({ length: 13 }, (_, i) => i + 1).map(ch => {
            const s = stats24.find(x => x.channel === ch);
            const level = s ? getCongestionLevel(s.busyScore) : "clear";
            const color = CONGESTION_COLORS[level];
            const isNonOverlapping = [1, 6, 11].includes(ch);
            return (
              <div key={ch} className="flex flex-col items-center gap-1">
                <div
                  className="w-full rounded-sm flex flex-col items-center justify-end pb-1 transition-all duration-500"
                  style={{
                    height: `${Math.max(24, (s?.apCount ?? 0) * 16 + 24)}px`,
                    background: s ? `${color}22` : "rgba(56,189,248,0.05)",
                    border: `1px solid ${s ? color + "60" : "rgba(56,189,248,0.1)"}`,
                    boxShadow: s ? `0 0 8px ${color}30` : "none",
                  }}
                >
                  {s && (
                    <span className="text-xs font-mono font-bold" style={{ color, fontSize: "10px" }}>
                      {s.apCount}
                    </span>
                  )}
                </div>
                <span className="text-xs font-mono" style={{
                  color: isNonOverlapping ? "#38bdf8" : "#64748b",
                  fontWeight: isNonOverlapping ? 600 : 400,
                  fontSize: "10px"
                }}>
                  {ch}
                </span>
                {isNonOverlapping && (
                  <div className="w-1 h-1 rounded-full" style={{ background: "#38bdf8" }} />
                )}
              </div>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          <span style={{ color: "#38bdf8" }}>●</span> Non-overlapping channels (1, 6, 11) — recommended for new deployments
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Channel Stats Table */}
        <div className="rf-panel p-4 rounded-lg" style={{ background: "#141e2e", border: "1px solid rgba(56,189,248,0.15)" }}>
          <h3 className="text-sm font-semibold mb-3" style={{ fontFamily: "'Space Grotesk', sans-serif", color: "#38bdf8" }}>
            Active Channel Details
          </h3>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {[...stats24, ...stats5].sort((a, b) => b.busyScore - a.busyScore).map(s => {
              const level = getCongestionLevel(s.busyScore);
              const color = CONGESTION_COLORS[level];
              const Icon = level === "clear" ? CheckCircle2 : level === "moderate" ? Wifi : level === "busy" ? AlertTriangle : XCircle;
              return (
                <div key={`${s.band}-${s.channel}`}
                  className="flex items-center gap-3 p-2 rounded"
                  style={{ background: `${color}0d`, border: `1px solid ${color}25` }}>
                  <Icon className="w-3.5 h-3.5 shrink-0" style={{ color }} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono font-semibold" style={{ color }}>
                        {s.band} GHz Ch {s.channel}
                      </span>
                      <span className="text-xs text-muted-foreground">{s.apCount} AP{s.apCount !== 1 ? "s" : ""}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <div className="flex-1 h-1 rounded-full bg-border overflow-hidden">
                        <div className="h-full rounded-full transition-all duration-500"
                          style={{ width: `${s.busyScore}%`, background: color, boxShadow: `0 0 4px ${color}` }} />
                      </div>
                      <span className="text-xs font-mono text-muted-foreground">{s.busyScore}%</span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs font-mono" style={{ color: "#4ade80" }}>{s.maxRssi} dBm</p>
                    <p className="text-xs text-muted-foreground">peak</p>
                  </div>
                </div>
              );
            })}
            {stats24.length === 0 && stats5.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-4">No active channels detected</p>
            )}
          </div>
        </div>

        {/* Noise Floor Analysis */}
        <div className="rf-panel p-4 rounded-lg" style={{ background: "#141e2e", border: "1px solid rgba(74,222,128,0.15)" }}>
          <h3 className="text-sm font-semibold mb-3" style={{ fontFamily: "'Space Grotesk', sans-serif", color: "#4ade80" }}>
            Noise Floor Estimates
          </h3>
          <div className="space-y-3">
            {[...stats24, ...stats5].slice(0, 8).map(s => {
              const noisePercent = Math.max(0, Math.min(100, ((s.noiseFloor + 100) / 60) * 100));
              const noiseColor = noisePercent > 60 ? "#f87171" : noisePercent > 40 ? "#fbbf24" : "#4ade80";
              return (
                <div key={`noise-${s.band}-${s.channel}`} className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="font-mono text-muted-foreground">{s.band} GHz Ch {s.channel}</span>
                    <span className="font-mono" style={{ color: noiseColor }}>{s.noiseFloor} dBm</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-border overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-700"
                      style={{
                        width: `${noisePercent}%`,
                        background: `linear-gradient(90deg, #4ade80, ${noiseColor})`,
                        boxShadow: `0 0 4px ${noiseColor}80`
                      }} />
                  </div>
                </div>
              );
            })}
            {stats24.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-4">No data available</p>
            )}
          </div>

          <div className="mt-4 p-2 rounded" style={{ background: "rgba(56,189,248,0.06)", border: "1px solid rgba(56,189,248,0.15)" }}>
            <p className="text-xs text-muted-foreground leading-relaxed">
              <span style={{ color: "#38bdf8" }}>Noise floor</span> is estimated from the weakest detected signal on each channel.
              Lower values (more negative) indicate a quieter RF environment.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function RecommendationCard({ band, channel, reason, color }: {
  band: string; channel: number; reason: string; color: "green" | "blue";
}) {
  const c = color === "green" ? "#4ade80" : "#38bdf8";
  return (
    <div className="p-4 rounded-lg" style={{
      background: `rgba(${color === "green" ? "74,222,128" : "56,189,248"},0.06)`,
      border: `1px solid rgba(${color === "green" ? "74,222,128" : "56,189,248"},0.25)`,
    }}>
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: `rgba(${color === "green" ? "74,222,128" : "56,189,248"},0.15)`, border: `1px solid ${c}40` }}>
          <CheckCircle2 className="w-5 h-5" style={{ color: c }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{band}</span>
            <span className="text-xs px-1.5 py-0.5 rounded font-mono font-bold"
              style={{ background: `${c}20`, color: c }}>
              Ch {channel}
            </span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">{reason}</p>
        </div>
      </div>
    </div>
  );
}
