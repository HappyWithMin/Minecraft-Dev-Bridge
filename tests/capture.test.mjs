import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { captureOptions, captureDirectory, gallery, imageBlock } from '../scripts/capture.mjs';
import { config, root } from '../scripts/paths.mjs';
import { execute } from '../scripts/tools.mjs';

test('resolution, duration and total-pixel limits are validated before actions',async()=>{
  assert.deepEqual(captureOptions({},true),{width:1920,height:1080});
  assert.equal(captureOptions({width:3840,height:2160},true).width,3840);
  for(const args of [{width:3841},{height:NaN},{fps:0},{durationMs:10001},{width:3840,height:2160,fps:30,durationMs:2000},{fps:30,durationMs:10000}])assert.throws(()=>captureOptions(args));
  await assert.rejects(execute('mc_run_scenario',{name:'bad capture',steps:[{tool:'mc_input',args:{keys:['forward'],durationMs:100}},{tool:'mc_capture_start',args:{width:3840,height:2160,fps:30,durationMs:2000}}]},{}),/million/);
});
test('capture ids and viewer filenames cannot escape the capture directory',()=>{
  assert.throws(()=>captureDirectory({runtimeDir:'x'},'../outside'),/id/);
  assert.throws(()=>gallery({frames:[{file:'../secret.png'}]}),/filename/);
  const html=gallery({id:'test',frames:[{file:'frame-0000.png',capturedAt:'</script><script>bad()</script>',elapsedMs:0}]});
  assert.ok(html.includes('\\u003c/script>'));assert.ok(!html.includes('</script><script>bad()'));
});
test('Java schedule and fast PNG encoder preserve exact pixels',()=>{
  const c=config(),temp=fs.mkdtempSync(path.join(os.tmpdir(),'mcbridge-png-test-'));
  const run=(exe,args)=>{const p=spawnSync(path.join(c.javaHome,'bin',exe+'.exe'),args,{encoding:'utf8',windowsHide:true});assert.equal(p.status,0,p.stdout+p.stderr);};
  try {
    run('javac',['-encoding','UTF-8','-d',temp,path.join(root,'src/main/java/local/mcbridge/CapturePlan.java'),path.join(root,'src/main/java/local/mcbridge/FastPng.java'),path.join(root,'tests/CaptureCoreTest.java')]);
    run('java',['-cp',temp,'local.mcbridge.CaptureCoreTest',path.join(temp,'test.png')]);
    fs.mkdirSync(path.join(temp,'client','screenshots'),{recursive:true});
    assert.throws(()=>imageBlock({runtimeDir:temp},path.join(temp,'test.png')),/outside/);
  } finally {
    assert.equal(path.dirname(temp),os.tmpdir());assert.ok(path.basename(temp).startsWith('mcbridge-png-test-'));fs.rmSync(temp,{recursive:true,force:true});
  }
});
