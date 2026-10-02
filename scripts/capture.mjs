import fs from 'node:fs';
import path from 'node:path';
import { rpc } from './client.mjs';

export function captureOptions(args={},single=false) {
  const width=args.width??1920,height=args.height??1080,fps=args.fps??10,durationMs=args.durationMs??2000;
  if(!Number.isInteger(width)||width<640||width>3840||!Number.isInteger(height)||height<360||height>2160)throw Error('Resolution must be 640..3840 by 360..2160');
  if(!Number.isInteger(fps)||fps<1||fps>30||!Number.isInteger(durationMs)||durationMs<100||durationMs>10000)throw Error('fps must be 1..30 and durationMs 100..10000');
  const count=single?1:Math.ceil(fps*durationMs/1000);
  if(count>120||count*width*height>250000000)throw Error('Capture exceeds 120 frames or 250 million total pixels; lower fps, duration or resolution');
  return single?{width,height}:{width,height,fps,durationMs};
}
export function captureDirectory(c,id) {
  if(typeof id!=='string'||!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(id))throw Error('Invalid capture id');
  return path.join(c.runtimeDir,'client','screenshots','captures',id);
}
export function imageBlock(c,file) {
  const base=fs.realpathSync(path.join(c.runtimeDir,'client','screenshots')), resolved=fs.realpathSync(file), relative=path.relative(base,resolved);
  if(relative.startsWith('..')||path.isAbsolute(relative)||path.extname(resolved)!=='.png')throw Error('Image path outside managed screenshots');
  if(fs.statSync(resolved).size>48*1024*1024)throw Error('PNG exceeds 48 MiB');
  const png=fs.readFileSync(resolved);
  if(png.length<24||png.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('Invalid PNG');
  return {type:'image',mimeType:'image/png',data:png.toString('base64')};
}
export async function captureStatus(c,id) {
  const dir=captureDirectory(c,id),file=path.join(dir,'manifest.json');
  let report=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):null;
  if(!report?.terminal)report=await rpc(c,'capture_status',{id});
  if(report.id!==id)throw Error('Capture manifest id mismatch');
  if(report.terminal){const viewer=path.join(dir,'index.html');fs.writeFileSync(viewer,gallery(report));return {...report,viewerPath:viewer};}
  return report;
}
export async function captureFrame(c,{id,index}) {
  const report=await captureStatus(c,id);
  if(!Number.isInteger(index)||index<0||index>=report.frames.length)throw Error(`Saved frame index must be 0..${report.frames.length-1}`);
  const frame=report.frames[index];
  if(!/^frame-\d{4}\.png$/.test(frame.file))throw Error('Invalid frame filename');
  return {...frame,path:path.join(captureDirectory(c,id),frame.file),captureId:id,savedIndex:index};
}
export function gallery(report) {
  const frames=report.frames.map(({file,elapsedMs,capturedAt,tick,frame,sampleIndex})=>{
    if(!/^frame-\d{4}\.png$/.test(file))throw Error('Invalid frame filename');
    return {file,elapsedMs,capturedAt,tick,frame,sampleIndex};
  });
  const json=JSON.stringify({id:report.id,state:report.state,width:report.width,height:report.height,requestedFrames:report.requestedFrames,missedRenderSlots:report.missedRenderSlots,backpressureDrops:report.backpressureDrops,observedFps:report.observedFps,frames}).replaceAll('<','\\u003c');
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Minecraft 连续帧检查</title>
<style>body{margin:0;background:#111821;color:#e5edf5;font:15px system-ui}header,footer{padding:16px 24px}h1{font-size:22px;margin:0 0 8px}p{color:#aebed0}button,a{background:#294058;color:white;border:0;padding:8px 14px;border-radius:6px;cursor:pointer;text-decoration:none;margin-right:6px}input{width:min(650px,90vw);vertical-align:middle}#stage{height:65vh;overflow:auto;background:#080d13;text-align:center}#shot{max-width:100%;max-height:100%;object-fit:contain}#stage.full #shot{max-width:none;max-height:none}#strip{display:flex;overflow:auto;gap:6px;padding:12px 24px}#strip img{width:128px;cursor:pointer;border:2px solid transparent}#strip img.selected{border-color:#59d7ba}#meta{font-variant-numeric:tabular-nums}small{color:#aebed0}</style>
<header><h1>Minecraft 连续帧检查</h1><p id="summary"></p><button id="prev">上一帧</button><button id="play">播放</button><button id="next">下一帧</button><button id="zoom">原始像素 / 适应窗口</button><a id="original" target="_blank">打开原图</a><a href="manifest.json">完整记录</a></header>
<div id="stage"><img id="shot" alt="实际游戏渲染帧"></div><footer><input id="slider" type="range" min="0" value="0"><p id="meta"></p><small>按实际采集间隔回放；遗漏的采样点不会补帧。截图读回和保存会影响游戏负载，不能作为无开销的性能基准。</small></footer><div id="strip"></div>
<script>const data=${json};const $=id=>document.getElementById(id);let index=0,playing=false,timer;const frames=data.frames;$('summary').textContent=data.width+' × '+data.height+' · '+data.state+' · 已保存 '+frames.length+'/'+data.requestedFrames+' 帧 · 实际约 '+Number(data.observedFps).toFixed(1)+' fps · 漏采 '+data.missedRenderSlots+' · 写盘背压跳过 '+data.backpressureDrops;$('slider').max=Math.max(0,frames.length-1);
frames.forEach((f,i)=>{const im=document.createElement('img');im.src=f.file;im.loading='lazy';im.alt='帧 '+i;im.onclick=()=>{stop();show(i)};$('strip').append(im)});
function show(i){if(!frames.length){$('meta').textContent='没有成功保存的画面，请查看完整记录';return}index=Math.max(0,Math.min(i,frames.length-1));const f=frames[index];$('shot').src=f.file;$('original').href=f.file;$('slider').value=index;$('meta').textContent='第 '+(index+1)+'/'+frames.length+' 帧 · 采样槽 '+f.sampleIndex+' · '+f.elapsedMs.toFixed(2)+' ms · tick '+f.tick+' · render '+f.frame+' · '+f.capturedAt;[...$('strip').children].forEach((im,j)=>im.classList.toggle('selected',j===index))}
function stop(){playing=false;clearTimeout(timer);$('play').textContent='播放'}function advance(){if(!playing)return;if(index>=frames.length-1){stop();return}timer=setTimeout(()=>{show(index+1);advance()},Math.max(1,frames[index+1].elapsedMs-frames[index].elapsedMs))}
$('play').onclick=()=>{if(playing){stop();return}if(index>=frames.length-1)show(0);playing=true;$('play').textContent='暂停';advance()};$('prev').onclick=()=>{stop();show(index-1)};$('next').onclick=()=>{stop();show(index+1)};$('slider').oninput=e=>{stop();show(+e.target.value)};$('zoom').onclick=()=>$('stage').classList.toggle('full');document.onkeydown=e=>{if(e.key==='ArrowLeft'){stop();show(index-1)}if(e.key==='ArrowRight'){stop();show(index+1)}};show(0);</script></html>`;
}
