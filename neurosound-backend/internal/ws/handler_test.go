package ws

import (
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"neurosound-backend/internal/buffer"
	"neurosound-backend/internal/dsp"
	"neurosound-backend/internal/processor"
	"neurosound-backend/internal/sse"
)

func newHubServer(t *testing.T) (*processor.Processor, *Hub, *websocket.Conn) {
	t.Helper()
	proc := processor.New(processor.Config{}, buffer.New(1000), dsp.NewRunner("", ""))
	hub := NewHub(proc, sse.New(), sse.New())
	srv := httptest.NewServer(hub)
	t.Cleanup(srv.Close)

	url := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws?id=test-device"
	conn, _, err := websocket.DefaultDialer.Dial(url, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	t.Cleanup(func() { conn.Close() })
	return proc, hub, conn
}

// waitRaw menunggu sampai processor menerima n frame.
func waitRaw(t *testing.T, proc *processor.Processor, n int) processor.RawResult {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		r := proc.Raw(1000)
		if len(r.Stim) >= n {
			return r
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("processor tidak menerima %d frame", n)
	return processor.RawResult{}
}

func send(t *testing.T, conn *websocket.Conn, msg string) {
	t.Helper()
	if err := conn.WriteMessage(websocket.TextMessage, []byte(msg)); err != nil {
		t.Fatalf("write: %v", err)
	}
}

func TestDeviceRegistered(t *testing.T) {
	proc, hub, conn := newHubServer(t)
	send(t, conn, `{"ch1":1,"ch2":2,"ts":1,"stim":false}`)
	waitRaw(t, proc, 1)
	if d := hub.Devices(); len(d) != 1 || d[0] != "test-device" {
		t.Fatalf("devices = %v", d)
	}
}

func TestFullFormatFrame(t *testing.T) {
	proc, _, conn := newHubServer(t)
	send(t, conn, `{"ch1":100,"ch2":-50,"ts":10,"stim":true}`)
	r := waitRaw(t, proc, 1)
	if !r.Stim[0] || r.Samples[0][0] <= 0 || r.Samples[1][0] >= 0 {
		t.Fatalf("frame salah dibaca: stim=%v ch1=%v ch2=%v", r.Stim[0], r.Samples[0][0], r.Samples[1][0])
	}
}

// Format firmware ads1115: batch [{"t","r","s"}, ...] (WS_BATCH 8).
func TestFirmwareBatchFormat(t *testing.T) {
	proc, _, conn := newHubServer(t)
	send(t, conn, `[{"t":1,"r":10,"s":1},{"t":2,"r":20,"s":0},{"t":3,"r":-30,"s":0}]`)
	r := waitRaw(t, proc, 3)
	if !r.Stim[0] || r.Stim[1] || r.Stim[2] {
		t.Fatalf("stim flags = %v, want [true false false]", r.Stim)
	}
	if r.Samples[0][2] >= 0 {
		t.Fatalf("sampel negatif hilang: %v", r.Samples[0])
	}
}

// Penanda stimulus tidak boleh hilang walaupun nilai ADC kebetulan 0.
func TestFirmwareStimWithZeroSample(t *testing.T) {
	proc, _, conn := newHubServer(t)
	send(t, conn, `[{"t":1,"r":0,"s":1},{"t":2,"r":5,"s":0}]`)
	r := waitRaw(t, proc, 2)
	if !r.Stim[0] {
		t.Fatal("stim=1 dengan r=0 tidak tercatat sebagai stimulus")
	}
}

func TestBadFrameDoesNotKillConnection(t *testing.T) {
	proc, _, conn := newHubServer(t)
	send(t, conn, `{not json`)
	send(t, conn, `{"ch1":7,"ts":1}`)
	waitRaw(t, proc, 1)
}

// Pesan bertipe (log/audio_test) tidak boleh masuk ke processor sebagai sampel 0.
func TestTypedMessagesNotSentToProcessor(t *testing.T) {
	proc, hub, conn := newHubServer(t)
	send(t, conn, `{"type":"audio_test","device":"x","seq":1,"uptime_ms":5000,"on":true,"freq":1000,"level_dbfs":-20,"ch":"L+R"}`)
	send(t, conn, `{"type":"log","device":"x","ts":12770,"lines":["[ 12770 ms] baris 1","baris 2"]}`)
	send(t, conn, `{"ch1":7,"ts":1}`) // penanda: frame EEG sesudahnya tetap diproses

	r := waitRaw(t, proc, 1)
	if len(r.Stim) != 1 {
		t.Fatalf("processor menerima %d frame, want 1 (pesan bertipe ikut masuk)", len(r.Stim))
	}

	var lines []string
	for _, e := range hub.Logs.Get("test-device", 0) {
		lines = append(lines, e.Line)
	}
	if len(lines) != 3 || lines[1] != "[ 12770 ms] baris 1" || lines[2] != "baris 2" {
		t.Fatalf("log = %q, want [connected, baris 1, baris 2]", lines)
	}

	detail := hub.Detail()
	if len(detail) != 1 || !detail[0].Connected || !strings.Contains(string(detail[0].AudioTest), `"freq":1000`) {
		t.Fatalf("detail = %+v", detail)
	}
}

func TestSendToUnknownDevice(t *testing.T) {
	_, hub, conn := newHubServer(t)
	send(t, conn, `{"type":"hello"}`)
	deadline := time.Now().Add(2 * time.Second)
	for len(hub.Devices()) == 0 && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if n := hub.SendTo("tidak-ada", []byte(`{}`)); n != 0 {
		t.Fatalf("SendTo device tak dikenal = %d, want 0", n)
	}
	if n := hub.SendTo("test-device", []byte(`{"type":"command","cmd":"net"}`)); n != 1 {
		t.Fatalf("SendTo test-device = %d, want 1", n)
	}
	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, msg, err := conn.ReadMessage()
	if err != nil || string(msg) != `{"type":"command","cmd":"net"}` {
		t.Fatalf("ESP menerima %q, err %v", msg, err)
	}
}
