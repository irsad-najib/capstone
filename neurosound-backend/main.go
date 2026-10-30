package main

import (
	"context"
	"crypto/subtle"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"neurosound-backend/internal/buffer"
	"neurosound-backend/internal/dsp"
	"neurosound-backend/internal/dummy"
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
	dummy  *dummy.Generator
	abrSSE *sse.Broadcaster
	rawSSE *sse.Broadcaster
	token  string // LOG_TOKEN; kosong = /logs dan perintah ke device terbuka
	start  time.Time

	stimMu sync.Mutex
	stim   stimState
}

// stimState = status stimulus terakhir yang diminta dashboard (backend tidak
// mendapat konfirmasi dari firmware, jadi ini status perintah, bukan status hardware).
type stimState struct {
	Running   bool   `json:"running"`
	DB        int    `json:"db"`
	StartedAt string `json:"started_at,omitempty"`
}

const defaultStimDB = 80

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

	a := &app{proc: proc, store: store, abrSSE: abrSSE, rawSSE: rawSSE, token: os.Getenv("LOG_TOKEN"),
		start: time.Now(), stim: stimState{DB: defaultStimDB}}
	a.hub = ws.NewHub(proc, abrSSE, rawSSE)
	a.dummy = dummy.New(proc)
	a.hub.Mute = func() bool { return a.dummy.Status().Running }
	// Rekaman dummy: MongoDB (GridFS) dulu, folder DUMMY_DIR sebagai cadangan.
	lib := dummy.NewLibrary(getenv("DUMMY_DIR", "../../abr/dummy"), pythonPath, getenv("DUMMY_SCRIPT", "dsp/dummy_npz.py"))
	if db := store.Database(); db != nil {
		if m, err := dummy.NewMongo(db); err != nil {
			log.Printf("[dummy] gridfs: %v", err)
		} else {
			lib.Store = m
		}
	}
	if lib.Dir != "" || lib.Store != nil {
		a.dummy.WithLibrary(lib)
	}

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
	mux.HandleFunc("/api/v1/stim/start", a.handleStimStart)
	mux.HandleFunc("/api/v1/stim/stop", a.handleStimStop)
	mux.HandleFunc("/api/v1/broadcast", a.auth(a.handleBroadcast))
	mux.HandleFunc("/api/v1/command", a.auth(a.handleCommand))
	mux.HandleFunc("/api/v1/dummy", a.auth(a.handleDummy))
	mux.HandleFunc("/api/v1/dummy/sources", a.auth(a.handleDummySources))
	mux.HandleFunc("/api/v1/dummy/start", a.auth(a.handleDummyStart))
	mux.HandleFunc("/api/v1/dummy/upload", a.auth(a.handleDummyUpload))
	mux.HandleFunc("/api/v1/dummy/stop", a.auth(a.handleDummyStop))
	mux.HandleFunc("/api/v1/dummy/speed", a.auth(a.handleDummySpeed))
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
		"status":   "ok",
		"time":     time.Now().Format(time.RFC3339),
		"uptime_s": int(time.Since(a.start).Seconds()),
		"mongo":    a.store.MongoEnabled(),
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
	// Body opsional: {"ear":"left","device":"esp32-abr-001","stim_db":80,"note":"..."}
	var meta struct {
		Ear    string `json:"ear"`
		Device string `json:"device"`
		StimDB int    `json:"stim_db"`
		Note   string `json:"note"`
	}
	_ = json.NewDecoder(r.Body).Decode(&meta)
	if meta.Ear != "" && meta.Ear != "left" && meta.Ear != "right" {
		http.Error(w, `ear harus "left" atau "right"`, http.StatusBadRequest)
		return
	}
	filename := processor.FilenameNow()
	doc := a.proc.SessionDocument(filename)
	doc.Ear, doc.Device, doc.Note = meta.Ear, meta.Device, meta.Note
	doc.StimDB = meta.StimDB
	if doc.StimDB == 0 {
		a.stimMu.Lock()
		doc.StimDB = a.stim.DB
		a.stimMu.Unlock()
	}
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

// handleStim: GET = status stimulus, POST = jumlah trial (perilaku lama).
func (a *app) handleStim(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		a.stimMu.Lock()
		st := a.stim
		a.stimMu.Unlock()
		res := a.proc.Result()
		writeJSON(w, map[string]any{"running": st.Running, "db": st.DB, "started_at": st.StartedAt,
			"stim_count": res.StimCount, "trials": res.TrialCount})
	case http.MethodPost:
		writeJSON(w, map[string]any{"ok": true, "trials": a.proc.Result().TrialCount})
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

// handleStimStart / handleStimStop mengirim "on"/"off" ke semua device
// (perintah konsol firmware) lewat {"type":"command","cmd":...}.
func (a *app) handleStimStart(w http.ResponseWriter, r *http.Request) { a.setStimRunning(w, r, true) }
func (a *app) handleStimStop(w http.ResponseWriter, r *http.Request)  { a.setStimRunning(w, r, false) }

func (a *app) setStimRunning(w http.ResponseWriter, r *http.Request, running bool) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	cmd := "off"
	if running {
		cmd = "on"
	}
	out, _ := json.Marshal(map[string]string{"type": "command", "cmd": cmd})
	sent := a.hub.Send(out)
	a.stimMu.Lock()
	a.stim.Running = running
	if running {
		a.stim.StartedAt = time.Now().Format(time.RFC3339)
	} else {
		a.stim.StartedAt = ""
	}
	st := a.stim
	a.stimMu.Unlock()
	writeJSON(w, map[string]any{"ok": true, "sent": sent, "running": st.Running, "db": st.DB, "started_at": st.StartedAt})
}

