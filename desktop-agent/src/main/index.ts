import { app, BrowserWindow, ipcMain, session, shell } from 'electron'
import path from 'path'
import { randomUUID } from 'crypto'
import { electronApp, is } from '@electron-toolkit/utils'
import { runAgent } from './agent'
import { getAudit } from './audit'
import { getSettings, setSettings } from './config'
import { checkOllama, pullOllamaModel } from './model'
import { deleteMemory, listMemories } from './memory'
import { indexWorkspace, ragStatus } from './rag'
import { startScheduler, stopScheduler, listTasks } from './scheduler'
import { secretStatus, setSecret } from './secrets'
import { checkForUpdates, initUpdater, installUpdate } from './updater'
import { listenOnce, speak, startContinuous, stopContinuous, stopSpeaking } from './voice'
import type { AgentRequest, ApprovalRequest } from './types'

let mainWindow: BrowserWindow | null = null
const approvals = new Map<string, (approved: boolean) => void>()

function createWindow(): void {
  mainWindow = new BrowserWindow({ width:1440,height:920,minWidth:1040,minHeight:700,backgroundColor:'#07090d',autoHideMenuBar:true,title:'AIRA Desktop',webPreferences:{preload:path.join(__dirname,'../preload/index.js'),contextIsolation:true,nodeIntegration:false,sandbox:true} })
  mainWindow.webContents.setWindowOpenHandler(({url})=>{if(/^https?:\/\//i.test(url))void shell.openExternal(url);return{action:'deny'}})
  mainWindow.webContents.on('will-navigate',(event,url)=>{const devUrl=process.env.ELECTRON_RENDERER_URL||'';if(is.dev&&devUrl&&url.startsWith(devUrl))return;if(!url.startsWith('file://'))event.preventDefault()})
  if(is.dev&&process.env.ELECTRON_RENDERER_URL)void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);else void mainWindow.loadFile(path.join(__dirname,'../renderer/index.html'))
}
async function requestApproval(title:string,details:string,risk:'low'|'medium'|'high'='medium'):Promise<boolean>{if(!mainWindow)return false;const id=randomUUID();const payload:ApprovalRequest={id,title,details,risk};return new Promise<boolean>(resolve=>{approvals.set(id,resolve);mainWindow?.webContents.send('agent:approval-request',payload);setTimeout(()=>{const pending=approvals.get(id);if(pending){approvals.delete(id);pending(false)}},120_000)})}
function cleanAgentRequest(value:unknown):AgentRequest{const request=(value||{}) as Partial<AgentRequest>;const text=String(request.text||'').trim().slice(0,50_000);if(!text)throw new Error('Agent request is empty.');const history=Array.isArray(request.history)?request.history.slice(-30).map(item=>({role:item.role,content:String(item.content||'').slice(0,30_000)})).filter(item=>['user','assistant','system','tool'].includes(item.role)):[];return{text,history,unattended:Boolean(request.unattended)}}

app.whenReady().then(async()=>{
  electronApp.setAppUserModelId('com.virexa.aira.desktop');session.defaultSession.setPermissionRequestHandler((_w,_p,callback)=>callback(false));session.defaultSession.setPermissionCheckHandler(()=>false);createWindow()
  ipcMain.handle('agent:send',async(_event,request:unknown)=>runAgent(cleanAgentRequest(request),{approve:requestApproval}))
  ipcMain.handle('agent:approval-response',(_event,id:string,approved:boolean)=>{const resolve=approvals.get(String(id));if(resolve){approvals.delete(String(id));resolve(Boolean(approved))}return true})
  ipcMain.handle('settings:get',()=>getSettings());ipcMain.handle('settings:set',(_event,patch)=>setSettings((patch||{}) as any));ipcMain.handle('secrets:status',()=>secretStatus());ipcMain.handle('secrets:set',(_event,key:string,value:string)=>setSecret(String(key),String(value||'')))
  ipcMain.handle('ollama:status',()=>checkOllama(getSettings()));ipcMain.handle('ollama:pull',(_event,model:string)=>pullOllamaModel(getSettings(),String(model||'').slice(0,200)))
  ipcMain.handle('voice:listen',()=>listenOnce());ipcMain.handle('voice:speak',(_event,text:string)=>speak(String(text||'').slice(0,12_000)));ipcMain.handle('voice:stop-speaking',()=>stopSpeaking());ipcMain.handle('voice:start-continuous',()=>startContinuous(transcript=>{const wake=getSettings().wakeWord.toLowerCase().trim();const lower=transcript.toLowerCase();if(wake&&!lower.includes(wake))return;const idx=wake?lower.indexOf(wake):-1;const text=idx>=0?transcript.slice(idx+wake.length).replace(/^[,:\s-]+/,'').trim():transcript;mainWindow?.webContents.send('voice:transcript',{text,raw:transcript})}));ipcMain.handle('voice:stop-continuous',()=>stopContinuous())
  ipcMain.handle('memory:list',(_event,limit?:number)=>listMemories(Number(limit)||100));ipcMain.handle('memory:delete',(_event,id:string)=>deleteMemory(String(id)));ipcMain.handle('rag:status',()=>ragStatus());ipcMain.handle('rag:index',()=>indexWorkspace(getSettings()));ipcMain.handle('tasks:list',()=>listTasks());ipcMain.handle('audit:list',(_event,limit?:number)=>getAudit(Number(limit)||100))
  ipcMain.handle('update:check',()=>checkForUpdates());ipcMain.handle('update:install',()=>installUpdate());ipcMain.handle('app:version',()=>app.getVersion())
  startScheduler(async(prompt,context)=>runAgent({text:prompt,unattended:true},context));initUpdater(()=>mainWindow)
})
app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)createWindow()});app.on('before-quit',()=>{stopScheduler();stopContinuous();stopSpeaking()});app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit()})
