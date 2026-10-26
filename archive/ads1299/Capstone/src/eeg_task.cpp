#include "eeg_task.h"

#include <Arduino.h>
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>
#include <freertos/task.h>
#include <atomic>

#include "ads1299_driver.h"
#include "eeg_config.h"
#include "eeg_filters.h"

static SemaphoreHandle_t drdy_semaphore        = nullptr;
static StaticSemaphore_t drdy_semaphore_storage;
static StaticTask_t      eeg_task_tcb;
static StackType_t       eeg_task_stack[EEG_TASK_STACK_BYTES / sizeof(StackType_t)];

/* WARNING-6 fix: SPSC lock-free ring — no portMUX needed for single producer/consumer. */
static EegSampleFrame    eeg_ring[EEG_RING_BUFFER_SIZE];
static std::atomic<uint32_t> eeg_ring_head;
static std::atomic<uint32_t> eeg_ring_tail;

static TaskHandle_t eeg_task_handle = nullptr;
static uint32_t     eeg_sequence    = 0U;

/* DRDY miss/recovery counters exposed for diagnostics. */
static volatile uint32_t eeg_drdy_timeouts = 0U;
static volatile uint32_t eeg_frame_errors  = 0U;

/* CRITICAL-1 fix: lock-free SPSC push — no critical section required. */
static void eeg_ring_push(const EegSampleFrame *frame) {
    const uint32_t head = eeg_ring_head.load(std::memory_order_relaxed);
    const uint32_t tail = eeg_ring_tail.load(std::memory_order_acquire);
    if ((head - tail) >= EEG_RING_BUFFER_SIZE) {
        /* Full — silently drop oldest. */
        eeg_ring_tail.store(tail + 1U, std::memory_order_release);
    }
    eeg_ring[head & EEG_RING_BUFFER_MASK] = *frame;
    eeg_ring_head.store(head + 1U, std::memory_order_release);
}

void IRAM_ATTR ads1299_drdy_isr(void) {
    BaseType_t woken = pdFALSE;
    if (drdy_semaphore != nullptr) {
        xSemaphoreGiveFromISR(drdy_semaphore, &woken);
        if (woken == pdTRUE) portYIELD_FROM_ISR();
    }
}

/* WARNING-4 fix: 50 ms timeout (10× sample period) + auto-recovery on DRDY stall. */
static void eeg_task_loop(void *parameter) {
    (void)parameter;
    int32_t       raw[EEG_NUM_CHANNELS];
    EegSampleFrame frame;
    uint32_t       consecutive_timeouts = 0U;

    for (;;) {
        if (xSemaphoreTake(drdy_semaphore, pdMS_TO_TICKS(50)) == pdTRUE) {
            consecutive_timeouts = 0U;

            if (ads1299_read_data(raw)) {
                frame.seq   = eeg_sequence++;
                frame.ts_ms = millis();
                for (uint8_t ch = 0U; ch < EEG_NUM_CHANNELS; ++ch) {
                    frame.ch[ch] = filter_sample(ch, raw[ch]);
                }
                eeg_ring_push(&frame);
            } else {
                eeg_frame_errors++;
            }
        } else {
            eeg_drdy_timeouts++;
            consecutive_timeouts++;
            if (consecutive_timeouts >= 10U) {
                Serial.printf("[EEG] DRDY stall (%lu timeouts) — restarting stream\n",
                              (unsigned long)eeg_drdy_timeouts);
                ads1299_stop_stream();
                vTaskDelay(pdMS_TO_TICKS(10));
                ads1299_start_stream();
                consecutive_timeouts = 0U;
                /* Drain any stale semaphore counts accumulated during stall. */
                while (xSemaphoreTake(drdy_semaphore, 0) == pdTRUE) {}
            }
        }
    }
}

bool eeg_task_start(void) {
    if (eeg_task_handle != nullptr) return true;

    eeg_ring_head.store(0U, std::memory_order_relaxed);
    eeg_ring_tail.store(0U, std::memory_order_relaxed);
    reset_filters();

    drdy_semaphore = xSemaphoreCreateBinaryStatic(&drdy_semaphore_storage);
    if (drdy_semaphore == nullptr) {
        Serial.println("[EEG] semaphore create failed");
        return false;
    }

    /* CRITICAL-3 fix: configure + verify ADS1299 but do NOT start stream yet. */
    if (!ads1299_init()) {
        Serial.println("[EEG] ADS1299 init failed");
        return false;
    }

    /* CRITICAL-1 fix: create task BEFORE attaching interrupt so the task is
       already blocked on xSemaphoreTake when the first DRDY pulse arrives. */
    eeg_task_handle = xTaskCreateStaticPinnedToCore(
        eeg_task_loop,
        "eeg_acq",
        EEG_TASK_STACK_BYTES / sizeof(StackType_t),
        nullptr,
        EEG_TASK_PRIORITY,
        eeg_task_stack,
        &eeg_task_tcb,
        EEG_TASK_CORE);

    if (eeg_task_handle == nullptr) {
        Serial.println("[EEG] task create failed");
        return false;
    }

    /* Attach interrupt after task exists. */
    pinMode(EEG_PIN_ADS1299_DRDY, INPUT);
    attachInterrupt(digitalPinToInterrupt(EEG_PIN_ADS1299_DRDY), ads1299_drdy_isr, FALLING);

    /* Drain any spurious semaphore counts, then start streaming. */
    while (xSemaphoreTake(drdy_semaphore, 0) == pdTRUE) {}

    /* CRITICAL-1 fix: start stream LAST — task and ISR are both ready. */
    ads1299_start_stream();

    Serial.printf("[EEG] streaming @ %u SPS, Core %u, Priority %u\n",
                  EEG_SAMPLE_RATE_HZ, EEG_TASK_CORE, EEG_TASK_PRIORITY);
    return true;
}

bool eeg_get_latest(float out[8]) {
    const uint32_t head = eeg_ring_head.load(std::memory_order_acquire);
    const uint32_t tail = eeg_ring_tail.load(std::memory_order_acquire);
    if (head == tail) return false;
    const EegSampleFrame *f = &eeg_ring[(head - 1U) & EEG_RING_BUFFER_MASK];
    for (uint8_t ch = 0U; ch < EEG_NUM_CHANNELS; ++ch) {
        out[ch] = f->ch[ch];
    }
    return true;
}

bool eeg_pop_sample(EegSampleFrame *out) {
    if (out == nullptr) return false;
    const uint32_t tail = eeg_ring_tail.load(std::memory_order_acquire);
    const uint32_t head = eeg_ring_head.load(std::memory_order_acquire);
    if (tail == head) return false;
    *out = eeg_ring[tail & EEG_RING_BUFFER_MASK];
    eeg_ring_tail.store(tail + 1U, std::memory_order_release);
    return true;
}

uint32_t eeg_available(void) {
    const uint32_t head = eeg_ring_head.load(std::memory_order_acquire);
    const uint32_t tail = eeg_ring_tail.load(std::memory_order_acquire);
    const uint32_t n    = head - tail;
    return (n > EEG_RING_BUFFER_SIZE) ? EEG_RING_BUFFER_SIZE : n;
}
