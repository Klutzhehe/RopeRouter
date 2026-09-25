import {createServer} from 'vite';
import {mkdir,writeFile,appendFile} from 'node:fs/promises';
const [count=24,layers=2,ticks=100,seed=42017]=process.argv.slice(2).map(Number);
const directory=`artifacts/solver-audit/scale-${seed}-${count}-${layers}`;
await mkdir(directory,{recursive:true});
const server=await createServer({server:{middlewareMode:true,watch:null,hmr:false},appType:'custom'});
try{
 const {generate}=await server.ssrLoadModule('/src/core/generate.ts');
 const {SimulationSession}=await server.ssrLoadModule('/src/core/simulation.ts');
 const sim=new SimulationSession();sim.handle({version:1,session:1,type:'initialize',project:generate(seed,count,layers)});sim.handle({version:1,session:1,type:'run'});
 await writeFile(`${directory}/ticks.ndjson`,'');
 for(let i=0;i<ticks && sim.running;i++){
  const t=performance.now();const frame=sim.advance();
  const row={tick:frame.project.tick,ms:Math.round(performance.now()-t),violations:frame.report.violations.length,kinds:frame.report.violations.reduce((a,v)=>(a[v.kind]=(a[v.kind]??0)+1,a),{}),invalid:[...new Set(frame.report.violations.flatMap(v=>v.objects).filter(id=>frame.project.routes.some(r=>r.id===id)))],reason:frame.stopReason};
  await appendFile(`${directory}/ticks.ndjson`,JSON.stringify(row)+'\n');
  if(i%3===2)console.log(JSON.stringify(row));
  if(i%15===14 || !sim.running || i===ticks-1)await writeFile(`${directory}/latest.snapshot.json`,JSON.stringify(sim.solver.snapshot()));
 }
}finally{await server.close()}
