package buffer

import "testing"

func pushN(r *RingBuffer, n int) {
	for i := 0; i < n; i++ {
		r.Push(Frame{Ch1: float64(i)})
	}
}

func TestPushAssignsSequentialSeq(t *testing.T) {
	r := New(4)
	for i := int64(0); i < 6; i++ {
		if got := r.Push(Frame{}).Seq; got != i {
			t.Fatalf("push %d: seq = %d", i, got)
		}
	}
}

func TestGetLastBeforeAndAfterWrap(t *testing.T) {
	r := New(5)
	pushN(r, 3)
	got := r.GetLast(10)
	if len(got) != 3 || got[0].Ch1 != 0 || got[2].Ch1 != 2 {
		t.Fatalf("before wrap: %+v", got)
	}

	pushN(r, 4) // total 7 frames, buffer keeps the last 5 (seq 2..6)
	got = r.GetLast(5)
	for i, f := range got {
		if f.Seq != int64(i+2) {
			t.Fatalf("after wrap: index %d has seq %d, want %d", i, f.Seq, i+2)
		}
	}
}

func TestGetRange(t *testing.T) {
	r := New(8)
	pushN(r, 12) // seq 4..11 retained

	frames, ok := r.GetRange(6, 4)
	if !ok || len(frames) != 4 || frames[0].Seq != 6 || frames[3].Seq != 9 {
		t.Fatalf("GetRange(6,4) = %+v, %v", frames, ok)
	}
	if _, ok := r.GetRange(2, 4); ok {
		t.Fatal("range already overwritten must fail")
	}
	if _, ok := r.GetRange(10, 4); ok {
		t.Fatal("range extending past newest frame must fail")
	}
}

func TestClearResetsSequence(t *testing.T) {
	r := New(4)
	pushN(r, 6)
	r.Clear()
	if got := r.GetLast(4); len(got) != 0 {
		t.Fatalf("after clear GetLast = %d frames", len(got))
	}
	if seq := r.Push(Frame{}).Seq; seq != 0 {
		t.Fatalf("seq after clear = %d, want 0", seq)
	}
}
