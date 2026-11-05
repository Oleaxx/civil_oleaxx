/* STATIC BALANCE — structural engine (no DOM). Pin-jointed 2D truss, direct stiffness method [K]{u}={F}.
   World units: metres, y points DOWN. Forces in N internally. Tension is positive.
   ASSUMPTIONS (simplified model, not a design code):
   - Joints are frictionless pins; members carry axial force only (solid square sections, side = size mm).
   - A load sits on the member (the "deck member") spanning its x-position whose midpoint is closest to deck level y=0.
     It is shared between that member's end nodes by linear interpolation (simply-supported deck stringer).
     That member also gets a bending moment M = P·a·b/L, combined with axial stress: σ = N/A ± M·c/I.
   - Self-weight is lumped half to each end node. Material limits are allowable stresses (no safety factor).
   - Compression members: Euler buckling Pcr = π²EI/(K·L)², K = 1 (pinned-pinned), I = b⁴/12.
   - Serviceability: max node displacement must stay below span/200.
   - Displacements are linear-elastic (small displacement theory); the drawing scales them up and says so.
   - CURVED MEMBERS (b.curve = signed rise h of a circular arc over the chord, |h| <= L/2, i.e. at most a semicircle):
     still a pin-ended two-force member, so the end thrust N acts along the chord and the section at offset e(s) from the chord
     carries M = N*e(s), largest at the apex (M = N*h). Chord stiffness by Castigliano (axial + bending strain energy):
     1/k = (integral cos^2(phi) ds)/(EA) + (integral e^2 ds)/(EI), so an arc is softer than EA/L. Weight and cost use the arc length.
     Apex stress: sigma = N/A +/- kw*(Mload + N*h)*c/I, kw = Winkler-Bach inner-fibre factor (rectangular section).
     In compression the moment is amplified by 1/(1 - N/Pcr) (beam-column effect). Shear strain energy is ignored.
   - MOVING VEHICLES (lv.moving): each vehicle is a set of axle point loads (AXLES: share of its weight, offset from its centre) that
     rolls across the span; the structure is solved statically at every position (quasi-static influence-line sweep) and each member keeps
     its worst utilisation. A dynamic load allowance DLA = 1.15 (impact/bounce, as in bridge codes) multiplies the vehicle weight. */
