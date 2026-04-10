/**
 * wifiUtils.ts — Wi-Fi analysis helper functions
 *
 * Provides channel analysis, signal quality classification,
 * channel overlap detection, and noise estimation.
 */

import type { AccessPoint } from "@/hooks/useWebSerial";

// ---- Signal Quality ----

export type SignalQuality = "excellent" | "good" | "fair" | "poor" | "unusable";

export function getSignalQuality(rssi: number): SignalQuality {
  if (rssi >= -50) return "excellent";
  if (rssi >= -60) return "good";
  if (rssi >= -70) return "fair";
  if (rssi >= -80) return "poor";
  return "unusable";
}

export const SIGNAL_COLORS: Record<SignalQuality, string> = {
  excellent: "#4ade80",  // phosphor green
  good:      "#86efac",  // light green
  fair:      "#fbbf24",  // amber
  poor:      "#f97316",  // orange
  unusable:  "#f87171",  // red
};

export const SIGNAL_BG_COLORS: Record<SignalQuality, string> = {
  excellent: "rgba(74,222,128,0.15)",
  good:      "rgba(134,239,172,0.12)",
  fair:      "rgba(251,191,36,0.15)",
  poor:      "rgba(249,115,22,0.15)",
  unusable:  "rgba(248,113,113,0.15)",
};

export function rssiToPercent(rssi: number): number {
  // Map -100 dBm → 0%, -20 dBm → 100%
  return Math.max(0, Math.min(100, ((rssi + 100) / 80) * 100));
}

// ---- Channel Analysis ----

/**
 * 2.4 GHz channel bandwidth: each channel occupies ~22 MHz,
 * centered at 2412 + (ch-1)*5 MHz. Channels overlap if within 4 channels.
 */
export function get24GHzFrequency(ch: number): number {
  if (ch === 14) return 2484;
  return 2412 + (ch - 1) * 5;
}

/**
 * Returns the list of 2.4 GHz channels that overlap with the given channel.
 * A channel overlaps if its center frequency is within ±11 MHz.
 */
export function getOverlappingChannels24(ch: number): number[] {
  const freq = get24GHzFrequency(ch);
  const overlapping: number[] = [];
  for (let c = 1; c <= 13; c++) {
    if (c !== ch) {
      const diff = Math.abs(get24GHzFrequency(c) - freq);
      if (diff < 22) overlapping.push(c);
    }
  }
  return overlapping;
}

/**
 * Compute per-channel statistics from a list of APs.
 */
export interface ChannelStats {
  channel: number;
  band: "2.4" | "5";
  apCount: number;
  maxRssi: number;
  avgRssi: number;
  busyScore: number;   // 0-100, higher = more congested
  noiseFloor: number;  // estimated noise floor in dBm
  aps: AccessPoint[];
}

export function computeChannelStats(aps: AccessPoint[]): ChannelStats[] {
  const map = new Map<number, AccessPoint[]>();

  for (const ap of aps) {
    if (!map.has(ap.ch)) map.set(ap.ch, []);
    map.get(ap.ch)!.push(ap);
  }

  const stats: ChannelStats[] = [];

  map.forEach((chAps, ch) => {
    const rssis = chAps.map((a) => a.rssi);
    const maxRssi = Math.max(...rssis);
    const avgRssi = rssis.reduce((s, r) => s + r, 0) / rssis.length;
    const band = chAps[0].band;

    // Busy score: based on AP count and signal strength
    // More APs + stronger signals = higher busy score
    const strengthFactor = rssis.filter((r) => r > -70).length / Math.max(rssis.length, 1);
    const countFactor = Math.min(chAps.length / 5, 1);
    const busyScore = Math.round((strengthFactor * 0.6 + countFactor * 0.4) * 100);

    // Noise floor estimate: weakest signal - 10 dBm
    const minRssi = Math.min(...rssis);
    const noiseFloor = Math.min(minRssi - 10, -90);

    stats.push({ channel: ch, band, apCount: chAps.length, maxRssi, avgRssi, busyScore, noiseFloor, aps: chAps });
  });

  return stats.sort((a, b) => a.channel - b.channel);
}

