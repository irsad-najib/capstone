import csv, numpy as np
import sys
base=sys.argv[1] if len(sys.argv)>1 else "recordings/abr_80nom_L_01"
x=np.loadtxt(base+".csv",delimiter=",",skiprows=1,usecols=2)
on=np.loadtxt(base+"_stim.csv",delimiter=",",skiprows=1,usecols=0).astype(int)
d=np.diff(on); d=d[(d>0)]
med=np.median(d); fs=med/0.090            # periode stimulus 90 ms (11.1/s, 18 blok x 5 ms)
print("sampel %d  onset %d  selang onset median %.0f sampel  → fs efektif %.0f Hz (nominal 15000)"%(len(x),len(on),med,fs))
print("selang onset: p5 %.0f p95 %.0f  (≠median = sampel hilang / celah)"%(np.percentile(d,5),np.percentile(d,95)))
# bandpass 100-3000 Hz zero-phase lewat FFT (sinyal utuh)
n=len(x); X=np.fft.rfft(x-np.mean(x)); f=np.fft.rfftfreq(n,1/fs); X[(f<100)|(f>3000)]=0; y=np.fft.irfft(X,n)
pre=int(0.010*fs); post=int(0.050*fs); L=pre+post
ep=[]; ok=on[(on-pre>=0)&(on+post<n)]
for i in ok: ep.append(y[i-pre:i+post])
ep=np.asarray(ep); print("epoch utuh %d, panjang %d sampel (%.1f ms)"%(len(ep),L,1000*L/fs))
pp=np.abs(ep).max(axis=1); thr=1.5*np.median(pp); keep=pp<thr; E=ep[keep]
print("ambang tolak %.0f µV (1.5×median), diterima %d / %d"%(thr,keep.sum(),len(ep)))
def stats(E,tag):
    avg=E.mean(axis=0); t=(np.arange(L)-pre)/fs*1000
    # lantai derau: rata-rata dengan tanda bergantian (+,-,+,-) membatalkan respons terkunci stimulus
    s=np.where(np.arange(len(E))%2==0,1.0,-1.0)[:,None]; pm=(E*s).mean(axis=0)
    r=lambda a,lo,hi: np.sqrt(np.mean(a[(t>=lo)&(t<hi)]**2))
    h1=E[0::2].mean(axis=0); h2=E[1::2].mean(axis=0)
    print("[%s] N=%d  rms rata-rata: pra(-10..0) %.1f | pasca(1..10) %.1f | pasca(10..20) %.1f µV"%(tag,len(E),r(avg,-10,0),r(avg,1,10),r(avg,10,20)))
    print("      lantai derau ± (1..10 ms): %.1f µV   → rasio sinyal/lantai %.2f"%(r(pm,1,10), r(avg,1,10)/r(pm,1,10)))
    print("      korelasi paruh ganjil/genap (1..30 ms): %.3f   (0..10 ms): %.3f"%(np.corrcoef(h1[(t>=1)&(t<30)],h2[(t>=1)&(t<30)])[0,1], np.corrcoef(h1[(t>=0)&(t<10)],h2[(t>=0)&(t<10)])[0,1]))
    i=np.argmax(np.abs(avg)); print("      puncak mutlak %.1f µV pada t=%.2f ms"%(avg[i],t[i]))
    return avg,t
avg,t=stats(E,"diterima")
# potongan pendek tiap 1 ms untuk melihat bentuk (µV)
print("bentuk rata-rata (µV) tiap ~1 ms:", [round(float(avg[int(pre+k*fs/1000)]),1) for k in range(-10,40,2)])
np.save("abr_avg_check.npy",avg)

print("\n=== verifikasi tambahan ===")
fsr=fs
# 1) spektrum rata-rata epoch (0..50 ms)
seg=avg[pre:pre+int(0.050*fsr)]; sp=np.abs(np.fft.rfft(seg*np.hanning(len(seg))))/len(seg)*4; ff=np.fft.rfftfreq(len(seg),1/fsr)
top=[]; 
for i in np.argsort(sp)[::-1]:
    if all(abs(ff[i]-g)>40 for g,_ in top): top.append((round(float(ff[i])),round(float(sp[i]),1)))
    if len(top)==6: break
print("puncak spektrum rata-rata (Hz, µV):", top)
# 2) derau per epoch di pita 100-3000 Hz
rm=np.sqrt((E**2).mean(axis=1)); print("rms per epoch (100-3000 Hz): median %.0f µV, p10 %.0f, p90 %.0f"%(np.median(rm),np.percentile(rm,10),np.percentile(rm,90)))
N=len(E); print("derau residu setelah rata-rata N=%d: %.0f µV  (ABR gelombang V ≈ 0.2-1 µV)"%(N, np.median(rm)/np.sqrt(N)))
for tgt in (0.3,):
    print("trial yang dibutuhkan agar derau acak ≤ %.1f µV: %.1e"%(tgt,(np.median(rm)/tgt)**2))
# 3) jarak stimulus vs dengung listrik
print("periode stimulus 90 ms = %.1f siklus 100 Hz, %.1f siklus 50 Hz"%(0.090*100,0.090*50))

print("\n=== statistik gaya backend (ganjil vs genap) + kontrol pra-stimulus ===")
def backend_stats(E, lo, hi):
    t=(np.arange(L)-pre)/fs*1000; m=(t>=lo)&(t<hi)
    A=E[0::2].mean(axis=0)[m]; B=E[1::2].mean(axis=0)[m]
    s=(A+B)/2; nn=(A-B)/2; ps=(s**2).sum(); pn=(nn**2).sum()
    ratio=max((ps-pn)/pn,0.01); r=np.corrcoef(A,B)[0,1]
    return 10*np.log10(ratio), r
for name,(lo,hi) in {"pasca 1..10 ms (jendela backend)":(1,10),"PRA -10..-1 ms (kontrol)":(-10,-1)}.items():
    snr,r=backend_stats(E,lo,hi); print("%-36s SNR %5.1f dB   r = %.3f"%(name,snr,r))
# ulangi pada subset acak 600 epoch (≈ jumlah trial backend) untuk mengecek kestabilan
rng=np.random.default_rng(1); idx=np.sort(rng.choice(len(E),597,replace=False)); E2=E[idx]
for name,(lo,hi) in {"pasca 1..10 (597 epoch)":(1,10),"PRA -10..-1 (597 epoch)":(-10,-1)}.items():
    snr,r=backend_stats(E2,lo,hi); print("%-36s SNR %5.1f dB   r = %.3f"%(name,snr,r))

print("\n=== 300 undian acak (597 epoch tiap undian) ===")
rs={"post":[], "pre":[]}; ss={"post":[], "pre":[]}
for k in range(300):
    ii=np.sort(rng.choice(len(E),597,replace=False)); Ek=E[ii]
    for nm,(lo,hi) in (("post",(1,10)),("pre",(-10,-1))):
        s_,r_=backend_stats(Ek,lo,hi); ss[nm].append(s_); rs[nm].append(r_)
for nm in ("post","pre"):
    print("%-4s  r: median %.2f  p5 %.2f  p95 %.2f   | SNR: median %.1f dB  p5 %.1f  p95 %.1f   | r>=0.4 pada %.0f%% undian"%(nm,np.median(rs[nm]),np.percentile(rs[nm],5),np.percentile(rs[nm],95),np.median(ss[nm]),np.percentile(ss[nm],5),np.percentile(ss[nm],95),100*np.mean(np.array(rs[nm])>=0.4)))
