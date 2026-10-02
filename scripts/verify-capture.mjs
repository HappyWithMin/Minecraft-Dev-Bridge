// Integration test. Uses the dedicated test player and saves only capture evidence.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execute, content } from './tools.mjs';
import { config, root } from './paths.mjs';
const c=config(),evidence=path.join(root,'evidence','capture-upgrade');fs.mkdirSync(evidence,{recursive:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function wait(id,predicate=s=>s.terminal,limit=15000) {
  const until=Date.now()+limit;
  while(Date.now()<until){const s=await execute('mc_capture_status',{id});if(predicate(s))return s;await sleep(100);}
  throw Error('Capture status timeout');
}
function verifyReport(r) {
  assert.equal(r.state,'completed');assert.ok(r.savedFrames>0);assert.equal(r.inFlight,0);
  assert.equal(r.savedFrames+r.missedRenderSlots+r.backpressureDrops+r.writeFailures+r.unattemptedFrames,r.requestedFrames);
  for(let i=0;i<r.frames.length;i++) {
    const f=r.frames[i],png=fs.readFileSync(f.path);
    assert.equal(png.readUInt32BE(16),r.width);assert.equal(png.readUInt32BE(20),r.height);
    if(i){assert.ok(f.elapsedMs>r.frames[i-1].elapsedMs);assert.ok(f.frame>r.frames[i-1].frame);assert.ok(f.sampleIndex>r.frames[i-1].sampleIndex);}
  }
}
let activeId;
try {
  const before=await execute('mc_status');assert.equal(before.connected,true);
  await execute('mc_camera',{mode:'THIRD_PERSON_FRONT'});
  await execute('mc_look',{yaw:0,pitch:0});
  const high=await execute('mc_screenshot',{width:3840,height:2160});
  const image=fs.readFileSync(high.path);assert.equal(image.readUInt32BE(16),3840);assert.equal(image.readUInt32BE(20),2160);assert.ok(high.restored);
  fs.copyFileSync(high.path,path.join(evidence,'screenshot-4k.png'));
  const capture=await execute('mc_capture_start',{width:1920,height:1080,fps:10,durationMs:3000});activeId=capture.id;
  await wait(activeId,s=>s.state==='recording');
  await assert.rejects(execute('mc_screenshot'),/active/);
  const during=await execute('mc_status');assert.equal(during.hidden,true);assert.equal(during.focused,false);assert.equal(during.mouseGrabbed,false);
  await execute('mc_input',{keys:['use'],durationMs:1000});
  await sleep(1300);
  await execute('mc_look',{yaw:25,pitch:-20});
  const sequence=await wait(activeId);activeId=null;verifyReport(sequence);
  assert.ok(sequence.frames.some(f=>f.player?.usingItem));assert.ok(sequence.frames.some(f=>f.player?.yaw===25));
  const block=await content('mc_capture_frame',{id:sequence.id,index:0});assert.ok(block.content.find(b=>b.type==='image'));
  fs.cpSync(sequence.directory,path.join(evidence,'sequence'),{recursive:true});
  const fast=await execute('mc_capture_start',{width:1280,height:720,fps:30,durationMs:2000});activeId=fast.id;
  const fastReport=await wait(activeId);activeId=null;verifyReport(fastReport);
  const cancel=await execute('mc_capture_start',{width:1920,height:1080,fps:5,durationMs:10000});activeId=cancel.id;
  await wait(activeId,s=>s.state==='recording'&&s.savedFrames>0);
  await execute('mc_capture_stop',{id:activeId});
  const cancelled=await wait(activeId);activeId=null;assert.equal(cancelled.state,'stopped');assert.ok(cancelled.savedFrames<cancelled.requestedFrames);
  const after=await execute('mc_status');assert.deepEqual(after.render,before.render);assert.equal(after.hidden,true);assert.equal(after.focused,false);
  const result={passed:true,verifiedAt:new Date().toISOString(),highResolution:high,sequence,fastSequence:fastReport,cancelled,restored:after.render};
  fs.writeFileSync(path.join(evidence,'verification.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify({passed:true,highResolution:[high.width,high.height],sequence:{saved:sequence.savedFrames,requested:sequence.requestedFrames,observedFps:sequence.observedFps,dropped:sequence.missedRenderSlots+sequence.backpressureDrops},fast:{saved:fastReport.savedFrames,requested:fastReport.requestedFrames,observedFps:fastReport.observedFps},restored:after.render,evidence},null,2));
} finally {
  if(activeId){await execute('mc_capture_stop',{id:activeId});await wait(activeId);}
  await execute('mc_stop');
}
