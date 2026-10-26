#pragma once
#include <stdbool.h>
#include <stddef.h>
#include "esp_timer.h"

#define NET_DEVICE_ID   "esp32-audio-001"
#define NET_WS_URI      "wss://capstone.irsad.site/ws?id=" NET_DEVICE_ID

/* Dipanggil dari task WebSocket saat backend kirim {"type":"command","cmd":"..."}.
 * {"cmd":"set_db","value":N} dari /api/v1/stim/set diteruskan sebagai perintah "db N". */
typedef void (*net_cmd_cb_t)(const char *cmd);

/* Init WiFi. Coba kredensial NVS → default → kalau gagal, buka AP + captive portal.
 * Blok maksimal ~15 detik selama mencoba konek. */
void net_start(net_cmd_cb_t on_command);

bool net_ws_send(const char *text, size_t len);
bool net_ws_send_bin(const void *data, size_t len);
bool net_ws_connected(void);
void net_print_status(void);

/* Log: ditulis ke serial dan ditampung untuk dikirim ke backend
 * sebagai {"type":"log","device":...,"ts":<uptime ms>,"lines":[...]}. */
#define LOG(tag, fmt, ...) \
    net_logf("[%7lld ms] [%-6s] " fmt, esp_timer_get_time() / 1000, tag, ##__VA_ARGS__)

/* Log debug: hanya keluar kalau mode debug nyala ("debug on"), ditandai [DEBUG].
 * Status debug disimpan di NVS, jadi log debug saat boot ikut keluar setelah restart. */
extern volatile bool net_debug;
#define DBG(tag, fmt, ...) do { if (net_debug) \
    net_logf("[%7lld ms] [%-6s] [DEBUG] " fmt, esp_timer_get_time() / 1000, tag, ##__VA_ARGS__); } while (0)

void net_debug_load(void);                    /* baca dari NVS, panggil setelah net_log_init */
void net_debug_set(bool on);

void net_log_init(void);                      /* pasang hook ESP_LOGx, panggil paling awal */
void net_logf(const char *fmt, ...) __attribute__((format(printf, 1, 2)));
void net_log_flush(void);                     /* panggil berkala dari satu task saja */

/* Hapus kredensial WiFi dari NVS lalu restart. */
void net_forget_wifi(void);
