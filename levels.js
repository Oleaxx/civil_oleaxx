/* Level data. span = metres between abutments; budget in $; loads: x = metres from left abutment, w = kN.
   moving:true = every load is a vehicle (off = metres behind the lead vehicle) that drives across; every member is checked at every position.
   wr = [min,max] kN the player may set for the load. */
const LEVELS=[
{id:1,name:'The First Span',span:8,budget:4000,loads:[{x:4,w:3,kind:'block'}],
 obj:'Join the two platforms and carry a 3 kN block.',teach:'Nodes, beams and supports. A long single beam must resist bending, so try adding a node under the load.'},
{id:2,name:'The First Load',span:10,budget:5000,wr:[5,40],loads:[{x:5,w:20,kind:'truck'}],
 obj:'Carry a 20 kN delivery truck. Drag it along the deck and watch the support reactions change.',teach:'Vertical forces and equilibrium: the support reactions always add up to the applied load.'},
{id:3,name:'Triangular Strength',span:12,budget:7000,wr:[20,80],loads:[{x:6,w:60,kind:'truck'}],
 obj:'Build a truss that carries a 60 kN truck.',teach:'Triangles cannot change shape. Inspect which members are in tension and which are in compression.'},
{id:4,name:'Material Selection',span:14,budget:6000,loads:[{x:7,w:80,kind:'container'}],
 obj:'Carry an 80 kN container and stay under budget.',teach:'Young’s modulus, strength and price differ per material. Timber buckles easily; concrete is weak in tension.'},
{id:5,name:'Two Cars Crossing',span:14,budget:7500,moving:true,loads:[{off:0,x:-1.6,w:60,kind:'car'},{off:3.2,x:-4.8,w:60,kind:'car'}],
 obj:'Two 60 kN cars drive across, one behind the other. Every member is checked at every car position.',teach:'Moving loads: the worst car position, and the worst member, change as the cars roll. Two cars on the span at once add their effects.'},
{id:6,name:'Maximum Efficiency',span:16,budget:8500,moving:true,loads:[{off:0,x:-1.6,w:45,kind:'car'},{off:3.2,x:-4.8,w:45,kind:'car'},{off:6.4,x:-8,w:45,kind:'car'}],
 obj:'Three 45 kN cars cross in convoy on a tight budget. Aim for three stars.',teach:'Optimisation under moving load: members peak when the convoy is centred. Put strong sections only where the numbers demand them.'},
{id:7,name:'Engineering Master',span:20,budget:16000,moving:true,loads:[{off:0,x:-1.6,w:100,kind:'heavy'},{off:8,x:-9.6,w:70,kind:'truck'}],
 obj:'A 100 kN heavy truck followed by a 70 kN truck cross the span. Both can be on the bridge at the same time.',teach:'Advanced trusses: several heavy axles at once, a dynamic allowance for bounce, and deck members that must not bend.'}];
/* Progressive hints: they point at ideas to explore without giving the design away. */
const HINTS={
1:['Both ends of the bridge must rest on something. Check the supports at each platform edge.','A beam that carries a load between its ends bends. How could you shorten the distance it spans unsupported?','Move the block along the deck and compare how the utilisation colours change.'],
2:['Drag the truck and watch the two support reactions. What do they always add up to?','Where would a node need to sit so the truck’s weight goes straight into a member end?','Not every member needs the same section. Let the forces you see guide the sizes.'],
3:['A four-sided frame can wobble. Which shape cannot change without a member changing length?','Run the simulation and read the colours: which members are being pulled, and which pushed?','Long members in compression are the usual troublemakers. What could make them shorter or stockier?'],
4:['Compare E, strength and price in the panel for each material. None is best at everything.','Which materials tolerate being pulled? Which dislike being pushed over long lengths?','Does every member in a bridge have to be the same material?'],
5:['Run once and watch the colours change as the cars roll: the critical member is not always the same one.','A car axle that sits between two joints bends the beam under it. How could joints help?','Two cars on the span at once add up. Where is the structure most stressed when both are on it?'],
6:['Every member is checked at every car position. A member that never leaves green is paying for strength it never uses.','After a run, look at which members peak when the convoy is centred on the span.','Members that are only pulled need no buckling margin. Heavy sections belong where the numbers demand them.'],
7:['Think about when each vehicle is at its worst position, and when both are on the span together.','Impact and bounce make a moving load a little harsher than a parked one.','Ideas from earlier levels still apply: triangles, joints under the load path, sections matched to the force.']};
LEVELS.forEach(l=>l.hints=HINTS[l.id]);

/* Guided tutorials. Steps complete by themselves when the plan is on the canvas (coordinates in metres, y negative = up).
   n = joints, b = beams [x1,y1,x2,y2], m/z = required material and section, sup = [x,y,type], run = pass the simulation.
   p = what to do, w = why (shown in the EXPLANATION drop-down). */
