import fs from 'node:fs';
import { execute } from './tools.mjs';
const [name,json='{}']=process.argv.slice(2);
try {
  const args=JSON.parse(json.startsWith('@')?fs.readFileSync(json.slice(1),'utf8'):json);
  const result=await execute(name,args);console.log(JSON.stringify(result,null,2));
  if(name==='mc_run_scenario'&&!result.passed)process.exitCode=1;
}catch(e){console.error(e.message);process.exitCode=1;}
