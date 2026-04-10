/**
 * ESP32-S3 Wi-Fi Analyzer Firmware
 * ===================================
 * Scans for Wi-Fi access points and outputs structured JSON data
 * over USB Serial (115200 baud) for consumption by the web application.
 *
 * Protocol:
 *   - Sends a JSON object per scan result set, terminated by newline.
 *   - Format: {"type":"scan","ts":<millis>,"aps":[{...},...]}
 *   - Each AP: {"ssid":"...","bssid":"...","ch":<1-14>,"rssi":<dBm>,"enc":<0-5>,"band":"2.4"|"5"}
 *
 * Commands received from host (newline-terminated):
 *   SCAN        - Trigger a single scan immediately
 *   AUTO_ON     - Enable auto-scan every <interval> seconds
 *   AUTO_OFF    - Disable auto-scan
 *   INTERVAL <n>- Set auto-scan interval in seconds (default: 5)
 *   PING        - Responds with PONG (connection health check)
 *
 * Board: ESP32-S3 (any variant)
 * Arduino IDE: 2.x with ESP32 Arduino Core 2.x+
 * Baud rate: 115200
 */

#include <Arduino.h>
#include <WiFi.h>
#include <esp_wifi.h>

// ---- Configuration ----
#define SERIAL_BAUD       115200
#define DEFAULT_INTERVAL  5000   // ms between auto-scans
#define MAX_SCAN_RESULTS  30     // cap results to avoid huge JSON

// ---- State ----
bool     autoScan     = false;
uint32_t scanInterval = DEFAULT_INTERVAL;
uint32_t lastScan     = 0;
uint32_t lastSerialCheck = 0;
String   cmdBuffer    = "";

// ==================== BEST RAW NOISE JAMMER (v3) ====================

bool noiseMode = false;
uint8_t noiseChannel = 6;

void startRawNoise(uint8_t ch = 6) {
  noiseChannel = ch;
  noiseMode = true;
  
  WiFi.mode(WIFI_AP);
  esp_wifi_set_mode(WIFI_MODE_AP);
  esp_wifi_set_channel(noiseChannel, WIFI_SECOND_CHAN_NONE);
  esp_wifi_set_max_tx_power(WIFI_POWER_19_5dBm);
  
  Serial.printf("{\"type\":\"status\",\"status\":\"noise_on\",\"channel\":%d}\n", noiseChannel);
}

void stopRawNoise() {
  noiseMode = false;
  WiFi.mode(WIFI_STA);
  Serial.println("{\"type\":\"status\",\"status\":\"noise_off\"}");
}

// Minimal valid header + maximum randomness (best compromise)
void transmitNoiseBurst() {
  // Valid Frame Control (Data frame, no retry, no power mgmt) + random addresses
  uint8_t packet[128] = {
    0x08, 0x00,           // Frame Control: Data frame
    0x00, 0x00,           // Duration
    0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,  // Addr1 (broadcast)
    0xDE, 0xAD, 0xBE, 0xEF, 0x13, 0x37,  // Addr2 (randomized BSSID)
    0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,  // Addr3
    0x00, 0x00            // Sequence control
  };

  // Fill the rest with pure random garbage
  for (uint8_t i = 24; i < 128; i += 4) {
    uint32_t r = esp_random();
    memcpy(&packet[i], &r, 4);
  }

  // Blast as many as possible
  for (int i = 0; i < 6; i++) {
    esp_wifi_80211_tx(WIFI_IF_AP, packet, 128, false);
  }
}

// ---- Helpers ----

/**
 * Escape a string for JSON output.
 */
String jsonEscape(const String& s) {
  String out;
  out.reserve(s.length() + 4);
  for (char c : s) {
    if      (c == '"')  out += "\\\"";
    else if (c == '\\') out += "\\\\";
    else if (c == '\n') out += "\\n";
    else if (c == '\r') out += "\\r";
    else if (c == '\t') out += "\\t";
    else                out += c;
  }
  return out;
}

/**
 * Map WiFi auth mode enum to integer code.
 * 0=Open, 1=WEP, 2=WPA, 3=WPA2, 4=WPA/WPA2, 5=WPA3
 */
int encCode(wifi_auth_mode_t mode) {
  switch (mode) {
    case WIFI_AUTH_OPEN:            return 0;
    case WIFI_AUTH_WEP:             return 1;
    case WIFI_AUTH_WPA_PSK:         return 2;
    case WIFI_AUTH_WPA2_PSK:        return 3;
    case WIFI_AUTH_WPA_WPA2_PSK:    return 4;
    case WIFI_AUTH_WPA3_PSK:        return 5;
    default:                        return 3;
  }
}

/**
 * Determine band from channel number.
 * Channels 1-14 → 2.4 GHz; 36+ → 5 GHz
 */
const char* bandStr(int ch) {
  return (ch >= 36) ? "5" : "2.4";
}

// ---- Scan & Output ----

