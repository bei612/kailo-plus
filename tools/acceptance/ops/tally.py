import json,glob,os,sys
B="/volumes/data/kailo/capacity/acceptance-evidence"
for r in tuple(sys.argv[1:]):
    d=f"{B}/{r}/results"
    print("==",r)
    for f in sorted(glob.glob(d+"/*.json")):
        try: j=json.load(open(f))
        except Exception: continue
        if not isinstance(j,dict) or "checks" not in j: continue
        c=j["checks"]; ok=sum(1 for x in c if x.get("ok"))
        sid=j.get("id",os.path.basename(f)); st=j.get("status"); t=str(j.get("finishedAt") or j.get("endedAt") or j.get("at") or "")[:19]
        print(f"{sid[:24]:24} {st:7} checks {ok}/{len(c)} shots {len(j.get('shots',[]))} {t}")
