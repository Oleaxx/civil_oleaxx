'use strict';
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)],P=Physics,clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const IC={select:'<path d="M5 3l14 8-6 2-3 6z"/>',node:'<circle cx="12" cy="12" r="3.5"/><circle cx="12" cy="12" r="9" opacity=".4"/>',beam:'<circle cx="5" cy="19" r="2.5"/><circle cx="19" cy="5" r="2.5"/><path d="M7 17L17 7"/>',delete:'<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',load:'<path d="M12 3v13M7 11l5 5 5-5M5 21h14"/>',support:'<path d="M12 5l7 12H5zM4 21h16"/>',undo:'<path d="M9 7L4 12l5 5M4 12h9a6 6 0 010 9h-2"/>',redo:'<path d="M15 7l5 5-5 5M20 12h-9a6 6 0 000 9h2"/>',play:'<path d="M7 4l13 8-13 8z"/>',reset:'<path d="M4 12a8 8 0 108-8M4 4v5h5"/>',gear:'<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',menu:'<path d="M4 6h16M4 12h16M4 18h16"/>',panel:'<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M14 4v16"/>',save:'<path d="M5 4h11l3 3v13H5zM8 4v5h7M8 20v-6h8v6"/>',folder:'<path d="M3 7h6l2 2h10v10H3z"/>',straight:'<path d="M5 19L19 5"/>',curve:'<path d="M4 19Q12 1 20 19"/>'};
$$('[data-ic]').forEach(e=>e.insertAdjacentHTML('afterbegin',`<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${IC[e.dataset.ic]}</svg>`));
const KIND={block:{w:1.6,h:1.2},car:{w:2.2,h:1},truck:{w:3.6,h:1.7},heavy:{w:5.2,h:2.3},container:{w:3.8,h:1.9}};
const HINT={select:'Drag nodes or loads. Drag empty space to pan, scroll to zoom.',node:'Click to place a node (snaps to the grid).',beam:'Click a start node, then each end node: the chain continues from the last node. Click the start node or press Esc to stop. Or type a length and angle above.',delete:'Click a node or beam to remove it.',load:'Click along the deck to move the load there.',support:'Click a node on a platform to cycle pin → roller → none.',curve:'Curved beam: click a start node, click the end point, then click a third point the arc passes through (like a 3-point arc in CAD). Esc cancels. You can also type a length and angle, then click the third point.'};
const TIPS={tension:'<b>Tension</b>: a pulling force that tends to stretch a member. Steel is strong in tension; concrete is not.',compression:'<b>Compression</b>: a pushing force that tends to shorten a member. Long, slim members may buckle before they crush.',buckling:'<b>Buckling</b>: a compression member loses stability and bows sideways. Capacity falls with the square of its length: Pcr = π²EI/L².',equil:'<b>Equilibrium</b>: the resultant force and moment on the structure are zero, so the support reactions always balance the loads.',tri:'<b>Triangulation</b>: a triangle of pinned members cannot change shape; a four-sided frame can. That is why trusses use triangles.',sup:'<b>Supports</b>: a pin resists both horizontal and vertical movement; a roller resists only vertical, letting the bridge expand freely.',bend:'<b>Bending</b>: a member that carries a load between its nodes acts as a beam. Add a node under the load to turn bending into axial force.',curve:'<b>Curved members</b>: thrust acts along the chord between the pins, so it sits a distance e off the curved centre line and bends the member: M = N·e, largest at the rise h. Curves are also softer along the chord, and the inner fibre carries extra stress (Winkler–Bach). Keep curves shallow, or make them stocky.'};
const cfg=Object.assign({snap:true,labels:true},JSON.parse(localStorage.getItem('sb_cfg')||'{}'));
let prog=JSON.parse(localStorage.getItem('sb_prog')||'{}');
const S={lv:0,nodes:[],beams:[],loads:[],tool:'select',sel:null,mat:'steel',size:60,undo:[],redo:[],cam:{x:0,y:0,k:40},sim:null,view:'util',nid:3,from:null,pend:null,btype:'straight',hover:null,hintN:0,mouse:{x:0,y:0},tut:false,tutPass:false,coachMin:false,exOpen:false,lastStep:-1};
const LV=()=>(S.tut?TUTORIALS:LEVELS)[S.lv],M=()=>({nodes:S.nodes,beams:S.beams}),node=id=>S.nodes.find(n=>n.id===id),sn=v=>cfg.snap?Math.round(v*2)/2:Math.round(v*100)/100;
const inArea=(x,y)=>x>=-4&&x<=LV().span+4&&y>=-12&&y<=6;
const cv=$('#cv'),g=cv.getContext('2d');let W=1,H=1,dpr=1;
function resize(){const r=cv.parentElement.getBoundingClientRect();dpr=window.devicePixelRatio||1;W=r.width;H=r.height;cv.width=W*dpr;cv.height=H*dpr}
const w2=(x,y)=>[x*S.cam.k+S.cam.x,y*S.cam.k+S.cam.y],s2=(px,py)=>({x:(px-S.cam.x)/S.cam.k,y:(py-S.cam.y)/S.cam.k});
function fit(){const sp=LV().span;S.cam.k=clamp(Math.min(W/(sp+12),H/(sp*.75+16)),8,90);S.cam.x=W/2-sp/2*S.cam.k;S.cam.y=H*.45}
function zoom(f,px=W/2,py=H/2){const w=s2(px,py);S.cam.k=clamp(S.cam.k*f,8,140);S.cam.x=px-w.x*S.cam.k;S.cam.y=py-w.y*S.cam.k}
function setStatus(t,k){const e=$('#status');e.textContent=t;e.className='pill '+k}
function toast(m,k='bad'){const d=document.createElement('div');d.className='toast '+k;d.textContent=m;$('#toasts').append(d);setTimeout(()=>d.remove(),3200)}
const modal=h=>{const m=$('#modal');m.innerHTML=`<div class="card">${h}</div>`;m.hidden=false},closeModal=()=>{$('#modal').hidden=true};
// ---------- history ----------
const snapshot=()=>JSON.stringify({n:S.nodes,b:S.beams,l:S.loads,i:S.nid});
function restore(s){const o=JSON.parse(s);S.nodes=o.n;S.beams=o.b;S.loads=o.l;S.nid=o.i;S.sel=null;S.from=null;S.pend=null}
const save=()=>localStorage.setItem('sb_d'+LV().id,snapshot());
function commit(pre){if(pre===snapshot())return;S.tutPass=false;S.undo.push(pre);if(S.undo.length>100)S.undo.shift();S.redo=[];save();refresh()}
function edit(fn){const pre=snapshot();fn();commit(pre)}
function undo(){if(S.sim||!S.undo.length)return;S.redo.push(snapshot());restore(S.undo.pop());save();refresh()}
function redo(){if(S.sim||!S.redo.length)return;S.undo.push(snapshot());restore(S.redo.pop());save();refresh()}
// ---------- construction ----------
function addNode(w){const x=sn(w.x),y=sn(w.y);if(!inArea(x,y))return toast('Outside the building area.');
 const ex=S.nodes.find(n=>Math.abs(n.x-x)<.01&&Math.abs(n.y-y)<.01);if(ex){S.sel={t:'node',id:ex.id};return refresh()}
 edit(()=>{const n={id:S.nid++,x,y,sup:null};S.nodes.push(n);S.sel={t:'node',id:n.id}})}
function addBeam(a,b){if(a===b)return;if(S.beams.some(q=>(q.a===a&&q.b===b)||(q.a===b&&q.b===a)))return toast('That beam already exists.');
 const p=node(a),q=node(b);if(Math.hypot(p.x-q.x,p.y-q.y)<.4)return toast('Beam is too short.');
 edit(()=>{S.beams.push({a,b,mat:S.mat,size:S.size,born:performance.now()});S.sel={t:'beam',i:S.beams.length-1}});return true}
