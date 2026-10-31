package ws

import (
	"encoding/binary"
	"math"
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

func TestDetailCountsFrames(t *testing.T) {
	proc, hub, conn := newHubServer(t)
	send(t, conn, `[{"t":1,"r":10,"s":1},{"t":2,"r":20,"s":0},{"t":3,"r":-30,"s":0}]`)
	waitRaw(t, proc, 3)
	d := hub.Detail()
	if len(d) != 1 || d[0].Frames != 3 || d[0].LastFrameAt == "" {
		t.Fatalf("detail = %+v, want frames=3 dan last_frame_at terisi", d)
	}
	if r := proc.Result(); r.FrameCount != 3 || r.StimCount != 1 {
		t.Fatalf("frame_count=%d stim_count=%d, want 3 dan 1", r.FrameCount, r.StimCount)
	}
}

// binV2 membangun pesan biner versi 2 (esp-ads1256/) dengan header 24 byte.
func binV2(fs uint16, uv float32, samples ...byte) []byte {
	msg := make([]byte, 24)
	msg[0], msg[1] = 0xEE, 2
	binary.LittleEndian.PutUint16(msg[2:], uint16(len(samples)/7))
	binary.LittleEndian.PutUint64(msg[8:], 1_000_000)
	binary.LittleEndian.PutUint16(msg[16:], fs)
	msg[18], msg[19] = 1, 1
	binary.LittleEndian.PutUint32(msg[20:], math.Float32bits(uv))
	return append(msg, samples...)
}

func TestBinaryFrames(t *testing.T) {
	proc, _, conn := newHubServer(t)
	// 3 sampel: CH1 = 1, -1, 0x7FFFFF; CH2 = 2, -2, -0x800000; onset di sampel kedua.
	const uv = 0.5
	msg := binV2(processor.Fs, uv,
		0, 0x00, 0x00, 0x01, 0x00, 0x00, 0x02,
		1, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFE,
		0, 0x7F, 0xFF, 0xFF, 0x80, 0x00, 0x00,
	)
	if err := conn.WriteMessage(websocket.BinaryMessage, msg); err != nil {
		t.Fatalf("write: %v", err)
	}
	r := waitRaw(t, proc, 3)
	if !r.Stim[1] || r.Stim[0] || r.Stim[2] {
		t.Fatalf("stim = %v", r.Stim)
	}
	want1 := []int32{1, -1, 0x7FFFFF}
	want2 := []int32{2, -2, -0x800000}
	for i := range want1 {
		if r.Samples[0][i] != float64(want1[i])*uv || r.Samples[1][i] != float64(want2[i])*uv {
			t.Fatalf("sampel %d = %v / %v", i, r.Samples[0][i], r.Samples[1][i])
		}
	}
}

func TestParseBinaryTimestamps(t *testing.T) {
	frames, err := parseBinary(binV2(processor.Fs, 1, make([]byte, 3*7)...))
	if err != nil {
		t.Fatal(err)
	}
	if step := frames[1].TS - frames[0].TS; step != 1_000_000/processor.Fs {
		t.Fatalf("selisih waktu sampel %d µs, want %d", step, 1_000_000/processor.Fs)
	}
}

func TestParseBinaryRejectsWrongRate(t *testing.T) {
	// Versi 1 = firmware ADS1299 16 kHz, tidak cocok dengan backend 15 kHz.
	v1 := append([]byte{0xEE, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0}, make([]byte, 7)...)
	if _, err := parseBinary(v1); err == nil {
		t.Fatal("pesan v1 16 kHz harus ditolak")
	}
	if _, err := parseBinary(binV2(16000, 1, make([]byte, 7)...)); err == nil {
		t.Fatal("pesan v2 dengan laju lain harus ditolak")
	}
	if _, err := parseBinary(binV2(processor.Fs, 0, make([]byte, 7)...)); err == nil {
		t.Fatal("µV per LSB 0 harus ditolak")
	}
}

func TestParseBinaryRejectsBadLength(t *testing.T) {
	msg := binV2(processor.Fs, 1, make([]byte, 2*7)...)
	if _, err := parseBinary(msg[:len(msg)-1]); err == nil {
		t.Fatal("pesan terpotong harus ditolak")
	}
}

// binV3 membangun pesan biner versi 3: sampel i24 kanal aktif, lalu daftar onset.
func binV3(samples []int32, onsets ...uint16) []byte {
	msg := binV2(processor.Fs, 0.5)
	msg[1] = 3
	binary.LittleEndian.PutUint16(msg[2:], uint16(len(samples)))
	for _, v := range samples {
		msg = append(msg, byte(v>>16), byte(v>>8), byte(v))
	}
	msg = append(msg, byte(len(onsets)))
	for _, o := range onsets {
		msg = binary.LittleEndian.AppendUint16(msg, o)
	}
	return msg
}

func TestParseBinaryV3(t *testing.T) {
	frames, err := parseBinary(binV3([]int32{1, -1, 0x7FFFFF, -0x800000}, 1, 3))
	if err != nil {
		t.Fatal(err)
	}
	want := []int32{1, -1, 0x7FFFFF, -0x800000}
	for i, f := range frames {
		if f.Ch1 != want[i] || f.Ch2 != 0 || f.UV != 0.5 || f.Stim != (i == 1 || i == 3) {
			t.Fatalf("frame %d = %+v", i, f)
		}
	}
	if frames[1].TS-frames[0].TS != 1_000_000/processor.Fs {
		t.Fatalf("selisih waktu %d µs", frames[1].TS-frames[0].TS)
	}
	bad := binV3([]int32{1, 2}, 5) // onset di luar paket
	if _, err := parseBinary(bad); err == nil {
		t.Fatal("onset di luar paket harus ditolak")
	}
	short := binV3([]int32{1, 2}, 1)
	if _, err := parseBinary(short[:len(short)-1]); err == nil {
		t.Fatal("pesan terpotong harus ditolak")
	}
}
