import re
def parse(s):
    toks=re.findall(r'\(|\)|"(?:[^"\\]|\\.)*"|[^\s()]+',s)
    def rd(i):
        out=[]
        while i<len(toks):
            t=toks[i]
            if t=='(':
                sub,i=rd(i+1); out.append(sub)
            elif t==')':
                return out,i+1
            else:
                out.append(t); i+=1   # keep raw token, quotes included
        return out,i
    res,_=rd(0)
    return res

def unq(t):
    if isinstance(t,str) and len(t)>=2 and t[0]=='"' and t[-1]=='"':
        return t[1:-1].replace('\\"','"').replace('\\\\','\\')
    return t