void performScan() {
  // Send scanning status
  Serial.println("{\"type\":\"status\",\"msg\":\"scanning\"}");

  int n = WiFi.scanNetworks(false, true); // blocking, include hidden

  if (n < 0) {
    Serial.println("{\"type\":\"error\",\"msg\":\"scan_failed\"}");
    return;
  }

  if (n > MAX_SCAN_RESULTS) n = MAX_SCAN_RESULTS;

  // Build JSON output
  String json = "{\"type\":\"scan\",\"ts\":";
  json += String(millis());
  json += ",\"count\":";
  json += String(n);
  json += ",\"aps\":[";

  for (int i = 0; i < n; i++) {
    if (i > 0) json += ",";

    String ssid = WiFi.SSID(i);
    String bssid = WiFi.BSSIDstr(i);
    int    rssi  = WiFi.RSSI(i);
    int    ch    = WiFi.channel(i);
    int    enc   = encCode(WiFi.encryptionType(i));

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

// ---- Command Handler ----

void handleCommand(const String& cmd) {
  String c = cmd;
  c.trim();
  c.toUpperCase();

  if (c == "PING") {
    Serial.println("{\"type\":\"pong\"}");
  }
  else if (c.startsWith("NOISE_ON")) {
    // Format: NOISE_ON <channel> <width> <random>
    int ch = 6;
    int width = 20;
    bool randomVal = true;
    
    if (c.indexOf(' ') > 0) {
      String params = c.substring(c.indexOf(' ') + 1);
      int firstSpace = params.indexOf(' ');
      if (firstSpace > 0) {
        ch = params.substring(0, firstSpace).toInt();
      } else {
        ch = params.toInt();
      }
      if (ch < 1) ch = 1;
      if (ch > 14) ch = 14;
      noiseChannel = ch;
    }
    
    noiseChannel = ch;
    startRawNoise(ch);
  }
  else if (c == "NOISE_OFF") {
    stopRawNoise();
  }
  else if (c.startsWith("NOISE_CHANNEL")) {
    int ch = c.substring(14).toInt();
    if (ch >= 1 && ch <= 14) {
      noiseChannel = ch;
      Serial.println("{\"type\":\"status\",\"status\":\"channel_set\",\"channel\":" + String(ch) + "}");
    }
  }
  else if (c == "SCAN") {
    performScan();
  }
  else if (c == "AUTO_ON") {
    autoScan = true;
    Serial.println("{\"type\":\"status\",\"msg\":\"auto_on\"}");
  }
  else if (c == "AUTO_OFF") {
    autoScan = false;
    Serial.println("{\"type\":\"status\",\"msg\":\"auto_off\"}");
  }
  else if (c.startsWith("INTERVAL ")) {
    int val = c.substring(9).toInt();
    if (val >= 1 && val <= 300) {
      scanInterval = (uint32_t)val * 1000;
      Serial.print("{\"type\":\"status\",\"msg\":\"interval_set\",\"val\":");
      Serial.print(val);
      Serial.println("}");
    } else {
      Serial.println("{\"type\":\"error\",\"msg\":\"invalid_interval\"}");
    }
  }
  else if (c == "INFO") {
    Serial.print("{\"type\":\"info\",\"fw\":\"1.0.0\",\"chip\":\"ESP32-S3\",\"sdk\":\"");
    Serial.print(ESP.getSdkVersion());
    Serial.print("\",\"heap\":");
    Serial.print(ESP.getFreeHeap());
    Serial.println("}");
  }
  else {
    // Unknown command — echo back
    Serial.print("{\"type\":\"error\",\"msg\":\"unknown_cmd\",\"cmd\":\"");
    Serial.print(jsonEscape(cmd));
    Serial.println("\"}");
  }
}

// ---- Arduino Setup & Loop ----

void setup() {
  Serial.begin(SERIAL_BAUD);
  delay(500);

  // Put Wi-Fi in station mode (no connection needed for scanning)
  WiFi.mode(WIFI_STA);
  WiFi.disconnect();
  delay(100);

  // Announce ready
  Serial.println("{\"type\":\"ready\",\"fw\":\"1.0.0\",\"chip\":\"ESP32-S3\"}");
}

void loop() {
  // Read incoming serial commands
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\n' || c == '\r') {
      if (cmdBuffer.length() > 0) {
        handleCommand(cmdBuffer);
        cmdBuffer = "";
      }
    } else {
      cmdBuffer += c;
    }
  }

  // Auto-scan timer
  if (autoScan && !noiseMode) {
    uint32_t now = millis();
    if (now - lastScan >= scanInterval) {
      lastScan = now;
      performScan();
    }
  }

  // Noise mode tight loop
  if (noiseMode) {
    transmitNoiseBurst();
    
    if (millis() - lastSerialCheck > 30) {
      lastSerialCheck = millis();
      delay(1);                    // Critical for WebSerial to stay responsive
    } else {
      delayMicroseconds(8);
    }
  }
}