function chainTo(w){const f=node(S.from),x=sn(w.x),y=sn(w.y);if(!inArea(x,y))return toast('Outside the building area.');if(Math.hypot(f.x-x,f.y-y)<.4)return toast('Beam is too short.');
 edit(()=>{const n={id:S.nid++,x,y,sup:null};S.nodes.push(n);S.beams.push({a:f.id,b:n.id,mat:S.mat,size:S.size,born:performance.now()});S.from=n.id;S.sel={t:'beam',i:S.beams.length-1}});refresh()}
function addByDim(){const f=node(S.from);if(!f||S.sim)return;const L=parseFloat($('#dL').value),a=parseFloat($('#dA').value||'0');
 if(!(L>=.4))return toast('Enter a length of at least 0.4 m.');if(!isFinite(a))return toast('Enter a valid angle in degrees.');
 const x=+(f.x+L*Math.cos(a*Math.PI/180)).toFixed(3),y=+(f.y-L*Math.sin(a*Math.PI/180)).toFixed(3);
 if(!inArea(x,y))return toast('That end point is outside the building area.');
 const ex=S.nodes.find(n=>Math.hypot(n.x-x,n.y-y)<.01);
 if(ex&&S.beams.some(q=>(q.a===f.id&&q.b===ex.id)||(q.a===ex.id&&q.b===f.id)))return toast('That beam already exists.');
 if(S.btype==='curve'){S.pend=ex?{id:ex.id,x:ex.x,y:ex.y}:{id:null,x,y};$('#dL').value='';$('#dA').value='';toast('Now click a third point for the curve to pass through.','ok');return refresh()}
 edit(()=>{let t=ex;if(!t){t={id:S.nid++,x,y,sup:null};S.nodes.push(t)}S.beams.push({a:f.id,b:t.id,mat:S.mat,size:S.size,born:performance.now()});S.from=t.id;S.sel={t:'beam',i:S.beams.length-1}});
 $('#dL').value='';$('#dA').value='';refresh();$('#dL').focus()}
function curveClick(w,nh){const f=node(S.from);
 if(!S.pend){if(nh&&nh.id===S.from){S.from=null;return refresh()}
  const e=nh?{id:nh.id,x:nh.x,y:nh.y}:{id:null,x:sn(w.x),y:sn(w.y)};
  if(!nh&&!inArea(e.x,e.y))return toast('Outside the building area.');if(Math.hypot(f.x-e.x,f.y-e.y)<.4)return toast('Beam is too short.');
  if(nh&&S.beams.some(q=>(q.a===f.id&&q.b===nh.id)||(q.a===nh.id&&q.b===f.id)))return toast('That beam already exists.');
  S.pend=e;toast('Now click a third point for the curve to pass through.','ok');return refresh()}
 const e=S.pend,r=P.curveThrough(f,e,w);if(r.err)return toast(r.err);
 edit(()=>{let t=e.id!=null?node(e.id):null;if(!t){t={id:S.nid++,x:e.x,y:e.y,sup:null};S.nodes.push(t)}
  S.beams.push({a:f.id,b:t.id,mat:S.mat,size:S.size,curve:r.h,born:performance.now()});S.from=t.id;S.pend=null;S.sel={t:'beam',i:S.beams.length-1}})}
function setBtype(t){S.btype=t;S.pend=null;if(S.tool!=='beam')setTool('beam');else{$('#hint').textContent=HINT[t==='curve'?'curve':'beam'];refresh()}}
function hintSection(){const h=LV().hints||[],n=Math.min(S.hintN,h.length);
 return`<section><h3>Hints</h3>${h.slice(0,n).map((x,i)=>`<p class="tip"><b>${i+1}.</b> ${x}</p>`).join('')||'<p class="mut">Stuck? Ask for a nudge. Hints guide your thinking without giving the design away.</p>'}<button class="btn ghost" data-act="hint" ${n>=h.length?'disabled':''}>${n?'Another hint':'Show a hint'}</button></section>`}
function delNode(n){if(n.locked)return toast('Abutment nodes cannot be deleted.');edit(()=>{S.beams=S.beams.filter(b=>b.a!==n.id&&b.b!==n.id);S.nodes=S.nodes.filter(m=>m!==n);S.sel=null;if(S.from===n.id)S.from=null})}
function cycleSup(n){const sp=LV().span;if(!((n.x<=.001||n.x>=sp-.001)&&n.y>=0))return toast('Supports must sit on a platform edge or below it.');
 edit(()=>{n.sup=n.sup===null?'pin':n.sup==='pin'?'roller':null})}
function moveLoad(x){const lv=LV();if(lv.moving)return toast('Vehicles drive across on their own. Press Run to test the bridge.','ok');let i=0;S.loads.forEach((l,k)=>{if(Math.abs(l.x-x)<Math.abs(S.loads[i].x-x))i=k});
 edit(()=>{S.loads[i].x=clamp(sn(x),.5,lv.span-.5)})}
function setTool(t){S.tool=t;S.from=null;S.pend=null;cv.style.cursor=t==='select'?'default':'crosshair';$('#hint').textContent=HINT[t==='beam'&&S.btype==='curve'?'curve':t];refresh()}
// ---------- hit testing ----------
const hitNode=p=>S.nodes.find(n=>{const q=npos(n),[x,y]=w2(q.x,q.y);return Math.hypot(x-p.x,y-p.y)<=16});
function hitBeam(p){const sd=(x1,y1,x2,y2)=>{const dx=x2-x1,dy=y2-y1,t=clamp(((p.x-x1)*dx+(p.y-y1)*dy)/(dx*dx+dy*dy||1),0,1);return Math.hypot(p.x-x1-t*dx,p.y-y1-t*dy)};
 return S.beams.findIndex(b=>{const a=npos(node(b.a)),c=npos(node(b.b)),v=(b.curve?P.arcPoints(a,c,b.curve,24):[a,c]).map(q=>w2(q.x,q.y));for(let j=0;j<v.length-1;j++)if(sd(v[j][0],v[j][1],v[j+1][0],v[j+1][1])<9)return true;return false})}
function hitLoad(w){if(LV().moving)return -1;return S.loads.findIndex(l=>{const d=KIND[l.kind],y=deckY(l.x);return Math.abs(w.x-l.x)<d.w/2&&w.y<y+.3&&w.y>y-d.h-.2})}
function deckY(x){const geo=P.memberGeom(M()),k=P.deckBeam(geo,S.nodes,x);if(k<0)return 0;const q=geo[k],a=npos(S.nodes[q.i]),c=npos(S.nodes[q.j]),t=(x-S.nodes[q.i].x)/q.dx;if(q.curved){const y=P.arcYAt(a,c,q.b.curve,x);if(y!==null)return y}return a.y+(c.y-a.y)*t}
function npos(n){const s=S.sim;if(s&&s.res&&!s.collapsed){const i=S.nodes.indexOf(n),k=s.sc*s.ease;return{x:n.x+s.res.u[2*i]*k,y:n.y+s.res.u[2*i+1]*k}}return n}
// ---------- pointer input ----------
let drag=null;const pt=e=>{const r=cv.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top}};
cv.addEventListener('pointerdown',e=>{cv.setPointerCapture(e.pointerId);const p=pt(e),w=s2(p.x,p.y),pan={k:'pan',sx:p.x,sy:p.y,cx:S.cam.x,cy:S.cam.y};S.mouse=p;
 if(e.button>0||S.sim){drag=pan;return}
 const nh=hitNode(p),bh=hitBeam(p),lh=hitLoad(w),t=S.tool;
 if(t==='select'){if(nh){S.sel={t:'node',id:nh.id};if(!nh.locked)drag={k:'node',n:nh,pre:snapshot()}}else if(lh>=0){S.sel={t:'load',i:lh};drag={k:'load',i:lh,pre:snapshot()}}else if(bh>=0)S.sel={t:'beam',i:bh};else{S.sel=null;drag=pan}refresh()}
 else if(t==='node'){if(nh){S.sel={t:'node',id:nh.id};refresh()}else addNode(w)}
 else if(t==='beam'){if(S.btype==='curve'&&S.from!=null)curveClick(w,nh);else if(S.from==null){if(nh){S.from=nh.id;refresh()}else toast('Start a beam on a node.')}else if(nh){if(nh.id===S.from){S.from=null;refresh()}else if(addBeam(S.from,nh.id)){S.from=nh.id;refresh()}}else chainTo(w)}
 else if(t==='delete'){if(nh)delNode(nh);else if(bh>=0)edit(()=>{S.beams.splice(bh,1);S.sel=null})}
 else if(t==='load')moveLoad(w.x);
 else if(t==='support'&&nh)cycleSup(nh)});
