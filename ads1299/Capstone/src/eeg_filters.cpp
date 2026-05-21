#include "eeg_filters.h"

#include <Arduino.h>

#include "eeg_config.h"

/** @brief Number of cascaded filter stages per EEG channel. */
static const uint8_t EEG_FILTER_STAGES = 3U;
/** @brief Static filter state indexed by channel and stage; no heap allocation is used. */
static BiquadState filter_states[EEG_NUM_CHANNELS][EEG_FILTER_STAGES];

void init_biquad(BiquadState *state) {
    if (state == nullptr) {
        return;
    }
    state->z1 = 0.0f;
    state->z2 = 0.0f;
}

float apply_biquad(const float coeff[5], BiquadState *state, float input) {
    const float output = (coeff[0] * input) + state->z1;
    state->z1 = (coeff[1] * input) - (coeff[3] * output) + state->z2;
    state->z2 = (coeff[2] * input) - (coeff[4] * output);
    /* WARNING-7 fix: flush denormals — ESP32 FPU has no hardware denormal support,
       subnormal values cause multi-cycle software fallback and slow down the ISR path. */
    if (fabsf(state->z1) < 1e-20f) state->z1 = 0.0f;
    if (fabsf(state->z2) < 1e-20f) state->z2 = 0.0f;
    return output;
}

float filter_sample(uint8_t ch, int32_t raw_int32) {
    if (ch >= EEG_NUM_CHANNELS) {
        return 0.0f;
    }

    float value_uv = static_cast<float>(raw_int32) * EEG_ADS1299_LSB_UV;
    value_uv = apply_biquad(EEG_BIQUAD_HP_0P5HZ, &filter_states[ch][0], value_uv);
    value_uv = apply_biquad(EEG_BIQUAD_NOTCH_50HZ, &filter_states[ch][1], value_uv);
    value_uv = apply_biquad(EEG_BIQUAD_NOTCH_60HZ, &filter_states[ch][2], value_uv);
    return value_uv;
}

void reset_filters(void) {
    for (uint8_t ch = 0; ch < EEG_NUM_CHANNELS; ++ch) {
        for (uint8_t stage = 0; stage < EEG_FILTER_STAGES; ++stage) {
            init_biquad(&filter_states[ch][stage]);
        }
    }
}
