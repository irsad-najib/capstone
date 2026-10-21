package devlog

import (
	"fmt"
	"testing"
	"time"
)

func TestRingWrapsAtCapacity(t *testing.T) {
	s := New()
	for i := 0; i < Capacity+250; i++ {
		s.Add("esp", fmt.Sprintf("line %d", i))
	}
	got := s.Get("esp", 0)
	if len(got) != Capacity {
		t.Fatalf("len = %d, want %d", len(got), Capacity)
	}
	if got[0].Line != "line 250" || got[len(got)-1].Line != fmt.Sprintf("line %d", Capacity+249) {
		t.Fatalf("urutan salah: first=%q last=%q", got[0].Line, got[len(got)-1].Line)
	}
}

func TestGetLimitAndMergeAllDevices(t *testing.T) {
	s := New()
	base := time.Date(2026, 10, 21, 0, 0, 0, 0, time.UTC)
	n := 0
	s.now = func() time.Time { n++; return base.Add(time.Duration(n) * time.Millisecond) }
	s.Add("a", "a1")
	s.Add("b", "b1")
	s.Add("a", "a2")

	all := s.Get("", 0)
	if len(all) != 3 || all[0].Line != "a1" || all[1].Line != "b1" || all[2].Line != "a2" {
		t.Fatalf("gabungan tidak urut waktu: %+v", all)
	}
	if last := s.Get("a", 1); len(last) != 1 || last[0].Line != "a2" {
		t.Fatalf("limit: %+v", last)
	}
	if none := s.Get("x", 10); none == nil || len(none) != 0 {
		t.Fatalf("device tak dikenal harus slice kosong, dapat %v", none)
	}
}
