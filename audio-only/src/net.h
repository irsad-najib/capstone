#pragma once
#include <stdbool.h>
#include <stddef.h>
#include "esp_timer.h"

#define NET_DEVICE_ID   "esp32-audio-001"
#define NET_WS_URI      "wss://capstone.irsad.site/ws?id=" NET_DEVICE_ID

/* Dipanggil dari task WebSocket saat backend kirim {"type":"command","cmd":"..."}. */
typedef void (*net_cmd_cb_t)(const char *cmd);

/* Init WiFi. Coba kredensial NVS → default → kalau gagal, buka AP + captive portal.
 * Blok maksimal ~15 detik selama mencoba konek. */
void net_start(net_cmd_cb_t on_command);

bool net_ws_send(const char *text, size_t len);
bool net_ws_connected(void);
void net_print_status(void);

/* Log: ditulis ke serial dan ditampung untuk dikirim ke backend
 * sebagai {"type":"log","device":...,"ts":<uptime ms>,"lines":[...]}. */
#define LOG(tag, fmt, ...) \
    net_logf("[%7lld ms] [%-6s] " fmt, esp_timer_get_time() / 1000, tag, ##__VA_ARGS__)

void net_log_init(void);                      /* pasang hook ESP_LOGx, panggil paling awal */
void net_logf(const char *fmt, ...) __attribute__((format(printf, 1, 2)));
void net_log_flush(void);                     /* panggil berkala dari satu task saja */

/* Hapus kredensial WiFi dari NVS lalu restart. */
void net_forget_wifi(void);
