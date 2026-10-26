#ifndef EEG_STREAM_H
#define EEG_STREAM_H

/** @file eeg_stream.h
 *  @brief WebSocket streaming interface for filtered EEG frames.
 */

#include <stdbool.h>

/** @brief Initialize WebSocket client state and connect to the configured backend.
 *  @return true when the client was configured.
 */
bool eeg_stream_init(void);

/** @brief Start the Core 0 WebSocket streaming task.
 *  @return true when the task exists or was created successfully.
 */
bool eeg_stream_start(void);

/** @brief FreeRTOS task entry for WebSocket servicing and JSON transmission.
 *  @param parameter Unused FreeRTOS task parameter.
 */
void eeg_stream_task(void *parameter);

#endif