cv.addEventListener('pointermove',e=>{const p=pt(e),w=s2(p.x,p.y);S.mouse=p;S.hover=S.sim?null:hitNode(p);if(!drag)return;
 if(drag.k==='pan'){S.cam.x=drag.cx+p.x-drag.sx;S.cam.y=drag.cy+p.y-drag.sy}
 else if(drag.k==='node'){const x=sn(w.x),y=sn(w.y);if(inArea(x,y)){drag.n.x=x;drag.n.y=y}}
 else if(drag.k==='load')S.loads[drag.i].x=clamp(sn(w.x),.5,LV().span-.5)});
cv.addEventListener('pointerup',()=>{if(drag&&drag.pre!==undefined)commit(drag.pre);drag=null;refresh()});
cv.addEventListener('wheel',e=>{e.preventDefault();const p=pt(e);zoom(Math.exp(-e.deltaY*.0015),p.x,p.y)},{passive:false});
cv.addEventListener('contextmenu',e=>e.preventDefault());
window.addEventListener('keydown',e=>{if(/INPUT|SELECT/.test(e.target.tagName))return;if(S.tool==='beam'&&S.from!=null&&!S.sim&&/^[0-9.]$/.test(e.key)){$('#dL').focus();return}const k=e.key.toLowerCase(),m={v:'select',n:'node',b:'beam',x:'delete',l:'load',s:'support'};
 if((e.ctrlKey||e.metaKey)&&k==='z'){e.preventDefault();e.shiftKey?redo():undo()}else if((e.ctrlKey||e.metaKey)&&k==='y')redo();
 else if(m[k]&&!e.ctrlKey)setTool(m[k]);else if(k==='escape'){S.from=null;S.pend=null;closeModal();refresh()}
 else if((k==='delete'||k==='backspace')&&S.sel&&!S.sim){if(S.sel.t==='beam')edit(()=>{S.beams.splice(S.sel.i,1);S.sel=null});else if(S.sel.t==='node')delNode(node(S.sel.id))}});
// ---------- UI wiring ----------
document.addEventListener('click',e=>{const el=e.target.closest('[data-act],[data-tool],[data-view],[data-btype]');if(!el)return;const d=el.dataset;
 if(d.btype)setBtype(d.btype);else if(d.tool)setTool(d.tool);
 else if(d.view){S.view=d.view;$$('[data-view]').forEach(b=>b.classList.toggle('on',b.dataset.view===S.view));legend()}
 else if(d.act==='zin')zoom(1.25);else if(d.act==='zout')zoom(.8);else if(d.act==='fit')fit();
 else if(d.act==='lab'){cfg.labels=!cfg.labels;saveCfg()}
 else if(d.act==='hint'){S.hintN++;renderPanel()}
 else if(d.act==='edit'){endSim();closeModal()}
 else if(d.act==='retry'){endSim();closeModal();runSim()}
 else if(d.act==='next'){loadLevel(S.lv+1,S.tut)}
 else if(d.act==='level')loadLevel(+d.i,d.t==='1');
 else if(d.act==='setmat'){S.mat=d.m;S.size=+d.z;refresh()}
 else if(d.act==='coachmin'){S.coachMin=!S.coachMin;renderCoach()}
 else if(d.act==='wipe'){prog={};localStorage.removeItem('sb_prog');closeModal();toast('Progress cleared.','ok')}
 else if(d.act==='saveSlot'){localStorage.setItem('sb_s'+LV().id,snapshot());toast('Design saved.','ok')}
 else if(d.act==='loadSlot'){const s=localStorage.getItem('sb_s'+LV().id);if(!s||S.sim)return toast(s?'Reset the simulation first.':'No saved design for this level.');const pre=snapshot();restore(s);commit(pre);refresh()}});
document.addEventListener('change',e=>{const d=e.target.dataset,v=e.target.value;
 if(d.act==='mat'||d.act==='size'){const val=d.act==='size'?+v:v;if(S.sel&&S.sel.t==='beam'&&!S.sim)edit(()=>{S.beams[S.sel.i][d.act]=val});else{S[d.act]=val;refresh()}}
 else if(d.act==='wt'){edit(()=>{S.loads[S.sel.i].w=+v})}
 else if(d.act==='snap'){cfg.snap=e.target.checked;saveCfg()}else if(d.act==='labels'){cfg.labels=e.target.checked;saveCfg()}});
