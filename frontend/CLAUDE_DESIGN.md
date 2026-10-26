# Neurosound — Design Brief for Claude Design

> Paste this whole file into Claude Design. It describes the product, the screens, the real data
> each screen shows, and the design system to follow. Build **desktop (1440px) and mobile (390px)**
> variants for every screen.

---

## 1. Product in one paragraph

Neurosound is a **wearable EEG headset for hearing screening** using the **Auditory Brainstem
Response (ABR)** method. An ESP32 in the headphone plays short *tone bursts* into the ear, records the
brain's electrical response through scalp electrodes, and streams it to a backend. The backend
filters the signal, cuts it into epochs around each tone, and **averages hundreds of trials** until a
small bump called **Wave V** (~5–7 ms after the sound) rises out of the noise. If Wave V is there, the
auditory pathway works → **Pass**. If not → **Refer** to a specialist.

The web dashboard is where an operator runs the scan, watches the averaged waveform "grow" in real
time, and reads the result.

- **Users:** clinicians / health workers / student researchers running a screening. Often not EEG
  experts — the UI must explain *what they're looking at* and *whether the scan is good enough yet*.
- **Context:** a lab or clinic desk, laptop on the side, patient wearing the headset. Also checked
  on a phone.
- **Stage:** university capstone prototype (Universitas Gadjah Mada, team C-251). **Do not** show
  fake regulatory claims ("FDA Cleared", "© Neurosound Medical Systems"). Use a neutral footer like
  "Neurosound · Capstone C-251 · Research prototype — not for clinical diagnosis".

## 2. Design direction

**"Clinical Precision"** — calm, trustworthy, data-first. Think medical monitor meets modern SaaS,
not a sci-fi brain HUD.

- Waveforms are the hero. Give charts room, thin precise lines, hairline grids, no heavy shadows
  that blur fine detail.
- Status must be readable in one glance: *Is the device connected? Is it recording? Is the result
  trustworthy yet?*
- Tonal layers + 1px outlines for depth instead of drop shadows.
- Numbers in tabular figures (monospace or `font-variant-numeric: tabular-nums`) so live values
  don't jitter.
- Avoid: neon-on-black cyberpunk, glowing brains, stock-photo doctors, gradients everywhere.

## 3. Design tokens (keep these — the code already uses them)

### Color (Material-3 style roles, already in `globals.css`)

| Role | Hex | Use |
| --- | --- | --- |
| `primary` | `#032034` | Sidebar background, headings, primary text accents |
| `primary-container` | `#1c354a` | Active nav item, dark cards |
| `on-primary-container` | `#859eb7` | Muted text on dark surfaces |
| `primary-fixed` | `#cde5ff` | Light blue highlight / selected rows |
| `secondary` | `#366850` | Positive actions (Start, Save), "Pass", live indicator |
| `secondary-container` | `#b8efd1` | Success chip background |
| `on-secondary-container` | `#3c6e56` | Success chip text |
| `tertiary-fixed` | `#ffdcc4` | Warning chip background ("Inconclusive") |
| `on-tertiary-container` | `#e5832b` | Warning accent / in-progress |
| `on-tertiary-fixed-variant` | `#703800` | Warning chip text |
| `error` | `#ba1a1a` | Stop / recording-live badge / "Refer" |
| `error-container` | `#ffdad6` | Error chip background |
| `surface` | `#faf9fb` | Page background |
| `surface-container-lowest` | `#ffffff` | Cards |
| `surface-container-low` / `-container` / `-high` | `#f4f3f5` / `#efedef` / `#e9e8ea` | Nested panels, table headers, hover |
| `on-surface` | `#1b1c1d` | Body text |
| `on-surface-variant` | `#43474c` | Secondary text, labels |
| `outline` / `outline-variant` | `#73777d` / `#c3c7cd` | Borders, grid lines, disabled |

