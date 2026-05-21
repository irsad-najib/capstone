#ifndef EEG_FILTERS_H
#define EEG_FILTERS_H

/** @file eeg_filters.h
 *  @brief Static biquad IIR filtering for ADS1299 EEG samples.
 */

#include <stdint.h>

/** @brief Direct-form II transposed biquad state. */
typedef struct {
    /** @brief First delay state. */
    float z1;
    /** @brief Second delay state. */
    float z2;
} BiquadState;

/** @brief Clear one biquad state structure.
 *  @param state State object to clear.
 */
void init_biquad(BiquadState *state);

/** @brief Apply one normalized biquad section.
 *  @param coeff Coefficients in order b0, b1, b2, a1, a2 with a0 normalized to 1.
 *  @param state Mutable filter state.
 *  @param input Input sample.
 *  @return Filtered output sample.
 */
float apply_biquad(const float coeff[5], BiquadState *state, float input);

/** @brief Filter one ADS1299 channel sample through DC-block, 50 Hz notch, and 60 Hz notch.
 *  @param ch Channel index in range 0..7.
 *  @param raw_int32 Sign-extended 24-bit ADS1299 code.
 *  @return Filtered sample in microvolts.
 */
float filter_sample(uint8_t ch, int32_t raw_int32);

/** @brief Clear all per-channel filter states. */
void reset_filters(void);

#endif
