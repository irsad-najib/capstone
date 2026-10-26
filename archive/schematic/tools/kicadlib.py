import os
import functools, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sexp import parse, unq
L='/Applications/KiCad/KiCad.app/Contents/SharedSupport/symbols/'

@functools.lru_cache(maxsize=None)
def libtree(lib): return parse(open(L+lib+'.kicad_sym',encoding='utf8').read())[0]

def getsym(lib,name):
    for e in libtree(lib)[1:]:
        if isinstance(e,list) and e[0]=='symbol' and unq(e[1])==name: return e
    raise KeyError(f'{lib}:{name}')

def base(lib,name):
    """resolve extends -> returns symbol element that owns the graphics/pins"""
    s=getsym(lib,name)
    ext=[x for x in s if isinstance(x,list) and x[0]=='extends']
    if ext: return base(lib,unq(ext[0][1]))
    return s

def pins(lib,name,unit=None):
    out=[]
    root=base(lib,name)
    if unit is not None:
        subs=[c for c in root if isinstance(c,list) and c[0]=='symbol'
              and unq(c[1]).rsplit('_',2)[-2:][0].isdigit()
              and int(unq(c[1]).rsplit('_',2)[-2]) == unit]
    def walk(e):
        if isinstance(e,list):
            if e and e[0]=='pin':
                at=[x for x in e if isinstance(x,list) and x[0]=='at'][0]
                nm=unq([x for x in e if isinstance(x,list) and x[0]=='name'][0][1])
                nb=unq([x for x in e if isinstance(x,list) and x[0]=='number'][0][1])
                out.append(dict(num=nb,name=nm,x=float(at[1]),y=float(at[2]),ang=float(at[3])))
            for c in e:
                if isinstance(c,list): walk(c)
    if unit is None:
        walk(root)
    else:
        for sub in subs: walk(sub)
    return out

def pinmap(lib,name):
    d={}
    for p in pins(lib,name):
        d[p['num']]=p
        d.setdefault(p['name'],p)
    return d
