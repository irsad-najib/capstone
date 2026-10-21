# Build Go binary
FROM golang:1.23-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/server .

# Runtime: Python (numpy + scipy) untuk DSP worker + binary Go
FROM python:3.12-slim
WORKDIR /app
RUN pip install --no-cache-dir numpy scipy
COPY --from=build /out/server /app/server
COPY dsp/ /app/dsp/

ENV PORT=8080 \
    PYTHON_BIN=python3 \
    DSP_WORKER=dsp/dsp_worker.py \
    SESSION_DIR=/app/data/sessions

EXPOSE 8080
CMD ["/app/server"]
