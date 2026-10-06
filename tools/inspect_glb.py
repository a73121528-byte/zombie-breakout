import json,struct,sys,os,re
def load(p):
    b=open(p,'rb').read()
    assert b[:4]==b'glTF',p
    l=struct.unpack('<I',b[12:16])[0]
    j=json.loads(b[20:20+l]); binoff=20+l+8
    return j,b,binoff
def acc_max(j,b,binoff,ai):
    a=j['accessors'][ai]; 
    if 'max' in a: return a['max'][0]
    return None
def info(p,full=True):
    j,b,o=load(p)
    print('=== %s  %.1f KB'%(os.path.basename(p),os.path.getsize(p)/1024))
    print(' extensionsUsed:',j.get('extensionsUsed'))
    ms=j.get('meshes',[])
    tris=0
    for m in ms:
        for pr in m['primitives']:
            if 'indices' in pr: tris+=j['accessors'][pr['indices']]['count']//3
    print(' meshes:',len(ms),[m.get('name') for m in ms][:12],'tris~',tris)
    print(' materials:',[ (m.get('name'), m.get('pbrMetallicRoughness',{}).get('baseColorFactor'), 'tex' if 'baseColorTexture' in m.get('pbrMetallicRoughness',{}) else '') for m in j.get('materials',[])])
    print(' textures:',len(j.get('textures',[])),'images:',[ (i.get('mimeType'),j['bufferViews'][i['bufferView']]['byteLength'] if 'bufferView' in i else i.get('uri')) for i in j.get('images',[])])
    for s in j.get('skins',[]):
        names=[j['nodes'][n].get('name','') for n in s['joints']]
        print(' skin joints(%d):'%len(names), names if full else [n for n in names if re.search('hand|head|spine|neck|hips|wrist',n,re.I)])
    for a in j.get('animations',[]):
        t=max(acc_max(j,b,o,s['input']) or 0 for s in a['samplers'])
        print('  anim %-40s %.2fs ch=%d'%(a.get('name'),t,len(a['channels'])))
for p in sys.argv[1:]:
    info(p, full=os.environ.get('FULL')=='1')
