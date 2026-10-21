/* Konektivitas: WiFi STA dengan fallback AP + captive portal, lalu WebSocket
 * (TLS) ke backend lewat Cloudflare.
 *
 * Urutan boot:
 *   1. Kredensial dari NVS ("wifi-cfg"), kalau kosong pakai DEFAULT_SSID
 *   2. Gagal konek dalam STA_TIMEOUT_MS → AP "ESP32-Setup" / "12345678"
 *      + DNS hijack + portal di 192.168.4.1. Simpan → restart
 *   3. Dapat IP → buka NET_WS_URI. Reconnect WiFi & WS otomatis
 *
 * Probe captive portal: Android /generate_204, iOS /hotspot-detect.html,
 * Windows /ncsi.txt & /connecttest.txt — semua (dan URL lain) di-redirect ke /.
 */

#include "net.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/event_groups.h"
#include "esp_wifi.h"
#include "esp_event.h"
#include "esp_netif.h"
#include "esp_http_server.h"
#include "esp_websocket_client.h"
#include "esp_crt_bundle.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "nvs_flash.h"
#include "nvs.h"
#include "lwip/sockets.h"

#define AP_SSID          "ESP32-Setup"
#define AP_PASS          "12345678"
#define DEFAULT_SSID     "irsad"      /* kosongkan ("") untuk skip */
#define DEFAULT_PASS     "nonenone"
#define STA_TIMEOUT_MS   15000
#define NVS_NS           "wifi-cfg"

