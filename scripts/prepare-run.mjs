import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
const args=process.argv.slice(2),arg=name=>{const index=args.indexOf(name);return index<0?null:args[index+1];};
const root=path.resolve(import.meta.dirname,'..'),exe=arg('--exe'),output=path.resolve(arg('--output')??path.join(root,'runtime','desktop-app'));
if(!exe||!path.isAbsolute(exe)||!fs.existsSync(exe))throw new Error('built-tauri-executable-required');
const marker=path.join(output,'.control-center-run-artifact');
if(fs.existsSync(output)&&fs.readdirSync(output).length&&!fs.existsSync(marker))throw new Error('artifact-output-not-empty-or-owned');
fs.mkdirSync(output,{recursive:true});fs.writeFileSync(marker,'Codex Control Center local run artifact\n');
const packaged=path.join(root,'.packaged');
for(const name of ['node.exe','node-LICENSE','manifest.json']){
 if(!fs.existsSync(path.join(packaged,name)))throw new Error('prepare-sidecar-first');
 fs.copyFileSync(path.join(packaged,name),path.join(output,name));
}
for(const name of ['LICENSE','THIRD_PARTY_NOTICES.md','THIRD_PARTY_LICENSES.txt'])fs.copyFileSync(path.join(root,name),path.join(output,name));
fs.cpSync(path.join(packaged,'core'),path.join(output,'core'),{recursive:true});
fs.copyFileSync(exe,path.join(output,'codex-control-center.exe'));
fs.writeFileSync(path.join(output,'run-manifest.json'),JSON.stringify({schemaVersion:1,build:'Tauri CLI application with embedded frontend',exeSha256:createHash('sha256').update(fs.readFileSync(path.join(output,'codex-control-center.exe'))).digest('hex'),node:JSON.parse(fs.readFileSync(path.join(packaged,'manifest.json'),'utf8'))}));
console.log(JSON.stringify({prepared:true,executable:path.join(output,'codex-control-center.exe'),resources:['core','node.exe','node-LICENSE']}));