func (a *app) handleStimSet(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var body struct {
		DB int `json:"db"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.DB < 0 || body.DB > 120 {
		http.Error(w, `body harus {"db": 0..120}`, http.StatusBadRequest)
		return
	}
	a.stimMu.Lock()
	a.stim.DB = body.DB
	a.stimMu.Unlock()
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

func (a *app) handleDummy(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, a.dummy.Status())
}

// handleDummySources: daftar sumber dummy, "synthetic" + rekaman .npz di DUMMY_DIR.
func (a *app) handleDummySources(w http.ResponseWriter, r *http.Request) {
	out := map[string]any{"sources": []string{dummy.SourceSynthetic}, "recordings": []dummy.Recording{}}
	if lib := a.dummy.Library(); lib != nil {
		c, err := lib.Catalog(r.Context())
		if err != nil {
			out["error"] = err.Error()
		} else {
			out["dir"], out["threshold_db"], out["recordings"] = c.Dir, c.ThresholdDB, c.Recordings
		}
	}
	writeJSON(w, out)
}

// handleDummyUpload: POST multipart, field "file" (boleh banyak): rekaman .npz
// dan/atau ground_truth.json, disimpan ke MongoDB GridFS.
func (a *app) handleDummyUpload(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	lib := a.dummy.Library()
	if lib == nil || lib.Store == nil {
		writeJSONStatus(w, http.StatusBadRequest, map[string]string{"error": dummy.ErrNoStore.Error()})
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 4*dummy.MaxFileSize)
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		writeJSONStatus(w, http.StatusBadRequest, map[string]string{"error": "multipart: " + err.Error()})
		return
	}
	defer r.MultipartForm.RemoveAll()

	uploaded := []map[string]any{}
	failed := map[string]string{}
	for _, fh := range r.MultipartForm.File["file"] {
		data, err := readPart(fh)
		if err == nil {
			var rec *dummy.Recording
			if rec, err = lib.Upload(r.Context(), fh.Filename, data); err == nil {
				item := map[string]any{"file": fh.Filename, "size": len(data)}
				if rec != nil {
					item["level_db"], item["sweeps"] = rec.LevelDB, rec.Sweeps
				}
				uploaded = append(uploaded, item)
				continue
			}
		}
		failed[fh.Filename] = err.Error()
	}
	status := http.StatusOK
	if len(uploaded) == 0 {
		status = http.StatusBadRequest
	}
	writeJSONStatus(w, status, map[string]any{"ok": len(failed) == 0, "uploaded": uploaded, "errors": failed})
}

func readPart(fh *multipart.FileHeader) ([]byte, error) {
	if fh.Size > dummy.MaxFileSize {
		return nil, fmt.Errorf("file > %d MB", dummy.MaxFileSize>>20)
	}
	f, err := fh.Open()
	if err != nil {
		return nil, err
	}
	defer f.Close()
	return io.ReadAll(f)
}

// handleDummyStart: POST {"source":"synthetic","stims":600,"noise_uv":4,"mains_uv":1.5,"no_response":false,"reset":true}
// (semua field opsional; stims 0 = jalan terus sampai /dummy/stop). source boleh
// nama file .npz dari /api/v1/dummy/sources untuk replay rekaman.
func (a *app) handleDummyStart(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	opt := dummy.Options{MainsUV: 1.5, Reset: true}
	if r.ContentLength != 0 {
		if err := json.NewDecoder(r.Body).Decode(&opt); err != nil {
			http.Error(w, "body bukan JSON: "+err.Error(), http.StatusBadRequest)
			return
		}
	}
	if err := a.dummy.Start(opt); err != nil {
		code := http.StatusInternalServerError
		switch {
		case errors.Is(err, dummy.ErrRunning):
			code = http.StatusConflict
		case errors.Is(err, dummy.ErrUnknownFile):
			code = http.StatusNotFound
		case errors.Is(err, dummy.ErrNoLibrary):
			code = http.StatusBadRequest
		}
		http.Error(w, err.Error(), code)
		return
	}
	writeJSON(w, a.dummy.Status())
}

func (a *app) handleDummyStop(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	a.dummy.Stop()
	writeJSON(w, a.dummy.Status())
}

// handleDummySpeed: POST {"speed": 1..20}, bisa diubah saat dummy berjalan.
func (a *app) handleDummySpeed(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var body struct {
		Speed float64 `json:"speed"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Speed <= 0 {
		http.Error(w, `body harus {"speed": 1..20}`, http.StatusBadRequest)
		return
	}
	a.dummy.SetSpeed(body.Speed)
	writeJSON(w, a.dummy.Status())
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

func writeJSONStatus(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
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
