/**
 * APTable.tsx — WiFi Overview–style AP List with Signal Gauge
 * Design: Ranked card list + arc gauge detail panel
 *
 * Left: scrollable ranked list of APs with signal bars
 * Right: selected AP detail with SVG arc gauge, RSSI history sparkline, and metadata
 */

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Search, Lock, Unlock, Wifi, WifiOff, Eye, EyeOff,
  ArrowUpDown, ArrowUp, ArrowDown, Shield, ShieldAlert, ShieldCheck
} from "lucide-react";
import type { ScanResult, AccessPoint, EncryptionType } from "@/hooks/useWebSerial";
import { ENC_LABELS } from "@/hooks/useWebSerial";
import { getSignalQuality, SIGNAL_COLORS, rssiToPercent, get24GHzFrequency } from "@/lib/wifiUtils";

interface Props {
  scanData: ScanResult;
}

type SortKey = "rssi" | "ssid" | "ch" | "enc";
type SortDir = "asc" | "desc";

// ── Signal bar segments (like WiFi Overview) ──
function SignalBars({ rssi }: { rssi: number }) {
  const pct = rssiToPercent(rssi);
  const totalBars = 16;
  const filledBars = Math.round((pct / 100) * totalBars);
  const quality = getSignalQuality(rssi);
  const color = SIGNAL_COLORS[quality];

  return (
    <div className="flex gap-px items-end" style={{ height: 14 }}>
      {Array.from({ length: totalBars }, (_, i) => {
        const filled = i < filledBars;
        const h = 4 + (i / totalBars) * 10;
        return (
          <div key={i} style={{
            width: 3,
            height: h,
            borderRadius: 1,
            background: filled ? color : "rgba(100,116,139,0.2)",
            boxShadow: filled ? `0 0 3px ${color}50` : "none",
            transition: "all 0.3s ease",
          }} />
        );
      })}
    </div>
  );
}

