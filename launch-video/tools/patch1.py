p = "index.html"
s = open(p).read()
R = [
    ("camTo(0.2,6.4,{cx:1000,cy:590,s:1.5,ease:'sine.inOut'});", "camTo(0.2,6.4,{cx:1000,cy:505,s:1.5,ease:'sine.inOut'});"),
    ("const cam={cx:1000,cy:590,s:1.42};", "const cam={cx:1000,cy:505,s:1.42};"),
    ('<div class="bar" style="width:100%;margin-top:6px;height:14px"><i id="pbar"></i></div>',
     '<div class="bar" style="width:100%;margin-top:6px;height:14px"><i id="pbar"></i></div>\n          <div id="log"><div class="ll">→ handshake with bootloader</div><div class="ll">→ erase  ·  write 924 B</div><div class="ll">→ verify read-back</div><div class="ll okl">✓ flash confirmed by desktop app</div></div>'),
    ('.toast{position:absolute;',
     '#log{font-family:"Geist Mono",monospace;font-size:24px;color:#8fb4ff;display:flex;flex-direction:column;gap:14px;margin-top:10px}.ll{opacity:0}.okl{color:#6ff0a0}\n.toast{position:absolute;'),
    ("tl.set('#toast',{opacity:1},18.35);",
     "[16.5,17.0,17.6,18.4].forEach((t,i)=>tl.fromTo($$('.ll')[i],{opacity:0,x:-18},{opacity:1,x:0,duration:.35,ease:'power3.out',immediateRender:false},t));\ntl.set('#toast',{opacity:1},18.35);"),
    ("const $=(s,r=document)=>r.querySelector(s);", "const $=(s,r=document)=>r.querySelector(s);const $$=(s,r=document)=>[...r.querySelectorAll(s)];"),
    ('<audio id="aud" src="sfx.wav" preload="auto"></audio>', '<audio id="aud" src="out/sfx.wav" preload="auto"></audio>'),
]
for a, b in R:
    assert a in s, a[:40]
    s = s.replace(a, b)
open(p, "w").write(s)
print("patched")
