/**
 * SpectrumChart.tsx — Wi-Fi Spectrum Parabolic Curve View
 * Design: Android WiFi Analyzer–style overlapping translucent curves
 *
 * Shows each AP as a bell/parabolic curve centered on its channel,
 * with height = signal strength (RSSI). Overlapping APs on the same
 * channel display as stacked translucent shapes with SSID labels.
 */

import { useMemo, useRef, useEffect, useState, useCallback } from "react";
import type { ScanResult, AccessPoint } from "@/hooks/useWebSerial";
import { get24GHzFrequency } from "@/lib/wifiUtils";

interface Props {
  scanData: ScanResult;
}

// ── Color palette for AP curves (distinct, vibrant, good on dark bg) ──
const AP_COLORS = [
  "#4ade80", "#38bdf8", "#f97316", "#a78bfa", "#fb923c",
  "#22d3ee", "#f87171", "#facc15", "#34d399", "#e879f9",
  "#60a5fa", "#fbbf24", "#2dd4bf", "#f472b6", "#818cf8",
  "#a3e635", "#fb7185", "#67e8f9", "#c084fc", "#fca5a1",
];

function getApColor(index: number): string {
  return AP_COLORS[index % AP_COLORS.length];
}

// ── Constants ──
const CHART_PADDING_LEFT = 52;
const CHART_PADDING_RIGHT = 20;
const CHART_PADDING_TOP = 24;
const CHART_PADDING_BOTTOM = 42;
const RSSI_MIN = -100;
const RSSI_MAX = -20;

// 2.4 GHz: channel 1 center = 2412 MHz, channel 13 center = 2472 MHz
// We show from 2400 to 2484 for a bit of margin
const FREQ_MIN_24 = 2400;
const FREQ_MAX_24 = 2485;

/**
 * Generate Gaussian bell curve points for one AP.
 * Returns SVG path data points as {x_freq, y_rssi} pairs.
 */
function generateBellCurve(ap: AccessPoint, steps = 60): { freq: number; rssi: number }[] {
  const centerFreq = get24GHzFrequency(ap.ch);
  const bandwidth = 22; // 2.4 GHz channel width in MHz
  const sigma = bandwidth / 3.5; // controls curve width
  const points: { freq: number; rssi: number }[] = [];

  // Extend curve a bit beyond the channel bandwidth
  const spread = bandwidth * 1.1;

  for (let i = 0; i <= steps; i++) {
    const freq = centerFreq - spread + (i / steps) * spread * 2;
    // Gaussian: peak at ap.rssi, falls off to noise floor
    const gaussian = Math.exp(-0.5 * Math.pow((freq - centerFreq) / sigma, 2));
    const rssi = RSSI_MIN + (ap.rssi - RSSI_MIN) * gaussian;
    points.push({ freq, rssi });
  }

  return points;
}

// ── Tooltip state ──
interface TooltipData {
  ap: AccessPoint;
  x: number;
  y: number;
}

