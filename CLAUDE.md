# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

An ESP32-based EEG streaming system. The ESP32 reads brain signal data from an ADS1299 chip, streams it over WebSocket to a Go backend, and generates audio feedback via a PCM5102A DAC.

## Repository Layout

- `Capstone/` — ESP32 firmware (PlatformIO/Arduino framework)
  - `src/sketch-capstone-1.ino` — single-file firmware (all logic here for now)
  - `platformio.ini` — board: `upesy_wroom` (ESP32-WROOM-32U)
- `main.go` / `go.mod` — Go WebSocket backend (single file, port 8080)
- `Claude.md` — raw architecture notes (superseded by this file)

## Commands

### ESP32 Firmware (PlatformIO)

```bash
# Build
pio run -e upesy_wroom

# Flash
pio run -e upesy_wroom --target upload

# Serial monitor (115200 baud)
pio device monitor --baud 115200

# Build + flash + monitor in one step
pio run -e upesy_wroom --target upload && pio device monitor --baud 115200
```

### Go Backend

```bash
go run main.go           # Start WebSocket server on :8080
go build -o capstone .   # Build binary
go test ./...            # Run tests
```

## Architecture

### Communication Flow

```
ADS1299 (SPI) → ESP32 → WebSocket (JSON) → Go backend (:8080/ws)
                   ↑
           PCM5102A (I2S) ← audio commands from backend
```

### ESP32 Firmware (`sketch-capstone-1.ino`)

Boot sequence:

1. Try connecting to saved WiFi credentials (stored in NVS via `Preferences`)
2. If no credentials or connection fails → start AP mode (`ESP32-Setup` / `12345678`) with a captive portal at `192.168.4.1`
3. After WiFi connects → open WebSocket to `WS_HOST:WS_PORT/ws?id=DEVICE_ID`

Key globals to configure at the top of the `.ino`:

- `WS_HOST` — Go backend IP
- `WS_PORT` — default `8080`
- `DEVICE_ID` — unique device string

**I2S / Audio**: WiFi radio interferes with I2S timing. The `pendingI2SReinit` flag defers I2S reinit to the main loop after WiFi events — never call `setupI2S()` directly from `onWiFiEvent()`.

**Captive portal**: Handles iOS (`/hotspot-detect.html`), Android (`/generate_204`), and Windows (`/ncsi.txt`) probes to trigger the OS captive portal popup.

**Hold GPIO 0 (BOOT button) on boot** → clears saved WiFi credentials.

### Go Backend (`main.go`)

Minimal single-file server using `gorilla/websocket`:

- `/ws?id=<device_id>` — WebSocket endpoint; ESP32 connects here
- `/broadcast?msg=<text>` — HTTP endpoint to push a message to all connected devices
- `ClientPool` manages connected devices with a mutex-protected map

JSON message format from ESP32:

```json
{ "type": "sensor", "device": "esp32-001", "temperature": "28" }
```

Supported server→ESP32 commands:

```json
{"type": "command", "cmd": "led_on"}
{"type": "command", "cmd": "led_off"}
```

## Hardware Pins

| Signal    | GPIO |
| --------- | ---- |
| I2S BCLK  | 26   |
| I2S LRC   | 25   |
| I2S DOUT  | 22   |
| RESET btn | 0    |
| LED       | 2    |

## Coding Constraints

- No `delay()` in the main loop — use `millis()` comparisons
- No dynamic allocation inside high-speed loops — use static buffers
- EEG acquisition task must have highest FreeRTOS priority when added
- Audio and WiFi share Core 0; EEG acquisition belongs on Core 1
- `Serial.printf` is fine for debugging; avoid it inside ISRs or time-critical paths

---

## AI Model Usage Strategy (Claude Code)

This project uses **model switching** between Haiku and Sonnet to minimize token cost without sacrificing quality.

### Model Pricing (current as of May 2026)

| Model                       | Input   | Output   | Notes                               |
| --------------------------- | ------- | -------- | ----------------------------------- |
| `claude-haiku-4-5-20251001` | $1/MTok | $5/MTok  | Fast, cheap, ~90% of Sonnet quality |
| `claude-sonnet-4-6`         | $3/MTok | $15/MTok | Balanced, default production model  |

Sonnet costs **3x more** than Haiku. Route tasks correctly to cut costs 40–60%.

---

### Task Routing Rules

