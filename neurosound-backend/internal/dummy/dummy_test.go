package dummy

import (
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