const TUTORIALS=[
{id:'t1',tag:'Tutorial 1',name:'Triangles',span:6,budget:1000,nosup:true,loads:[{x:3,w:60,kind:'truck'}],
 blurb:'Supports, joints and triangles. A small truss built step by step, one steady 60 kN load.',
 obj:'Follow the glowing guides to build a small truss that carries a 60 kN truck.',teach:'Supports, joints, triangles, and putting the load straight onto a joint.',
 steps:[
 {h:'Set the supports',tool:'support',sup:[[0,0,'pin'],[6,0,'roller']],p:'Choose the <b>Support</b> tool. Click the left platform node once (pin) and the right one twice (roller).',
  w:'A pin stops a bridge moving in any direction; a roller only stops it dropping. Together they hold the bridge in place yet let it expand and shrink with temperature, so no hidden sideways force builds up. Without supports the loads would have nowhere to go.'},
 {h:'Put a joint under the load',tool:'node',n:[[3,0]],p:'Choose the <b>Node</b> tool and click the glowing circle on the deck, right under the truck.',
  w:'A load that presses on the middle of a beam bends it, and slim beams are weak in bending. A load that lands on a joint goes straight into the members as push or pull, which is what they do best.'},
 {h:'Build the bottom chord',tool:'beam',m:'timber',z:40,b:[[0,0,3,0],[3,0,6,0]],p:'Choose the <b>Beam</b> tool, pick the beam type below, then click the left node, the middle node and the right node.',
  w:'The bottom chord is stretched as the bridge sags (about 23 kN here). A stretched member cannot buckle, so a thin, cheap timber section is enough. Steel here would be wasted money.'},
 {h:'Raise two top joints',tool:'node',n:[[1.5,-2],[4.5,-2]],p:'Choose the <b>Node</b> tool and click both glowing circles above the deck.',
  w:'Height is strength. The further the top chord sits above the bottom chord, the smaller the push and pull in each one, because the bending effect is carried by a pair of forces with a long lever arm.'},
 {h:'Add the top chord',tool:'beam',m:'steel',z:40,b:[[1.5,-2,4.5,-2]],p:'Press <b>Esc</b> to end the last chain, pick the steel type below, then click the two top joints.',
  w:'The top chord is squeezed (about 46 kN, the biggest force in this truss) and a squeezed member can buckle sideways. Steel resists buckling far better than timber, so the member in compression gets the strong material.'},
 {h:'Close the triangles',tool:'beam',m:'steel',z:40,b:[[0,0,1.5,-2],[1.5,-2,3,0],[3,0,4.5,-2],[4.5,-2,6,0]],p:'With the steel beam, click in order: left node, top joint, middle node, top joint, right node.',
  w:'A triangle cannot change shape unless one side changes length, which is why trusses are built from triangles. The two diagonals at the load hang the truck from the top chord (pulled); the outer two push it down to the supports (squeezed).'},
 {h:'Run the simulation',run:true,p:'Press <b>Run simulation</b> and watch the inspection, the loading and the result.',
  w:'The test checks every member for yielding, crushing and buckling, and measures how far the bridge bends. Colours show how hard each member works. A perfect design is not all green: members that stay cold are material you paid for and did not need.'}],
 done:{t:'Your first efficient truss',p:'The truck is carried, the cost is low and every member does real work.',
  w:'Timber where members are only pulled, steel where they are pushed, the load on a joint, and every shape closed with triangles. The top chord works near its limit and the bottom chord has spare capacity, which is the cheapest way to carry this load.'}},
{id:'t2',tag:'Tutorial 2',name:'Materials & Sizes',span:12,budget:3000,loads:[{x:6,w:110,kind:'container'}],
 blurb:'Matching material and section size to the job of each member under a heavier 110 kN load.',
 obj:'Build a Pratt truss that carries a 110 kN container, choosing a material and size for each group of members.',teach:'Different members do different jobs, so they deserve different materials and sections.',
 steps:[
 {h:'Lay out the joints',tool:'node',n:[[3,0],[6,0],[9,0],[3,-3],[6,-3],[9,-3]],p:'Choose the <b>Node</b> tool and click all six glowing circles: three on the deck and three 3 m above it.',
  w:'Joints every 3 m keep members short. Buckling capacity falls with the square of length, so a member half as long is four times harder to buckle. The container sits on the middle deck joint, so no beam has to bend to carry it.'},
 {h:'Bottom chord: timber',tool:'beam',m:'timber',z:40,b:[[0,0,3,0],[3,0,6,0],[6,0,9,0],[9,0,12,0]],p:'Choose the <b>Beam</b> tool and the timber type below, then click the four deck nodes from left to right.',
  w:'The bottom chord is pulled (about 58 kN). Pulled members only need enough cross-section area; they cannot buckle. Timber 40 mm does it at about 90% of its capacity for a fraction of the price of steel.'},
 {h:'Top chord: steel 60',tool:'beam',m:'steel',z:60,b:[[3,-3,6,-3],[6,-3,9,-3]],p:'Press <b>Esc</b>, choose steel 60 mm below, then click the three top joints from left to right.',
  w:'The top chord carries the biggest force in the truss, a squeeze of about 114 kN. A 60 mm section has about five times the stiffness against sideways bending of a 40 mm one (I grows with the fourth power of depth), so it buckles much later.'},
 {h:'Verticals: timber 40',tool:'beam',m:'timber',z:40,b:[[3,0,3,-3],[6,0,6,-3],[9,0,9,-3]],p:'Press <b>Esc</b>, choose timber 40 mm, then draw the three verticals between the deck and top joints.',
  w:'Under this load the verticals carry almost nothing (under 1 kN). Their job is to keep the two chords apart. A member that does little should be the cheapest one you can use.'},
 {h:'Diagonals: steel 60',tool:'beam',m:'steel',z:60,b:[[0,0,3,-3],[3,-3,6,0],[6,0,9,-3],[9,-3,12,0]],p:'Choose steel 60 mm, then click in order: left node, top joint, middle node, top joint, right node.',
  w:'The diagonals carry the shear, the load travelling to the supports. The outer pair is squeezed (about 82 kN) and the inner pair is pulled, so they need a strong material that also resists buckling.'},
 {h:'Run the simulation',run:true,p:'Press <b>Run simulation</b>. Check which members stay cold and which glow.',
  w:'Compare the colours with your choices: heavily used members should be near their limit, lightly used ones cheap. That balance is what a three-star design looks like.'}],
 done:{t:'Right material, right place',p:'Four groups of members, each matched to its job, carry 110 kN for a low cost.',
  w:'Cheap timber works for members that are pulled or barely loaded. Steel goes where members are squeezed and could buckle. Using one strong section everywhere would have worked, but it would cost several times more.'}},
{id:'t3',tag:'Tutorial 3',name:'Crossing Traffic',span:12,budget:4800,moving:true,loads:[{off:0,x:-1.6,w:60,kind:'truck'}],
 blurb:'A 60 kN truck drives over the bridge. See how forces move through members as it rolls along.',
 obj:'Build a six-panel Pratt truss, then press Run and watch the truck cross. Every member is checked at every position.',teach:'Moving loads: the critical member changes with the truck position, and moving vehicles add an impact allowance of 15%.',
 steps:[
 {h:'Deck: steel 90',tool:'beam',m:'steel',z:90,b:[[0,0,2,0],[2,0,4,0],[4,0,6,0],[6,0,8,0],[8,0,10,0],[10,0,12,0]],p:'Choose the <b>Beam</b> tool and steel 90 mm. Click the left node, then every 2 m along the deck (new joints appear as you click).',
  w:'The truck drives along the bottom chord, so it must be continuous. Joints every 2 m keep each wheel close to a joint, so deck beams are pulled rather than bent. The deck is pulled by up to 58 kN as the truck nears midspan, so it gets strong steel.'},
 {h:'End posts: steel 60',tool:'beam',m:'steel',z:60,b:[[0,0,2,-3],[10,-3,12,0]],p:'Press <b>Esc</b>, choose steel 60 mm. Click the left node, then the glowing top joint. Press Esc, click the right node, then its top joint.',
  w:'When the truck is near one end, almost its whole weight goes down the inclined end post (about 67 kN, squeezed). It is the first member to feel the truck, so it needs steel.'},
 {h:'Top chord: timber 90',tool:'beam',m:'timber',z:90,b:[[2,-3,4,-3],[4,-3,6,-3],[6,-3,8,-3],[8,-3,10,-3]],p:'Press <b>Esc</b>, choose timber 90 mm. Click the four top joints from left to right.',
  w:'The top chord is squeezed by up to 64 kN, yet at only 2 m long a stocky 90 mm timber section resists buckling and is much cheaper than steel. Short, stocky and cheap beats long, slim and strong.'},
 {h:'Verticals: timber 90',tool:'beam',m:'timber',z:90,b:[[2,0,2,-3],[4,0,4,-3],[6,0,6,-3],[8,0,8,-3],[10,0,10,-3]],p:'Press <b>Esc</b>, stay on timber 90 mm and draw the five verticals between the deck and the top joints.',
  w:'Verticals mostly hold the chords apart. Their force changes as the truck passes each one, but it stays modest (under 40 kN), so cheap stocky timber works.'},
 {h:'Diagonals: timber 90',tool:'beam',m:'timber',z:90,b:[[2,-3,4,0],[4,-3,6,0],[6,0,8,-3],[8,0,10,-3]],p:'Draw the four inner diagonals: top joint to the next deck joint toward midspan, on both halves.',
  w:'The diagonals carry the shear. Their force depends on where the truck is, and the worst case for each one happens at a different position. That is why the simulation checks every member at every truck position, not just at midspan.'},
 {h:'Run the simulation',run:true,p:'Press <b>Run simulation</b> and watch the truck cross. Notice which members change colour as it moves.',
  w:'Watch the colours travel: the end posts and deck load up as the truck approaches, the top chord peaks near midspan. The result also includes a 15% impact allowance on the truck weight for bounce, as bridge codes do.'}],
 done:{t:'A bridge ready for traffic',p:'The truck crosses safely and every member is used efficiently.',
  w:'A moving load tests each member at many positions, so the worst case differs member by member. Sizing each group to its own worst case, strong steel on the deck and end posts and stocky timber elsewhere, gives a safe bridge for a modest cost.'}}];
