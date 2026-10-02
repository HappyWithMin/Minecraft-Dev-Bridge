import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { config, root, libraries } from './paths.mjs';
const c = config(), { jars } = libraries(c);
const classes = path.join(root, 'build', 'classes-'+Date.now());
fs.mkdirSync(classes, {recursive:true});
const source = path.join(root, 'src', 'main', 'java', 'local', 'mcbridge');
const args = ['-encoding','UTF-8','-proc:none','--release','25','-cp',jars.join(path.delimiter),'-d',classes,...fs.readdirSync(source,{recursive:true}).filter(f=>f.endsWith('.java')).map(f=>path.join(source,f))];
function run(exe,args) { const p=spawnSync(path.join(c.javaHome,'bin',exe+'.exe'),args,{stdio:'inherit',windowsHide:true}); if(p.status!==0)process.exit(p.status||1); }
run('javac', args);
fs.cpSync(path.join(root,'src','main','resources'),classes,{recursive:true});
fs.mkdirSync(path.join(root,'dist'),{recursive:true});
run('jar',['--create','--file',path.join(root,'dist','minecraft-dev-bridge-26.3.jar'),'-C',classes,'.']);
console.log('Built dist/minecraft-dev-bridge-26.3.jar');