#define LOG(tag, fmt, ...) \
    printf("[%7lld ms] [%-6s] " fmt "\n", esp_timer_get_time() / 1000, tag, ##__VA_ARGS__)

#define BIT_GOT_IP  BIT0

static EventGroupHandle_t               net_events;
static esp_netif_t                     *sta_netif;
static esp_websocket_client_handle_t    ws;
static net_cmd_cb_t                     cmd_cb;
static bool                             portal_mode;
static bool                             ever_connected;
static char                             cur_ssid[33];
static uint32_t                         ws_connects, ws_rx, ws_tx;

/* ------------------------------------------------------------------ */
/*  NVS                                                                */
/* ------------------------------------------------------------------ */
static bool load_creds(char *ssid, size_t ssid_sz, char *pass, size_t pass_sz)
{
    nvs_handle_t h;
    if (nvs_open(NVS_NS, NVS_READONLY, &h) != ESP_OK) return false;
    bool ok = nvs_get_str(h, "ssid", ssid, &ssid_sz) == ESP_OK && ssid[0];
    if (ok && nvs_get_str(h, "pass", pass, &pass_sz) != ESP_OK) pass[0] = '\0';
    nvs_close(h);
    return ok;
}

static void save_creds(const char *ssid, const char *pass)
{
    nvs_handle_t h;
    ESP_ERROR_CHECK(nvs_open(NVS_NS, NVS_READWRITE, &h));
    nvs_set_str(h, "ssid", ssid);
    nvs_set_str(h, "pass", pass);
    nvs_commit(h);
    nvs_close(h);
}

void net_forget_wifi(void)
{
    nvs_flash_init();   /* aman dipanggil sebelum net_start() */
    nvs_handle_t h;
    if (nvs_open(NVS_NS, NVS_READWRITE, &h) == ESP_OK) {
        nvs_erase_all(h);
        nvs_commit(h);
        nvs_close(h);
    }
    LOG("NVS", "kredensial WiFi dihapus, restart...");
    esp_restart();
}

/* ------------------------------------------------------------------ */
/*  WebSocket                                                          */
/* ------------------------------------------------------------------ */
/* Ambil nilai string "key":"value" dari JSON sederhana (tanpa escape). */
static bool json_str(const char *js, int len, const char *key, char *out, size_t out_sz)
{
    char pat[24];
    snprintf(pat, sizeof(pat), "\"%s\":\"", key);
    const char *p = strstr(js, pat);
    if (!p || p >= js + len) return false;
    p += strlen(pat);
    size_t n = 0;
    while (p < js + len && *p != '"' && n < out_sz - 1) out[n++] = *p++;
    out[n] = '\0';
    return true;
}

static void ws_event(void *arg, esp_event_base_t base, int32_t id, void *data)
{
    (void)arg; (void)base;
    esp_websocket_event_data_t *ev = data;

    switch (id) {
    case WEBSOCKET_EVENT_CONNECTED:
        ws_connects++;
        LOG("WS", "terhubung ke %s", NET_WS_URI);
        break;
    case WEBSOCKET_EVENT_DISCONNECTED:
        LOG("WS", "terputus, reconnect otomatis");
        break;
    case WEBSOCKET_EVENT_ERROR:
        LOG("WS", "error transport/TLS");
        break;
    case WEBSOCKET_EVENT_DATA: {
        if (ev->op_code != 0x1 || ev->data_len <= 0) break;   /* teks saja */
        ws_rx++;
        /* Pesan kecil, NUL-terminate di salinan lokal supaya strstr aman. */
        char msg[512];
        int  n = ev->data_len < (int)sizeof(msg) - 1 ? ev->data_len : (int)sizeof(msg) - 1;
        memcpy(msg, ev->data_ptr, n);
        msg[n] = '\0';

        /* Backend membalas ack berisi pesan kita → hitung round-trip. */
        const char *up = strstr(msg, "\"uptime_ms\":");
        if (strstr(msg, "\"type\":\"ack\"") && up) {
            long long sent = atoll(up + 12);
            LOG("WS", "ack  rtt=%lld ms", esp_timer_get_time() / 1000 - sent);
            break;
        }

        char type[16], cmd[64];
        if (json_str(msg, n, "type", type, sizeof(type)) && !strcmp(type, "command") &&
            json_str(msg, n, "cmd", cmd, sizeof(cmd))) {
            LOG("WS", "command dari backend: \"%s\"", cmd);
            if (cmd_cb) cmd_cb(cmd);
            break;
        }
        LOG("WS", "rx: %.*s", n > 160 ? 160 : n, msg);
        break;
    }
    default:
        break;
    }
}

static void ws_start(void)
{
    if (ws) return;
    esp_websocket_client_config_t cfg = {
        .uri                  = NET_WS_URI,
        .crt_bundle_attach    = esp_crt_bundle_attach,
        .reconnect_timeout_ms = 5000,
        .network_timeout_ms   = 10000,
        .ping_interval_sec    = 15,   /* Cloudflare menutup koneksi idle */
        .task_stack           = 6144,
    };
    ws = esp_websocket_client_init(&cfg);
    esp_websocket_register_events(ws, WEBSOCKET_EVENT_ANY, ws_event, NULL);
    esp_websocket_client_start(ws);
    LOG("WS", "membuka %s", NET_WS_URI);
}

bool net_ws_connected(void)
{
    return ws && esp_websocket_client_is_connected(ws);
}

bool net_ws_send(const char *text, size_t len)
{
    if (!net_ws_connected()) return false;
    bool ok = esp_websocket_client_send_text(ws, text, len, pdMS_TO_TICKS(1000)) >= 0;
    if (ok) ws_tx++;
    return ok;
}

/* ------------------------------------------------------------------ */
/*  WiFi events                                                        */
/* ------------------------------------------------------------------ */
static void wifi_event(void *arg, esp_event_base_t base, int32_t id, void *data)
{
    (void)arg;
    if (base == WIFI_EVENT && id == WIFI_EVENT_STA_START) {
        if (!portal_mode) esp_wifi_connect();
    } else if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) {
        xEventGroupClearBits(net_events, BIT_GOT_IP);
        if (portal_mode) return;
        wifi_event_sta_disconnected_t *d = data;
        LOG("WIFI", "terputus (reason %d), coba lagi", d->reason);
        esp_wifi_connect();
    } else if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
        ip_event_got_ip_t *e = data;
        LOG("WIFI", "terhubung ke \"%s\"  IP " IPSTR, cur_ssid, IP2STR(&e->ip_info.ip));
        ever_connected = true;
        xEventGroupSetBits(net_events, BIT_GOT_IP);
        ws_start();
    } else if (base == WIFI_EVENT && id == WIFI_EVENT_AP_STACONNECTED) {
        LOG("AP", "klien tersambung ke %s", AP_SSID);
    }
}

