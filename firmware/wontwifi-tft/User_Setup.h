// ============================================================
//  TFT_eSPI User_Setup.h
//  For: Hosyond ESP32-S3 2.8" ILI9341 Black CYD
//
//  INSTRUCTIONS:
//    Copy this file to your TFT_eSPI library folder, replacing
//    the existing User_Setup.h:
//
//    Windows: C:\Users\<you>\Documents\Arduino\libraries\TFT_eSPI\User_Setup.h
// ============================================================

// ---- Driver ------------------------------------------------
#define ILI9341_DRIVER

// ---- SPI Pins (adjust if your board differs) ---------------
#define TFT_MOSI  13
#define TFT_SCLK  12
#define TFT_CS    10
#define TFT_DC    11
#define TFT_RST   -1   // Tied to EN/RST internally

// Backlight — controlled in sketch (GPIO 42)
// #define TFT_BL  42   // Don't define here; managed in sketch

// ---- CRITICAL for ESP32-S3 ---------------------------------
// The S3 uses a different SPI peripheral than original ESP32.
// Without this, you get a blank screen or garbage output.
#define USE_FSPI_PORT

// ---- Display resolution ------------------------------------
#define TFT_WIDTH   240
#define TFT_HEIGHT  320

// ---- Fonts -------------------------------------------------
#define LOAD_GLCD
#define LOAD_FONT2
#define LOAD_FONT4
#define LOAD_FONT6
#define LOAD_FONT7
#define LOAD_FONT8
#define LOAD_GFXFF
#define SMOOTH_FONT

// ---- SPI Speed ---------------------------------------------
#define SPI_FREQUENCY       40000000
#define SPI_READ_FREQUENCY  20000000
