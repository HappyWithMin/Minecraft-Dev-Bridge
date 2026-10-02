// Explicit live check against the configured, managed test client. Run after mc_launch.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { config, root } from './paths.mjs';
const c=config();
const installed=JSON.parse(fs.readFileSync(path.join(os.homedir(),'plugins','minecraft-dev-bridge','.mcp.json'),'utf8')).mcpServers.minecraft_dev_bridge;
const child=spawn(installed.command,installed.args,{windowsHide:true,stdio:['pipe','pipe','pipe']});
const lines=readline.createInterface({input:child.stdout}), pending=new Map();let id=0,stderr='';
child.stderr.on('data',b=>stderr+=b);
lines.on('line',line=>{const result=JSON.parse(line);pending.get(result.id)?.(result);});
function call(method,params={}) {
  return new Promise((resolve,reject)=>{
    const next=++id,t=setTimeout(()=>{pending.delete(next);reject(Error('MCP live timeout: '+stderr));},25000);
    pending.set(next,result=>{clearTimeout(t);pending.delete(next);resolve(result);});
    child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:next,method,params})+'\n');
  });
}
async function tool(name,args={}) {
  const response=await call('tools/call',{name,arguments:args});
  if(response.error||response.result.isError)throw Error(JSON.stringify(response));
  return response.result;
}
const data=r=>JSON.parse(r.content.find(b=>b.type==='text').text);
const checks=[], evidence=path.join(root,'evidence');fs.mkdirSync(evidence,{recursive:true});
try {
  const init=await call('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'live-verification',version:'1.0'}});
  assert.equal(init.result.protocolVersion,'2025-06-18');
  const list=await call('tools/list');assert.equal(list.result.tools.length,21);checks.push('MCP initialize and 21 tools');
  const state=data(await tool('mc_status'));
  assert.equal(state.connected,true);assert.equal(state.hidden,true);assert.equal(state.focused,false);assert.equal(state.mouseGrabbed,false);
  checks.push('Connected, hidden, unfocused, mouse not captured');
  const url=`http://127.0.0.1:${c.clientPort}/rpc`;
  let response=await fetch(url,{method:'POST',body:JSON.stringify({op:'status'})});assert.equal(response.status,401);
  const token=fs.readFileSync(path.join(c.runtimeDir,'client','bridge-token.txt'),'utf8').trim();
  response=await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${token}`,Origin:'https://example.com'},body:JSON.stringify({op:'status'})});assert.equal(response.status,403);
  checks.push('Missing token and browser-origin requests rejected');
  await tool('mc_camera',{mode:'THIRD_PERSON_FRONT'});
  await tool('mc_look',{yaw:0,pitch:0});
  await new Promise(r=>setTimeout(r,200));
  const screenshot=await tool('mc_screenshot',{width:960,height:600});
  const png=Buffer.from(screenshot.content.find(b=>b.type==='image').data,'base64');
  assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  assert.equal(png.readUInt32BE(16),960);assert.equal(png.readUInt32BE(20),600);
  fs.writeFileSync(path.join(evidence,'hidden-third-person.png'),png);
  checks.push('MCP returns an actual 960x600 PNG image');
  const capture=data(await tool('mc_capture_start',{width:1280,height:720,fps:5,durationMs:600}));
  let sequence;const deadline=Date.now()+10000;
  do {await new Promise(r=>setTimeout(r,100));sequence=data(await tool('mc_capture_status',{id:capture.id}));}while(!sequence.terminal&&Date.now()<deadline);
  assert.equal(sequence.state,'completed');assert.ok(sequence.savedFrames>0);assert.ok(fs.existsSync(sequence.viewerPath));
  const capturedFrame=await tool('mc_capture_frame',{id:capture.id,index:0});
  const framePng=Buffer.from(capturedFrame.content.find(b=>b.type==='image').data,'base64');
  assert.equal(framePng.readUInt32BE(16),1280);assert.equal(framePng.readUInt32BE(20),720);
  checks.push('Installed MCP starts, polls and returns continuous frames with an offline viewer');
  const failed=await call('tools/call',{name:'mc_run_scenario',arguments:{name:'capture-failure-cleans-up',steps:[{tool:'mc_capture_start',args:{width:1280,height:720,fps:5,durationMs:10000}},{tool:'mc_input',args:{keys:['sneak'],durationMs:10000}},{waitMs:500},{assert:{path:'hidden',equals:false}}]}});
  assert.equal(failed.result.isError,true);const captureCleanup=data(failed.result);
  assert.match(captureCleanup.error,/Assertion failed/);assert.equal(captureCleanup.captures[0].state,'stopped');
  const cleaned=data(await tool('mc_status'));assert.equal(cleaned.capture,null);assert.equal(cleaned.inputRemainingMs,0);assert.deepEqual(cleaned.render,state.render);
  checks.push('Failed scenario stops its capture, releases input and restores rendering');
  const running=call('tools/call',{name:'mc_run_scenario',arguments:{name:'mcp-stop-cancels-active-scenario',steps:[{tool:'mc_input',args:{keys:['sneak'],durationMs:10000}},{waitMs:4000},{tool:'mc_input',args:{keys:['forward'],durationMs:1000}}]}});
  await new Promise(r=>setTimeout(r,250));
  const stopStarted=Date.now();await tool('mc_stop');assert.ok(Date.now()-stopStarted<2000);
  const stopped=await running;assert.equal(stopped.result.isError,true);
  const stoppedReport=data(stopped.result);assert.match(stoppedReport.error,/cancelled/);assert.ok(stoppedReport.steps.length<3);
  assert.equal(data(await tool('mc_status')).inputRemainingMs,0);
  checks.push('Stop preempts an active scenario and prevents later movement');
  const server=data(await tool('mc_server_command',{command:'list'}));assert.match(server.output,new RegExp(c.username));
  checks.push('RCON lists the separate test identity');
  fs.writeFileSync(path.join(evidence,'installed-mcp-check.json'),JSON.stringify({passed:true,checks,state,screenshot:data(screenshot),sequence,captureCleanup,stoppedReport,verifiedAt:new Date().toISOString()},null,2));
  console.log(JSON.stringify({passed:true,checks,evidence},null,2));
} finally {
  try{await tool('mc_stop');}finally{child.stdin.end();child.kill();lines.close();}
}