/**
 * Get channel congestion level label.
 */
export type CongestionLevel = "clear" | "moderate" | "busy" | "congested";

export function getCongestionLevel(busyScore: number): CongestionLevel {
  if (busyScore < 25) return "clear";
  if (busyScore < 50) return "moderate";
  if (busyScore < 75) return "busy";
  return "congested";
}

export const CONGESTION_COLORS: Record<CongestionLevel, string> = {
  clear:     "#4ade80",
  moderate:  "#fbbf24",
  busy:      "#f97316",
  congested: "#ef4444",
};

/**
 * Recommend the best 2.4 GHz channel (1, 6, or 11) based on current usage.
 */
export function recommendBestChannel24(aps: AccessPoint[]): { channel: number; reason: string } {
  const candidates = [1, 6, 11];
  const stats = computeChannelStats(aps.filter((a) => a.band === "2.4"));
  const statsMap = new Map(stats.map((s) => [s.channel, s]));

  let bestCh = 1;
  let bestScore = Infinity;

  for (const ch of candidates) {
    const s = statsMap.get(ch);
    if (!s) {
      return { channel: ch, reason: `Channel ${ch} is completely empty — ideal choice.` };
    }
    const score = s.busyScore + s.apCount * 5;
    if (score < bestScore) {
      bestScore = score;
      bestCh = ch;
    }
  }

  const s = statsMap.get(bestCh);
  return {
    channel: bestCh,
    reason: s
      ? `Channel ${bestCh} has the lowest congestion (${s.apCount} AP${s.apCount !== 1 ? "s" : ""}, busy score ${s.busyScore}%).`
      : `Channel ${bestCh} appears to be the least congested option.`,
  };
}

/**
 * Recommend the best 5 GHz channel.
 */
export function recommendBestChannel5(aps: AccessPoint[]): { channel: number; reason: string } {
  const stats = computeChannelStats(aps.filter((a) => a.band === "5"));
  if (stats.length === 0) return { channel: 36, reason: "No 5 GHz APs detected — channel 36 is a safe default." };

  const usedChannels = new Set(stats.map((s) => s.channel));
  const preferred5GHz = [36, 40, 44, 48, 149, 153, 157, 161];

  for (const ch of preferred5GHz) {
    if (!usedChannels.has(ch)) {
      return { channel: ch, reason: `Channel ${ch} (5 GHz) is completely empty — ideal choice.` };
    }
  }

  const sorted = [...stats].sort((a, b) => a.busyScore - b.busyScore);
  const best = sorted[0];
  return {
    channel: best.channel,
    reason: `Channel ${best.channel} (5 GHz) has the lowest congestion score (${best.busyScore}%).`,
  };
}

// ---- Spectrum Data for Chart ----

/**
 * Generate spectrum curve data for a single AP (Gaussian-shaped signal).
 * Returns array of {freq, power} points.
 */
export function getApSpectrumCurve(ap: AccessPoint): { freq: number; power: number }[] {
  const centerFreq = ap.band === "2.4" ? get24GHzFrequency(ap.ch) : ap.ch; // use ch as proxy for 5GHz
  const bandwidth = ap.band === "2.4" ? 22 : 40; // MHz
  const sigma = bandwidth / 4;
  const points: { freq: number; power: number }[] = [];
  const steps = 40;

  for (let i = 0; i <= steps; i++) {
    const freq = centerFreq - bandwidth + (i / steps) * bandwidth * 2;
    const power = ap.rssi * Math.exp(-0.5 * Math.pow((freq - centerFreq) / sigma, 2));
    points.push({ freq: Math.round(freq * 10) / 10, power: Math.round(power * 10) / 10 });
  }

  return points;
}