static bool sta_connect(const char *ssid, const char *pass)
{
    wifi_config_t wc = { 0 };
    strlcpy((char *)wc.sta.ssid, ssid, sizeof(wc.sta.ssid));
    strlcpy((char *)wc.sta.password, pass, sizeof(wc.sta.password));
    strlcpy(cur_ssid, ssid, sizeof(cur_ssid));

    LOG("WIFI", "konek ke \"%s\"...", ssid);
    portal_mode = true;   /* tahan retry di handler selama ganti config */
    esp_wifi_disconnect();
    esp_err_t err = esp_wifi_set_config(WIFI_IF_STA, &wc);
    portal_mode = false;
    if (err != ESP_OK) LOG("WIFI", "set_config gagal: %s", esp_err_to_name(err));
    esp_wifi_connect();

    EventBits_t bits = xEventGroupWaitBits(net_events, BIT_GOT_IP, pdFALSE, pdTRUE,
                                           pdMS_TO_TICKS(STA_TIMEOUT_MS));
    if (bits & BIT_GOT_IP) return true;
    LOG("WIFI", "gagal konek ke \"%s\"", ssid);
    return false;
}

/* ------------------------------------------------------------------ */
/*  DNS hijack: semua query A dijawab 192.168.4.1                     */
/* ------------------------------------------------------------------ */
static void dns_task(void *arg)
{
    (void)arg;
    int sock = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
    struct sockaddr_in addr = {
        .sin_family = AF_INET, .sin_port = htons(53), .sin_addr.s_addr = htonl(INADDR_ANY),
    };
    bind(sock, (struct sockaddr *)&addr, sizeof(addr));

    uint8_t pkt[512];
    for (;;) {
        struct sockaddr_in from;
        socklen_t flen = sizeof(from);
        int n = recvfrom(sock, pkt, sizeof(pkt) - 16, 0, (struct sockaddr *)&from, &flen);
        if (n < 12) continue;

        /* Lewati nama di bagian question, lalu QTYPE + QCLASS. */
        int q = 12;
        while (q < n && pkt[q]) q += pkt[q] + 1;
        q += 5;
        if (q > n) continue;
        bool is_a = pkt[q - 4] == 0 && pkt[q - 3] == 1;

        pkt[2] = 0x81; pkt[3] = 0x80;                    /* response, no error */
        pkt[6] = 0; pkt[7] = is_a ? 1 : 0;               /* ANCOUNT */
        pkt[8] = pkt[9] = pkt[10] = pkt[11] = 0;         /* buang NS/AR (EDNS) */
        int len = q;
        if (is_a) {
            const uint8_t ans[] = { 0xC0, 0x0C, 0, 1, 0, 1, 0, 0, 0, 60, 0, 4,
                                    192, 168, 4, 1 };
            memcpy(pkt + len, ans, sizeof(ans));
            len += sizeof(ans);
        }
        sendto(sock, pkt, len, 0, (struct sockaddr *)&from, flen);
    }
}

/* ------------------------------------------------------------------ */
/*  Portal HTTP                                                        */
/* ------------------------------------------------------------------ */
static const char PAGE_HEAD[] =
    "<!doctype html><html><head><meta charset=utf-8>"
    "<meta name=viewport content='width=device-width,initial-scale=1'>"
    "<title>ESP32 Setup</title><style>"
    "body{font-family:sans-serif;background:#0f172a;color:#e2e8f0;margin:0;padding:16px}"
    ".c{max-width:420px;margin:auto}h2{margin:.2em 0}p{color:#94a3b8}"
    "button,input{width:100%;box-sizing:border-box;padding:12px;margin:4px 0;"
    "border-radius:8px;border:1px solid #334155;background:#1e293b;color:#e2e8f0;font-size:16px}"
    "button.n{text-align:left}button.s{background:#2563eb;border:0;margin-top:12px}"
    "</style></head><body><div class=c><h2>ESP32 Audio Test</h2>"
    "<p>Pilih WiFi untuk konek ke capstone.irsad.site</p>";

static void html_escape(char *out, size_t out_sz, const char *in)
{
    size_t n = 0;
    for (; *in && n + 6 < out_sz; in++) {
        const char *r = NULL;
        switch (*in) {
        case '&':  r = "&amp;";  break;
        case '<':  r = "&lt;";   break;
        case '>':  r = "&gt;";   break;
        case '"':  r = "&quot;"; break;
        case '\'': r = "&#39;";  break;
        }
        if (r) { strcpy(out + n, r); n += strlen(r); }
        else   out[n++] = *in;
    }
    out[n] = '\0';
}