const saveCfg=()=>localStorage.setItem('sb_cfg',JSON.stringify(cfg));
$('#undo').onclick=undo;$('#redo').onclick=redo;$('#run').onclick=runSim;
$('#tgL').onclick=()=>{$('#left').classList.toggle('open');$('#right').classList.remove('open')};$('#tgR').onclick=()=>{$('#right').classList.toggle('open');$('#left').classList.remove('open')};
$('#reset').onclick=()=>{if(S.sim)return endSim();if(S.beams.length||S.nodes.length>2)edit(()=>{S.nodes=S.nodes.filter(n=>n.locked);S.beams=[];S.sel=null});setStatus('Ready to build','idle')};
$('#modal').onclick=e=>{if(e.target.id==='modal'||e.target.closest('[data-close]'))closeModal()};
$('#lvBtn').onclick=()=>modal(`<h2>Challenges</h2><p>Finish a level to unlock the next. Replay any level to improve your score.</p>${LEVELS.map((l,i)=>{const p=prog[l.id],ok=i===0||prog[LEVELS[i-1].id];return`<button class="lv" data-act="level" data-i="${i}" ${ok?'':'disabled'}><b>${l.id}. ${l.name}</b><span class="mut">${l.span} m · $${l.budget.toLocaleString()}</span><em>${p?'★'.repeat(p.stars)+'☆'.repeat(3-p.stars):ok?'☆☆☆':'🔒'}</em></button>`}).join('')}<div class="acts"><button class="btn ghost" data-close>Close</button></div>`);
$('#tutBtn').onclick=()=>modal(`<h2>Tutorials</h2><p>Guided builds that show you the best design and explain why. Open them any time; they do not affect your challenge progress.</p>${TUTORIALS.map((l,i)=>{const p=prog[l.id];return`<button class="lv" data-act="level" data-t="1" data-i="${i}"><b>${l.tag} · ${l.name}</b><span class="mut">${l.span} m · $${l.budget.toLocaleString()}${l.moving?' · moving':''}</span><em>${p?'★'.repeat(p.stars)+'☆'.repeat(3-p.stars):'☆☆☆'}</em></button><p class="tdesc">${l.blurb}</p>`}).join('')}<div class="acts"><button class="btn ghost" data-close>Close</button></div>`);
$('#settings').onclick=()=>modal(`<h2>Settings</h2><label class="chk"><input type="checkbox" data-act="snap" ${cfg.snap?'checked':''}> Snap nodes to the 0.5 m grid</label><label class="chk"><input type="checkbox" data-act="labels" ${cfg.labels?'checked':''}> Show beam length labels</label><p class="mut">Utilisation colour thresholds are set in <code>Physics.THRESH</code> (physics.js): currently ${P.THRESH.map(v=>v*100+'%').join(' / ')}.</p><div class="acts"><button class="btn ghost" data-act="wipe">Clear saved progress</button><button class="btn run" data-close>Done</button></div>`);
function legend(){$('#legend').innerHTML=S.view==='util'?`<span><i style="background:#2ee6a6"></i>&lt;${P.THRESH[0]*100}% safe</span><span><i style="background:#ffd23f"></i>${P.THRESH[0]*100}–${P.THRESH[1]*100}%</span><span><i style="background:#ff8a2a"></i>${P.THRESH[1]*100}–${P.THRESH[2]*100}%</span><span><i style="background:#ff3b4e"></i>&gt;100% failed</span><span><i style="background:#4da3ff"></i>not analysed</span>`:`<span><i style="background:#22d3ee"></i>Tension</span><span><i style="background:#ff8a2a"></i>Compression</span><span>Thickness = force size · arrows show direction</span>`}
function renderObj(){const l=LV();$('#obj').innerHTML=`<b>${l.tag?l.tag+' · '+l.name:l.id+'. '+l.name}</b>${l.obj}<br><i>Budget $${l.budget.toLocaleString()}</i> · span ${l.span} m<br><span class="mut">${l.teach}</span>`}
// ---------- panel ----------
const kv=(k,v)=>`<div class="kv"><span>${k}</span><b>${v}</b></div>`;
const matSel=(cur,sz)=>`<select data-act="mat">${Object.entries(P.MATERIALS).map(([k,m])=>`<option value="${k}" ${k===cur?'selected':''}>${m.name}</option>`).join('')}</select><select data-act="size">${P.SIZES.map(s=>`<option value="${s}" ${s===sz?'selected':''}>${s} × ${s} mm section</option>`).join('')}</select>`;
function selHTML(res){const e=S.sel;
 if(!e)return`<p class="mut">Select a node, beam or load to inspect it.</p><h3>New beam defaults</h3>${matSel(S.mat,S.size)}`;
 if(e.t==='node'){const n=node(e.id);if(!n){S.sel=null;return selHTML(res)}const r=res&&res.reactions.find(q=>q.id===n.id);
  return kv('Node',n.id)+kv('x',n.x.toFixed(2)+' m')+kv('Elevation',(-n.y).toFixed(2)+' m')+kv('Support',n.sup||'none')+kv('Members',S.beams.filter(b=>b.a===n.id||b.b===n.id).length)+(r?kv('Reaction ↑',r.ry.toFixed(1)+' kN')+kv('Reaction →',r.rx.toFixed(1)+' kN'):'')}
 if(e.t==='load'){const l=S.loads[e.i],lv=LV();return kv('Load',l.kind)+kv('Weight',l.w+' kN')+kv('Position x',l.x.toFixed(1)+' m')+(lv.wr?`<input type="range" data-act="wt" min="${lv.wr[0]}" max="${lv.wr[1]}" step="1" value="${l.w}">`:'')}
 const b=S.beams[e.i];if(!b){S.sel=null;return selHTML(res)}
 const a=node(b.a),c=node(b.b),L=Math.hypot(c.x-a.x,c.y-a.y),m=P.MATERIALS[b.mat],q=P.sec(b.size),mem=res&&res.members[e.i],cv=b.curve?P.arc(L,b.curve):null,Sa=cv&&cv.hm?cv.S:L;
 return matSel(b.mat,b.size)+(cv&&cv.hm?kv('Shape','Curved arc')+kv('Chord',L.toFixed(2)+' m')+kv('Arc length',Sa.toFixed(2)+' m')+kv('Rise h',cv.hm.toFixed(2)+' m')+kv('Radius R',cv.R.toFixed(2)+' m'):kv('Length',L.toFixed(2)+' m'))+kv('Area A',(q.A*1e4).toFixed(1)+' cm²')+kv('Inertia I',(q.I*1e8).toFixed(0)+' cm⁴')+kv('Young’s E',m.E/1e9+' GPa')+kv('Density',m.rho+' kg/m³')+kv('Max tension',m.st/1e6+' MPa')+kv('Max compression',m.sc/1e6+' MPa')+kv('Mass',(m.rho*q.A*Sa).toFixed(0)+' kg')+kv('Cost','$'+Math.round(m.rho*q.A*Sa*m.price))
  +(mem?kv('Axial force',Math.abs(mem.N/1000).toFixed(1)+' kN '+(mem.N>=0?'(T)':'(C)'))+kv('Stress σ=F/A',(mem.sigma/1e6).toFixed(1)+' MPa')+kv('Utilisation',(mem.util*100).toFixed(0)+'%')+kv('Euler Pcr',(mem.Pcr/1000).toFixed(0)+' kN')+kv('Governing',mem.mode)+(mem.curved?kv('Curve moment N·h',(mem.Mc/1000).toFixed(2)+' kN·m')+kv('Chord stiffness',Math.min(100,mem.kr*100).toFixed(0)+'% of straight'):''):'')}
function renderPanel(){const s=S.sim,res=s&&s.res;let tip=TIPS.equil;const e=S.sel;
 if(e&&e.t==='beam'&&res&&res.members[e.i]){const m=res.members[e.i];tip=m.mode==='curvature'?TIPS.curve:m.mode==='bending'?TIPS.bend:m.mode==='buckling'?TIPS.buckling:m.N>=0?TIPS.tension:TIPS.compression}
 else if(S.tool==='beam'&&S.btype==='curve')tip=TIPS.curve;else if(S.tool==='beam'||S.tool==='node')tip=TIPS.tri;else if(S.tool==='support')tip=TIPS.sup;
 let r='<p class="mut">Run the simulation to see member forces, stresses and reactions.</p>';
 if(res){const mu=Math.max(...res.members.map(m=>m.util));r=kv('Peak utilisation',(mu*100).toFixed(0)+'%')+kv('Max displacement',(res.maxDisp*1000).toFixed(1)+' mm')+kv('Drawing scale','×'+s.sc.toFixed(0)+' (visual only)')+res.reactions.map(q=>kv('Reaction, node '+q.id,q.ry.toFixed(1)+' kN ↑'+(Math.abs(q.rx)>.05?', '+q.rx.toFixed(1)+' → ':''))).join('')}
 $('#panel').innerHTML=`<section><h3>Selected element</h3>${selHTML(res)}</section><section><h3>Simulation results</h3>${r}</section><section><h3>Learn</h3><p class="tip">${tip}</p><p class="tip">${S.tool==='select'?TIPS.tri:TIPS.equil}</p></section>${S.tut?'':hintSection()}
 <details><summary>How is this calculated?</summary><p>Global stiffness [K]{u}={F} is assembled from each member’s EA/L, supports remove degrees of freedom, and the reduced system is solved by Gaussian elimination. Member force N = (EA/L)·Δ along the member; σ = N/A. Compression members also check Euler buckling Pcr = π²EI/(KL)², K = 1.</p><p>Assumptions: pinned joints, solid square sections, allowable stresses without safety factors, each load shared linearly between the end nodes of the deck member beneath it (which also resists bending M = Pab/L), deflection limit span/200.</p><p>Curved members are circular arcs defined by a chord and a rise h. The end thrust N acts along the chord, so an arc carries bending M = N·e (largest at the apex, N·h) on top of its axial force. Chord stiffness comes from axial plus bending strain energy, so arcs are softer than EA/L; compression amplifies the moment by 1/(1 − N/Pcr); and the inner fibre sees a Winkler–Bach stress increase. Weight and cost use the arc length.</p>${LV().moving?'<p>Moving vehicles: each vehicle is split into axle loads that roll across the span. The structure is solved at every position and each member keeps its worst result. Vehicle weight is multiplied by a 1.15 dynamic allowance (bounce and impact). A beam under an axle between two joints also bends, so joints close together help.</p>':''}</details>`}
function refresh(){const lv=LV(),c=P.cost(M()),st=P.stability(M());
 $('#bCost').innerHTML=`$${c.toLocaleString()} <small>/ $${lv.budget.toLocaleString()}</small>`;$('#bCost').className=c>lv.budget?'bad':'';
 $('#bN').textContent=S.nodes.length;$('#bB').textContent=S.beams.length;$('#bL').textContent=S.loads.reduce((a,l)=>a+l.w,0)+' kN';
 const e=$('#bS');e.textContent=st.t;e.className=st.ok?'ok':'bad';const dm=$('#dim'),df=S.from!=null&&S.tool==='beam'&&!S.sim?node(S.from):null;dm.style.display=df?'flex':'none';if(df)$('#dFrom').textContent='From node '+df.id;
 $$('[data-tool]').forEach(b=>b.classList.toggle('on',b.dataset.tool===S.tool));$$('[data-btype]').forEach(b=>b.classList.toggle('on',b.dataset.btype===S.btype&&S.tool==='beam'));$('#undo').disabled=!S.undo.length||!!S.sim;$('#redo').disabled=!S.redo.length||!!S.sim;renderPanel();renderCoach()}
