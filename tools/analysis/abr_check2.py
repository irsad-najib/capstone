import numpy as np
import sys
base=sys.argv[1] if len(sys.argv)>1 else "recordings/abr_80nom_L_01"
x=np.loadtxt(base+".csv",delimiter=",",skiprows=1,usecols=2)
on=np.loadtxt(base+"_stim.csv",delimiter=",",skiprows=1,usecols=0).astype(int)
fs=np.median(np.diff(on))/0.090; n=len(x)
print("fs efektif %.0f Hz, sampel %d, onset %d"%(fs,n,len(on)))
X=np.fft.rfft(x-x.mean()); f=np.fft.rfftfreq(n,1/fs)
def run(label, notch):
    Y=X.copy(); Y[(f<100)|(f>3000)]=0
    if notch:
        for h in np.arange(50,3001,50): Y[np.abs(f-h)<2.0]=0       # sisir 50 Hz, lebar ±2 Hz
    y=np.fft.irfft(Y,n)
    pre=int(0.010*fs); post=int(0.050*fs); L=pre+post
    ok=on[(on-pre>=0)&(on+post<n)]; ep=np.asarray([y[i-pre:i+post] for i in ok])
    pp=np.abs(ep).max(axis=1); E=ep[pp<1.5*np.median(pp)]
    t=(np.arange(L)-pre)/fs*1000
    def stats(E,lo,hi):
        m=(t>=lo)&(t<hi); A=E[0::2].mean(0)[m]; B=E[1::2].mean(0)[m]
        s=(A+B)/2; nn=(A-B)/2; ps=(s**2).sum(); pn=(nn**2).sum()
        return 10*np.log10(max((ps-pn)/pn,0.01)), np.corrcoef(A,B)[0,1]
    rng=np.random.default_rng(7); R={"post":[], "pre":[]}; S={"post":[], "pre":[]}
    for _ in range(300):
        Ek=E[np.sort(rng.choice(len(E),597,replace=False))]
        for nm,(lo,hi) in (("post",(1,10)),("pre",(-10,-1))):
            s_,r_=stats(Ek,lo,hi); S[nm].append(s_); R[nm].append(r_)
    avg=E.mean(0); rm=lambda lo,hi: np.sqrt(np.mean(avg[(t>=lo)&(t<hi)]**2))
    sp=np.abs(np.fft.rfft(avg[pre:pre+int(.05*fs)]*np.hanning(len(avg[pre:pre+int(.05*fs)]))))/len(avg[pre:pre+int(.05*fs)])*4
    print("\n[%s]  epoch diterima %d"%(label,len(E)))
    print("  rms rata-rata: pra %.1f µV | pasca 1-10 ms %.1f µV | rms epoch tunggal median %.0f µV"%(rm(-10,0),rm(1,10),np.median(np.sqrt((E**2).mean(1)))))
    for nm in ("post","pre"):
        print("  %-4s r median %.2f (r>=0.4 pada %3.0f%% undian) | SNR median %.1f dB"%(nm,np.median(R[nm]),100*np.mean(np.array(R[nm])>=0.4),np.median(S[nm])))
run("tanpa notch (baseline)", False)
run("dengan sisir notch 50 Hz", True)
