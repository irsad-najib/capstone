package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"time"

	"neurosound-backend/internal/buffer"
	"neurosound-backend/internal/dsp"
	"neurosound-backend/internal/processor"
	"neurosound-backend/internal/session"
	"neurosound-backend/internal/sse"
	"neurosound-backend/internal/ws"
)

type app struct {
	proc   *processor.Processor
	store  *session.Store
	hub    *ws.Hub
	abrSSE *sse.Broadcaster
	rawSSE *sse.Broadcaster
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

	a := &app{proc: proc, store: store, abrSSE: abrSSE, rawSSE: rawSSE}
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
	mux.HandleFunc("/api/v1/broadcast", a.handleBroadcast)
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
	writeJSON(w, map[string]any{"devices": a.hub.Devices()})
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
	writeJSON(w, map[string]any{"ok": true, "db": body.DB})
}

func (a *app) handleBroadcast(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var body struct {
		Msg string `json:"msg"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	writeJSON(w, map[string]any{"ok": true, "msg": body.Msg})
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
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
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