function loadLevel(i,tut=false){S.tut=tut;S.lv=i;const lv=LV();S.tutPass=false;S.lastStep=-1;S.exOpen=false;S.hintN=0;S.sim=null;S.sel=null;S.from=null;S.undo=[];S.redo=[];
 S.nodes=[{id:1,x:0,y:0,sup:lv.nosup?null:'pin',locked:true},{id:2,x:lv.span,y:0,sup:lv.nosup?null:'roller',locked:true}];S.beams=[];S.nid=3;S.loads=lv.loads.map(l=>({...l}));
 const sv=localStorage.getItem('sb_d'+lv.id);if(sv)try{restore(sv)}catch(e){}
 if(lv.moving)S.loads=lv.loads.map(l=>({...l}));
 $('#lvName').textContent=lv.tag?lv.tag+' · '+lv.name:`${lv.id}. ${lv.name}`;$('#lvBtn small').textContent=S.tut?'Tutorial':'Challenge';renderObj();legend();$('#chk').style.display='none';fit();setStatus('Ready to build','idle');setTool('select');closeModal();$('#left').classList.remove('open')}
// ---------- simulation sequence ----------
function runSim(){if(S.sim&&S.sim.stage<5)return;if(S.sim)endSim();S.sel=null;S.from=null;S.sim={stage:0,t:0,ease:0,res:null,sc:1,parts:[],pieces:[],lx:null,ly:0,lvy:0,collapsed:false,pt:0,ins:P.inspect(M(),S.loads,LV())};
 $('#left').classList.remove('open');$('#right').classList.remove('open');setStatus('Stage 1 of 5 · Structural inspection','run');refresh()}
function endSim(){S.sim=null;$('#chk').style.display='none';setStatus('Ready to build','idle');refresh()}
function abort(title,msg){S.sim=null;$('#chk').style.display='none';setStatus('Cannot simulate','bad');refresh();modal(`<h2>${title}</h2><p>${msg}</p><div class="acts"><button class="btn run" data-close>Back to building</button></div>`)}
const next=(s,t)=>{S.sim.stage=s;S.sim.t=0;setStatus(`Stage ${s+1} of 5 · ${t}`,'run')};
function simUpdate(dt){const s=S.sim,lv=LV(),chk=$('#chk');s.t+=dt;
 if(s.stage===0){chk.style.display='block';const n=s.ins.checks.length,shown=Math.floor(s.t/1.6*n);
  chk.innerHTML='<b>Structural inspection</b>'+s.ins.checks.map((c,i)=>`<div class="${i<shown?(c.ok?'ok':'bad'):'wait'}">${i<shown?(c.ok?'✔':'✘'):'○'} ${c.label}</div>`).join('');
  if(s.t>1.9){const bad=s.ins.checks.find(c=>!c.ok);if(bad)return abort('Structure not ready',bad.msg);next(1,'Load application')}}
 else if(s.stage===1){chk.style.display='none';if(s.t>1.1){try{s.all=P.analyseAll(M(),S.loads,lv)}catch(e){return abort('Solver error',e.message==='SINGULAR'?'The stiffness matrix is singular, so the structure is unstable.':e.message)}
  s.sc=clamp(.45/Math.max(s.all.maxD,1e-6),1,50);next(2,'Structural analysis')}}
 else if(s.stage===2){chk.style.display='block';chk.innerHTML=`<b>Solving</b><div><code>[K]{u} = {F}</code></div><div class="wait">${S.nodes.length*2} degrees of freedom · ${S.beams.length} members · ${s.all.frames.length} load case(s)</div>`;
  if(s.t>1.1){chk.style.display='none';next(3,'Visual response');s.dur=lv.moving?(lv.span+Math.max(...S.loads.map(l=>l.off||0))+4)/3.2:2.2}}
 else if(s.stage===3){const A=s.all,p=Math.min(1,s.t/s.dur);s.ease=1-Math.pow(1-Math.min(1,s.t/1.2),3);let fi=lv.moving?Math.round(p*(A.frames.length-1)):0;
  const fail=A.failFrame>=0&&(lv.moving?fi>=A.failFrame:s.t>1.5);if(fail&&lv.moving)fi=A.failFrame;
  s.res=A.frames[fi].res;s.lx=A.frames[fi].x;if(fail)collapse();else if(s.t>s.dur+.5)finish(false)}
 else if(s.stage===4){s.lvy+=14*dt;s.ly+=s.lvy*dt;s.pieces.forEach(q=>{q.dl-=dt;if(q.dl>0)return;q.vy+=14*dt;const mx=(q.a.x+q.b.x)/2,my=(q.a.y+q.b.y)/2,c=Math.cos(q.vr*dt),n=Math.sin(q.vr*dt);
   [q.a,q.b].forEach(v=>{const rx=v.x-mx,ry=v.y-my;v.x=mx+rx*c-ry*n+q.vx*dt;v.y=my+rx*n+ry*c+q.vy*dt})});if(s.t>2.8)finish(true)}
 s.parts.forEach(q=>{q.vy+=12*dt;q.x+=q.vx*dt;q.y+=q.vy*dt;q.l-=dt});s.parts=s.parts.filter(q=>q.l>0);
 s.pt+=dt;if(s.pt>.25&&s.stage>=3&&s.stage<5){s.pt=0;if(!/INPUT|SELECT/.test(document.activeElement.tagName))renderPanel()}}
function collapse(){const s=S.sim,bad=s.res.members.map((m,i)=>m.util>1?i:-1).filter(i=>i>=0),f=S.beams[bad[0]],pa=npos(node(f.a)),pb=npos(node(f.b)),c0={x:(pa.x+pb.x)/2,y:(pa.y+pb.y)/2};
 const pieces=S.beams.map((b,i)=>{const a={...npos(node(b.a))},c={...npos(node(b.b))},d=Math.hypot((a.x+c.x)/2-c0.x,(a.y+c.y)/2-c0.y);
  return{a,b:c,dl:bad.includes(i)?0:.2+d*.07,vy:0,vx:(Math.random()-.5)*2,vr:(Math.random()-.5)*4,col:P.utilColor(s.res.members[i].util),w:3+b.size/18,h:b.curve||0}});
 for(let i=0;i<70;i++)s.parts.push({x:c0.x,y:c0.y,vx:(Math.random()-.5)*9,vy:-Math.random()*7,l:.8+Math.random()*1.2,c:Math.random()<.5?'#ff8a2a':'#ffd23f'});
 s.pieces=pieces;s.collapsed=true;s.stage=4;s.t=0;setStatus('Member failure — collapse','bad')}
const MODE={yield:'allowable tensile stress (the member yielded in tension)',crushing:'allowable compressive stress (the member was crushed)',buckling:'Euler buckling capacity (the slender member bowed sideways)',bending:'bending capacity (the member carrying the load acts as a beam; add a node under the load or use a deeper section)',curvature:'bending capacity (the thrust in a curved member is offset from its centre line by the curve, so it bends as well as carrying axial force; flatten the curve, use a deeper section or a stiffer material)'};
const NUDGE={yield:'Stress is force divided by area (σ = F/A). Which two things could you change to lower it?',crushing:'Compression capacity depends on strength and area. Could that force be shared by more members?',buckling:'Euler capacity depends on E, I and length. Which of those can you influence?',bending:'Is a load being applied somewhere between the joints of that member?',defl:'Stiffness comes from both the material and the shape of the structure.',over:'Where are you paying for material that is barely being used?',curvature:'Thrust along a curved member sits off its centre line by the rise h, giving M = N·h. How could you reduce h, or the force N?'};
function where(b){const a=node(b.a),c=node(b.b),sp=LV().span,mx=(a.x+c.x)/2,dx=Math.abs(c.x-a.x),dy=Math.abs(c.y-a.y),L=Math.hypot(dx,dy);
 const kind=dx<.25*L?'vertical member':dy<.25*L?((a.y+c.y)/2<-.5?'top chord member':'deck / bottom chord member'):'diagonal member';
 return kind+(mx<sp/3?' near the left support':mx>sp*2/3?' near the right support':' near midspan')}