#### Use Haiku (`claude-haiku-4-5-20251001`) for:

- Parsing and validating JSON packets from ESP32
- Routing/classifying simple commands (`led_on`, `led_off`, `set_frequency`, etc.)
- Boilerplate code generation (struct definitions, getters/setters, simple handlers)
- Reformatting or converting data between types
- Writing repetitive test cases
- Log summarization or simple pattern matching
- Any task where the expected output is short and deterministic

#### Use Sonnet (`claude-sonnet-4-6`) for:

- EEG brainwave pattern analysis (alpha/beta/theta detection logic)
- Designing FreeRTOS task architecture and inter-task communication
- Debugging complex timing issues (I2S + WiFi interference, SPI DRDY interrupt)
- Writing or reviewing real-time audio DSP code (sine generation, DMA buffers)
- Designing the Go backend architecture (multi-device handling, session storage)
- Anything requiring multi-step reasoning or tradeoff analysis
- Code review with security/reliability implications
- Writing CLAUDE.md updates or architecture documentation

---

### Extended Thinking (Budget Tokens)

Extended thinking is billed as **output tokens** at the model's standard output rate.

**Minimum budget: 1,024 tokens.**

| Task Type                          | Model  | Thinking Budget | Reason                              |
| ---------------------------------- | ------ | --------------- | ----------------------------------- |
| JSON parsing / command routing     | Haiku  | OFF             | Deterministic, no reasoning needed  |
| Simple code generation             | Haiku  | OFF             | Boilerplate, low complexity         |
| EEG band detection logic           | Haiku  | ~1K tokens      | Light numerical reasoning           |
| FreeRTOS task design               | Sonnet | ~4K tokens      | Concurrency tradeoffs               |
| Brainwave analysis / neurofeedback | Sonnet | ~4–8K tokens    | Multi-channel signal interpretation |
| Full architecture decisions        | Sonnet | ~8K+ tokens     | Deep reasoning, rare call           |

Rule of thumb: **if a task would take a senior engineer >10 minutes to think through, enable thinking on Sonnet.**

---

### Prompt Caching

Always cache the system prompt and EEG context header that is sent on every request. This can reduce effective input cost by **up to 90%** on cached tokens.

Content worth caching:

- EEG channel layout and pin definitions
- Device configuration schema
- JSON packet format specification
- FreeRTOS task structure overview

---

### Batch API

Use batch processing (50% discount) for:

- Post-session EEG analysis (not realtime)
- Generating multiple test cases at once
- Bulk log analysis

Do **not** use batch for anything in the realtime WebSocket streaming path.

---

### Go Backend: Model Router Example

```go
// ModelRouter returns the appropriate Claude model string for a given task type.
func ModelRouter(taskType string) string {
    switch taskType {
    // Fast, cheap tasks → Haiku
    case "parse_eeg_packet",
         "validate_json",
         "command_dispatch",
         "heartbeat_ack",
         "log_summary",
         "boilerplate_gen":
        return "claude-haiku-4-5-20251001"

    // Complex reasoning tasks → Sonnet
    case "brainwave_analysis",
         "neurofeedback_interpretation",
         "session_summary",
         "architecture_design",
         "debug_timing_issue",
         "audio_dsp_review":
        return "claude-sonnet-4-6"

    default:
        return "claude-haiku-4-5-20251001" // Default to cheap
    }
}

// ThinkingBudget returns the extended thinking token budget for a task.
// Returns 0 to disable thinking (saves cost on simple tasks).
func ThinkingBudget(taskType string) int {
    switch taskType {
    case "brainwave_analysis":
        return 4000
    case "neurofeedback_interpretation", "session_summary":
        return 8000
    case "architecture_design", "debug_timing_issue":
        return 8000
    case "audio_dsp_review":
        return 4000
    default:
        return 0 // No thinking for simple tasks
    }
}
```

---

### Cost Optimization Summary

| Lever                            | Savings                   | Apply to                      |
| -------------------------------- | ------------------------- | ----------------------------- |
| Use Haiku for simple tasks       | ~67% vs Sonnet            | Parsing, routing, boilerplate |
| Prompt caching                   | up to 90% on cached input | System prompt, EEG schema     |
| Batch API                        | 50%                       | Post-session analysis         |
| Extended thinking OFF by default | Varies                    | Only enable when truly needed |

**Recommended split for this project: ~85% Haiku / ~15% Sonnet by request count.**
