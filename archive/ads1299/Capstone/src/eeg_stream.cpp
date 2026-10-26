#include "eeg_stream.h"

#include <Arduino.h>
#include <ArduinoJson.h>
#include <WebSocketsClient.h>
#include <WiFi.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>

#include "eeg_config.h"
#include "eeg_task.h"

/** @brief WebSocket client from the Links2004 WebSockets library. */
static WebSocketsClient eeg_ws;
/** @brief Static task control block for the streaming task. */
static StaticTask_t eeg_stream_tcb;
/** @brief Static stack for the streaming task. */
static StackType_t eeg_stream_stack[EEG_STREAM_TASK_STACK_BYTES / sizeof(StackType_t)];
/** @brief Streaming task handle. */
static TaskHandle_t eeg_stream_handle = nullptr;
/** @brief Static JSON document reused by the stream task. */
static StaticJsonDocument<EEG_JSON_DOC_BYTES> eeg_json_doc;
/** @brief Static serialized JSON transmit buffer. */
static char eeg_json_tx_buffer[EEG_JSON_TX_BYTES];
/** @brief True after WebSocket configuration has been applied. */
static bool eeg_stream_configured = false;
/** @brief True while the WebSocket connection is established. */
static bool eeg_ws_connected = false;
/** @brief Last reconnect attempt timestamp. */
static uint32_t eeg_ws_last_attempt_ms = 0U;
/** @brief Current reconnect backoff interval. */
static uint32_t eeg_ws_backoff_ms = 1000U;
/** @brief Minimum reconnect backoff interval. */
static const uint32_t EEG_WS_BACKOFF_MIN_MS = 1000U;
/** @brief Maximum reconnect backoff interval. */
static const uint32_t EEG_WS_BACKOFF_MAX_MS = 15000U;

/** @brief WebSocket event callback; logs connection state outside the acquisition path. */
static void eeg_ws_event(WStype_t type, uint8_t *payload, size_t length) {
    (void)payload;
    (void)length;

    switch (type) {
        case WStype_CONNECTED:
            eeg_ws_connected = true;
            eeg_ws_backoff_ms = EEG_WS_BACKOFF_MIN_MS;
            Serial.printf("EEG WS: connected to ws://%s:%u%s\n", EEG_WS_HOST, EEG_WS_PORT, EEG_WS_PATH);
            break;
        case WStype_DISCONNECTED:
            eeg_ws_connected = false;
            Serial.printf("EEG WS: disconnected\n");
            break;
        case WStype_ERROR:
            eeg_ws_connected = false;
            Serial.printf("EEG WS: transport error\n");
            break;
        default:
            break;
    }
}

/** @brief Attempt a reconnect using millis-based backoff; skipped when WiFi is not up. */
static void eeg_stream_reconnect_if_due(void) {
    if (eeg_ws_connected) {
        return;
    }

    if (WiFi.status() != WL_CONNECTED) {
        return;
    }

    const uint32_t now = millis();
    if ((now - eeg_ws_last_attempt_ms) < eeg_ws_backoff_ms) {
        return;
    }

    eeg_ws_last_attempt_ms = now;
    eeg_ws.begin(EEG_WS_HOST, EEG_WS_PORT, EEG_WS_PATH);
    if (eeg_ws_backoff_ms < EEG_WS_BACKOFF_MAX_MS) {
        eeg_ws_backoff_ms *= 2U;
        if (eeg_ws_backoff_ms > EEG_WS_BACKOFF_MAX_MS) {
            eeg_ws_backoff_ms = EEG_WS_BACKOFF_MAX_MS;
        }
    }
}

/** @brief Serialize and transmit one EEG frame as compact JSON. */
static void eeg_stream_send_frame(const EegSampleFrame *frame) {
    eeg_json_doc.clear();

    eeg_json_doc["type"] = "eeg";
    eeg_json_doc["device"] = EEG_DEVICE_ID;
    eeg_json_doc["seq"] = frame->seq;
    eeg_json_doc["ts"] = frame->ts_ms;
    JsonArray channels = eeg_json_doc.createNestedArray("ch");
    for (uint8_t ch = 0; ch < EEG_NUM_CHANNELS; ++ch) {
        channels.add(frame->ch[ch]);
    }

    const size_t len = serializeJson(eeg_json_doc, eeg_json_tx_buffer, sizeof(eeg_json_tx_buffer));
    if ((len > 0U) && (len < sizeof(eeg_json_tx_buffer))) {
        eeg_ws.sendTXT(eeg_json_tx_buffer, len);
    }
}

bool eeg_stream_init(void) {
    eeg_ws.onEvent(eeg_ws_event);
    eeg_ws.setReconnectInterval(0);
    eeg_ws.enableHeartbeat(15000UL, 3000UL, 2U);
    /* eeg_ws.begin() is deferred to eeg_stream_reconnect_if_due()
       so it is only called after WiFi is connected and LWIP is ready. */
    eeg_ws_last_attempt_ms = millis();
    eeg_stream_configured = true;
    return true;
}

bool eeg_stream_start(void) {
    if (eeg_stream_handle != nullptr) {
        return true;
    }

    if (!eeg_stream_configured) {
        eeg_stream_init();
    }

    eeg_stream_handle = xTaskCreateStaticPinnedToCore(
        eeg_stream_task,
        "eeg_stream",
        EEG_STREAM_TASK_STACK_BYTES / sizeof(StackType_t),
        nullptr,
        EEG_STREAM_TASK_PRIORITY,
        eeg_stream_stack,
        &eeg_stream_tcb,
        EEG_STREAM_TASK_CORE);

    if (eeg_stream_handle == nullptr) {
        Serial.printf("EEG WS: failed to create stream task\n");
        return false;
    }

    return true;
}

void eeg_stream_task(void *parameter) {
    (void)parameter;
    EegSampleFrame frame;

    for (;;) {
        if (!eeg_stream_configured) {
            eeg_stream_init();
        }

        if (WiFi.status() == WL_CONNECTED) {
            eeg_ws.loop();
        }
        eeg_stream_reconnect_if_due();

        uint8_t sent_this_pass = 0U;
        while (eeg_ws_connected && (sent_this_pass < 8U) && eeg_pop_sample(&frame)) {
            eeg_stream_send_frame(&frame);
            sent_this_pass++;
            eeg_ws.loop();
        }

        if (sent_this_pass == 0U) {
            vTaskDelay(pdMS_TO_TICKS(2));
        } else {
            taskYIELD();
        }
    }
}