const Physics=(()=>{
const G=9.81,THRESH=[.5,.8,1],COLS=['#2ee6a6','#ffd23f','#ff8a2a','#ff3b4e'];
const MATERIALS={
 timber:{name:'Timber (softwood)',E:11e9,rho:600,st:40e6,sc:30e6,price:1.6,color:'#e0a766'},
 steel:{name:'Structural steel',E:200e9,rho:7850,st:250e6,sc:250e6,price:2.8,color:'#7fb0ff'},
 aluminium:{name:'Aluminium 6061',E:69e9,rho:2700,st:150e6,sc:150e6,price:6,color:'#c3d0e4'},
 concrete:{name:'Reinforced concrete',E:30e9,rho:2400,st:12e6,sc:30e6,price:.5,color:'#9aa6b2'}};
const SIZES=[40,60,90];
const sec=mm=>{const s=mm/1000;return{A:s*s,I:s**4/12}};
const MINRISE=.02,DLA=1.15,AXLES={car:[[.7,.5],[-.7,.5]],truck:[[1.2,.4],[-1,.6]],heavy:[[1.9,.25],[.1,.375],[-1.9,.375]]};
/* Circular arc over chord L with signed rise h (positive = left of the a->b direction, i.e. up for a left-to-right beam). */
function arc(L,h){const hm=Math.min(Math.abs(h||0),L/2);if(!(hm>1e-9))return{hm:0,h:0,S:L,R:Infinity,al:0,i1:L,i2:0};
 const R=(L*L/4+hm*hm)/(2*hm),al=Math.asin(Math.min(1,L/(2*R))),co=Math.cos(al),sc=Math.sin(al)*co;
 return{hm,h:Math.sign(h)*hm,S:2*R*al,R,al,i1:R*(al+sc),i2:R**3*(al-3*sc+2*al*co*co)}}
function arcPoints(a,b,h,n=32){const L=Math.hypot(b.x-a.x,b.y-a.y),A=arc(L,h);if(!A.hm)return[{x:a.x,y:a.y},{x:b.x,y:b.y}];
 const cx=(b.x-a.x)/L,cy=(b.y-a.y)/L,nx=cy,ny=-cx,sg=Math.sign(h),pts=[];
 for(let k=0;k<=n;k++){const th=-A.al+2*A.al*k/n,u=L/2+A.R*Math.sin(th),v=sg*A.R*(Math.cos(th)-Math.cos(A.al));pts.push({x:a.x+u*cx+v*nx,y:a.y+u*cy+v*ny})}
 pts[0]={x:a.x,y:a.y};pts[n]={x:b.x,y:b.y};return pts}
function arcYAt(a,b,h,x){const p=arcPoints(a,b,h,64);let y=null;for(let k=0;k<p.length-1;k++){const x1=p[k].x,x2=p[k+1].x;if(Math.abs(x2-x1)<1e-12||x<Math.min(x1,x2)-1e-9||x>Math.max(x1,x2)+1e-9)continue;
 const v=p[k].y+(p[k+1].y-p[k].y)*(x-x1)/(x2-x1);if(y===null||v<y)y=v}return y}
/* Three-point arc, like CAD: start a, end b, and a point p the arc passes through. Returns {h} or {err}. */
function curveThrough(a,b,p){const L=Math.hypot(b.x-a.x,b.y-a.y);if(L<1e-9)return{err:'Beam is too short.'};
 const cx=(b.x-a.x)/L,cy=(b.y-a.y)/L,px=p.x-a.x,py=p.y-a.y,u=px*cx+py*cy,d=px*cy-py*cx;
 if(Math.abs(d)<1e-6)return{err:'That point is on the chord. Click a point off the line to bend the beam.'};
 const v0=((u-L/2)**2+d*d-L*L/4)/(2*d),R=Math.hypot(L/2,v0);
 if(v0*d>1e-9)return{err:'That curve would be more than a semicircle. Click a point nearer the beam.'};
 const h=Math.sign(d)*(R-Math.abs(v0));
 if(Math.abs(h)<MINRISE*L)return{err:'The curve is too shallow. Click further from the beam, or use a straight beam.'};
 return{h:+h.toFixed(3)}}
/* Winkler-Bach: inner/outer-fibre bending stress of a curved rectangular section relative to the straight-beam value My/I. */
function winkler(R,d){const ri=R-d/2,ro=R+d/2,rn=d/Math.log1p(d/ri),e=R-rn;if(!(e>0))return 1;const A=d*d,I=d**4/12;
 return Math.max((rn-ri)/(A*e*ri),(ro-rn)/(A*e*ro))/((d/2)/I)}
const utilColor=u=>u<THRESH[0]?COLS[0]:u<THRESH[1]?COLS[1]:u<THRESH[2]?COLS[2]:COLS[3];
const nodeMap=ns=>new Map(ns.map((n,i)=>[n.id,i]));
function memberGeom(model){const idx=nodeMap(model.nodes);return model.beams.map(b=>{const i=idx.get(b.a),j=idx.get(b.b),p=model.nodes[i],q=model.nodes[j],dx=q.x-p.x,dy=q.y-p.y,L=Math.hypot(dx,dy);
 const cv=b.curve?arc(L,b.curve):null,cu=!!(cv&&cv.hm>0);
 return{b,i,j,dx,dy,L,c:dx/L,s:dy/L,m:MATERIALS[b.mat],...sec(b.size),curved:cu,S:cu?cv.S:L,R:cu?cv.R:0,hm:cu?cv.hm:0,h:cu?cv.h:0,i1:cu?cv.i1:L,i2:cu?cv.i2:0}})}
function deckBeam(geo,nodes,x,deckY=0){let best=-1,bd=1e9;geo.forEach((q,k)=>{if(Math.abs(q.dx)<1e-6)return;const a=nodes[q.i].x,c=nodes[q.j].x;if(x<Math.min(a,c)-1e-9||x>Math.max(a,c)+1e-9)return;
 const d=Math.abs((nodes[q.i].y+nodes[q.j].y)/2-(q.curved?q.c*q.h:0)-deckY);if(d<bd){bd=d;best=k}});return best}
function solve(model,loads){
 const nodes=model.nodes,geo=memberGeom(model),nd=nodes.length*2,used=new Set();
 const K=Array.from({length:nd},()=>new Float64Array(nd)),F=new Float64Array(nd);
 geo.forEach(q=>{used.add(q.i);used.add(q.j);q.k=q.curved?1/(q.i1/(q.m.E*q.A)+q.i2/(q.m.E*q.I)):q.m.E*q.A/q.L;q.kr=q.k*q.L/(q.m.E*q.A);q.Mb=0;const d=[2*q.i,2*q.i+1,2*q.j,2*q.j+1],v=[q.c,q.s,-q.c,-q.s];
  for(let a=0;a<4;a++)for(let b=0;b<4;b++)K[d[a]][d[b]]+=q.k*v[a]*v[b];
  const W=q.m.rho*q.A*q.S*G;F[d[1]]+=W/2;F[d[3]]+=W/2});
 loads.forEach(l=>{const k=deckBeam(geo,nodes,l.x);if(k<0)throw new Error('LOAD_OFF_DECK');const q=geo[k],t=(l.x-nodes[q.i].x)/q.dx,P=l.w*1000;
  F[2*q.i+1]+=P*(1-t);F[2*q.j+1]+=P*t;q.Mb+=P*q.L*t*(1-t)});
 const fix=new Set();nodes.forEach((n,i)=>{if(!used.has(i)||n.sup==='pin'){fix.add(2*i);fix.add(2*i+1)}else if(n.sup==='roller')fix.add(2*i+1)});
 const fr=[];for(let d=0;d<nd;d++)if(!fix.has(d))fr.push(d);
 const n=fr.length,A=fr.map(r=>{const row=new Float64Array(n+1);fr.forEach((c,j)=>row[j]=K[r][c]);row[n]=F[r];return row});
 let sc=0;for(let i=0;i<nd;i++)sc=Math.max(sc,K[i][i]);
 for(let c=0;c<n;c++){let p=c;for(let r=c+1;r<n;r++)if(Math.abs(A[r][c])>Math.abs(A[p][c]))p=r;
  if(Math.abs(A[p][c])<1e-9*sc)throw new Error('SINGULAR');[A[c],A[p]]=[A[p],A[c]];
  for(let r=c+1;r<n;r++){const f=A[r][c]/A[c][c];if(f)for(let j=c;j<=n;j++)A[r][j]-=f*A[c][j]}}
 const x=new Float64Array(n);for(let i=n-1;i>=0;i--){let s=A[i][n];for(let j=i+1;j<n;j++)s-=A[i][j]*x[j];x[i]=s/A[i][i]}
 const u=new Float64Array(nd);fr.forEach((d,i)=>u[d]=x[i]);
 let maxDisp=0;nodes.forEach((_,i)=>maxDisp=Math.max(maxDisp,Math.hypot(u[2*i],u[2*i+1])));
 if(!isFinite(maxDisp)||maxDisp>2)throw new Error('SINGULAR');
 const members=geo.map(q=>{const N=q.k*(q.c*(u[2*q.j]-u[2*q.i])+q.s*(u[2*q.j+1]-u[2*q.i+1])),sig=N/q.A,Pcr=Math.PI**2*q.m.E*q.I/(q.L*q.L);
  const Mc=q.curved?Math.abs(N)*q.hm:0,kw=q.curved?winkler(q.R,q.b.size/1000):1,sb0=(q.Mb+Mc)*kw*(q.b.size/2000)/q.I,r=N<0?-N/Pcr:0,
   amp=q.curved&&N<0?(r<1?Math.min(1/(1-r),50):50):1,sb=sb0*amp,bm=q.curved&&Mc>=q.Mb?'curvature':'bending';let util,mode;
  if(N>=0){util=(sig+sb)/q.m.st;mode=sb>sig?bm:'yield'}
  else{const cr=(-sig+sb)/q.m.sc,bk=-N/Pcr+sb0/q.m.sc;util=Math.max(cr,bk);mode=bk>=cr?'buckling':sb>-sig?bm:'crushing';if(q.curved&&r>=1){util=Math.max(util,r);mode='buckling'}}
  return{N,sigma:sig,sb,Pcr,util,mode,L:q.L,curved:q.curved,Mc,kr:q.kr}});
 const reactions=[];nodes.forEach((n,i)=>{if(!n.sup||!used.has(i))return;let rx=-F[2*i],ry=-F[2*i+1];for(let j=0;j<nd;j++){rx+=K[2*i][j]*u[j];ry+=K[2*i+1][j]*u[j]}
  reactions.push({id:n.id,sup:n.sup,rx:rx/1000,ry:-ry/1000})});
 return{u,members,reactions,maxDisp}}
function cost(model){const idx=nodeMap(model.nodes);let c=0;model.beams.forEach(b=>{const p=model.nodes[idx.get(b.a)],q=model.nodes[idx.get(b.b)],m=MATERIALS[b.mat];const Lc=Math.hypot(q.x-p.x,q.y-p.y);c+=m.rho*(b.size/1000)**2*(b.curve?arc(Lc,b.curve).S:Lc)*m.price});
 return Math.round(c+model.nodes.filter(n=>!n.locked).length*20)}
function inspect(model,loads,lv){
 const nodes=model.nodes,idx=nodeMap(nodes),checks=[],adj=nodes.map(()=>[]);
 model.beams.forEach(b=>{const i=idx.get(b.a),j=idx.get(b.b);adj[i].push(j);adj[j].push(i)});
 const seen=new Set(),st=[];nodes.forEach((n,i)=>{if(n.sup&&adj[i].length){seen.add(i);st.push(i)}});
 while(st.length){const i=st.pop();adj[i].forEach(j=>{if(!seen.has(j)){seen.add(j);st.push(j)}})}
 const joints=adj.filter(a=>a.length).length,lost=nodes.filter((n,i)=>adj[i].length&&!seen.has(i)).length;
 const r=nodes.reduce((a,n,i)=>a+(adj[i].length?(n.sup==='pin'?2:n.sup==='roller'?1:0):0),0),m=model.beams.length;
 const side=f=>nodes.some((n,i)=>n.sup&&adj[i].length&&f(n));
 checks.push({label:'Bridge has members',ok:m>0,msg:'Add beams between nodes to build a bridge.'});
 checks.push({label:'All members connected to a support',ok:m>0&&lost===0,msg:`${lost} node(s) are not connected to any support.`});
 checks.push({label:'Both platforms are supported',ok:side(n=>n.x<=.001)&&side(n=>n.x>=lv.span-.001),msg:'Connect a supported node on the left platform and one on the right platform.'});
 checks.push({label:'Enough constraints: m + r ≥ 2j',ok:m+r>=2*joints&&m>0,msg:`m + r = ${m+r} but 2j = ${2*joints}: the structure is a mechanism. Add members to make triangles.`});
 const geo=memberGeom(model);
 if(lv.moving){let gap=false;for(let x=.1;x<=lv.span-.099;x+=.1)if(deckBeam(geo,nodes,x)<0){gap=true;break}
 checks.push({label:'Deck is continuous for the vehicles',ok:m>0&&!gap,msg:'There is a gap in the deck, so a vehicle would fall through. Connect beams along the deck from the left platform to the right platform.'})}
 else checks.push({label:'Load rests on the deck',ok:loads.every(l=>deckBeam(geo,nodes,l.x)>=0),msg:'A load is not above any member. Move it onto the bridge.'});
 let ok=checks.every(c=>c.ok),msg='';
 if(ok)try{solve(model,lv.moving?[]:loads)}catch(e){ok=false;msg=e.message==='SINGULAR'?'The stiffness matrix is singular: part of the structure can move freely (unstable or improperly supported).':'Solver error: '+e.message}
 checks.push({label:'Stiffness matrix [K] solvable',ok:ok,msg});
 return{checks,ok:checks.every(c=>c.ok)}}
function analyseAll(model,loads,lv){
 const frames=[];
 if(lv.moving){const mo=Math.max(...loads.map(l=>l.off||0)),T=lv.span+mo+4,n=Math.max(24,Math.round(T*2.5));
  for(let f=0;f<=n;f++){const xl=-1.6+T*f/n,ax=[];
   loads.forEach(l=>(AXLES[l.kind]||[[0,1]]).forEach(([dx,sh])=>{const x=xl-(l.off||0)+dx;if(x>=.1&&x<=lv.span-.1)ax.push({x,w:l.w*sh*DLA})}));
   frames.push({x:xl,res:solve(model,ax)})}}
 else frames.push({x:null,res:solve(model,loads)});
 const util=model.beams.map(()=>0);let failFrame=-1,maxD=0,maxS=0,crit={i:-1,u:-1,mode:'',fi:0};
 frames.forEach((f,fi)=>{f.res.members.forEach((m,i)=>{util[i]=Math.max(util[i],m.util);maxS=Math.max(maxS,Math.abs(m.sigma)+m.sb);if(m.util>crit.u)crit={i,u:m.util,mode:m.mode,fi}});
  maxD=Math.max(maxD,f.res.maxDisp);if(failFrame<0&&f.res.members.some(m=>m.util>1))failFrame=fi});
 return{frames,util,maxD,maxS,crit,failFrame,lim:lv.span/200,deflOK:maxD<=lv.span/200,avgU:util.reduce((a,b)=>a+b,0)/Math.max(1,util.length)}}
const score=(a,c,budget,nb)=>Math.max(0,Math.round(400+300*Math.max(0,1-c/budget)+200*Math.min(1,a.avgU/.6)-3*nb));
function stability(model){if(!model.beams.length)return{ok:false,t:'No bridge yet'};try{solve(model,[]);return{ok:true,t:'Stable'}}catch(e){return{ok:false,t:'Unstable / disconnected'}}}
return{DLA,MATERIALS,SIZES,THRESH,sec,utilColor,solve,inspect,analyseAll,cost,deckBeam,memberGeom,score,stability,arc,arcPoints,arcYAt,curveThrough,MINRISE}})();