function finish(collapsed){const s=S.sim,A=s.all,lv=LV(),c=P.cost(M()),over=c>lv.budget,pass=A.failFrame<0&&A.deflOK&&!over;s.stage=5;
 const sc=pass?P.score(A,c,lv.budget,S.beams.length):0,stars=pass?1+(c<=lv.budget*.75)+(A.avgU>=.4):0,cb=S.beams[A.crit.i],loc=cb?where(cb):'';
 let why;if(A.failFrame>=0)why=`Your bridge failed because the ${loc} exceeded its ${MODE[A.crit.mode]}.`;
 else if(!A.deflOK)why=`The bridge is too flexible: maximum displacement ${(A.maxD*1000).toFixed(0)} mm exceeds the span/200 limit of ${(A.lim*1000).toFixed(0)} mm. Use stiffer material, larger sections or a deeper truss.`;
 else if(over)why=`The structure is safe, but it costs $${c.toLocaleString()} and the budget is $${lv.budget.toLocaleString()}. Remove or downsize low-stress members.`;
 else{const r=A.frames[A.crit.fi].res,T=r.members.filter(m=>m.N>=0).length;why=`Your bridge carried the load. ${T} members acted in tension and ${r.members.length-T} in compression, passing the forces to the supports. The most heavily used member was the ${loc} at ${(A.crit.u*100).toFixed(0)}% of capacity.`}
 S.tutPass=S.tut&&pass;const nxt=S.tut?S.lv<TUTORIALS.length-1?'<button class="btn run" data-act="next">Next tutorial</button>':'<button class="btn run" data-act="level" data-i="0">Go to challenges</button>':S.lv<LEVELS.length-1?'<button class="btn run" data-act="next">Next level</button>':'';
 const nudge=pass?'':`<p class="tip"><b>Hint:</b> ${A.failFrame>=0?NUDGE[A.crit.mode]:!A.deflOK?NUDGE.defl:NUDGE.over}</p>`;const old=prog[lv.id];if(pass&&(!old||sc>old.score)){prog[lv.id]={score:sc,stars:Math.max(stars,old?old.stars:0)};localStorage.setItem('sb_prog',JSON.stringify(prog))}
 setStatus(pass?'Bridge holds ✔':'Bridge failed','bad'===0?'':pass?'ok':'bad');
 modal(`<div class="big">${pass?'Bridge holds':'Bridge failed'}</div><h2>${pass?'★'.repeat(stars)+'☆'.repeat(3-stars):'Not this time'}</h2><p>${why}</p>${pass&&lv.done?`<p class="tip"><b>Why this design works:</b> ${lv.done.w}</p>`:''}${nudge}<div class="grid">
 <div class="cell"><small>Construction cost</small><b>$${c.toLocaleString()} / $${lv.budget.toLocaleString()}</b></div><div class="cell"><small>Max member stress</small><b>${(A.maxS/1e6).toFixed(1)} MPa</b></div>
 <div class="cell"><small>Max displacement</small><b>${(A.maxD*1000).toFixed(1)} mm (limit ${(A.lim*1000).toFixed(0)})</b></div><div class="cell"><small>Critical member</small><b>${cb?'#'+(A.crit.i+1)+' · '+(A.crit.u*100).toFixed(0)+'%':'-'}</b></div>
 <div class="cell"><small>Structural efficiency</small><b>${(A.avgU*100).toFixed(0)}% mean utilisation</b></div><div class="cell"><small>Score</small><b>${sc}</b></div></div>
 <div class="acts"><button class="btn ghost" data-act="edit">Edit design</button><button class="btn ghost" data-act="retry">Run again</button>${pass?nxt:''}</div>`);refresh()}
// ---------- tutorial coach ----------
const nAt=(x,y)=>S.nodes.find(n=>Math.abs(n.x-x)<.01&&Math.abs(n.y-y)<.01);
const bAt=(a,b,c,d)=>{const p=nAt(a,b),q=nAt(c,d);return p&&q?S.beams.find(e=>(e.a===p.id&&e.b===q.id)||(e.a===q.id&&e.b===p.id)):null};
const bOk=(e,st)=>e&&(!st.m||e.mat===st.m)&&(!st.z||e.size===st.z);
function stepInfo(st){let need=0,have=0,wrong=0;
 (st.n||[]).forEach(([x,y])=>{need++;if(nAt(x,y))have++});
 (st.sup||[]).forEach(([x,y,t])=>{need++;const n=nAt(x,y);if(n&&n.sup===t)have++});
 (st.b||[]).forEach(([a,b,c,d])=>{need++;const e=bAt(a,b,c,d);if(bOk(e,st))have++;else if(e)wrong++});
 if(st.run){need++;if(S.tutPass)have++}
 return{done:have===need,wrong}}
const curStep=()=>{const st=LV().steps||[],i=st.findIndex(s=>!stepInfo(s).done);return i<0?st.length:i};
function renderCoach(){const c=$('#coach');if(!c)return;const lv=LV(),st=lv.steps;
 if(!S.tut||!st||S.sim){c.hidden=true;$$('[data-tool]').forEach(b=>b.classList.remove('cue'));return}
 const i=curStep(),n=st.length,s=st[i],fin=i>=n;if(i!==S.lastStep){if(S.lastStep>=0&&i>S.lastStep)toast('Step complete','ok');S.lastStep=i;S.exOpen=false}
 $$('[data-tool]').forEach(b=>b.classList.toggle('cue',!!(s&&s.tool===b.dataset.tool&&S.tool!==s.tool)));
 const plan=st.reduce((a,x)=>a+(x.b||[]).length,0),info=s?stepInfo(s):{wrong:0},on=s&&s.m&&S.mat===s.m&&S.size===s.z,why=fin?lv.done.w:s.w;
 const nx=S.lv<TUTORIALS.length-1?'<button class="btn ghost" data-act="next">Next tutorial</button>':'<button class="btn ghost" data-act="level" data-i="0">Go to challenges</button>';
 const html=`<div class="cc-top"><span>${lv.tag} · ${fin?'complete':'step '+(i+1)+' of '+n}</span><button data-act="coachmin" title="${S.coachMin?'Expand':'Collapse'}">${S.coachMin?'+':'–'}</button></div><div class="cc-bar"><i style="width:${Math.round(100*Math.min(i,n)/n)}%"></i></div><b class="ct">${fin?lv.done.t:s.h}</b>`+(S.coachMin?'':`<p>${fin?lv.done.p:s.p}</p>`
  +(s&&s.m?`<button class="chip${on?' on':''}" data-act="setmat" data-m="${s.m}" data-z="${s.z}">${P.MATERIALS[s.m].name} · ${s.z} mm ${on?'✓':'· click to select'}</button>`:'')
  +(info.wrong?`<p class="cc-warn">${info.wrong} beam(s) here use another material or size. Select them and change it in the Engineering panel, or undo and redraw.</p>`:'')
  +(!fin&&S.beams.length>plan?`<p class="cc-warn">You have ${S.beams.length-plan} beam(s) more than the plan. Extra members cost money; delete any you do not need.</p>`:'')
  +`<details id="why"${S.exOpen?' open':''}><summary>Explanation</summary><p>${why}</p></details>`+(fin?`<div class="acts">${nx}</div>`:''));
 if(c.dataset.h!==html){c.innerHTML=html;c.dataset.h=html}c.hidden=false}
