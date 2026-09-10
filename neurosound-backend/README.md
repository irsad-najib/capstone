# Neurosound Backend

Hybrid Go + Python DSP backend for the Neurosound ABR frontend.

## Setup

```bash
./scripts/setup.sh
go mod tidy
```

Optional MongoDB:

```bash
docker compose up -d mongo
cp .env.example .env
```

Run:

```bash
MONGO_URI=mongodb://localhost:27017 go run .
```

Frontend default backend URL is `http://localhost:8080`, so no frontend env change is needed when this server runs on port `8080`.

## ESP32 WebSocket Frame

Send frames to `ws://localhost:8080/ws?id=esp32-abr-001`:

```json
{"ch1":12345,"ch2":-4321,"ts":1234567890,"stim":true}
```

## Main Endpoints

- `GET /api/v1/health`
- `GET /api/v1/devices`
- `GET /api/v1/abr`
- `GET /api/v1/raw/stream`
- `GET /api/v1/abr/stream`
- `POST /api/v1/abr/save`
- `GET /api/v1/sessions`
- `GET /api/v1/sessions/{filename}`
- `POST /api/v1/reset`
