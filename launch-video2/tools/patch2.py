p = "index.html"
s = open(p).read()
R = [
    # S1: centre vertically; the first block leaves cleanly before the punch
    ('<div class="big" id="s1a" style="left:130px;top:150px;font-size:236px">', '<div class="big" id="s1a" style="left:130px;top:330px;font-size:236px">'),
    ('<div class="big" id="s1b" style="left:130px;top:96px;font-size:236px;display:none">', '<div class="big" id="s1b" style="left:130px;top:190px;font-size:236px;display:none">'),
    ("tl.to('#s1a',{opacity:.12,y:-30,duration:.4,ease:'power2.inOut'},1.55);", "tl.to('#s1a',{opacity:0,y:-50,duration:.18,ease:'power2.in'},1.55);"),
    ("tl.set('#s1b',{display:'block'},1.62);", "tl.set('#s1b',{display:'block'},1.72);"),
    # S3: the prompt + chip step aside when the real UI arrives; the note becomes a solid label
    (".note{position:absolute;font-family:\"Instrument Serif\",serif;font-style:italic;font-size:54px;color:var(--blue);white-space:nowrap}",
     ".note{position:absolute;font-weight:800;letter-spacing:-.02em;font-size:34px;color:var(--cream);background:var(--ink);padding:10px 24px;border-radius:999px;white-space:nowrap;box-shadow:0 12px 30px rgba(0,0,0,.3)}"),
    ('<div class="note" id="n1" style="left:360px;top:300px;opacity:0">← your name for the board</div>', '<div class="note" id="n1" style="left:318px;top:188px;opacity:0">Name your boards</div>'),
    ("tl.set(['#imIdle'],{opacity:0},0);", "tl.to(['#prompt','#chip'],{opacity:0,y:90,duration:.3,ease:'power2.in'},8.1);\ntl.set(['#imIdle'],{opacity:0},0);"),
    # S5: LED to the lower right so it never touches the type
    ("#led{position:absolute;left:1380px;top:540px;width:560px;height:560px;margin:-280px 0 0 -280px;border-radius:50%}", "#led{position:absolute;left:1560px;top:640px;width:440px;height:440px;margin:-220px 0 0 -220px;border-radius:50%}"),
    ('<div class="big" id="s5a" style="left:130px;top:190px;font-size:270px">', '<div class="big" id="s5a" style="left:130px;top:130px;font-size:270px">'),
    ('<div class="big" id="s5b" style="left:130px;top:560px;font-size:150px">', '<div class="big" id="s5b" style="left:130px;top:520px;font-size:150px">'),
    ("#led .core{position:absolute;inset:70px;", "#led .core{position:absolute;inset:56px;"),
]
for a, b in R:
    assert a in s, a[:60]
    s = s.replace(a, b)
open(p, "w").write(s)
print("ok")