document.addEventListener('toggle',e=>{if(e.target.id==='why')S.exOpen=e.target.open},true);
function ghost(t,z){const st=LV().steps||[],cs=curStep();g.save();g.lineCap='round';
 st.forEach((s,j)=>{if(j<cs)return;g.globalAlpha=j===cs?.55+.3*Math.sin(t*4):.16;
  (s.b||[]).forEach(([x1,y1,x2,y2])=>{if(bOk(bAt(x1,y1,x2,y2),s))return;const[ax,ay]=w2(x1,y1),[bx,by]=w2(x2,y2);g.setLineDash([8,6]);g.strokeStyle=s.m?P.MATERIALS[s.m].color:'#22d3ee';g.lineWidth=(3+(s.z||40)/18)*z;g.beginPath();g.moveTo(ax,ay);g.lineTo(bx,by);g.stroke()});
  (s.n||[]).forEach(([x,y])=>{if(nAt(x,y))return;const[px,py]=w2(x,y);g.setLineDash([4,4]);g.strokeStyle='#22d3ee';g.lineWidth=2;g.beginPath();g.arc(px,py,9*z,0,7);g.stroke()});
  (s.sup||[]).forEach(([x,y,ty])=>{const q=nAt(x,y);if(q&&q.sup===ty)return;const[px,py]=w2(x,y);g.setLineDash([4,4]);g.strokeStyle='#22d3ee';g.lineWidth=2;g.beginPath();g.arc(px,py,17*z,0,7);g.stroke()})});g.restore()}
// ---------- rendering ----------
const rr=(x,y,w,h,r,f)=>{g.beginPath();g.roundRect?g.roundRect(x,y,w,h,r):g.rect(x,y,w,h);g.fillStyle=f;g.fill()};
function tri(x,y,a,z,col){g.save();g.translate(x,y);g.rotate(a);g.fillStyle=col;g.beginPath();g.moveTo(z,0);g.lineTo(-z,-z*.8);g.lineTo(-z,z*.8);g.fill();g.restore()}
function curvePreview(){const n=node(S.from),e=S.pend,m=s2(S.mouse.x,S.mouse.y),r=P.curveThrough(n,e,m),[px,py]=w2(n.x,n.y),[ex,ey]=w2(e.x,e.y);
 g.setLineDash([7,5]);g.strokeStyle='#ff8a2a';g.lineWidth=2;g.globalAlpha=.4;g.beginPath();g.moveTo(px,py);g.lineTo(ex,ey);g.stroke();g.globalAlpha=1;
 if(r.h){g.beginPath();P.arcPoints(n,e,r.h,32).forEach((v,j)=>{const [x,y]=w2(v.x,v.y);j?g.lineTo(x,y):g.moveTo(x,y)});g.stroke()}
 g.setLineDash([]);g.beginPath();g.arc(ex,ey,5,0,7);g.fillStyle='#ff8a2a';g.fill();g.font='600 11px "JetBrains Mono",monospace';g.textAlign='left';
 g.fillText(r.h?'arc '+P.arc(Math.hypot(e.x-n.x,e.y-n.y),r.h).S.toFixed(2)+' m · rise '+Math.abs(r.h).toFixed(2)+' m':'click a point off the chord',S.mouse.x+14,S.mouse.y-10)}
