import readline from 'node:readline';
import { definitions, content, cancelScenarios } from './tools.mjs';
const input=readline.createInterface({input:process.stdin,crlfDelay:Infinity});
const send=obj=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',...obj})+'\n');
// MCP stdio uses one JSON-RPC message per line, not HTTP Content-Length framing.
// Serialize mutations; respond to protocol requests without mixing logs into stdout.
let chain=Promise.resolve();
input.on('line',line=>{
  let req;
  try{if(Buffer.byteLength(line)>1024*1024)throw Error('Request too large');req=JSON.parse(line);}catch{send({id:null,error:{code:-32700,message:'Parse error'}});return;}
  if(!req||typeof req!=='object'||Array.isArray(req)){send({id:null,error:{code:-32600,message:'Invalid request'}});return;}
  if(req.id===undefined)return;
  if(req.jsonrpc!=='2.0'||typeof req.method!=='string'){send({id:req.id??null,error:{code:-32600,message:'Invalid request'}});return;}
  if(req.method==='initialize') {
    const versions=['2025-06-18','2025-03-26','2024-11-05'];
    send({id:req.id,result:{protocolVersion:versions.includes(req.params?.protocolVersion)?req.params.protocolVersion:'2025-06-18',capabilities:{tools:{listChanged:false}},serverInfo:{name:'minecraft-dev-bridge',version:'0.2.0'}}});return;
  }
  if(req.method==='ping'){send({id:req.id,result:{}});return;}
  if(req.method==='tools/list'){send({id:req.id,result:{tools:definitions}});return;}
  if(req.method!=='tools/call'){send({id:req.id,error:{code:-32601,message:'Method not found'}});return;}
  const run=async()=>{
    try{send({id:req.id,result:await content(req.params?.name,req.params?.arguments??{})});}
    catch(e){send({id:req.id,result:{isError:true,content:[{type:'text',text:e.message}]}});}
  };
  if(['mc_stop','mc_shutdown'].includes(req.params?.name)) {cancelScenarios();void run();}
  else if(req.params?.name==='mc_capture_stop')void run();
  else chain=chain.then(run);
});
