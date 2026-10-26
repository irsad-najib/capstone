import os
import sys; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sexp import parse, unq
def find(e,tag): return [c for c in e if isinstance(c,list) and c[0]==tag]
def load(p=os.environ.get('NET','eeg_v1.net')):
    t=parse(open(p).read())[0]
    nets={}
    for blk in find(t,'nets'):
        for n in find(blk,'net'):
            name=unq(find(n,'name')[0][1])
            nets[name]=[(unq(find(nd,'ref')[0][1]),unq(find(nd,'pin')[0][1])) for nd in find(n,'node')]
    return nets
if __name__=='__main__':
    nets=load()
    for k in sorted(nets):
        if k.startswith('unconnected'): continue
        v=nets[k]
        print(f'{len(v):3}  {k:30} {v if len(v)<8 else v[:7]}')
