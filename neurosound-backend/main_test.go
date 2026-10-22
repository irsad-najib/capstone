package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"neurosound-backend/internal/buffer"
	"neurosound-backend/internal/dsp"
	"neurosound-backend/internal/processor"
	"neurosound-backend/internal/session"
	"neurosound-backend/internal/sse"
	"neurosound-backend/internal/ws"
)

func newTestApp(t *testing.T) *app {
	t.Helper()
	proc := processor.New(processor.Config{}, buffer.New(1000), dsp.NewRunner("", ""))
	store, err := session.NewStore(context.Background(), "", "", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	a := &app{proc: proc, store: store, abrSSE: sse.New(), rawSSE: sse.New()}
	a.hub = ws.NewHub(proc, a.abrSSE, a.rawSSE)
	return a
}

func call(t *testing.T, h http.HandlerFunc, method, path string, out any) int {
	t.Helper()
	rec := httptest.NewRecorder()
	h(rec, httptest.NewRequest(method, path, nil))
	if out != nil && rec.Code == http.StatusOK {
		if err := json.Unmarshal(rec.Body.Bytes(), out); err != nil {
			t.Fatalf("%s %s: body bukan JSON: %s", method, path, rec.Body.String())
		}
	}
	return rec.Code
}

func TestHealth(t *testing.T) {
	a := newTestApp(t)
	var body map[string]any
	if code := call(t, a.handleHealth, "GET", "/api/v1/health", &body); code != 200 || body["status"] != "ok" {
		t.Fatalf("health: %d %v", code, body)
	}
}

func TestABREmptyResult(t *testing.T) {
	a := newTestApp(t)
	var r processor.Result
	call(t, a.handleABR, "GET", "/api/v1/abr", &r)
	if r.TrialCount != 0 || r.SamplingRate != processor.Fs || len(r.ABRAverage) != 2 {
		t.Fatalf("abr kosong: trials=%d fs=%d channels=%d", r.TrialCount, r.SamplingRate, len(r.ABRAverage))
	}
}

func TestPostOnlyEndpoints(t *testing.T) {
	a := newTestApp(t)
	for path, h := range map[string]http.HandlerFunc{
		"/api/v1/reset": a.handleReset, "/api/v1/abr/save": a.handleSave,
		"/api/v1/stim": a.handleStim, "/api/v1/stim/set": a.handleStimSet,
	} {
		if code := call(t, h, "GET", path, nil); code != http.StatusMethodNotAllowed {
			t.Errorf("GET %s = %d, want 405", path, code)
		}
	}
}

func TestSaveListAndGetSession(t *testing.T) {
	a := newTestApp(t)
	var saved struct {
		OK   bool   `json:"ok"`
		File string `json:"file"`
	}
	if code := call(t, a.handleSave, "POST", "/api/v1/abr/save", &saved); code != 200 || !saved.OK {
		t.Fatalf("save: %d %+v", code, saved)
	}

	var list struct {
		Sessions []session.Meta `json:"sessions"`
		Total    int            `json:"total"`
	}
	call(t, a.handleSessions, "GET", "/api/v1/sessions", &list)
	if list.Total != 1 || list.Sessions[0].Filename != saved.File {
		t.Fatalf("sessions = %+v", list)
	}

	var doc session.Document
	if code := call(t, a.handleSessions, "GET", "/api/v1/sessions/"+saved.File, &doc); code != 200 || doc.Filename != saved.File {
		t.Fatalf("detail: %d %+v", code, doc.Filename)
	}
}

func TestSessionDetailRejectsTraversal(t *testing.T) {
	a := newTestApp(t)
	for _, p := range []string{"/api/v1/sessions/../../go.mod", "/api/v1/sessions/eeg_abr_missing.json"} {
		if code := call(t, a.handleSessions, "GET", p, nil); code != http.StatusNotFound {
			t.Errorf("GET %s = %d, want 404", p, code)
		}
	}
}

func TestCORSPreflight(t *testing.T) {
	rec := httptest.NewRecorder()
	cors(http.NotFoundHandler()).ServeHTTP(rec, httptest.NewRequest("OPTIONS", "/api/v1/abr", nil))
	if rec.Code != http.StatusNoContent || rec.Header().Get("Access-Control-Allow-Origin") != "*" {
		t.Fatalf("preflight: %d %v", rec.Code, rec.Header())
	}
}

func post(t *testing.T, h http.HandlerFunc, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	h(rec, httptest.NewRequest("POST", path, strings.NewReader(body)))
	return rec
}

func TestCommandUnknownDevice404(t *testing.T) {
	a := newTestApp(t)
	if rec := post(t, a.handleCommand, "/api/v1/command", `{"device":"esp32-audio-001","cmd":"net"}`); rec.Code != http.StatusNotFound {
		t.Fatalf("device tidak ada = %d, want 404 (%s)", rec.Code, rec.Body.String())
	}
	if rec := post(t, a.handleCommand, "/api/v1/command", `{"device":"x"}`); rec.Code != http.StatusBadRequest {
		t.Fatalf("tanpa cmd = %d, want 400", rec.Code)
	}
	// device kosong = broadcast ke semua; tanpa device terhubung tetap ok dengan sent 0
	rec := post(t, a.handleCommand, "/api/v1/command", `{"cmd":"net"}`)
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"sent":0`) {
		t.Fatalf("broadcast command = %d %s", rec.Code, rec.Body.String())
	}
}

func TestBroadcastAcceptsGetAndPost(t *testing.T) {
	a := newTestApp(t)
	var body map[string]any
	if code := call(t, a.handleBroadcast, "GET", "/api/v1/broadcast?msg=l%20-10", &body); code != 200 || body["msg"] != "l -10" {
		t.Fatalf("GET broadcast: %d %v", code, body)
	}
	if rec := post(t, a.handleBroadcast, "/api/v1/broadcast", `{"msg":"off"}`); rec.Code != 200 {
		t.Fatalf("POST broadcast: %d", rec.Code)
	}
}

func TestLogTokenRequired(t *testing.T) {
	a := newTestApp(t)
	a.token = "rahasia"
	h := a.auth(a.handleLogs)
	if code := call(t, h, "GET", "/api/v1/logs", nil); code != http.StatusUnauthorized {
		t.Fatalf("tanpa token = %d, want 401", code)
	}
	if code := call(t, h, "GET", "/api/v1/logs?token=rahasia", nil); code != 200 {
		t.Fatalf("dengan token = %d, want 200", code)
	}
}
