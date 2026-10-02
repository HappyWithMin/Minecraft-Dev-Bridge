import net from 'node:net';

export function packet(id,type,body='') {
  const text=Buffer.from(body,'utf8'), p=Buffer.alloc(text.length+14);
  p.writeInt32LE(text.length+10,0);p.writeInt32LE(id,4);p.writeInt32LE(type,8);text.copy(p,12);return p;
}
export class PacketDecoder {
  buffer=Buffer.alloc(0);
  push(chunk) {
    this.buffer=Buffer.concat([this.buffer,chunk]);const out=[];
    while(this.buffer.length>=4) {
      const n=this.buffer.readInt32LE(0);
      if(n<10||n>4*1024*1024)throw Error('Invalid RCON packet size');
      if(this.buffer.length<n+4)break;
      if(this.buffer[n+2]!==0||this.buffer[n+3]!==0)throw Error('Invalid RCON packet terminator');
      out.push({id:this.buffer.readInt32LE(4),type:this.buffer.readInt32LE(8),body:this.buffer.subarray(12,n+2).toString('utf8')});
      this.buffer=this.buffer.subarray(n+4);
    }
    return out;
  }
}
export async function rcon({host='127.0.0.1',port,password},command) {
  if(!['127.0.0.1','::1','localhost'].includes(host))throw Error('RCON is restricted to localhost; use a local SSH tunnel for remote servers.');
  if(typeof command!=='string'||!command.trim()||command.length>4096||/[\r\n\0]/.test(command))throw Error('A single nonempty command (up to 4096 characters) is required');
  return new Promise((resolve,reject)=>{
    const socket=net.createConnection({host,port}), decoder=new PacketDecoder();let authorized=false, finished=false, sentinelSent=false, parts=[];
    const timer=setTimeout(()=>finish(Error('RCON timeout; command outcome may be unknown. Inspect logs before retrying.')),7000);
    function finish(error,value) {if(finished)return;finished=true;clearTimeout(timer);socket.destroy();error?reject(error):resolve(value);}
    socket.on('error',e=>finish(e));
    socket.on('close',()=>{if(!finished)finish(Error('RCON connection closed before completion'));});
    socket.on('connect',()=>socket.write(packet(1,3,password)));
    socket.on('data',chunk=>{
      try {
        for(const p of decoder.push(chunk)) {
          if(p.id===-1)throw Error('RCON authentication failed');
          if(!authorized&&p.id===1&&p.type===2) {
            authorized=true;
            socket.write(packet(2,2,command));
          } else if(authorized&&p.id===2) {
            parts.push(p.body);
            // Minecraft RCON expects a request per read. Send a harmless empty command
            // only after receiving output; its response marks the end of all chunks.
            if(!sentinelSent){sentinelSent=true;socket.write(packet(3,2,''));}
          }
          else if(authorized&&p.id===3)finish(null,parts.join(''));
        }
      } catch(e){finish(e);}
    });
  });
}
