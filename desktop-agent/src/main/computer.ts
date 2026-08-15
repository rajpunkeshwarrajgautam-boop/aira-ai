import { clipboard } from 'electron'
import { execFile } from 'child_process'
import { promisify } from 'util'
const execFileAsync=promisify(execFile)
function psQuote(value:string):string{return `'${value.replace(/'/g,"''")}'`}
export async function powerShell(script:string,timeout=60_000):Promise<{stdout:string;stderr:string}>{const {stdout,stderr}=await execFileAsync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',script],{windowsHide:true,timeout,maxBuffer:4*1024*1024});return{stdout:stdout.trim().slice(0,30_000),stderr:stderr.trim().slice(0,12_000)}}
export async function listWindows(){const{stdout}=await powerShell(`Get-Process | Where-Object {$_.MainWindowTitle} | Select-Object ProcessName,Id,MainWindowTitle | ConvertTo-Json -Compress`);if(!stdout)return[];const p=JSON.parse(stdout);const items=Array.isArray(p)?p:[p];return items.map(i=>({process:String(i.ProcessName||''),pid:Number(i.Id||0),title:String(i.MainWindowTitle||'')}))}
export async function focusWindow(query:string){const{stdout}=await powerShell(`$w = New-Object -ComObject WScript.Shell; if ($w.AppActivate(${psQuote(query.slice(0,300))})) { 'true' } else { 'false' }`);return stdout.trim().toLowerCase()==='true'}
export async function mouseClick(x:number,y:number,button:'left'|'right'='left'){const safeX=Math.max(0,Math.round(x));const safeY=Math.max(0,Math.round(y));const down=button==='right'?'0x0008':'0x0002';const up=button==='right'?'0x0010':'0x0004';await powerShell(`Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class AiraMouse { [DllImport("user32.dll")] public static extern bool SetCursorPos(int X,int Y); [DllImport("user32.dll")] public static extern void mouse_event(uint flags,uint dx,uint dy,uint data,UIntPtr extra); }
'@
[AiraMouse]::SetCursorPos(${safeX},${safeY}) | Out-Null
Start-Sleep -Milliseconds 80
[AiraMouse]::mouse_event(${down},0,0,0,[UIntPtr]::Zero)
[AiraMouse]::mouse_event(${up},0,0,0,[UIntPtr]::Zero)`);return true}
export async function scroll(delta:number){const wheel=Math.max(-2400,Math.min(2400,Math.round(delta)));await powerShell(`Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class AiraWheel { [DllImport("user32.dll")] public static extern void mouse_event(uint flags,uint dx,uint dy,uint data,UIntPtr extra); }
'@
[AiraWheel]::mouse_event(0x0800,0,0,[uint][int]${wheel},[UIntPtr]::Zero)`);return true}
export async function pasteText(text:string){if(text.length>20_000)throw new Error('Text exceeds 20,000 character computer-input limit.');clipboard.writeText(text);await powerShell(`Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait('^v')`);return true}
const KEY_MAP:Record<string,string>={enter:'{ENTER}',tab:'{TAB}',escape:'{ESC}',esc:'{ESC}',backspace:'{BACKSPACE}',delete:'{DELETE}',up:'{UP}',down:'{DOWN}',left:'{LEFT}',right:'{RIGHT}',home:'{HOME}',end:'{END}',pageup:'{PGUP}',pagedown:'{PGDN}',space:' '}
export async function pressKeys(keys:string){const normalized=keys.trim().toLowerCase();let sequence=KEY_MAP[normalized];if(!sequence){const parts=normalized.split('+').map(p=>p.trim()).filter(Boolean);const last=parts.at(-1)||'';const prefix=(parts.includes('ctrl')?'^':'')+(parts.includes('alt')?'%':'')+(parts.includes('shift')?'+':'');if(/^[a-z0-9]$/.test(last))sequence=`${prefix}${last}`}if(!sequence)throw new Error('Unsupported key sequence.');await powerShell(`Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait(${psQuote(sequence)})`);return true}
export async function launchApp(target:string){const clean=target.trim();if(!clean)throw new Error('Missing application target.');await powerShell(`Start-Process -FilePath ${psQuote(clean)}`);return true}
