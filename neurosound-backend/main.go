package main

import (
	"context"
	"crypto/subtle"
	_ "embed"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"neurosound-backend/internal/buffer"
	"neurosound-backend/internal/dsp"
	"neurosound-backend/internal/processor"
	"neurosound-backend/internal/session"
	"neurosound-backend/internal/sse"
	"neurosound-backend/internal/ws"
)

//go:embed openapi.yaml
var openapiSpec []byte

//go:embed logs.html
var logsPage []byte

type app struct {
	proc   *processor.Processor
	store  *session.Store
	hub    *ws.Hub
	abrSSE *sse.Broadcaster
	rawSSE *sse.Broadcaster
	token  string // LOG_TOKEN; kosong = /logs dan perintah ke device terbuka
}

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	pythonPath := getenv("PYTHON_BIN", defaultPython())
	dspPath := getenv("DSP_WORKER", "dsp/dsp_worker.py")
	port := getenv("PORT", "8080")

	ring := buffer.New(32000)
	runner := dsp.NewRunner(pythonPath, dspPath)
	proc := processor.New(processor.Config{Fs: processor.Fs}, ring, runner)
	abrSSE := sse.New()
	rawSSE := sse.New()
	store, err := session.NewStore(ctx, os.Getenv("MONGO_URI"), getenv("MONGO_DB", "neurosound"), getenv("SESSION_DIR", "data/sessions"))
	if err != nil {
		log.Printf("[mongo] disabled: %v", err)
		store, _ = session.NewStore(context.Background(), "", "", getenv("SESSION_DIR", "data/sessions"))
	}
	defer store.Close(context.Background())

	a := &app{proc: proc, store: store, abrSSE: abrSSE, rawSSE: rawSSE, token: os.Getenv("LOG_TOKEN")}
	a.hub = ws.NewHub(proc, abrSSE, rawSSE)

	go a.tickStreams()

	mux := http.NewServeMux()
	mux.Handle("/ws", a.hub)
	mux.Handle("/stream/abr", abrSSE)
	mux.Handle("/stream/raw", rawSSE)
	mux.Handle("/api/v1/abr/stream", abrSSE)
	mux.Handle("/api/v1/raw/stream", rawSSE)

	mux.HandleFunc("/api/status", a.handleHealth)
	mux.HandleFunc("/api/v1/health", a.handleHealth)
	mux.HandleFunc("/api/v1/devices", a.handleDevices)
	mux.HandleFunc("/api/v1/abr", a.handleABR)
	mux.HandleFunc("/api/v1/abr/save", a.handleSave)
	mux.HandleFunc("/api/v1/reset", a.handleReset)
	mux.HandleFunc("/api/v1/stim", a.handleStim)
	mux.HandleFunc("/api/v1/stim/set", a.handleStimSet)
	mux.HandleFunc("/api/v1/broadcast", a.auth(a.handleBroadcast))
	mux.HandleFunc("/api/v1/command", a.auth(a.handleCommand))
	mux.HandleFunc("/api/v1/logs", a.auth(a.handleLogs))
	mux.HandleFunc("/api/v1/logs/stream", a.auth(a.hub.Logs.ServeStream))
	mux.HandleFunc("/logs", a.auth(handleLogsPage))
	mux.HandleFunc("/openapi.yaml", handleSpec)
	mux.HandleFunc("/docs", handleDocs)
	mux.HandleFunc("/api/results", a.handleResults)
	mux.HandleFunc("/api/v1/sessions", a.handleSessions)
	mux.HandleFunc("/api/v1/sessions/", a.handleSessionDetail)

	handler := cors(mux)
	log.Printf("Neurosound backend listening on :%s", port)
	log.Printf("WebSocket: ws://localhost:%s/ws?id=esp32", port)
	log.Fatal(http.ListenAndServe(":"+port, handler))
}

func (a *app) tickStreams() {
	rawTicker := time.NewTicker(200 * time.Millisecond)
	abrTicker := time.NewTicker(2 * time.Second)
	defer rawTicker.Stop()
	defer abrTicker.Stop()
	for {
		select {
		case <-rawTicker.C:
			a.rawSSE.Broadcast(a.proc.Raw(500))
		case <-abrTicker.C:
			a.abrSSE.Broadcast(a.proc.Result())
		}
	}
}

func (a *app) handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, map[string]any{
		"status": "ok",
		"time":   time.Now().Format(time.RFC3339),
	})
}

func (a *app) handleDevices(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, map[string]any{"devices": a.hub.Devices(), "detail": a.hub.Detail()})
}

func (a *app) handleABR(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, a.proc.Result())
}

func (a *app) handleResults(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, a.proc.Result().Analysis)
}

