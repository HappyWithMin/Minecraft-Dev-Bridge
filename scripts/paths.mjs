import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const configPath = process.env.MCBRIDGE_CONFIG || path.join(os.homedir(), '.minecraft-dev-bridge', 'config.json');
export function config() {
  if (!fs.existsSync(configPath)) throw Error(`Run setup first; missing ${configPath}. Setup: node "${path.join(root, 'scripts', 'setup.mjs')}" <minecraftRoot> <resolved Fabric 26.3 version> <serverDir> <javaHome>`);
  return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}
export function libraries(c) {
  const dir = path.join(c.minecraftRoot, 'versions', c.version);
  const profile = JSON.parse(fs.readFileSync(path.join(dir, c.version + '.json'), 'utf8'));
  if (profile.inheritsFrom) throw Error('Use a resolved launcher profile (inheritsFrom is not supported).');
  const jars = [];
  for (const lib of profile.libraries) {
    let allowed = !lib.rules;
    for (const rule of lib.rules || []) {
      const match = !rule.features && (!rule.os || ((!rule.os.name || rule.os.name === 'windows') && (!rule.os.arch || ['amd64','x86_64'].includes(rule.os.arch))));
      if (match) allowed = rule.action === 'allow';
    }
    if (!allowed) continue;
    const [g,n,v,cl] = lib.name.split(':');
    const rel = lib.downloads?.artifact?.path || (!lib.downloads ? `${g.replaceAll('.','/')}/${n}/${v}/${n}-${v}${cl ? '-'+cl : ''}.jar` : null);
    if (rel) jars.push(path.join(c.minecraftRoot, 'libraries', rel));
  }
  jars.push(path.join(dir, c.version + '.jar'));
  for (const jar of jars) if (!fs.existsSync(jar)) throw Error(`Installed library missing: ${jar}`);
  return { jars, profile };
}
