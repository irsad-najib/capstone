#ifndef EEG_TASK_H
#define EEG_TASK_H

/** @file eeg_task.h
 *  @brief FreeRTOS EEG acquisition task and static sample ring-buffer API.
 */

#include <stdint.h>
#include <stdbool.h>

/** @brief One filtered EEG sample frame in the static ring buffer. */
typedef struct {
    /** @brief Monotonic acquisition sequence number. */
    uint32_t seq;
    /** @brief millisecond timestamp captured after filtering. */
    uint32_t ts_ms;
    /** @brief Filtered channels in microvolts. */
    float ch[8];
} EegSampleFrame;

/** @brief Start ADS1299 acquisition and create the pinned Core 1 EEG task.
 *  @return true when initialization, semaphore creation, ISR installation, and task creation succeeded.
 */
bool eeg_task_start(void);

/** @brief Copy the newest filtered EEG sample in a cross-core safe critical section.
 *  @param out Caller-provided array receiving eight microvolt samples.
 *  @return true when at least one sample was available.
 */
bool eeg_get_latest(float out[8]);

/** @brief Pop the oldest filtered EEG frame from the static ring buffer.
 *  @param out Caller-provided frame receiving the sample.
 *  @return true when one frame was copied.
 */
bool eeg_pop_sample(EegSampleFrame *out);

/** @brief Return the number of frames currently queued in the static ring buffer.
 *  @return Pending frame count, capped at EEG_RING_BUFFER_SIZE.
 */
uint32_t eeg_available(void);

#endif
