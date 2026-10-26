"""Core emitter for KiCad 10 .kicad_sch files."""
import os
import uuid as _uuid, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from kicadlib import base, pins, libtree
from sexp import unq
import math, hashlib

def U(seed):
    h = hashlib.md5(seed.encode()).hexdigest()
    return f"{h[0:8]}-{h[8:12]}-{h[12:16]}-{h[16:20]}-{h[20:32]}"

DROP=set()

def _strip(e, drop):
    if not isinstance(e,list): return e
    out=[e[0]]
    for c in e[1:]:
        if isinstance(c,list) and c and c[0] in drop: continue
        out.append(_strip(c,drop) if isinstance(c,list) else c)
    return out

def ser(e, ind=0):
    """serialize nested list back to s-expression"""
    pad = '  '*ind
    if not isinstance(e, list):
        return e
    head = e[0]
    parts = []
    # leading scalar atoms stay on the head line (KiCad writes them that way)
    i=1
    lead=[]
    while i < len(e) and not isinstance(e[i], list):
        lead.append(e[i]); i+=1
    rest=[ser(c, ind+1) if isinstance(c, list) else ('  '*(ind+1)+c) for c in e[i:]]
    headline = pad + '(' + head + (' ' + ' '.join(lead) if lead else '')
    if not rest:
        return headline + ')'
    return headline + '\n' + '\n'.join(rest) + '\n' + pad + ')'

def q(s):
    return '"' + str(s).replace('\\','\\\\').replace('"','\\"') + '"'