static esp_err_t portal_root(httpd_req_t *req)
{
    httpd_resp_set_type(req, "text/html");
    httpd_resp_send_chunk(req, PAGE_HEAD, HTTPD_RESP_USE_STRLEN);

    /* Scan blocking ~2 detik; AP tetap jalan karena mode APSTA. */
    wifi_scan_config_t sc = { .show_hidden = false };
    uint16_t count = 0;
    static wifi_ap_record_t recs[16];
    if (esp_wifi_scan_start(&sc, true) == ESP_OK) {
        count = sizeof(recs) / sizeof(recs[0]);
        esp_wifi_scan_get_ap_records(&count, recs);
    }

    char line[400], esc[100];
    for (int i = 0; i < count; i++) {
        if (!recs[i].ssid[0]) continue;
        html_escape(esc, sizeof(esc), (const char *)recs[i].ssid);
        snprintf(line, sizeof(line),
                 "<button class=n type=button onclick=\"document.getElementById('s').value=this.dataset.s\" "
                 "data-s=\"%s\">%s &nbsp;<small>%d dBm</small></button>",
                 esc, esc, recs[i].rssi);
        httpd_resp_send_chunk(req, line, HTTPD_RESP_USE_STRLEN);
    }
    if (count == 0)
        httpd_resp_send_chunk(req, "<p>Tidak ada jaringan, isi SSID manual.</p>",
                              HTTPD_RESP_USE_STRLEN);

    httpd_resp_send_chunk(req,
        "<form method=post action=/save>"
        "<input id=s name=ssid placeholder=SSID required maxlength=32>"
        "<input name=pass type=password placeholder=Password maxlength=63>"
        "<button class=s>Simpan &amp; restart</button></form></div></body></html>",
        HTTPD_RESP_USE_STRLEN);
    return httpd_resp_send_chunk(req, NULL, 0);
}

static void url_decode(char *s)
{
    char *o = s;
    for (; *s; s++) {
        if (*s == '+') *o++ = ' ';
        else if (*s == '%' && isxdigit((unsigned char)s[1]) && isxdigit((unsigned char)s[2])) {
            char hex[3] = { s[1], s[2], 0 };
            *o++ = (char)strtol(hex, NULL, 16);
            s += 2;
        } else *o++ = *s;
    }
    *o = '\0';
}

static void restart_cb(void *arg) { (void)arg; esp_restart(); }

static esp_err_t portal_save(httpd_req_t *req)
{
    char body[256] = { 0 };
    int  len = req->content_len < (int)sizeof(body) - 1 ? req->content_len : (int)sizeof(body) - 1;
    int  got = 0;
    while (got < len) {
        int r = httpd_req_recv(req, body + got, len - got);
        if (r <= 0) return ESP_FAIL;
        got += r;
    }

    char ssid[100] = { 0 }, pass[200] = { 0 };
    httpd_query_key_value(body, "ssid", ssid, sizeof(ssid));
    httpd_query_key_value(body, "pass", pass, sizeof(pass));
    url_decode(ssid);
    url_decode(pass);
    if (!ssid[0] || strlen(ssid) > 32 || strlen(pass) > 63) {
        httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "SSID/password tidak valid");
        return ESP_OK;
    }

    save_creds(ssid, pass);
    LOG("PORTAL", "kredensial \"%s\" disimpan, restart 1 detik lagi", ssid);

    char esc[100], page[sizeof(PAGE_HEAD) + 512];
    html_escape(esc, sizeof(esc), ssid);
    snprintf(page, sizeof(page), "%s<p>Tersimpan. ESP restart dan konek ke <b>%s</b>.</p>"
             "</div></body></html>", PAGE_HEAD, esc);
    httpd_resp_set_type(req, "text/html");
    httpd_resp_send(req, page, HTTPD_RESP_USE_STRLEN);

    static esp_timer_handle_t t;
    const esp_timer_create_args_t ta = { .callback = restart_cb, .name = "restart" };
    esp_timer_create(&ta, &t);
    esp_timer_start_once(t, 1000000);
    return ESP_OK;
}

/* Semua probe OS dan URL tak dikenal → redirect ke portal. */
static esp_err_t portal_redirect(httpd_req_t *req, httpd_err_code_t err)
{
    (void)err;
    httpd_resp_set_status(req, "302 Found");
    httpd_resp_set_hdr(req, "Location", "http://192.168.4.1/");
    return httpd_resp_send(req, NULL, 0);
}

