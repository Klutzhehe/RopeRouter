import {createServer} from 'vite';
import {mkdir,writeFile} from 'node:fs/promises';
const [count=24,layers=2,iterations=2000,seed=42017]=process.argv.slice(2).map(Number);
const directory=`artifacts/solver-audit/sweep-${seed}-${count}-${layers}`;
await mkdir(directory,{recursive:true});
const server=await createServer({server:{middlewareMode:true,watch:null,hmr:false},appType:'custom'});
try{
 const {generate}=await server.ssrLoadModule('/src/core/generate.ts');
 const {BoardSweep}=await server.ssrLoadModule('/src/core/pbd/board-sweep.ts');
 const sweep=new BoardSweep(generate(seed,count,layers));
 const start=performance.now();
 for(let i=0;i<count;i++){sweep.initializeRoute(i);console.log('prepared',i+1,'candidates',sweep.options[i].length,'ms',Math.round(performance.now()-start));}
 for(let i=0;i<iterations;i++){
  const solved=sweep.step();
  if(i%count===0 || solved){const report=sweep.report();console.log('sweep',i,report.violations.length,'ms',Math.round(performance.now()-start));await writeFile(`${directory}/latest.json`,JSON.stringify({...sweep.board,routes:sweep.working}));}
  if(solved){console.log('COMPLETE',JSON.stringify(sweep.report()));break;}
 }
}finally{await server.close()}