func (a *app) handleSave(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	filename := processor.FilenameNow()
	doc := a.proc.SessionDocument(filename)
	if err := a.store.Save(r.Context(), doc); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]any{"ok": true, "file": filename})
}

func (a *app) handleReset(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	a.proc.Reset()
	writeJSON(w, map[string]any{"ok": true})
}

func (a *app) handleStim(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	writeJSON(w, map[string]any{"ok": true, "trials": a.proc.Result().TrialCount})
}

func (a *app) handleStimSet(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var body struct {
		DB int `json:"db"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	msg, _ := json.Marshal(map[string]any{"cmd": "set_db", "value": body.DB})
	writeJSON(w, map[string]any{"ok": true, "db": body.DB, "sent": a.hub.Send(msg)})
}

// handleBroadcast mengirim {"type":"command","cmd":msg} ke semua device.
// Terima GET ?msg= maupun POST {"msg":"..."}.
func (a *app) handleBroadcast(w http.ResponseWriter, r *http.Request) {
	var msg string
	switch r.Method {
	case http.MethodGet:
		msg = r.URL.Query().Get("msg")
	case http.MethodPost:
		var body struct {
			Msg string `json:"msg"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		msg = body.Msg
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if msg == "" {
		http.Error(w, "msg kosong", http.StatusBadRequest)
		return
	}
	out, _ := json.Marshal(map[string]string{"type": "command", "cmd": msg})
	writeJSON(w, map[string]any{"ok": true, "msg": msg, "sent": a.hub.Send(out)})
}

// handleCommand: POST {"device":"esp32-audio-001","cmd":"l -30"} -> {"type":"command","cmd":...}
// ke device itu (device kosong = semua). 404 kalau device tidak terhubung.
func (a *app) handleCommand(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var body struct {
		Device string `json:"device"`
		Cmd    string `json:"cmd"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Cmd == "" {
		http.Error(w, `body harus JSON dengan field "cmd"`, http.StatusBadRequest)
		return
	}
	out, _ := json.Marshal(map[string]string{"type": "command", "cmd": body.Cmd})
	sent := a.hub.SendTo(body.Device, out)
	if body.Device != "" && sent == 0 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "device tidak terhubung", "device": body.Device})
		return
	}
	if body.Device != "" {
		a.hub.Logs.Add(body.Device, "[server] > "+body.Cmd)
	}
	writeJSON(w, map[string]any{"ok": true, "sent": sent})
}

func (a *app) handleLogs(w http.ResponseWriter, r *http.Request) {
	device := r.URL.Query().Get("device")
	limit, err := strconv.Atoi(r.URL.Query().Get("limit"))
	if err != nil || limit <= 0 {
		limit = 200
	}
	writeJSON(w, map[string]any{"device": device, "lines": a.hub.Logs.Get(device, limit)})
}

func handleLogsPage(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write(logsPage)
}

// auth mewajibkan LOG_TOKEN (header X-Log-Token, Authorization: Bearer, atau ?token=) bila diset.
func (a *app) auth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if a.token == "" || r.Method == http.MethodOptions {
			next(w, r)
			return
		}
		got := r.Header.Get("X-Log-Token")
		if got == "" {
			got = strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		}
		if got == "" {
			got = r.URL.Query().Get("token")
		}
		if subtle.ConstantTimeCompare([]byte(got), []byte(a.token)) != 1 {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		next(w, r)
	}
}

func handleSpec(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/yaml")
	_, _ = w.Write(openapiSpec)
}

func handleDocs(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write([]byte(`<!doctype html>
<html><head><meta charset="utf-8"><title>Neurosound API</title>
<link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui.css"></head>
<body><div id="swagger-ui"></div>
<script src="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui-bundle.js"></script>
<script>SwaggerUIBundle({url: "/openapi.yaml", dom_id: "#swagger-ui"});</script>
</body></html>`))
}

func (a *app) handleSessions(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/api/v1/sessions" {
		a.handleSessionDetail(w, r)
		return
	}
	items, err := a.store.List(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]any{"sessions": items, "total": len(items)})
}

func (a *app) handleSessionDetail(w http.ResponseWriter, r *http.Request) {
	filename := r.PathValue("filename")
	if filename == "" {
		filename = r.URL.Path[len("/api/v1/sessions/"):]
	}
	doc, err := a.store.Get(r.Context(), filename)
	if err != nil {
		http.Error(w, "session not found", http.StatusNotFound)
		return
	}
	writeJSON(w, doc)
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

func cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-Log-Token, Authorization")
		w.Header().Set("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func defaultPython() string {
	if _, err := os.Stat(".venv/bin/python"); err == nil {
		return ".venv/bin/python"
	}
	return "python3"
}