export default function SpectrumChart({ scanData }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 420 });
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);
  const [hoveredAp, setHoveredAp] = useState<string | null>(null);

  // Resize observer
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width } = entry.contentRect;
        setDimensions({ width: Math.max(400, width), height: Math.max(320, Math.min(500, width * 0.48)) });
      }
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const { width, height } = dimensions;
  const plotW = width - CHART_PADDING_LEFT - CHART_PADDING_RIGHT;
  const plotH = height - CHART_PADDING_TOP - CHART_PADDING_BOTTOM;

  // Separate 2.4 GHz and 5 GHz APs
  const aps24 = useMemo(() => scanData.aps.filter(a => a.band === "2.4"), [scanData]);
  const aps5 = useMemo(() => scanData.aps.filter(a => a.band === "5"), [scanData]);

  // Coordinate transforms for 2.4 GHz
  const freqToX = useCallback((freq: number) => {
    return CHART_PADDING_LEFT + ((freq - FREQ_MIN_24) / (FREQ_MAX_24 - FREQ_MIN_24)) * plotW;
  }, [plotW]);

  const rssiToY = useCallback((rssi: number) => {
    const clamped = Math.max(RSSI_MIN, Math.min(RSSI_MAX, rssi));
    return CHART_PADDING_TOP + (1 - (clamped - RSSI_MIN) / (RSSI_MAX - RSSI_MIN)) * plotH;
  }, [plotH]);

  // Build SVG path for an AP bell curve
  const buildCurvePath = useCallback((ap: AccessPoint): string => {
    const pts = generateBellCurve(ap);
    const commands = pts.map((p, i) => {
      const x = freqToX(p.freq);
      const y = rssiToY(p.rssi);
      return i === 0 ? `M ${x} ${y}` : `L ${x} ${y}`;
    });
    return commands.join(" ");
  }, [freqToX, rssiToY]);

  // Build closed SVG path for filled area
  const buildFilledPath = useCallback((ap: AccessPoint): string => {
    const pts = generateBellCurve(ap);
    const baseY = rssiToY(RSSI_MIN);
    const commands = pts.map((p, i) => {
      const x = freqToX(p.freq);
      const y = rssiToY(p.rssi);
      return i === 0 ? `M ${x} ${baseY} L ${x} ${y}` : `L ${x} ${y}`;
    });
    // Close path back to baseline
    const lastPt = pts[pts.length - 1];
    commands.push(`L ${freqToX(lastPt.freq)} ${baseY} Z`);
    return commands.join(" ");
  }, [freqToX, rssiToY]);

  // Channels to show on x-axis
  const channels24 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
  const nonOverlapChannels = [1, 6, 11];

  // Grid lines for RSSI
  const rssiTicks = [-30, -40, -50, -60, -70, -80, -90];

  // Sort APs so weakest are drawn first (behind) and strongest last (front)
  const sortedAps = useMemo(() => [...aps24].sort((a, b) => a.rssi - b.rssi), [aps24]);

  // ── 5 GHz data for secondary display ──
  const channels5 = useMemo(() => {
    const chSet = new Set(aps5.map(a => a.ch));
    return Array.from(chSet).sort((a, b) => a - b);
  }, [aps5]);

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    // Find closest AP curve to mouse
    let closest: AccessPoint | null = null;
    let closestDist = Infinity;

    for (const ap of aps24) {
      const centerFreq = get24GHzFrequency(ap.ch);
      const cx = freqToX(centerFreq);
      const cy = rssiToY(ap.rssi);
      const dist = Math.sqrt((mx - cx) ** 2 + (my - cy) ** 2);
      if (dist < closestDist && dist < 80) {
        closestDist = dist;
        closest = ap;
      }
    }

    if (closest) {
      setTooltip({ ap: closest, x: mx, y: my });
      setHoveredAp(closest.bssid);
    } else {
      setTooltip(null);
      setHoveredAp(null);
    }
  }, [aps24, freqToX, rssiToY]);

  const handleMouseLeave = useCallback(() => {
    setTooltip(null);
    setHoveredAp(null);
  }, []);

  // Encryption label
  const encLabel = (enc: number) => {
    const labels: Record<number, string> = { 0: "Open", 1: "WEP", 2: "WPA", 3: "WPA2", 4: "WPA/WPA2", 5: "WPA3" };
    return labels[enc] ?? "Unknown";
  };

  return (
    <div className="space-y-4 h-full">
      {/* ── 2.4 GHz Parabolic Spectrum ── */}
      <div className="rf-panel rounded-lg overflow-hidden"
        style={{ background: "#0c1220", border: "1px solid rgba(74,222,128,0.15)" }}>
        <div className="flex items-center justify-between px-4 pt-3 pb-1">
          <div>
            <h3 className="text-sm font-semibold" style={{ fontFamily: "'Space Grotesk', sans-serif", color: "#4ade80" }}>
              2.4 GHz Spectrum
            </h3>
            <p className="text-xs text-muted-foreground">{aps24.length} APs · Channels 1–13</p>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span>dBm scale</span>
            <span style={{ color: "#4ade80" }}>▲ stronger</span>
          </div>
        </div>

        <div ref={containerRef} className="w-full" style={{ minHeight: 320 }}>
          <svg
            ref={svgRef}
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            style={{ cursor: "crosshair" }}
          >
            <defs>
              {/* Glow filter for curves */}
              <filter id="curveGlow">
                <feGaussianBlur in="SourceGraphic" stdDeviation="2" />
              </filter>

              {/* Gradient definitions for each AP */}
              {sortedAps.map((ap, i) => {
                const color = getApColor(i);
                return (
                  <linearGradient key={ap.bssid} id={`grad-${i}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={color} stopOpacity={hoveredAp === ap.bssid ? 0.55 : 0.35} />
                    <stop offset="100%" stopColor={color} stopOpacity={0.03} />
                  </linearGradient>
                );
              })}
            </defs>

            {/* ── Background grid ── */}
            {/* Horizontal RSSI lines */}
            {rssiTicks.map(rssi => {
              const y = rssiToY(rssi);
              return (
                <g key={rssi}>
                  <line x1={CHART_PADDING_LEFT} y1={y} x2={width - CHART_PADDING_RIGHT} y2={y}
                    stroke="rgba(56,189,248,0.07)" strokeWidth={1} />
                  <text x={CHART_PADDING_LEFT - 6} y={y + 3.5}
                    fill="#475569" fontSize={10} fontFamily="'IBM Plex Mono', monospace" textAnchor="end">
                    {rssi}
                  </text>
                </g>
              );
            })}

            {/* Y-axis label */}
            <text x={14} y={height / 2} fill="#64748b" fontSize={10} fontFamily="'IBM Plex Mono', monospace"
              textAnchor="middle" transform={`rotate(-90, 14, ${height / 2})`}>
              dBm
            </text>

            {/* Vertical channel lines */}
            {channels24.map(ch => {
              const freq = get24GHzFrequency(ch);
              const x = freqToX(freq);
              const isNonOverlap = nonOverlapChannels.includes(ch);
              return (
                <g key={ch}>
                  <line x1={x} y1={CHART_PADDING_TOP} x2={x} y2={height - CHART_PADDING_BOTTOM}
                    stroke={isNonOverlap ? "rgba(56,189,248,0.18)" : "rgba(56,189,248,0.06)"} strokeWidth={1}
                    strokeDasharray={isNonOverlap ? "none" : "2 4"} />
                  <text x={x} y={height - CHART_PADDING_BOTTOM + 16}
                    fill={isNonOverlap ? "#38bdf8" : "#475569"}
                    fontSize={isNonOverlap ? 12 : 10}
                    fontFamily="'IBM Plex Mono', monospace"
                    fontWeight={isNonOverlap ? 600 : 400}
                    textAnchor="middle">
                    {ch}
                  </text>
                  {isNonOverlap && (
                    <text x={x} y={height - 6}
                      fill="#38bdf8" fontSize={8} fontFamily="'IBM Plex Mono', monospace"
                      textAnchor="middle" opacity={0.6}>
                      {get24GHzFrequency(ch)} MHz
                    </text>
                  )}
                </g>
              );
            })}

            {/* X-axis label */}
            <text x={CHART_PADDING_LEFT + plotW / 2} y={height - CHART_PADDING_BOTTOM + 34}
              fill="#64748b" fontSize={10} fontFamily="'IBM Plex Mono', monospace" textAnchor="middle">
              Channel
            </text>

            {/* ── AP Bell Curves ── */}
            {sortedAps.map((ap, i) => {
              const color = getApColor(i);
              const isHovered = hoveredAp === ap.bssid;
              const centerFreq = get24GHzFrequency(ap.ch);
              const peakX = freqToX(centerFreq);
              const peakY = rssiToY(ap.rssi);

              return (
                <g key={`${ap.bssid}-${i}`} style={{ transition: "opacity 0.2s" }}>
                  {/* Filled area with gradient */}
                  <path
                    d={buildFilledPath(ap)}
                    fill={`url(#grad-${i})`}
                    opacity={isHovered ? 1 : 0.8}
                  />

                  {/* Glow under the curve (subtle) */}
                  <path
                    d={buildCurvePath(ap)}
                    fill="none"
                    stroke={color}
                    strokeWidth={isHovered ? 3 : 1.5}
                    opacity={0.3}
                    filter="url(#curveGlow)"
                  />

                  {/* Main curve stroke */}
                  <path
                    d={buildCurvePath(ap)}
                    fill="none"
                    stroke={color}
                    strokeWidth={isHovered ? 2.5 : 1.5}
                    opacity={isHovered ? 1 : 0.75}
                  />

                  {/* Peak dot */}
                  <circle cx={peakX} cy={peakY} r={isHovered ? 4 : 2.5}
                    fill={color} opacity={isHovered ? 1 : 0.9}
                    style={{ filter: `drop-shadow(0 0 4px ${color})` }} />

                  {/* SSID label at peak */}
                  {(ap.ssid || isHovered) && (
                    <text x={peakX} y={peakY - 8}
                      fill={color} fontSize={isHovered ? 11 : 9}
                      fontFamily="'IBM Plex Mono', monospace"
                      fontWeight={isHovered ? 700 : 500}
                      textAnchor="middle"
                      opacity={isHovered ? 1 : 0.85}
                      style={{ textShadow: "0 0 6px rgba(0,0,0,0.8), 0 1px 3px rgba(0,0,0,0.9)" }}>
                      {ap.ssid || "(hidden)"}
                      {isHovered ? `, ${ap.rssi}` : ""}
                    </text>
                  )}
                </g>
              );
            })}

            {/* ── Tooltip overlay ── */}
            {tooltip && (
              <foreignObject
                x={Math.min(tooltip.x + 12, width - 200)}
                y={Math.max(tooltip.y - 80, 4)}
                width={190} height={100}
                style={{ pointerEvents: "none" }}
              >
                <div style={{
                  background: "rgba(15,22,35,0.95)",
                  border: "1px solid rgba(56,189,248,0.35)",
                  borderRadius: 8,
                  padding: "8px 10px",
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 11,
                  color: "#e2e8f0",
                  backdropFilter: "blur(8px)",
                }}>
                  <div style={{ color: "#38bdf8", fontWeight: 700, marginBottom: 2 }}>
                    {tooltip.ap.ssid || "(hidden)"}
                  </div>
                  <div style={{ color: "#94a3b8", fontSize: 10 }}>{tooltip.ap.bssid}</div>
                  <div style={{ marginTop: 4, display: "flex", gap: 12 }}>
                    <span>Ch <b style={{ color: "#4ade80" }}>{tooltip.ap.ch}</b></span>
                    <span><b style={{ color: "#facc15" }}>{tooltip.ap.rssi}</b> dBm</span>
                  </div>
                  <div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>
                    {encLabel(tooltip.ap.enc)} · {tooltip.ap.band} GHz
                  </div>
                </div>
              </foreignObject>
            )}
          </svg>
        </div>
      </div>

      {/* ── 5 GHz Summary (if any) ── */}
      {aps5.length > 0 && (
        <div className="rf-panel p-4 rounded-lg"
          style={{ background: "#0c1220", border: "1px solid rgba(56,189,248,0.15)" }}>
          <h3 className="text-sm font-semibold mb-2" style={{ fontFamily: "'Space Grotesk', sans-serif", color: "#38bdf8" }}>
            5 GHz Networks
          </h3>
          <p className="text-xs text-muted-foreground mb-3">{aps5.length} APs detected on {channels5.length} channels</p>
          <div className="flex flex-wrap gap-2">
            {aps5.map((ap, i) => (
              <div key={ap.bssid + i} className="flex items-center gap-2 px-3 py-1.5 rounded-md text-xs"
                style={{ background: "rgba(56,189,248,0.08)", border: "1px solid rgba(56,189,248,0.15)" }}>
                <span className="font-mono font-semibold" style={{ color: "#38bdf8" }}>Ch {ap.ch}</span>
                <span style={{ color: "#e2e8f0" }}>{ap.ssid || "(hidden)"}</span>
                <span className="font-mono" style={{ color: "#facc15" }}>{ap.rssi} dBm</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Signal Strength Legend ── */}
      <div className="rf-panel p-4 rounded-lg"
        style={{ background: "#0c1220", border: "1px solid rgba(74,222,128,0.1)" }}>
        <div className="flex items-center justify-between">
          <div className="flex gap-4">
            {[
              { label: "Excellent (> -50)", color: "#4ade80", count: scanData.aps.filter(a => a.rssi >= -50).length },
              { label: "Good (-50 to -60)", color: "#86efac", count: scanData.aps.filter(a => a.rssi >= -60 && a.rssi < -50).length },
              { label: "Fair (-60 to -70)", color: "#fbbf24", count: scanData.aps.filter(a => a.rssi >= -70 && a.rssi < -60).length },
              { label: "Weak (< -70)", color: "#f87171", count: scanData.aps.filter(a => a.rssi < -70).length },
            ].map(({ label, color, count }) => (
              <div key={label} className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full" style={{ background: color, boxShadow: `0 0 6px ${color}50` }} />
                <span className="text-xs text-muted-foreground">{label}</span>
                <span className="text-xs font-mono font-semibold" style={{ color }}>{count}</span>
              </div>
            ))}
          </div>
          <span className="text-xs text-muted-foreground font-mono">
            Total: {scanData.aps.length} APs
          </span>
        </div>
      </div>
    </div>
  );
}
