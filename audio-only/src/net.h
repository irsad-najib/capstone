#pragma once
#include <stdbool.h>
#include <stddef.h>

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

/* Hapus kredensial WiFi dari NVS lalu restart. */
void net_forget_wifi(void);
