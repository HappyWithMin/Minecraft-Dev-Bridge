import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { root, libraries } from './paths.mjs';

export function properties(file) {
  return Object.fromEntries(fs.readFileSync(file,'utf8').split(/\r?\n/).filter(l=>l.trim()&&!/^\s*[#!]/.test(l)).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim()];}));
}
export async function rpc(c,op,args={}) {
  const token=fs.readFileSync(path.join(c.runtimeDir,'client','bridge-token.txt'),'utf8').trim();
  const response=await fetch(`http://127.0.0.1:${c.clientPort}/rpc`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({...args,op}),signal:AbortSignal.timeout(18000)});
  const data=await response.json();
  if(!response.ok||!data.ok)throw Error(data.error||`Bridge HTTP ${response.status}`);
  return data;
}
export async function launch(c) {
  const gameDir=path.join(c.runtimeDir,'client');
  try {const status=await rpc(c,'status');return {alreadyRunning:true,...status};}catch(e) {
    if(!/ENOENT|fetch failed|ECONNREFUSED/.test(String(e)))throw Error(`Existing endpoint could not be verified: ${e.message}`);
  }
  const statePath=path.join(gameDir,'launch-state.json');
  if(fs.existsSync(statePath)) {
    const old=JSON.parse(fs.readFileSync(statePath));let alive=false;
    try {process.kill(old.pid,0);alive=true;}catch{}
    if(alive)throw Error('The previous client process is still running or starting. Check its log before launching again.');
  }
  if(!['127.0.0.1','localhost','::1'].includes(c.serverHost))throw Error('Dedicated offline test client is restricted to your local development server');
  const props=properties(path.join(c.serverDir,'server.properties'));
  if(props['online-mode']!=='false')throw Error('This launcher uses a separate offline test identity and requires an existing local offline-mode test server. It does not change online-mode.');
  if(Number(props['server-port'])!==c.serverPort)throw Error('Configured server port does not match server.properties');
  const {jars,profile}=libraries(c);
  if(!/fabric/.test(profile.mainClass))throw Error('Select a Fabric loader profile');
  const username=c.username;
  if(!/^[A-Za-z0-9_]{1,16}$/.test(username))throw Error('Invalid test player name');
  fs.mkdirSync(path.join(gameDir,'mods'),{recursive:true});
  fs.copyFileSync(path.join(root,'dist','minecraft-dev-bridge-26.3.jar'),path.join(gameDir,'mods','minecraft-dev-bridge.jar'));
  fs.writeFileSync(path.join(gameDir,'bridge-token.txt'),crypto.randomBytes(32).toString('hex'),{mode:0o600});
  const options=path.join(gameDir,'options.txt');
  if(!fs.existsSync(options))fs.writeFileSync(options,'fullscreen:false\noverrideWidth:960\noverrideHeight:600\nguiScale:2\nrenderDistance:6\nsimulationDistance:5\nmaxFps:30\nenableVsync:false\npauseOnLostFocus:false\ninactivityFpsLimit:minimized\nonboardAccessibility:false\nskipMultiplayerWarning:true\njoinedFirstServer:true\ntutorialStep:none\nlang:zh_cn\nsoundCategory_master:0.0\n');
  const uuid=crypto.createHash('md5').update('OfflinePlayer:'+username).digest();uuid[6]=(uuid[6]&15)|48;uuid[8]=(uuid[8]&63)|128;
  const args=['-Xms256M','-Xmx2G','-XX:StackShadowPages=32','--enable-native-access=ALL-UNNAMED','--add-exports','java.base/jdk.internal.misc=ALL-UNNAMED','-Dmcbridge.dedicated=true',`-Dmcbridge.port=${c.clientPort}`,'-cp',jars.join(path.delimiter),profile.mainClass,'--username',username,'--version','26.3','--gameDir',gameDir,'--assetsDir',path.join(c.minecraftRoot,'assets'),'--assetIndex',profile.assetIndex.id,'--uuid',uuid.toString('hex'),'--accessToken','0','--versionType','release','--width','960','--height','600','--quickPlayMultiplayer',`${c.serverHost}:${c.serverPort}`];
  const log=fs.openSync(path.join(gameDir,'launch.log'),'w');
  const child=spawn(path.join(c.javaHome,'bin','javaw.exe'),args,{cwd:gameDir,detached:true,windowsHide:true,stdio:['ignore',log,log]});
  try {await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});}finally{fs.closeSync(log);}
  child.unref();
  const state={pid:child.pid,username,startedAt:new Date().toISOString(),gameDir};
  fs.writeFileSync(statePath,JSON.stringify(state,null,2));
  return {...state,message:'Starting hidden client; poll mc_status and inspect mc_logs if not ready.'};
}
export function readLog(file,lines=100) {
  if(!Number.isInteger(lines)||lines<1||lines>1000)throw Error('lines must be 1..1000');
  const fd=fs.openSync(file,'r');try {
    const stat=fs.fstatSync(fd), size=Math.min(stat.size,256*1024), buf=Buffer.alloc(size);
    fs.readSync(fd,buf,0,size,stat.size-size);
    return buf.toString('utf8').split(/\r?\n/).slice(-lines).join('\n').replace(/(accessToken[=\s]+)\S+/gi,'$1[REDACTED]');
  }finally{fs.closeSync(fd);}
}
