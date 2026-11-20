p = "index.html"
s = open(p).read()
R = [
    ('    <div id="uiwrap">', '    <div id="uirise" style="position:absolute;inset:0"><div id="uiwrap">'),
    ('      <div class="ring" id="rg2" style="left:780px;top:164px;width:210px;height:62px;opacity:0"></div>\n    </div>',
     '      <div class="ring" id="rg2" style="left:780px;top:164px;width:210px;height:62px;opacity:0"></div>\n    </div></div>'),
    ("tl.set(['#uiwrap','#chip','#prompt'],{opacity:0},0);", "tl.set(['#uirise','#chip','#prompt'],{opacity:0},0);"),
    ("tl.fromTo('#uiwrap',{opacity:0,y:260},{opacity:1,y:0,", "tl.fromTo('#uirise',{opacity:0,y:260},{opacity:1,y:0,"),
]
for a, b in R:
    assert a in s, a[:50]
    s = s.replace(a, b)
open(p, "w").write(s)
print("ok")
