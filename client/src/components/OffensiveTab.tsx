// OffensiveTab.tsx
import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Power, Square, Zap, AlertTriangle, Target, Radio } from 'lucide-react';
import type { ScanResult, AccessPoint } from '@/hooks/useWebSerial';

interface OffensiveTabProps {
  sendCommand: (command: string) => void;
  isConnected: boolean;
  scanResults: ScanResult | null;
}

type JamMode = 'wideband' | 'channel';

export default function OffensiveTab({ sendCommand, isConnected, scanResults }: OffensiveTabProps) {
  // ── Noise Jammer State ──
  const [isJamming, setIsJamming] = useState(false);
  const [mode, setMode] = useState<JamMode>('wideband');
  const [channel, setChannel] = useState(6);
  const [jamStatus, setJamStatus] = useState("Idle");

  // ── Deauth State ──
  const [isDeauthing, setIsDeauthing] = useState(false);
  const [deauthTarget, setDeauthTarget] = useState<AccessPoint | null>(null);
  const [deauthCount, setDeauthCount] = useState(0); // 0 = continuous
  const [deauthSent, setDeauthSent] = useState(0);
  const [deauthStatus, setDeauthStatus] = useState("Idle");

  // ── Beacon Spam State ──
  const [isBeaconing, setIsBeaconing] = useState(false);
  const [beaconPrefix, setBeaconPrefix] = useState("FreeWiFi");
  const [beaconCount, setBeaconCount] = useState(10);
  const [beaconChannel, setBeaconChannel] = useState(6);
  const [beaconStatus, setBeaconStatus] = useState("Idle");

  const aps: AccessPoint[] = scanResults?.aps ?? [];

  useEffect(() => {
    const handleMessage = (e: CustomEvent) => {
      const data = e.detail;
      if (data.type === "status") {
        // Noise
        if (data.status === "wideband_on") {
          setIsJamming(true);
          setJamStatus("WIDEBAND NOISE ACTIVE — All Channels");
        } else if (data.status === "noise_on") {
          setIsJamming(true);
          setJamStatus(`NOISE ON CHANNEL ${data.channel}`);
        } else if (data.status === "wideband_off" || data.status === "noise_off") {
          setIsJamming(false);
          setJamStatus("Idle");
        }
        // Deauth
        else if (data.status === "deauth_on") {
          setIsDeauthing(true);
          setDeauthSent(0);
          setDeauthStatus(`DEAUTHING ${data.bssid} CH${data.channel}${data.count > 0 ? ` (${data.count} frames)` : ' (continuous)'}`);
        } else if (data.status === "deauth_off") {
          setIsDeauthing(false);
          setDeauthStatus(`Done — ${data.sent ?? 0} frames sent`);
        }
        // Beacon Spam
        else if (data.status === "beacon_on") {
          setIsBeaconing(true);
          setBeaconStatus(`SPAMMING ${data.count} fake APs on CH${data.channel} (prefix: "${data.prefix}")`);
        } else if (data.status === "beacon_off") {
          setIsBeaconing(false);
          setBeaconStatus("Idle");
        }
      }
    };

    window.addEventListener('serial-message', handleMessage as EventListener);
    return () => window.removeEventListener('serial-message', handleMessage as EventListener);
  }, []);

  // ── Noise Jammer ──
  const toggleJamming = () => {
    if (!isConnected) return;
    if (!isJamming) {
      if (mode === 'wideband') {
        sendCommand("NOISE_ON");
        setJamStatus("Starting Wideband Noise...");
      } else {
        sendCommand(`NOISE_ON ${channel}`);
        setJamStatus(`Starting noise on channel ${channel}...`);
      }
    } else {
      sendCommand("NOISE_OFF");
      setJamStatus("Stopping...");
    }
  };

  // ── Deauth ──
  const toggleDeauth = () => {
    if (!isConnected) return;
    if (!isDeauthing) {
      if (!deauthTarget) return;
      const countArg = deauthCount > 0 ? ` ${deauthCount}` : '';
      sendCommand(`DEAUTH_START ${deauthTarget.bssid} ${deauthTarget.ch}${countArg}`);
      setDeauthStatus("Starting...");
    } else {
      sendCommand("DEAUTH_STOP");
      setDeauthStatus("Stopping...");
    }
  };

  // ── Beacon Spam ──
  const toggleBeacon = () => {
    if (!isConnected) return;
    if (!isBeaconing) {
      const prefix = beaconPrefix.trim() || "FreeWiFi";
      sendCommand(`BEACON_START ${prefix} ${beaconCount} ${beaconChannel}`);
      setBeaconStatus("Starting...");
    } else {
      sendCommand("BEACON_STOP");
      setBeaconStatus("Stopping...");
    }
  };

  const globalActive = isJamming || isDeauthing || isBeaconing;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Zap className="w-8 h-8 text-red-500" />
          <div>
            <h2 className="text-2xl font-mono text-red-400">OFFENSIVE TOOLS</h2>
            <p className="text-slate-400 text-sm">2.4 GHz Noise + Deauth + Beacon Spam</p>
          </div>
        </div>
        <div className={`px-4 py-1 rounded-full text-sm font-mono ${
          globalActive ? 'bg-red-500/20 text-red-400' : 'bg-emerald-500/20 text-emerald-400'
        }`}>
          {globalActive ? '⚠ ATTACK ACTIVE' : 'STANDBY'}
        </div>
      </div>

      {/* ── NOISE JAMMER ── */}
      <Card className="border-red-500/30 bg-slate-950">
        <CardHeader>
          <CardTitle className="text-red-400 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5" />
            NOISE JAMMER
            <span className={`ml-auto text-xs font-mono px-2 py-0.5 rounded-full ${
              isJamming ? 'bg-red-500/20 text-red-400' : 'bg-slate-700 text-slate-400'
            }`}>{jamStatus}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-xs text-slate-400 block mb-2 font-mono">JAM MODE</label>
            <div className="flex gap-2">
              <Button variant={mode === 'wideband' ? 'destructive' : 'outline'} onClick={() => setMode('wideband')} className="flex-1">
                WIDEBAND (All Channels)
              </Button>
              <Button variant={mode === 'channel' ? 'destructive' : 'outline'} onClick={() => setMode('channel')} className="flex-1">
                SINGLE CHANNEL
              </Button>
            </div>
          </div>
          {mode === 'channel' && (
            <div>
              <label className="text-xs text-slate-400 block mb-2 font-mono">TARGET CHANNEL</label>
              <Select value={channel.toString()} onValueChange={(v) => setChannel(parseInt(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 13 }, (_, i) => i + 1).map(ch => (
                    <SelectItem key={ch} value={ch.toString()}>Channel {ch}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <Button
            onClick={toggleJamming}
            disabled={!isConnected || isDeauthing || isBeaconing}
            className={`w-full h-14 text-lg font-mono text-white transition-all ${
              isJamming ? 'bg-red-600 hover:bg-red-700' : 'bg-emerald-600 hover:bg-emerald-700'
            }`}
          >
            {isJamming ? <><Square className="mr-3 w-5 h-5" />STOP JAMMER</> : <><Power className="mr-3 w-5 h-5" />START {mode === 'wideband' ? 'WIDEBAND' : 'CHANNEL'} NOISE</>}
          </Button>
        </CardContent>
      </Card>

      {/* ── DEAUTH ATTACK ── */}
      <Card className="border-orange-500/30 bg-slate-950">
        <CardHeader>
          <CardTitle className="text-orange-400 flex items-center gap-2">
            <Target className="w-5 h-5" />
            DEAUTHENTICATION ATTACK
            <span className={`ml-auto text-xs font-mono px-2 py-0.5 rounded-full ${
              isDeauthing ? 'bg-orange-500/20 text-orange-400' : 'bg-slate-700 text-slate-400'
            }`}>{deauthStatus}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-xs text-slate-400 block mb-2 font-mono">TARGET AP {aps.length === 0 && <span className="text-yellow-500">(scan first to populate)</span>}</label>
            <Select
              value={deauthTarget?.bssid ?? ""}
              onValueChange={(bssid) => {
                const ap = aps.find(a => a.bssid === bssid) ?? null;
                setDeauthTarget(ap);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select target AP from scan results..." />
              </SelectTrigger>
              <SelectContent>
                {aps.map(ap => (
                  <SelectItem key={ap.bssid} value={ap.bssid}>
                    {ap.ssid || '(hidden)'} — {ap.bssid} — CH{ap.ch} — {ap.rssi}dBm
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {deauthTarget && (
            <div className="bg-slate-900 border border-slate-700 rounded p-3 text-xs font-mono text-slate-300 grid grid-cols-2 gap-2">
              <span className="text-slate-500">BSSID</span><span>{deauthTarget.bssid}</span>
              <span className="text-slate-500">SSID</span><span>{deauthTarget.ssid || '(hidden)'}</span>
              <span className="text-slate-500">Channel</span><span>{deauthTarget.ch}</span>
              <span className="text-slate-500">Signal</span><span>{deauthTarget.rssi} dBm</span>
            </div>
          )}
          <div>
            <label className="text-xs text-slate-400 block mb-2 font-mono">FRAME COUNT <span className="text-slate-500">(0 = continuous)</span></label>
            <Input
              type="number"
              min={0}
              max={9999}
              value={deauthCount}
              onChange={e => setDeauthCount(Math.max(0, parseInt(e.target.value) || 0))}
              className="font-mono bg-slate-900 border-slate-700 w-40"
            />
          </div>
          <Button
            onClick={toggleDeauth}
            disabled={!isConnected || isJamming || isBeaconing || (!isDeauthing && !deauthTarget)}
            className={`w-full h-14 text-lg font-mono text-white transition-all ${
              isDeauthing ? 'bg-orange-600 hover:bg-orange-700' : 'bg-orange-500 hover:bg-orange-600'
            }`}
          >
            {isDeauthing
              ? <><Square className="mr-3 w-5 h-5" />STOP DEAUTH</>
              : <><Target className="mr-3 w-5 h-5" />LAUNCH DEAUTH{deauthCount > 0 ? ` (${deauthCount} frames)` : ' (continuous)'}</>
            }
          </Button>
          {isDeauthing && (
            <div className="bg-orange-950 border border-orange-500/50 rounded p-3 text-orange-400 text-xs font-mono">
              ⚠ SENDING 802.11 DEAUTH FRAMES — Clients being disconnected from {deauthTarget?.ssid || deauthTarget?.bssid}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── BEACON SPAM ── */}
      <Card className="border-yellow-500/30 bg-slate-950">
        <CardHeader>
          <CardTitle className="text-yellow-400 flex items-center gap-2">
            <Radio className="w-5 h-5" />
            BEACON SPAM
            <span className={`ml-auto text-xs font-mono px-2 py-0.5 rounded-full ${
              isBeaconing ? 'bg-yellow-500/20 text-yellow-400' : 'bg-slate-700 text-slate-400'
            }`}>{beaconStatus}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2">
              <label className="text-xs text-slate-400 block mb-2 font-mono">SSID PREFIX</label>
              <Input
                value={beaconPrefix}
                onChange={e => setBeaconPrefix(e.target.value.slice(0, 28))}
                placeholder="FreeWiFi"
                className="font-mono bg-slate-900 border-slate-700"
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-2 font-mono">COUNT (1–50)</label>
              <Input
                type="number"
                min={1}
                max={50}
                value={beaconCount}
                onChange={e => setBeaconCount(Math.min(50, Math.max(1, parseInt(e.target.value) || 1)))}
                className="font-mono bg-slate-900 border-slate-700"
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-2 font-mono">BROADCAST CHANNEL</label>
            <Select value={beaconChannel.toString()} onValueChange={v => setBeaconChannel(parseInt(v))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Array.from({ length: 13 }, (_, i) => i + 1).map(ch => (
                  <SelectItem key={ch} value={ch.toString()}>Channel {ch}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-slate-500 font-mono">
            Broadcasts {beaconCount} fake APs: "{beaconPrefix}0" … "{beaconPrefix}{beaconCount - 1}" on CH{beaconChannel}
          </p>
          <Button
            onClick={toggleBeacon}
            disabled={!isConnected || isJamming || isDeauthing}
            className={`w-full h-14 text-lg font-mono text-white transition-all ${
              isBeaconing ? 'bg-yellow-600 hover:bg-yellow-700' : 'bg-yellow-500 hover:bg-yellow-600'
            }`}
          >
            {isBeaconing
              ? <><Square className="mr-3 w-5 h-5" />STOP BEACON SPAM</>
              : <><Radio className="mr-3 w-5 h-5" />START BEACON SPAM ({beaconCount} APs)</>
            }
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}