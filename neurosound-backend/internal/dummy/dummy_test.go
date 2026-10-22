package dummy

import (
	"bufio"
	"bytes"
	"context"
	"encoding/binary"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"neurosound-backend/internal/buffer"
	"neurosound-backend/internal/dsp"
	"neurosound-backend/internal/processor"
)

func TestStopsAfterRequestedStims(t *testing.T) {
	proc := processor.New(processor.Config{}, buffer.New(32000), dsp.NewRunner("", ""))
	g := New(proc)
	if err := g.Start(Options{Stims: 2}); err != nil {
		t.Fatal(err)
	}
	if err := g.Start(Options{}); err != ErrRunning {
		t.Fatalf("start kedua: %v, want ErrRunning", err)
	}
	deadline := time.Now().Add(3 * time.Second)
	for g.Status().Running && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	st := g.Status()
	if st.Running || st.Stims != 2 {
		t.Fatalf("status = %+v, want selesai dengan 2 stimulus", st)
	}
	if got := proc.Result().StimCount; got != 2 {
		t.Fatalf("processor stim_count = %d, want 2", got)
	}
	g.Stop() // aman dipanggil setelah selesai sendiri
}

// Replay rekaman: stimulus mengikuti trig_idx rekaman, berhenti setelah limit
// (rekaman diputar ulang kalau limit melebihi jumlah sweep).
func TestReplayStopsAfterRequestedStims(t *testing.T) {
	proc := processor.New(processor.Config{}, buffer.New(32000), dsp.NewRunner("", ""))
	sig := &Signal{UV: make([]float32, 2000), Trig: []int{200, 1200}}
	src := &replay{sig: sig}
	var stims []int
	for i := 0; i < 5000; i++ {
		if _, _, stim := src.next(); stim {
			stims = append(stims, i)
		}
	}
	if want := []int{200, 1200, 2200, 3200, 4200}; fmt.Sprint(stims) != fmt.Sprint(want) {
		t.Fatalf("stimulus di %v, want %v (replay harus berulang)", stims, want)
	}

	g := New(proc)
	g.mu.Lock()
	g.status.Running = true
	g.mu.Unlock()
	done := make(chan struct{})
	go g.run(Options{Stims: 3}, &replay{sig: sig}, make(chan struct{}), done)
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("replay tidak berhenti")
	}
	if st := g.Status(); st.Stims != 3 || proc.Result().StimCount != 3 {
		t.Fatalf("stims = %d, processor = %d, want 3", st.Stims, proc.Result().StimCount)
	}
}

func TestParseSignal(t *testing.T) {
	var b bytes.Buffer
	b.WriteString(fmt.Sprintf(`{"fs":%d,"n":3,"trig":[1]}`+"\n", processor.Fs))
	for _, v := range []float32{1.5, -2, 0.25} {
		_ = binary.Write(&b, binary.LittleEndian, v)
	}
	sig, err := parseSignal(bufio.NewReader(&b))
	if err != nil || len(sig.UV) != 3 || sig.UV[1] != -2 || sig.Trig[0] != 1 {
		t.Fatalf("sig = %+v, err %v", sig, err)
	}
	if _, err := parseSignal(bufio.NewReader(strings.NewReader(`{"fs":20000,"n":0}` + "\n"))); err == nil {
		t.Fatal("fs salah harus ditolak")
	}
}

// Rekaman asli di repo (abr/dummy): dibaca lewat dsp/dummy_npz.py kalau Python + numpy ada.
func TestLibraryRealRecordings(t *testing.T) {
	py := "../../.venv/bin/python"
	dir := "../../../../abr/dummy"
	if _, err := os.Stat(py); err != nil {
		py = "python3"
	}
	if _, err := os.Stat(dir + "/ground_truth.json"); err != nil {
		t.Skip("abr/dummy tidak ada")
	}
	lib := NewLibrary(dir, py, "../../dsp/dummy_npz.py")
	c, err := lib.Catalog(context.Background())
	if err != nil {
		t.Skipf("python/numpy tidak tersedia: %v", err)
	}
	if len(c.Recordings) == 0 {
		t.Fatal("tidak ada rekaman")
	}
	rec := c.Recordings[0]
	sig, _, err := lib.Load(rec.File)
	if err != nil {
		t.Fatal(err)
	}
	if len(sig.Trig) != rec.Sweeps || len(sig.UV) != int(rec.DurationS*processor.Fs+0.5) {
		t.Fatalf("%s: %d trig / %d sampel, want %d / %.0f s", rec.File, len(sig.Trig), len(sig.UV), rec.Sweeps, rec.DurationS)
	}
	if _, _, err := lib.Load("../../go.mod"); err != ErrUnknownFile {
		t.Fatalf("path traversal: err = %v, want ErrUnknownFile", err)
	}
}