// ── SVG Arc Gauge (speedometer style) ──
function SignalGauge({ rssi }: { rssi: number }) {
  const size = 220;
  const cx = size / 2;
  const cy = size / 2 + 15;
  const radius = 85;
  const startAngle = -210;
  const endAngle = 30;
  const totalAngle = endAngle - startAngle;

  // Map RSSI (-100 to -20) to angle
  const pct = Math.max(0, Math.min(1, (rssi + 100) / 80));
  const needleAngle = startAngle + pct * totalAngle;

  const quality = getSignalQuality(rssi);
  const color = SIGNAL_COLORS[quality];

  // Arc path helper
  const polarToCartesian = (cx: number, cy: number, r: number, angleDeg: number) => {
    const rad = (angleDeg * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  };

  const describeArc = (cx: number, cy: number, r: number, startA: number, endA: number) => {
    const start = polarToCartesian(cx, cy, r, endA);
    const end = polarToCartesian(cx, cy, r, startA);
    const largeArc = endA - startA > 180 ? 1 : 0;
    return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 0 ${end.x} ${end.y}`;
  };

  // Tick marks
  const ticks = [-100, -90, -80, -70, -60, -50, -40, -30, -20];
  const tickColors = ["#f87171", "#f87171", "#f97316", "#f97316", "#fbbf24", "#fbbf24", "#86efac", "#4ade80", "#4ade80"];

  // Needle endpoint
  const needleEnd = polarToCartesian(cx, cy, radius - 12, needleAngle);
  const needleBase1 = polarToCartesian(cx, cy, 6, needleAngle - 90);
  const needleBase2 = polarToCartesian(cx, cy, 6, needleAngle + 90);

  return (
    <svg width={size} height={size * 0.7} viewBox={`0 0 ${size} ${size * 0.7}`}>
      <defs>
        <filter id="gaugeGlow">
          <feGaussianBlur in="SourceGraphic" stdDeviation="3" />
        </filter>
        <filter id="needleShadow">
          <feDropShadow dx="0" dy="1" stdDeviation="2" floodColor={color} floodOpacity="0.5" />
        </filter>
      </defs>

      {/* Background arc track */}
      <path d={describeArc(cx, cy, radius, startAngle, endAngle)}
        fill="none" stroke="rgba(100,116,139,0.15)" strokeWidth={14} strokeLinecap="round" />

      {/* Colored segments */}
      {ticks.slice(0, -1).map((_, i) => {
        const segStart = startAngle + (i / (ticks.length - 1)) * totalAngle;
        const segEnd = startAngle + ((i + 1) / (ticks.length - 1)) * totalAngle;
        return (
          <path key={i} d={describeArc(cx, cy, radius, segStart, segEnd)}
            fill="none" stroke={tickColors[i]} strokeWidth={14} strokeLinecap="butt"
            opacity={pct * (ticks.length - 1) >= i ? 0.7 : 0.1}
          />
        );
      })}

      {/* Glow on active arc */}
      <path d={describeArc(cx, cy, radius, startAngle, needleAngle)}
        fill="none" stroke={color} strokeWidth={16} strokeLinecap="round"
        opacity={0.2} filter="url(#gaugeGlow)" />

      {/* Tick labels */}
      {ticks.map((val, i) => {
        const angle = startAngle + (i / (ticks.length - 1)) * totalAngle;
        const pos = polarToCartesian(cx, cy, radius + 18, angle);
        return (
          <text key={val} x={pos.x} y={pos.y} fill="#64748b" fontSize={8}
            fontFamily="'IBM Plex Mono', monospace" textAnchor="middle" dominantBaseline="middle">
            {val}
          </text>
        );
      })}

      {/* dBm label */}
      <text x={cx} y={cy - 15} fill="#64748b" fontSize={10}
        fontFamily="'IBM Plex Mono', monospace" textAnchor="middle">
        dBm
      </text>

      {/* WiFi icon at center */}
      <text x={cx} y={cy - 2} fill={color} fontSize={16} textAnchor="middle" opacity={0.5}>
        ⦿
      </text>

      {/* Needle */}
      <polygon
        points={`${needleEnd.x},${needleEnd.y} ${needleBase1.x},${needleBase1.y} ${needleBase2.x},${needleBase2.y}`}
        fill={color} filter="url(#needleShadow)"
      />

      {/* Center cap */}
      <circle cx={cx} cy={cy} r={8} fill="#1e293b" stroke={color} strokeWidth={2} />

      {/* Big RSSI value */}
      <text x={cx - 42} y={cy + 40} fill={color} fontSize={28}
        fontFamily="'Space Grotesk', sans-serif" fontWeight={700} textAnchor="middle">
        {rssi}
      </text>
      <text x={cx - 42} y={cy + 54} fill="#64748b" fontSize={10}
        fontFamily="'IBM Plex Mono', monospace" textAnchor="middle">
        dBm
      </text>

      {/* Channel value */}
      <text x={cx + 42} y={cy + 40} fill="#38bdf8" fontSize={28}
        fontFamily="'Space Grotesk', sans-serif" fontWeight={700} textAnchor="middle">
        –
      </text>
      <text x={cx + 42} y={cy + 54} fill="#64748b" fontSize={10}
        fontFamily="'IBM Plex Mono', monospace" textAnchor="middle">
        canal
      </text>
    </svg>
  );
}

// ── Detail gauge with channel ──
function SignalGaugeWithChannel({ ap }: { ap: AccessPoint }) {
  const quality = getSignalQuality(ap.rssi);
  const color = SIGNAL_COLORS[quality];
  const size = 220;
  const cx = size / 2;
  const cy = size / 2 + 15;
  const radius = 85;
  const startAngle = -210;
  const endAngle = 30;
  const totalAngle = endAngle - startAngle;
  const pct = Math.max(0, Math.min(1, (ap.rssi + 100) / 80));
  const needleAngle = startAngle + pct * totalAngle;

  const polarToCartesian = (cx: number, cy: number, r: number, angleDeg: number) => {
    const rad = (angleDeg * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  };

  const describeArc = (cx: number, cy: number, r: number, startA: number, endA: number) => {
    const start = polarToCartesian(cx, cy, r, endA);
    const end = polarToCartesian(cx, cy, r, startA);
    const largeArc = endA - startA > 180 ? 1 : 0;
    return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 0 ${end.x} ${end.y}`;
  };

  const ticks = [-100, -90, -80, -70, -60, -50, -40, -30, -20];
  const tickColors = ["#f87171", "#f87171", "#f97316", "#f97316", "#fbbf24", "#fbbf24", "#86efac", "#4ade80", "#4ade80"];

  const needleEnd = polarToCartesian(cx, cy, radius - 12, needleAngle);
  const needleBase1 = polarToCartesian(cx, cy, 6, needleAngle - 90);
  const needleBase2 = polarToCartesian(cx, cy, 6, needleAngle + 90);

  return (
    <svg width={size} height={size * 0.78} viewBox={`0 0 ${size} ${size * 0.78}`}>
      <defs>
        <filter id="detailGaugeGlow">
          <feGaussianBlur in="SourceGraphic" stdDeviation="3" />
        </filter>
        <filter id="detailNeedleShadow">
          <feDropShadow dx="0" dy="1" stdDeviation="2" floodColor={color} floodOpacity="0.5" />
        </filter>
      </defs>

      {/* Background arc */}
      <path d={describeArc(cx, cy, radius, startAngle, endAngle)}
        fill="none" stroke="rgba(100,116,139,0.12)" strokeWidth={14} strokeLinecap="round" />

      {/* Segments */}
      {ticks.slice(0, -1).map((_, i) => {
        const segStart = startAngle + (i / (ticks.length - 1)) * totalAngle;
        const segEnd = startAngle + ((i + 1) / (ticks.length - 1)) * totalAngle;
        return (
          <path key={i} d={describeArc(cx, cy, radius, segStart, segEnd)}
            fill="none" stroke={tickColors[i]} strokeWidth={14} strokeLinecap="butt"
            opacity={pct * (ticks.length - 1) >= i ? 0.75 : 0.08} />
        );
      })}

      {/* Glow */}
      <path d={describeArc(cx, cy, radius, startAngle, needleAngle)}
        fill="none" stroke={color} strokeWidth={18} strokeLinecap="round"
        opacity={0.15} filter="url(#detailGaugeGlow)" />

      {/* Tick labels */}
      {ticks.map((val, i) => {
        const angle = startAngle + (i / (ticks.length - 1)) * totalAngle;
        const pos = polarToCartesian(cx, cy, radius + 18, angle);
        return (
          <text key={val} x={pos.x} y={pos.y} fill="#475569" fontSize={8}
            fontFamily="'IBM Plex Mono', monospace" textAnchor="middle" dominantBaseline="middle">
            {val}
          </text>
        );
      })}

      {/* WiFi icon */}
      <g transform={`translate(${cx}, ${cy - 8})`} opacity={0.4}>
        <text fill={color} fontSize={18} textAnchor="middle" dominantBaseline="middle">📶</text>
      </g>

      {/* dBm label */}
      <text x={cx} y={cy + 2} fill="#64748b" fontSize={9}
        fontFamily="'IBM Plex Mono', monospace" textAnchor="middle">dBm</text>

      {/* Needle */}
      <polygon
        points={`${needleEnd.x},${needleEnd.y} ${needleBase1.x},${needleBase1.y} ${needleBase2.x},${needleBase2.y}`}
        fill={color} filter="url(#detailNeedleShadow)" />

      {/* Center cap */}
      <circle cx={cx} cy={cy} r={7} fill="#0f172a" stroke={color} strokeWidth={2} />

      {/* RSSI value */}
      <text x={cx - 45} y={cy + 42} fill={color} fontSize={30}
        fontFamily="'Space Grotesk', sans-serif" fontWeight={700} textAnchor="middle">
        {ap.rssi}
      </text>
      <text x={cx - 45} y={cy + 56} fill="#64748b" fontSize={10}
        fontFamily="'IBM Plex Mono', monospace" textAnchor="middle">dBm</text>

      {/* Channel value */}
      <text x={cx + 45} y={cy + 42} fill="#38bdf8" fontSize={30}
        fontFamily="'Space Grotesk', sans-serif" fontWeight={700} textAnchor="middle">
        {ap.ch}
      </text>
      <text x={cx + 45} y={cy + 56} fill="#64748b" fontSize={10}
        fontFamily="'IBM Plex Mono', monospace" textAnchor="middle">channel</text>
    </svg>
  );
}

export default function APTable({ scanData }: Props) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("rssi");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [bandFilter, setBandFilter] = useState<"all" | "2.4" | "5">("all");
  const [showHidden, setShowHidden] = useState(true);
  const [selectedBssid, setSelectedBssid] = useState<string | null>(null);

  const filtered = useMemo(() => {
    let aps = [...scanData.aps];
    if (!showHidden) aps = aps.filter(a => a.ssid !== "");
    if (bandFilter !== "all") aps = aps.filter(a => a.band === bandFilter);
    if (search) {
      const q = search.toLowerCase();
      aps = aps.filter(a =>
        a.ssid.toLowerCase().includes(q) ||
        a.bssid.toLowerCase().includes(q) ||
        a.ch.toString().includes(q)
      );
    }
    aps.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "ssid": cmp = a.ssid.localeCompare(b.ssid); break;
        case "rssi": cmp = a.rssi - b.rssi; break;
        case "ch": cmp = a.ch - b.ch; break;
        case "enc": cmp = a.enc - b.enc; break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return aps;
  }, [scanData.aps, search, sortKey, sortDir, bandFilter, showHidden]);

  // Auto-select strongest AP if nothing selected
  useEffect(() => {
    if (!selectedBssid && filtered.length > 0) {
      setSelectedBssid(filtered[0].bssid);
    }
  }, [filtered, selectedBssid]);

  const selectedAp = useMemo(() =>
    scanData.aps.find(a => a.bssid === selectedBssid) ?? filtered[0] ?? null
  , [scanData.aps, selectedBssid, filtered]);

  const handleSort = useCallback((key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir(key === "rssi" ? "desc" : "asc");
    }
  }, [sortKey]);

  const count24 = scanData.aps.filter(a => a.band === "2.4").length;
  const count5 = scanData.aps.filter(a => a.band === "5").length;

  return (
    <div className="flex gap-4 h-full" style={{ minHeight: 500 }}>
      {/* ── Left: AP List ── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Summary bar */}
        <div className="flex items-center gap-3 px-3 py-2 rounded-t-lg mb-0"
          style={{ background: "rgba(56,189,248,0.06)", border: "1px solid rgba(56,189,248,0.12)", borderBottom: "none" }}>
          <span className="text-xs font-semibold" style={{ color: "#4ade80" }}>
            WiFis: {scanData.aps.length} ({filtered.length})
          </span>
          <span className="text-xs font-mono" style={{ color: "#4ade80" }}>2.4 GHz: {count24}</span>
          <span className="text-xs font-mono" style={{ color: "#38bdf8" }}>5 GHz: {count5}</span>
        </div>

        {/* Filters */}
        <div className="flex gap-2 items-center px-2 py-2"
          style={{ background: "#0c1220", border: "1px solid rgba(56,189,248,0.12)", borderTop: "none" }}>
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)}
              className="pl-7 h-7 text-xs font-mono"
              style={{ background: "#0f1623", borderColor: "rgba(56,189,248,0.15)", color: "#e2e8f0" }} />
          </div>
          {(["all", "2.4", "5"] as const).map(b => (
            <Button key={b} size="sm" variant="outline" className="h-7 px-2 text-xs"
              onClick={() => setBandFilter(b)}
              style={bandFilter === b
                ? { background: "rgba(74,222,128,0.12)", borderColor: "rgba(74,222,128,0.3)", color: "#4ade80" }
                : { background: "transparent", borderColor: "rgba(56,189,248,0.15)", color: "#475569" }
              }>
              {b === "all" ? "All" : `${b}G`}
            </Button>
          ))}
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs"
            onClick={() => setShowHidden(v => !v)}
            style={{ borderColor: "rgba(56,189,248,0.15)", color: showHidden ? "#64748b" : "#fbbf24" }}>
            {showHidden ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
          </Button>
        </div>

        {/* Scrollable AP cards */}
        <div className="flex-1 overflow-y-auto" style={{
          background: "#0a0f1a",
          border: "1px solid rgba(56,189,248,0.12)",
          borderTop: "none",
          borderRadius: "0 0 8px 8px",
        }}>
          {filtered.map((ap, i) => {
            const quality = getSignalQuality(ap.rssi);
            const color = SIGNAL_COLORS[quality];
            const isSelected = ap.bssid === selectedBssid;
            const isHidden = ap.ssid === "";
            const isOpen = ap.enc === 0;

            return (
              <div
                key={ap.bssid + i}
                onClick={() => setSelectedBssid(ap.bssid)}
                className="cursor-pointer transition-all duration-150"
                style={{
                  padding: "10px 12px",
                  borderBottom: "1px solid rgba(56,189,248,0.06)",
                  borderLeft: isSelected ? `3px solid ${color}` : "3px solid transparent",
                  background: isSelected ? "rgba(56,189,248,0.06)" : i % 2 === 0 ? "transparent" : "rgba(56,189,248,0.015)",
                }}
              >
                <div className="flex items-start gap-3">
                  {/* Rank number */}
                  <div className="flex items-center justify-center w-7 h-7 rounded-full shrink-0 text-xs font-bold"
                    style={{
                      background: isSelected ? `${color}20` : "rgba(100,116,139,0.1)",
                      color: isSelected ? color : "#475569",
                      border: `1px solid ${isSelected ? color + "40" : "rgba(100,116,139,0.15)"}`,
                    }}>
                    {i + 1}
                  </div>

                  <div className="flex-1 min-w-0">
                    {/* SSID + BSSID */}
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold truncate"
                        style={{ color: isSelected ? color : (isHidden ? "#475569" : "#e2e8f0"), fontStyle: isHidden ? "italic" : "normal" }}>
                        {isHidden ? "(Hidden Network)" : ap.ssid}
                      </span>
                      <span className="text-xs font-mono text-muted-foreground shrink-0">[{ap.bssid}]</span>
                    </div>

                    {/* Meta row */}
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-xs" style={{ color: "#64748b" }}>
                        {isOpen ? <ShieldAlert className="inline w-3 h-3 mr-0.5" style={{ color: "#fbbf24" }} /> : <ShieldCheck className="inline w-3 h-3 mr-0.5" style={{ color: "#4ade80" }} />}
                        {ENC_LABELS[ap.enc as EncryptionType]}
                      </span>
                      <span className="text-xs font-mono" style={{ color: "#38bdf8" }}>
                        Ch: {ap.ch} ({ap.band === "2.4" ? get24GHzFrequency(ap.ch) : ap.ch * 5 + 5000})
                      </span>
                    </div>
                  </div>

                  {/* Signal info */}
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className="text-sm font-mono font-bold" style={{ color }}>
                      {ap.rssi} dBm
                    </span>
                    <SignalBars rssi={ap.rssi} />
                  </div>
                </div>
              </div>
            );
          })}

          {filtered.length === 0 && (
            <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
              No access points match your filters
            </div>
          )}
        </div>
      </div>

      {/* ── Right: Detail Panel ── */}
      <div className="w-80 shrink-0 flex flex-col gap-3 overflow-y-auto">
        {selectedAp ? (
          <>
            {/* Signal gauge */}
            <div className="rounded-lg p-4 flex flex-col items-center"
              style={{ background: "#0c1220", border: "1px solid rgba(56,189,248,0.15)" }}>
              <SignalGaugeWithChannel ap={selectedAp} />
            </div>

            {/* AP Details */}
            <div className="rounded-lg overflow-hidden"
              style={{ background: "#0c1220", border: "1px solid rgba(56,189,248,0.12)" }}>
              <div className="px-4 py-2.5" style={{ background: "rgba(56,189,248,0.06)", borderBottom: "1px solid rgba(56,189,248,0.1)" }}>
                <h3 className="text-sm font-semibold" style={{ color: "#38bdf8", fontFamily: "'Space Grotesk', sans-serif" }}>
                  Network Details
                </h3>
              </div>

              <div className="divide-y" style={{ borderColor: "rgba(56,189,248,0.06)" }}>
                <DetailRow label="SSID" value={selectedAp.ssid || "(Hidden)"} color={selectedAp.ssid ? "#4ade80" : "#64748b"} />
                <DetailRow label="BSSID" value={selectedAp.bssid} mono />
                <DetailRow label="Signal" value={`${selectedAp.rssi} dBm`} color={SIGNAL_COLORS[getSignalQuality(selectedAp.rssi)]} />
                <DetailRow label="Quality" value={getSignalQuality(selectedAp.rssi).toUpperCase()} color={SIGNAL_COLORS[getSignalQuality(selectedAp.rssi)]} />
                <DetailRow label="Channel" value={selectedAp.ch.toString()} color="#38bdf8" />
                <DetailRow label="Frequency"
                  value={`${selectedAp.band === "2.4" ? get24GHzFrequency(selectedAp.ch) : selectedAp.ch * 5 + 5000} MHz`} />
                <DetailRow label="Band" value={`${selectedAp.band} GHz`}
                  color={selectedAp.band === "2.4" ? "#4ade80" : "#38bdf8"} />
                <DetailRow label="Security" value={ENC_LABELS[selectedAp.enc as EncryptionType]}
                  color={selectedAp.enc === 0 ? "#fbbf24" : "#4ade80"} />
                <DetailRow label="Signal %" value={`${Math.round(rssiToPercent(selectedAp.rssi))}%`}
                  color={SIGNAL_COLORS[getSignalQuality(selectedAp.rssi)]} />
              </div>
            </div>

            {/* Security badge */}
            <div className="rounded-lg px-4 py-3 flex items-center gap-3"
              style={{
                background: selectedAp.enc === 0 ? "rgba(251,191,36,0.06)" : "rgba(74,222,128,0.04)",
                border: `1px solid ${selectedAp.enc === 0 ? "rgba(251,191,36,0.2)" : "rgba(74,222,128,0.12)"}`,
              }}>
              {selectedAp.enc === 0
                ? <Unlock className="w-5 h-5" style={{ color: "#fbbf24" }} />
                : <Lock className="w-5 h-5" style={{ color: "#4ade80" }} />
              }
              <div>
                <p className="text-xs font-semibold" style={{ color: selectedAp.enc === 0 ? "#fbbf24" : "#4ade80" }}>
                  {selectedAp.enc === 0 ? "⚠ Open Network" : "🔒 Secured Network"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {selectedAp.enc === 0
                    ? "This network has no encryption. Traffic can be intercepted."
                    : `Protected with ${ENC_LABELS[selectedAp.enc as EncryptionType]} encryption.`
                  }
                </p>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center rounded-lg"
            style={{ background: "#0c1220", border: "1px solid rgba(56,189,248,0.12)" }}>
            <div className="text-center p-6">
              <WifiOff className="w-10 h-10 mx-auto mb-3" style={{ color: "#475569" }} />
              <p className="text-sm text-muted-foreground">Select an AP from the list</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Detail row component ──
function DetailRow({ label, value, color, mono }: {
  label: string; value: string; color?: string; mono?: boolean;
}) {
  return (
    <div className="flex justify-between items-center px-4 py-2" style={{ borderBottom: "1px solid rgba(56,189,248,0.04)" }}>
      <span className="text-xs text-muted-foreground">{label}:</span>
      <span className={`text-xs font-semibold ${mono ? "font-mono" : ""}`}
        style={{ color: color ?? "#e2e8f0" }}>
        {value}
      </span>
    </div>
  );
}
