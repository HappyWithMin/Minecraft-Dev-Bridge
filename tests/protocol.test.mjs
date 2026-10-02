import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { packet, PacketDecoder, rcon } from '../scripts/rcon.mjs';
import { definitions, validate, checkAssertion, execute } from '../scripts/tools.mjs';

test('RCON decoder tolerates arbitrary TCP fragmentation and combined responses',()=>{
  const bytes=Buffer.concat([packet(2,0,'多字节中文'),packet(2,0,'second'),packet(3,0,'')]);
  for(let split=1;split<bytes.length;split++) {
    const d=new PacketDecoder(), parts=[...d.push(bytes.subarray(0,split)),...d.push(bytes.subarray(split))];
    assert.deepEqual(parts.map(p=>p.body),['多字节中文','second','']);
  }
  const invalid=packet(1,0,'');invalid.writeInt32LE(-1,0);
  assert.throws(()=>new PacketDecoder().push(invalid),/size/);
});

test('RCON authenticates, returns all chunks, and rejects bad password',async()=>{
  const server=net.createServer(socket=>{
    const d=new PacketDecoder();
    socket.on('data',b=>{for(const p of d.push(b)) {
      if(p.type===3)socket.write(packet(p.body==='secret'?p.id:-1,2));
      else if(p.id===2) {
        socket.write(packet(2,0,'first'));
        socket.write(packet(2,0,' second'));
      } else if(p.id===3)socket.write(packet(3,0,'empty command response'));
    }});
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const c={port:server.address().port,password:'secret'};
  try {
    assert.equal(await rcon(c,'list'),'first second');
    await assert.rejects(rcon({...c,password:'bad'},'list'),/authentication/);
  }finally{await new Promise(r=>server.close(r));}
});

test('bounded inputs and scenarios reject malformed requests before any mutation',async()=>{
  const s=definitions.find(t=>t.name==='mc_input').inputSchema;
  validate({keys:['forward'],durationMs:300},s);
  for(const v of [{keys:['forward'],durationMs:11000},{keys:['unknown'],durationMs:100},{keys:['forward'],durationMs:NaN},{keys:[],durationMs:1,op:'quit'}])assert.throws(()=>validate(v,s));
  await assert.rejects(execute('mc_run_scenario',{name:'invalid',steps:[{tool:'mc_server_command',args:{command:'say should-never-run'}},{tool:'mc_shutdown'}]},{}),/not allowed/);
  await assert.rejects(execute('mc_run_scenario',{name:'invalid',steps:[{waitMs:1,tool:'mc_stop'}]},{}),/exactly one/);
});

test('assertions reject missing fields and distinguish numeric and boolean values',()=>{
  assert.equal(checkAssertion({player:{x:4}}, {path:'player.x',min:3,max:5}).passed,true);
  assert.throws(()=>checkAssertion({connected:false},{path:'connected',equals:true}),/failed/);
  assert.throws(()=>checkAssertion({}, {path:'player.x',min:0}),/does not exist/);
});

test('plugin staging preserves an earlier staged JAR and rejects path traversal',async()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'mcbridge-stage-test-'));
  const c={serverDir:path.join(temp,'server'),runtimeDir:path.join(temp,'runtime')};
  const source=path.join(temp,'new.jar'), first=Buffer.from('504b03046669727374','hex'), second=Buffer.from('504b03047365636f6e64','hex');
  try {
    fs.writeFileSync(source,first);
    const one=await execute('mc_stage_plugin',{source,filename:'example.jar'},c);assert.equal(one.active,false);
    fs.writeFileSync(source,second);
    const two=await execute('mc_stage_plugin',{source,filename:'example.jar'},c);
    assert.notEqual(one.sha256,two.sha256);assert.deepEqual(fs.readFileSync(two.path),second);
    const backups=fs.readdirSync(path.join(c.runtimeDir,'backups'));assert.equal(backups.length,1);
    assert.deepEqual(fs.readFileSync(path.join(c.runtimeDir,'backups',backups[0])),first);
    await assert.rejects(execute('mc_stage_plugin',{source,filename:'../outside.jar'},c),/filename/);
  }finally {
    // Remove only the exact temporary directory created above, after checking its parent/prefix.
    assert.equal(path.dirname(temp),os.tmpdir());assert.ok(path.basename(temp).startsWith('mcbridge-stage-test-'));
    fs.rmSync(temp,{recursive:true,force:true});
  }
});

test('MCP stdio initializes, lists tools, reports validation errors and stays usable',async()=>{
  const p=spawn(process.execPath,['scripts/mcp.mjs'],{stdio:['pipe','pipe','pipe'],windowsHide:true});
  const lines=readline.createInterface({input:p.stdout}), pending=new Map();let stderr='';
  p.stderr.on('data',s=>stderr+=s);
  lines.on('line',s=>{const v=JSON.parse(s);pending.get(v.id)?.(v);});
  let id=0;
  function call(method,params={}){return new Promise((resolve,reject)=>{const next=++id;const t=setTimeout(()=>reject(Error('MCP timeout '+stderr)),3000);pending.set(next,v=>{clearTimeout(t);pending.delete(next);resolve(v);});p.stdin.write(JSON.stringify({jsonrpc:'2.0',id:next,method,params})+'\n');});}
  try {
    const init=await call('initialize',{protocolVersion:'2025-06-18'});assert.equal(init.result.protocolVersion,'2025-06-18');
    const tools=await call('tools/list');assert.ok(tools.result.tools.find(t=>t.name==='mc_screenshot'));
    const invalid=new Promise(resolve=>pending.set(null,resolve));
    p.stdin.write('null\n');assert.equal((await invalid).error.code,-32600);pending.delete(null);
    const bad=await call('tools/call',{name:'mc_input',arguments:{durationMs:99999,keys:[]}});assert.equal(bad.result.isError,true);
    assert.deepEqual((await call('ping')).result,{});
    assert.equal(stderr,'');
  }finally{p.stdin.end();p.kill();lines.close();}
});
