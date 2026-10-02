import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { root } from './paths.mjs';
const target=path.join(os.homedir(),'plugins','minecraft-dev-bridge');
fs.mkdirSync(target,{recursive:true});
for(const name of ['.codex-plugin','dist','scripts','skills','src','tests','package.json','README.md']) {
  const from=path.join(root,name),to=path.join(target,name);
  if(path.resolve(from)!==path.resolve(to))fs.cpSync(from,to,{recursive:true});
}
// Absolute paths intentionally bind this personal installation to this machine.
const mcp={mcpServers:{minecraft_dev_bridge:{command:process.execPath,args:[path.join(target,'scripts','mcp.mjs')],startup_timeout_sec:15,tool_timeout_sec:180}}};
fs.writeFileSync(path.join(target,'.mcp.json'),JSON.stringify(mcp,null,2));
console.log(`Personal plugin source prepared at ${target}`);
