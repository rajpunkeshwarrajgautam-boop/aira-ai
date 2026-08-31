import { app } from 'electron'
import { execFile, spawn } from 'child_process'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { promisify } from 'util'
import { getSettings } from './config'
import { resolvePathInsideRoot } from './policy'
const execFileAsync = promisify(execFile)
function safeLocal(input: string): string { const root=path.resolve(getSettings().workspaceRoot); const expanded=input.startsWith('~')?path.join(os.homedir(),input.slice(1)):input; const target=path.isAbsolute(expanded)?path.resolve(expanded):path.resolve(root,expanded); return resolvePathInsideRoot(root,target) }
async function adb(args:string[],timeout=45_000):Promise<{stdout:string;stderr:string}>{ const {stdout,stderr}=await execFileAsync('adb',args,{windowsHide:true,timeout,maxBuffer:4*1024*1024}); return {stdout:stdout.trim(),stderr:stderr.trim()} }
export async function androidDevices(){ const {stdout}=await adb(['devices','-l']); return stdout.split(/\r?\n/).slice(1).map(l=>l.trim()).filter(Boolean).map(line=>{const [serial,state,...rest]=line.split(/\s+/);return {serial,state,details:rest.join(' ')}}) }
export async function androidStatus():Promise<Record<string,string>>{ const props=await adb(['shell','getprop']); const battery=await adb(['shell','dumpsys','battery']); const size=await adb(['shell','wm','size']); return {brand:props.stdout.match(/\[ro\.product\.brand\]: \[(.*?)\]/)?.[1]||'',model:props.stdout.match(/\[ro\.product\.model\]: \[(.*?)\]/)?.[1]||'',androidVersion:props.stdout.match(/\[ro\.build\.version\.release\]: \[(.*?)\]/)?.[1]||'',batteryLevel:battery.stdout.match(/level:\s*(\d+)/)?.[1]||'',display:size.stdout} }
export async function androidShell(command:string){ if(!command.trim()) throw new Error('Missing ADB shell command.'); return await adb(['shell',command],60_000) }
export async function androidTap(x:number,y:number){ await adb(['shell','input','tap',String(Math.round(x)),String(Math.round(y))]); return true }
export async function androidSwipe(x1:number,y1:number,x2:number,y2:number,durationMs=350){ await adb(['shell','input','swipe',String(Math.round(x1)),String(Math.round(y1)),String(Math.round(x2)),String(Math.round(y2)),String(Math.max(50,Math.min(5000,Math.round(durationMs))))]); return true }
export async function androidText(text:string){ const encoded=text.slice(0,4000).replace(/ /g,'%s').replace(/[&|<>;]/g,''); await adb(['shell','input','text',encoded]); return true }
export async function androidLaunch(packageName:string){ const clean=packageName.trim(); if(!/^[a-zA-Z0-9._]+$/.test(clean)) throw new Error('Invalid Android package name.'); await adb(['shell','monkey','-p',clean,'-c','android.intent.category.LAUNCHER','1']); return true }
export async function androidPush(localPath:string,remotePath:string){ await adb(['push',safeLocal(localPath),remotePath],120_000); return true }
export async function androidPull(remotePath:string,localPath:string){ const local=safeLocal(localPath); await fs.mkdir(path.dirname(local),{recursive:true}); await adb(['pull',remotePath,local],120_000); return true }
export async function androidScreenshot():Promise<{file:string}>{ const folder=path.join(app.getPath('userData'),'android-captures'); await fs.mkdir(folder,{recursive:true}); const file=path.join(folder,`android-${Date.now()}.png`); await new Promise<void>((resolve,reject)=>{ const child=spawn('adb',['exec-out','screencap','-p'],{windowsHide:true,stdio:['ignore','pipe','pipe']}); const chunks:Buffer[]=[];const errors:Buffer[]=[];child.stdout.on('data',(c:Buffer)=>chunks.push(c));child.stderr.on('data',(c:Buffer)=>errors.push(c));child.on('error',reject);child.on('close',async code=>{if(code!==0)return reject(new Error(Buffer.concat(errors).toString('utf8')||`adb exited ${code}`));try{await fs.writeFile(file,Buffer.concat(chunks));resolve()}catch(e){reject(e)}})}); return {file} }