function draw(t){g.setTransform(dpr,0,0,dpr,0,0);const k=S.cam.k,z=clamp(k/40,.6,1.6),sim=S.sim,lv=LV();
 let gr=g.createLinearGradient(0,0,0,H);gr.addColorStop(0,'#09142b');gr.addColorStop(.6,'#0d2249');gr.addColorStop(1,'#0f3a5e');g.fillStyle=gr;g.fillRect(0,0,W,H);
 const a=s2(0,0),b=s2(W,H);g.lineWidth=1;
 for(let x=Math.floor(a.x);x<=b.x;x++){const px=w2(x,0)[0];g.strokeStyle=x%5?'rgba(120,170,255,.06)':'rgba(120,170,255,.15)';g.beginPath();g.moveTo(px,0);g.lineTo(px,H);g.stroke()}
 for(let y=Math.floor(a.y);y<=b.y;y++){const py=w2(0,y)[1];g.strokeStyle=y%5?'rgba(120,170,255,.06)':'rgba(120,170,255,.15)';g.beginPath();g.moveTo(0,py);g.lineTo(W,py);g.stroke()}
 const [x0,y0]=w2(0,0),[x1]=w2(lv.span,0),wy=w2(0,9)[1];
 g.beginPath();g.moveTo(0,H);g.lineTo(0,wy);for(let x=0;x<=W;x+=12)g.lineTo(x,wy+Math.sin(x*.02+t*1.5)*3);g.lineTo(W,H);gr=g.createLinearGradient(0,wy,0,H);gr.addColorStop(0,'rgba(34,211,238,.55)');gr.addColorStop(1,'rgba(14,90,130,.8)');g.fillStyle=gr;g.fill();
 [[-1e4,x0],[x1,1e4]].forEach(([l,r],i)=>{gr=g.createLinearGradient(0,y0,0,y0+k*14);gr.addColorStop(0,'#35607f');gr.addColorStop(1,'#122338');g.fillStyle=gr;g.fillRect(l,y0,r-l,H);
  g.fillStyle='#2dd4bf';g.fillRect(l,y0-2,r-l,5);g.strokeStyle='rgba(255,255,255,.06)';for(let j=1;j<6;j++){g.beginPath();g.moveTo(l,y0+j*k*1.5);g.lineTo(r,y0+j*k*1.5);g.stroke()}});
 const ly=w2(0,2.6)[1];g.strokeStyle='#ff8a2a';g.fillStyle='#ff8a2a';g.lineWidth=1.5;g.beginPath();g.moveTo(x0,ly);g.lineTo(x1,ly);g.moveTo(x0,ly-6);g.lineTo(x0,ly+6);g.moveTo(x1,ly-6);g.lineTo(x1,ly+6);g.stroke();
 g.font='600 12px "JetBrains Mono",monospace';g.textAlign='center';g.fillText(`${lv.span.toFixed(1)} m span`,(x0+x1)/2,ly-8);
 if(!sim){g.setLineDash([6,6]);g.strokeStyle='rgba(255,255,255,.12)';const p1=w2(-4,-12),p2=w2(lv.span+4,6);g.strokeRect(p1[0],p1[1],p2[0]-p1[0],p2[1]-p1[1]);g.setLineDash([])}
 if(S.tut&&!sim)ghost(t,z);
 // beams
 const res=sim&&sim.res&&!sim.collapsed?sim.res:null;let maxN=1;if(res)res.members.forEach(m=>maxN=Math.max(maxN,Math.abs(m.N)));
 if(!(sim&&sim.collapsed))S.beams.forEach((bm,i)=>{const pa=npos(node(bm.a)),pc=npos(node(bm.b));let [ax,ay]=w2(pa.x,pa.y),[cx,cy]=w2(pc.x,pc.y);const pr=Math.min(1,(performance.now()-(bm.born||0))/220);cx=ax+(cx-ax)*pr;cy=ay+(cy-ay)*pr;
  const crv=bm.curve?P.arcPoints(pa,pc,bm.curve,28).map(v=>w2(v.x,v.y)):null,nv=crv?Math.max(2,Math.ceil(crv.length*pr)):0,
   at=f=>{if(!crv)return{x:ax+(cx-ax)*f,y:ay+(cy-ay)*f,a:Math.atan2(cy-ay,cx-ax)};const j=Math.min(crv.length-2,Math.floor(f*(crv.length-1))),u=f*(crv.length-1)-j,[x1,y1]=crv[j],[x2,y2]=crv[j+1];return{x:x1+(x2-x1)*u,y:y1+(y2-y1)*u,a:Math.atan2(y2-y1,x2-x1)}};
  let col=P.MATERIALS[bm.mat].color,w=(3+bm.size/18)*z;const m=res&&res.members[i];
  if(m){if(S.view==='util')col=P.utilColor(m.util);else{col=m.N>=0?'#22d3ee':'#ff8a2a';w=(2+9*Math.abs(m.N)/maxN)*z}}
  const ln=()=>{g.beginPath();if(crv)crv.slice(0,nv).forEach(([x,y],j)=>j?g.lineTo(x,y):g.moveTo(x,y));else{g.moveTo(ax,ay);g.lineTo(cx,cy)}g.stroke()};g.lineCap='round';
  if(S.sel&&S.sel.t==='beam'&&S.sel.i===i){g.strokeStyle='rgba(255,138,42,.5)';g.lineWidth=w+10;ln()}
  g.strokeStyle='rgba(2,8,20,.6)';g.lineWidth=w+3;ln();g.strokeStyle=col;g.lineWidth=w;ln();
  if(m&&S.view==='force'){const o=Math.sin(t*4)*.02;[[.2+o,m.N>=0?Math.PI:0],[.8-o,m.N>=0?0:Math.PI]].forEach(([f,d])=>{const q=at(f);tri(q.x,q.y,q.a+d,5*z,'#fff')})}
  if(cfg.labels&&k>22&&!sim){g.font='500 10px "JetBrains Mono",monospace';g.fillStyle='rgba(200,220,255,.85)';g.textAlign='center';{const q=at(.5),Lc=Math.hypot(pc.x-pa.x,pc.y-pa.y);g.fillText(crv?P.arc(Lc,bm.curve).S.toFixed(2)+' m arc':Lc.toFixed(2)+' m',q.x,q.y-8*z)}}});
 // collapsing pieces
 if(sim)sim.pieces.forEach(q=>{const [ax,ay]=w2(q.a.x,q.a.y),[cx,cy]=w2(q.b.x,q.b.y);g.lineCap='round';g.strokeStyle=q.col;g.lineWidth=q.w*z;g.beginPath();if(q.h)P.arcPoints(q.a,q.b,q.h,20).forEach((v,j)=>{const [x,y]=w2(v.x,v.y);j?g.lineTo(x,y):g.moveTo(x,y)});else{g.moveTo(ax,ay);g.lineTo(cx,cy)}g.stroke()});
 // rubber band
 if(S.from!=null&&S.tool==='beam'&&node(S.from)&&S.pend)curvePreview();else if(S.from!=null&&S.tool==='beam'&&node(S.from)){const n=node(S.from),[px,py]=w2(n.x,n.y);g.setLineDash([7,5]);g.strokeStyle='#ff8a2a';g.lineWidth=2;g.beginPath();g.moveTo(px,py);g.lineTo(S.mouse.x,S.mouse.y);g.stroke();g.setLineDash([]);
  const m=s2(S.mouse.x,S.mouse.y);g.fillStyle='#ff8a2a';g.font='600 11px "JetBrains Mono",monospace';g.fillText(Math.hypot(m.x-n.x,m.y-n.y).toFixed(2)+' m · '+(Math.atan2(n.y-m.y,m.x-n.x)*180/Math.PI).toFixed(0)+'°',S.mouse.x+14,S.mouse.y-10)}
 // nodes + supports
 S.nodes.forEach(n=>{if(sim&&sim.collapsed&&!n.locked)return;const p=npos(n),[px,py]=w2(p.x,p.y),sel=S.sel&&S.sel.t==='node'&&S.sel.id===n.id,hv=S.hover===n,r=(6+(sel||hv?2:0))*z;
  if(n.sup){g.fillStyle='rgba(34,211,238,.25)';g.strokeStyle='#22d3ee';g.lineWidth=2;g.beginPath();g.moveTo(px,py);g.lineTo(px-14*z,py+22*z);g.lineTo(px+14*z,py+22*z);g.closePath();g.fill();g.stroke();
   if(n.sup==='roller'){g.fillStyle='#22d3ee';[-7,7].forEach(d=>{g.beginPath();g.arc(px+d*z,py+27*z,4*z,0,7);g.fill()})}else{g.beginPath();g.moveTo(px-18*z,py+24*z);g.lineTo(px+18*z,py+24*z);g.stroke()}}
  g.beginPath();g.arc(px,py,r,0,7);g.fillStyle='#0b1730';g.fill();g.lineWidth=2.5;g.strokeStyle=sel?'#ff8a2a':n.locked?'#ffd23f':'#e6eefc';g.stroke();
  if(sel){g.fillStyle='#ff8a2a';g.font='600 11px "JetBrains Mono",monospace';g.textAlign='left';g.fillText(`(${n.x.toFixed(1)}, ${(-n.y).toFixed(1)}) m`,px+12,py-12)}});
 // loads
 S.loads.forEach((l,i)=>{const mv=sim&&sim.lx!=null,x=mv?sim.lx-(l.off||0):l.x,y=deckY(x)+(sim&&sim.collapsed&&(!mv||(x>0&&x<lv.span))?sim.ly:0),d=KIND[l.kind],[sx,sy]=w2(x,y),w=d.w*k,h=d.h*k,sel=S.sel&&S.sel.t==='load'&&S.sel.i===i;
  g.save();g.translate(sx,sy-3);if(sel){g.strokeStyle='#ff8a2a';g.lineWidth=2;g.strokeRect(-w/2-4,-h-4,w+8,h+8)}
  if(l.kind==='block'){rr(-w/2,-h,w,h,5,'#6b7f99');rr(-w/2,-h,w,h*.22,5,'#9bb0cc')}
  else if(l.kind==='container'){rr(-w/2,-h,w,h*.92,3,'#ff8a2a');g.strokeStyle='rgba(0,0,0,.25)';g.lineWidth=2;for(let j=1;j<8;j++){g.beginPath();g.moveTo(-w/2+w*j/8,-h);g.lineTo(-w/2+w*j/8,-h*.1);g.stroke()}}
  else if(l.kind==='car'){const cc=['#e6eefc','#2ee6a6','#ff5e8a'][i%3];rr(-w/2,-h*.62,w,h*.42,4,cc);rr(-w*.26,-h,w*.5,h*.46,5,cc);rr(-w*.2,-h*.92,w*.17,h*.3,2,'#bfe3ff');rr(w*.02,-h*.92,w*.17,h*.3,2,'#bfe3ff');
   const wr=h*.17;g.fillStyle='#0a1222';[-.3,.3].forEach(f=>{g.beginPath();g.arc(w*f,-wr*.9,wr,0,7);g.fill();g.strokeStyle='#8ea3c4';g.lineWidth=2;g.stroke()})}
  else{rr(-w/2,-h*.95,w*.64,h*.8,4,l.kind==='heavy'?'#ff8a2a':'#e6eefc');rr(w*.17,-h*.72,w*.33,h*.57,5,'#2d6bff');rr(w*.3,-h*.62,w*.14,h*.22,2,'#bfe3ff');
   const wr=h*.17;g.fillStyle='#0a1222';(l.kind==='heavy'?[-.36,-.14,.1,.36]:[-.3,-.05,.33]).forEach(f=>{g.beginPath();g.arc(w*f,-wr*.9,wr,0,7);g.fill();g.strokeStyle='#8ea3c4';g.lineWidth=2;g.stroke()})}
  g.fillStyle='#fff';g.font='700 11px Sora,sans-serif';g.textAlign='center';g.fillText(l.w+' kN',0,-h-k*1.4-6);
  const ah=k*1.2,pu=1+(sim&&sim.stage>=1?Math.sin(t*5)*.08:0);g.strokeStyle=g.fillStyle='#ff8a2a';g.lineWidth=3;g.beginPath();g.moveTo(0,-h-ah*pu-4);g.lineTo(0,-h-8);g.stroke();tri(0,-h-4,Math.PI/2,7,'#ff8a2a');g.restore()});
 if(sim)sim.parts.forEach(q=>{const [px,py]=w2(q.x,q.y);g.globalAlpha=clamp(q.l,0,1);g.fillStyle=q.c;g.fillRect(px,py,4,4)});g.globalAlpha=1}
let last=0;function frame(ts){const dt=Math.min(.05,(ts-last)/1000||0);last=ts;if(S.sim)simUpdate(dt);draw(ts/1000);requestAnimationFrame(frame)}
$('#dGo').onclick=addByDim;
['#dL','#dA'].forEach(s=>$(s).addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();addByDim()}else if(e.key==='Escape'){S.from=null;S.pend=null;e.target.blur();refresh()}}));
window.addEventListener('resize',resize);resize();loadLevel(0);requestAnimationFrame(frame);
