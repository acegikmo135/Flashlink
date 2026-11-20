// usage: node tools/snap.cjs t1 t2 ...  → out/snap_<t>.png (1920x1080)
const {chromium}=require('playwright');const path=require('path');
(async()=>{const b=await chromium.launch({args:['--no-sandbox']});const p=await b.newPage({viewport:{width:1080,height:1920}});
p.on('pageerror',e=>console.log('PAGEERR',e.message));p.on('console',m=>{if(m.type()==='error')console.log('CONSOLE',m.text())});
await p.goto('file://'+path.resolve('index.html')+'?export=1');await p.evaluate(()=>document.fonts.ready);await p.waitForTimeout(800);
for(const t of process.argv.slice(2)){await p.evaluate(t=>window.seekTo(t),parseFloat(t));await p.waitForTimeout(120);await p.screenshot({path:`out/snap_${t}.png`});console.log('snap',t);}
await b.close();})();