class Sheet:
    def __init__(self, name, filename, paper="A2", title=""):
        self.name=name; self.filename=filename; self.paper=paper; self.title=title
        self.uuid=U('sheet:'+filename)
        self.libs={}           # lib_id -> symbol element
        self.items=[]          # raw text chunks
        self.instpath=None     # set by project
        self.nsym=0
        self.ref_offset=0

    def need(self, lib_id):
        if lib_id in self.libs: return
        lib,name = lib_id.split(':',1)
        self.libs[lib_id]=(lib,name)

    # ---- geometry ----
    def pin_xy(self, lib_id, X, Y, num, unit=None):
        lib,name = lib_id.split(':',1)
        for p in pins(lib,name,unit):
            if p['num']==num:
                return (X+p['x'], Y-p['y'], p['ang'])
        raise KeyError(f'{lib_id} pin {num}')

    def wire(self, x1,y1,x2,y2):
        u=U(f'w{self.filename}{x1}{y1}{x2}{y2}')
        self.items.append(f'''  (wire
    (pts (xy {x1:g} {y1:g}) (xy {x2:g} {y2:g}))
    (stroke (width 0) (type default))
    (uuid {q(u)})
  )''')

    def label(self, x,y,rot,text,glob=False,seed=''):
        kind='global_label' if glob else 'label'
        u=U(f'l{self.filename}{x}{y}{text}{seed}')
        shape='  (shape input)\n' if glob else ''
        # justify so text runs away from the wire
        just = 'left' if rot in (0,90) else 'right'
        self.items.append(f'''  ({kind} {q(text)}
    (at {x:g} {y:g} {rot:g})
{shape}    (effects (font (size 1.27 1.27)) (justify {just}))
    (uuid {q(u)})
  )''')

    def stub(self, lib_id, X, Y, num, net, glob=False, length=3.81, unit=None):
        px,py,ang = self.pin_xy(lib_id,X,Y,num,unit)
        dx = -math.cos(math.radians(ang)); dy = math.sin(math.radians(ang))
        ex, ey = px+dx*length, py+dy*length
        self.wire(px,py,ex,ey)
        if abs(dx)>0.5:  rot = 0 if dx>0 else 180
        else:            rot = 90 if dy<0 else 270
        self.label(ex,ey,rot,net,glob,seed=f'{lib_id}{X}{Y}{num}')

    def nc(self, lib_id, X, Y, num, unit=None):
        px,py,_=self.pin_xy(lib_id,X,Y,num,unit)
        u=U(f'nc{self.filename}{px}{py}')
        self.items.append(f'  (no_connect (at {px:g} {py:g}) (uuid {q(u)}))')

    def place(self, lib_id, ref, value, X, Y, conns, footprint='', glob_nets=(), dnp=False, fields=None, unit=1, multiunit=False):
        """conns: dict pin_number -> net name (None = no-connect)"""
        X = round(X/1.27)*1.27
        Y = round(Y/1.27)*1.27
        if self.ref_offset:
            import re as _re
            m=_re.match(r'^([A-Za-z#]+)(\d+)$', ref)
            if m: ref = m.group(1) + str(int(m.group(2)) + self.ref_offset)
        self.need(lib_id)
        self.nsym+=1
        u=U(f's{self.filename}{ref}u{unit}')
        lib,name=lib_id.split(':',1)
        props=[('Reference',ref,0,-2.54),('Value',value,0,2.54),('Footprint',footprint,0,5.08),
               ('Datasheet','',0,7.62),('Description','',0,10.16)]
        ptxt=''
        for i,(k,v,ox,oy) in enumerate(props):
            hide=' (hide yes)' if k in ('Footprint','Datasheet','Description') or v=='' else ''
            ptxt+=f'''    (property {q(k)} {q(v)}
      (at {X+ox:g} {Y+oy:g} 0)
      (effects (font (size 1.27 1.27)){hide})
    )\n'''
        if fields:
            for k,v in fields.items():
                ptxt+=f'''    (property {q(k)} {q(v)}
      (at {X:g} {Y+12.7:g} 0)
      (effects (font (size 1.27 1.27)) (hide yes))
    )\n'''
        pintxt=''
        for p in pins(lib,name, unit if multiunit else None):
            pintxt+=f'    (pin {q(p["num"])} (uuid {q(U(u+p["num"]))}))\n'
        dnptxt='    (dnp yes)\n' if dnp else ''
        self.items.append(f'''  (symbol
    (lib_id {q(lib_id)})
    (at {X:g} {Y:g} 0)
    (unit {unit})
    (exclude_from_sim no)
    (in_bom yes)
    (on_board yes)
{dnptxt}    (uuid {q(u)})
{ptxt}{pintxt}    (instances
      (project "eeg_v1"
        (path {q(self.instpath)}
          (reference {q(ref)})
          (unit {unit})
        )
      )
    )
  )''')
        for num,net in conns.items():
            if net is None:
                self.nc(lib_id,X,Y,num,unit if multiunit else None)
            else:
                self.stub(lib_id,X,Y,num,net,glob=(net in glob_nets),unit=(unit if multiunit else None))

    def text(self,x,y,s,size=2.0):
        u=U(f't{self.filename}{x}{y}{s}')
        self.items.append(f'''  (text {q(s)}
    (exclude_from_sim no)
    (at {x:g} {y:g} 0)
    (effects (font (size {size} {size})) (justify left bottom))
    (uuid {q(u)})
  )''')

    def render(self, page, sheet_inst_path):
        libtxt=''
        for lib_id,(lib,name) in sorted(self.libs.items()):
            import copy
            el = copy.deepcopy(base(lib,name))
            parent = unq(el[1])
            el[1] = '"' + lib_id + '"'
            # derived symbols: inner unit sub-symbols must be named <lib_id>_<u>_<s>
            for c in el:
                if isinstance(c,list) and c and c[0]=='symbol':
                    inner = unq(c[1])
                    if inner.startswith(parent+'_'):
                        c[1] = '"' + name + inner[len(parent):] + '"'
            el = _strip(el, DROP)
            # overlay the derived symbol's own properties (value, datasheet, keywords...)
            from kicadlib import getsym
            own = getsym(lib, name)
            if unq(own[1]) != parent:
                ownprops = {unq(c[1]): c for c in own if isinstance(c,list) and c[0]=='property'}
                merged=[]
                for c in el:
                    if isinstance(c,list) and c[0]=='property' and unq(c[1]) in ownprops:
                        merged.append(ownprops.pop(unq(c[1])))
                    else:
                        merged.append(c)
                for k,v in ownprops.items():
                    merged.append(v)
                el = merged
            el = _strip(el, DROP)
            libtxt += ser(el, 2) + '\n'
        return f'''(kicad_sch
  (version 20250114)
  (generator "eeschema")
  (generator_version "10.0")
  (uuid {q(self.uuid)})
  (paper "{self.paper}")
  (title_block
    (title "ESP-EEG v1 rebuild (Cerelog Inc., CC-BY-NC-SA 4.0)")
    (company "")
    (comment 1 "{self.title}")
  )
  (lib_symbols
{libtxt}  )
''' + '\n'.join(self.items) + f'''
  (sheet_instances
    (path "/" (page "{page}"))
  )
  (embedded_fonts no)
)
'''
