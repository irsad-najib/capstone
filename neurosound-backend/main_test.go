package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"neurosound-backend/internal/buffer"
	"neurosound-backend/internal/dsp"
	"neurosound-backend/internal/dummy"
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
	a := &app{proc: proc, store: store, abrSSE: sse.New(), rawSSE: sse.New(), start: time.Now(), stim: stimState{DB: defaultStimDB}}
	a.hub = ws.NewHub(proc, a.abrSSE, a.rawSSE)
	a.dummy = dummy.New(proc)
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
		"/api/v1/stim/set":   a.handleStimSet,
		"/api/v1/stim/start": a.handleStimStart, "/api/v1/stim/stop": a.handleStimStop,
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

func callBody(t *testing.T, h http.HandlerFunc, method, path, body string, out any) int {
	t.Helper()
	rec := httptest.NewRecorder()
	h(rec, httptest.NewRequest(method, path, strings.NewReader(body)))
	if out != nil && rec.Code == http.StatusOK {
		if err := json.Unmarshal(rec.Body.Bytes(), out); err != nil {
			t.Fatalf("%s %s: body bukan JSON: %s", method, path, rec.Body.String())
		}
	}
	return rec.Code
}

func TestHealthReportsMongoAndUptime(t *testing.T) {
	a := newTestApp(t)
	var body map[string]any
	call(t, a.handleHealth, "GET", "/api/v1/health", &body)
	if body["mongo"] != false {
		t.Errorf("mongo = %v, want false (store tanpa MONGO_URI)", body["mongo"])
	}
	if _, ok := body["uptime_s"]; !ok {
		t.Error("uptime_s tidak ada")
	}
}

func TestStimStartStopState(t *testing.T) {
	a := newTestApp(t)
	var st struct {
		Running   bool   `json:"running"`
		DB        int    `json:"db"`
		StartedAt string `json:"started_at"`
	}
	call(t, a.handleStim, "GET", "/api/v1/stim", &st)
	if st.Running || st.DB != defaultStimDB {
		t.Fatalf("awal: %+v", st)
	}
	call(t, a.handleStimStart, "POST", "/api/v1/stim/start", nil)
	call(t, a.handleStim, "GET", "/api/v1/stim", &st)
	if !st.Running || st.StartedAt == "" {
		t.Fatalf("setelah start: %+v", st)
	}
	if code := callBody(t, a.handleStimSet, "POST", "/api/v1/stim/set", `{"db":60}`, nil); code != 200 {
		t.Fatalf("stim/set = %d", code)
	}
	call(t, a.handleStimStop, "POST", "/api/v1/stim/stop", nil)
	call(t, a.handleStim, "GET", "/api/v1/stim", &st)
	if st.Running || st.DB != 60 || st.StartedAt != "" {
		t.Fatalf("setelah stop: %+v", st)
	}
}

func TestStimSetRejectsBadBody(t *testing.T) {
	a := newTestApp(t)
	for _, body := range []string{"", "bukan json", `{"db":500}`} {
		if code := callBody(t, a.handleStimSet, "POST", "/api/v1/stim/set", body, nil); code != http.StatusBadRequest {
			t.Errorf("body %q = %d, want 400", body, code)
		}
	}
}

func TestSaveStoresMetadata(t *testing.T) {
	a := newTestApp(t)
	var saved struct {
		File string `json:"file"`
	}
	body := `{"ear":"right","device":"esp32-abr-001","stim_db":70,"note":"tes"}`
	if code := callBody(t, a.handleSave, "POST", "/api/v1/abr/save", body, &saved); code != 200 {
		t.Fatalf("save = %d", code)
	}
	var doc session.Document
	call(t, a.handleSessionDetail, "GET", "/api/v1/sessions/"+saved.File, &doc)
	if doc.Ear != "right" || doc.Device != "esp32-abr-001" || doc.StimDB != 70 || doc.Note != "tes" || doc.PreStimMs != processor.PreStimMs {
		t.Fatalf("metadata tidak tersimpan: %+v", doc)
	}
	if code := callBody(t, a.handleSave, "POST", "/api/v1/abr/save", `{"ear":"kiri"}`, nil); code != http.StatusBadRequest {
		t.Errorf("ear tidak valid = %d, want 400", code)
	}
}

func TestDummyStartStop(t *testing.T) {
	a := newTestApp(t)
	var st dummy.Status
	if code := callBody(t, a.handleDummyStart, "POST", "/api/v1/dummy/start", `{"noise_uv":2}`, &st); code != 200 || !st.Running {
		t.Fatalf("start: %d %+v", code, st)
	}
	if code := callBody(t, a.handleDummyStart, "POST", "/api/v1/dummy/start", "", nil); code != http.StatusConflict {
		t.Errorf("start kedua = %d, want 409", code)
	}
	time.Sleep(60 * time.Millisecond)
	call(t, a.handleDummyStop, "POST", "/api/v1/dummy/stop", &st)
	if st.Running || st.Frames == 0 {
		t.Fatalf("setelah stop: %+v", st)
	}
	if got := a.proc.Result().FrameCount; got != st.Frames {
		t.Errorf("processor frame_count = %d, generator frames = %d", got, st.Frames)
	}
}