Chart colors: **Channel 0 = `secondary` (#366850)**, Channel 1 = `primary-container` (#1c354a),
noise/previous snapshot = `outline-variant` at 60%, Wave markers (I / III / V) = `on-tertiary-container`
(#e5832b). The expected Wave V latency window (5–7.5 ms) = a soft `secondary-container` band behind the
trace.

Please also propose a **dark mode** mapping for these roles (sidebar already dark; charts must stay
legible).

### Typography — Inter

| Token | Size / line / weight |
| --- | --- |
| headline-lg | 32/40, 700, -0.02em (mobile 24/32) |
| headline-md | 24/32, 600 |
| headline-sm | 20/28, 600 |
| body-md | 16/24, 400 |
| body-sm | 14/20, 400 |
| label-md | 12/16, 600, often UPPERCASE + wide tracking for section labels |
| label-sm | 11/14, 500 |
| mono (JetBrains Mono or system mono) | live numbers, timestamps, filenames, frame log |

### Shape & spacing

- Radius: buttons/inputs 8px, cards 12–16px, chips full pill.
- 4px base grid; widgets separated by 16px or 24px.
- Page margins: 16px mobile, 48px desktop. 12-column grid on desktop, max content width ~1280px.
- Elevation: white card + 1px `outline-variant` border. Hover/selected: 4px shadow tinted primary at 5%.

## 4. App shell

- **Desktop:** fixed left sidebar 256px, `primary` background, logo "Neurosound" at top, nav items
  with icon + label, active item uses `primary-container` + left accent bar. Bottom of sidebar:
  compact backend status (green dot "Backend online" / grey "Offline") and device ID.
- **Top bar** (per page): page title, connection chips (`● Backend`, `● Device esp32-abr-001`),
  hamburger on mobile.
- **Mobile:** sidebar becomes an off-canvas drawer + a **bottom nav** with 4–5 icons.
- Nav items: **Dashboard**, **Start Scan**, **History**, **Device Status**, **Settings**.
- Icons: Material Design icons (react-icons `Md*`) — GridView, MonitorHeart, History, Sensors,
  SettingsApplications.

## 5. Screens

For every screen, design these states: **loading**, **empty**, **backend offline**, and the
normal/populated state.

### 5.1 Dashboard (`/`)

Purpose: "Is everything ready, and what happened recently?"

- Greeting + date, big CTA **Start New Scan** (secondary button).
- **Metric cards (4):** Total sessions · Sessions this week · Pass rate (%) · Avg. trials per session.
- **System monitoring card:** Backend (online/offline + last health check time), Device (connected
  device IDs from `/api/v1/devices`), Stimulus (idle / running @ 80 dB), MongoDB (on/off).
- **Current scan summary panel:** if a scan is running — live trial counter, SNR, mini waveform
  sparkline, "Open live scan →". If idle — friendly empty state.
- **Recent sessions table:** File · Saved at · Trials · Outcome chip · Actions (View).

### 5.2 Live Scan (`/scan`) — the most important screen

Purpose: run the stimulus and watch the ABR average converge.

- Header: red pulsing **LIVE** badge (or grey **PAUSED**), title "Auditory Brainstem Response",
  device + ear (Left / Right) selector.
- Controls: **Start stimulus** (secondary), **Stop** (error), **Reset average** (ghost), **Save
  session** (primary, disabled until ≥100 trials). Stimulus level stepper in dB (e.g. 40–90 dB, step 10).
- **Main chart (9/12 cols):** averaged ABR waveform, x-axis 0–10 ms (epoch), y-axis µV. Tabs:
  **ABR Average** | **Raw EEG** (scrolling live signal from SSE) . Markers for detected Wave I, III, V
  with latency labels. Shaded expected-Wave-V window. Optional faint "ghost" of the previous snapshot
  so the user sees it sharpening.
- **Scan health side panel (3/12 cols):**
  - Trials: big number + progress bar toward 500 (thresholds: <100 insufficient, 100–499
    inconclusive, ≥500 enough).
  - SNR (dB) per channel with a small gauge; ≥3 dB = good.
  - Signal quality chip (`good` / `noisy` / `saturated`).
  - Latencies: Wave I, III, V (ms) and I–V interpeak interval.
- **Frame log** (collapsible, mono, bottom): last N WebSocket frames `{ch1, ch2, ts, stim}` for
  debugging.
- A one-line helper under the chart explaining what to look for:
  "A clear peak around 5–7 ms that keeps growing as trials increase means the ear responded."

### 5.3 History (`/records`)

- Filter chips: Result — All · Normal (≥500 trials) · Inconclusive (100–499) · Insufficient (<100).
- Search by filename, sort by date.
- Table (desktop) / card list (mobile): Filename (mono) · Saved at · Trials · SNR · Verdict chip ·
  actions (View result, Download JSON).
- Pagination or "Load more".

### 5.4 Result detail (`/results?file=...`)

Purpose: a clear, printable diagnostic summary for one session.

- **Verdict hero card:** big **PASS** (secondary) or **REFER** (error) or **INCONCLUSIVE**
  (tertiary), with one-sentence plain-language explanation, ear, date, trial count.
- Tabs **Visual** | **Metrics**.
  - Visual: final ABR waveform with Wave I/III/V markers; small multiples showing the waveform at
    100 / 250 / 500 / final trials (from `abr_snapshots`) to show convergence.
  - Metrics: table of waves (name, latency ms, amplitude µV), interpeak intervals (I–III, III–V,
    I–V), SNR per channel, Pearson r between halves (reproducibility), sampling rate, epoch length.
- Session info card: filename, saved at, device, stimulus level.
- Actions: **Export PDF**, **Back to history**, **Re-run scan**.
- Print stylesheet: A4, black on white, chart kept, sidebar hidden.

### 5.5 Device Status (`/device`)

- Network link card: WiFi SSID, device IP, WebSocket state, last frame received (e.g. "12 ms ago"),
  frames/sec.
- Hardware interfaces card: ADC (ADS1115 / ADS1299), DAC PCM5102A (I2S), sample rate, channels.
- Runtime checks list with ✓ / ⚠ / ✕: backend health, device connected, frames arriving, stimulus
  markers present, signal not saturated.
- Acquisition summary: uptime, total frames, dropped frames.
- Small illustration/diagram: Headset → ESP32 → WiFi → Backend → Dashboard with live status on each hop.

### 5.6 Settings (`/settings`)

- Language: **Bahasa Indonesia / English** (segmented control).
- Theme: Light / Dark / System.
- Notifications toggle: "Alert when scan finishes, backend goes offline, or device disconnects."
- Backend URL input (default `http://localhost:8080`) with "Test connection" button.
- Scan defaults: stimulus dB, target trial count, auto-save when target reached.

## 6. Components to define

Buttons (primary / secondary / danger / ghost / icon), status chips (success / warning / error /
neutral / live-pulsing), connection pill with dot, metric card, chart card with header + legend +
tabs, progress bar with threshold ticks, SNR gauge, data table + mobile card row, empty state,
offline banner ("Backend offline — start the Go server to load session history." with a retry
button), toast, segmented control, toggle, text input, sidebar nav item, bottom nav item.

## 7. Real data shapes (use realistic values, not lorem ipsum)

```jsonc
// GET /api/v1/abr  — live average
{ "trial_count": 342, "sampling_rate": 860, "epoch_ms": 10,
  "quality": "good", "snr": [4.2, 1.8],
  "abr_average": [[/* ch0 µV samples */], [/* ch1 */]] }

// GET /api/v1/sessions
{ "sessions": [
  { "filename": "eeg_abr_20260928_141203.json", "saved_at": "2026-09-28T14:12:03Z",
    "trial_count": 612, "snr": [5.1, 2.3], "verdict": "Pass" } ], "total": 18 }

// Result analysis
{ "waves": [ {"name":"I","latency_ms":1.6,"amplitude_uv":0.18},
             {"name":"III","latency_ms":3.9,"amplitude_uv":0.22},
             {"name":"V","latency_ms":5.8,"amplitude_uv":0.41} ],
  "interpeak_ms": {"I-III": 2.3, "III-V": 1.9, "I-V": 4.2},
  "verdict": "Pass" }
```

Sample device ID: `esp32-abr-001`. Stimulus: tone burst, 80 dB.

## 8. Accessibility & quality bar

- WCAG AA contrast for all text, including chips.
- Never rely on color alone: verdicts carry a word + icon (✓ Pass, ↗ Refer, ? Inconclusive).
- Touch targets ≥ 44px on mobile.
- Charts: axis labels with units (ms, µV), readable at 390px width (allow horizontal pinch/scroll
  inside the chart card, never the page).
- Motion: only the LIVE pulse and subtle waveform draw-in; respect `prefers-reduced-motion`.

## 9. Deliverables

1. Design system page (tokens, type scale, components, light + dark).
2. Six screens × desktop + mobile, with the states listed above.
3. A short note on any token changes you recommend, so they can be ported back to
   `frontend/src/app/globals.css` (Tailwind v4 `@theme`).

Tech the final UI will be built with: **Next.js 16, React 19, Tailwind CSS 4, react-icons (Material)**.
