package dsp

import (
	"math"
	"math/cmplx"
)

// SOS adalah satu second-order section IIR filter.
type SOS struct {
	b [3]float64
	a [3]float64 // a[0] selalu 1
	z [2]float64 // state
}

func (s *SOS) Process(x float64) float64 {
	y := s.b[0]*x + s.z[0]
	s.z[0] = s.b[1]*x - s.a[1]*y + s.z[1]
	s.z[1] = s.b[2]*x - s.a[2]*y
	return y
}

func (s *SOS) Reset() { s.z = [2]float64{} }

// ButterBP menghitung 2nd-order Butterworth bandpass sebagai 2 SOS.
// Setara: scipy.signal.butter(2, [low/nyq, high/nyq], btype='band')
func ButterBP(lowHz, highHz, fsHz float64) [2]SOS {
	w1 := 2.0 * math.Tan(math.Pi*lowHz/fsHz)
	w2 := 2.0 * math.Tan(math.Pi*highHz/fsHz)
	bw := w2 - w1
	w0sq := w1 * w2

	// LP prototype pole untuk 2nd-order Butterworth: p = (-1+j)/√2
	lpp := complex(-1.0/math.Sqrt2, 1.0/math.Sqrt2)

	// LP → BP: s² - bw*p*s + w0² = 0
	bwp := complex(bw, 0) * lpp
	disc := bwp*bwp - complex(4*w0sq, 0)
	sq := cmplx.Sqrt(disc)
	bp1 := (bwp + sq) / 2
	bp2 := (bwp - sq) / 2

	makeSOS := func(bp complex128) SOS {
		p1 := -2.0 * real(bp)
		p0 := real(bp * cmplx.Conj(bp))
		a0 := 4 + 2*p1 + p0
		return SOS{
			b: [3]float64{2 * bw / a0, 0, -2 * bw / a0},
			a: [3]float64{1, (-8 + 2*p0) / a0, (4 - 2*p1 + p0) / a0},
		}
	}
	return [2]SOS{makeSOS(bp1), makeSOS(bp2)}
}

// FiltFilt menerapkan zero-phase IIR filter (forward + backward).
// Setara: scipy.signal.filtfilt
func FiltFilt(sections [2]SOS, data []float64) []float64 {
	if len(data) < 6 {
		out := make([]float64, len(data))
		copy(out, data)
		return out
	}
	apply := func(secs [2]SOS, in []float64) []float64 {
		out := make([]float64, len(in))
		for i, x := range in {
			for s := range secs {
				x = secs[s].Process(x)
			}
			out[i] = x
		}
		return out
	}

	for i := range sections {
		sections[i].Reset()
	}
	fwd := apply(sections, data)

	rev := make([]float64, len(fwd))
	for i, v := range fwd {
		rev[len(fwd)-1-i] = v
	}
	for i := range sections {
		sections[i].Reset()
	}
	bwd := apply(sections, rev)

	out := make([]float64, len(bwd))
	for i, v := range bwd {
		out[len(bwd)-1-i] = v
	}
	return out
}

// SafeBandpass bandpass filter dengan guard untuk data terlalu pendek.
func SafeBandpass(data []float64, lowHz, highHz, fsHz float64) []float64 {
	nyq := 0.5 * fsHz
	if highHz > nyq*0.95 {
		highHz = nyq * 0.95
	}
	if lowHz < 0.5 {
		lowHz = 0.5
	}
	if lowHz >= highHz || len(data) < 12 {
		out := make([]float64, len(data))
		copy(out, data)
		return out
	}
	return FiltFilt(ButterBP(lowHz, highHz, fsHz), data)
}

// PearsonR menghitung korelasi Pearson antara dua slice.
func PearsonR(x, y []float64) float64 {
	n := len(x)
	if n != len(y) || n < 2 {
		return 0
	}
	var mx, my float64
	for i := range x {
		mx += x[i]
		my += y[i]
	}
	mx /= float64(n)
	my /= float64(n)
	var num, dx2, dy2 float64
	for i := range x {
		dx, dy := x[i]-mx, y[i]-my
		num += dx * dy
		dx2 += dx * dx
		dy2 += dy * dy
	}
	if d := math.Sqrt(dx2 * dy2); d != 0 {
		return num / d
	}
	return 0
}

// Linspace membuat n titik dari start ke stop (inklusif).
func Linspace(start, stop float64, n int) []float64 {
	out := make([]float64, n)
	if n == 1 {
		out[0] = start
		return out
	}
	step := (stop - start) / float64(n-1)
	for i := range out {
		out[i] = start + float64(i)*step
	}
	return out
}

// ResampleLinear mengubah ukuran slice ke n titik dengan interpolasi linear.
func ResampleLinear(in []float64, n int) []float64 {
	if len(in) == n {
		out := make([]float64, n)
		copy(out, in)
		return out
	}
	out := make([]float64, n)
	for i := range out {
		pos := float64(i) * float64(len(in)-1) / float64(n-1)
		lo := int(pos)
		hi := lo + 1
		if hi >= len(in) {
			out[i] = in[len(in)-1]
			continue
		}
		frac := pos - float64(lo)
		out[i] = in[lo]*(1-frac) + in[hi]*frac
	}
	return out
}