static void portal_start(void)
{
    portal_mode = true;
    esp_wifi_disconnect();

    wifi_config_t ap = {
        .ap = {
            .ssid           = AP_SSID,
            .ssid_len       = sizeof(AP_SSID) - 1,
            .password       = AP_PASS,
            .channel        = 1,
            .max_connection = 4,
            .authmode       = WIFI_AUTH_WPA2_PSK,
        },
    };
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_APSTA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_AP, &ap));

    httpd_handle_t srv;
    httpd_config_t hc = HTTPD_DEFAULT_CONFIG();
    hc.stack_size = 8192;
    ESP_ERROR_CHECK(httpd_start(&srv, &hc));
    const httpd_uri_t root = { .uri = "/",     .method = HTTP_GET,  .handler = portal_root };
    const httpd_uri_t save = { .uri = "/save", .method = HTTP_POST, .handler = portal_save };
    httpd_register_uri_handler(srv, &root);
    httpd_register_uri_handler(srv, &save);
    httpd_register_err_handler(srv, HTTPD_404_NOT_FOUND, portal_redirect);

    xTaskCreatePinnedToCore(dns_task, "dns", 3072, NULL, 3, NULL, 1);
    LOG("PORTAL", "AP \"%s\" / \"%s\" aktif → buka http://192.168.4.1", AP_SSID, AP_PASS);
}

/* ------------------------------------------------------------------ */
/*  Public                                                             */
/* ------------------------------------------------------------------ */
void net_start(net_cmd_cb_t on_command)
{
    cmd_cb     = on_command;
    net_events = xEventGroupCreate();

    esp_err_t err = nvs_flash_init();
    if (err == ESP_ERR_NVS_NO_FREE_PAGES || err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        nvs_flash_erase();
        err = nvs_flash_init();
    }
    ESP_ERROR_CHECK(err);

    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    sta_netif = esp_netif_create_default_wifi_sta();
    esp_netif_create_default_wifi_ap();

    wifi_init_config_t wic = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&wic));
    esp_event_handler_register(WIFI_EVENT, ESP_EVENT_ANY_ID, wifi_event, NULL);
    esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP, wifi_event, NULL);
    ESP_ERROR_CHECK(esp_wifi_set_storage(WIFI_STORAGE_RAM));
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_ps(WIFI_PS_NONE));   /* latensi stabil */
    portal_mode = true;   /* tahan auto-connect di STA_START sampai config diset */
    ESP_ERROR_CHECK(esp_wifi_start());
    portal_mode = false;

    char ssid[33] = { 0 }, pass[65] = { 0 };
    if (load_creds(ssid, sizeof(ssid), pass, sizeof(pass))) {
        if (sta_connect(ssid, pass)) return;
    } else {
        LOG("WIFI", "belum ada kredensial tersimpan");
    }

    if (DEFAULT_SSID[0] && strcmp(ssid, DEFAULT_SSID) != 0) {
        if (sta_connect(DEFAULT_SSID, DEFAULT_PASS)) {
            save_creds(DEFAULT_SSID, DEFAULT_PASS);
            return;
        }
    }
    portal_start();
}

void net_print_status(void)
{
    if (portal_mode) {
        LOG("NET", "mode portal: AP \"%s\" → http://192.168.4.1", AP_SSID);
        return;
    }
    wifi_ap_record_t ap;
    if (esp_wifi_sta_get_ap_info(&ap) == ESP_OK) {
        esp_netif_ip_info_t ip;
        esp_netif_get_ip_info(sta_netif, &ip);
        LOG("NET", "WiFi \"%s\"  RSSI %d dBm  IP " IPSTR, cur_ssid, ap.rssi, IP2STR(&ip.ip));
    } else {
        LOG("NET", "WiFi \"%s\" belum terhubung%s", cur_ssid, ever_connected ? " (reconnect)" : "");
    }
    LOG("NET", "WS %s  connect=%lu  tx=%lu  rx=%lu  heap=%lu",
        net_ws_connected() ? "ON " : "OFF", (unsigned long)ws_connects,
        (unsigned long)ws_tx, (unsigned long)ws_rx, (unsigned long)esp_get_free_heap_size());
}
