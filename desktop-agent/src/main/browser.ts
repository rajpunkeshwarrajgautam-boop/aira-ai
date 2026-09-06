import { app, BrowserWindow, session } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import { assertPublicBrowserNetworkUrl, assertPublicHttpUrl } from './policy'

interface BrowserElement { ref:string; tag:string; text:string; aria:string; placeholder:string; type:string }
interface BrowserSnapshot { url:string; title:string; text:string; elements:BrowserElement[] }

class BrowserController {
  private window: BrowserWindow | null = null
  private networkPolicyInstalled = false

  private ensureWindow(): BrowserWindow {
    if (this.window && !this.window.isDestroyed()) return this.window
    const ses=session.fromPartition('persist:aira-browser')
    ses.setPermissionRequestHandler((_w,_p,callback)=>callback(false))
    ses.setPermissionCheckHandler(()=>false)
    if (!this.networkPolicyInstalled) {
      this.networkPolicyInstalled = true
      // The listener is intentionally unfiltered so WebSocket handshakes cannot
      // bypass the same DNS/IP policy applied to HTTP(S). Non-network schemes
      // such as data: and blob: are left alone for normal page rendering.
      ses.webRequest.onBeforeRequest((details, callback) => {
        if (!/^(?:https?|wss?):\/\//i.test(details.url)) {
          callback({ cancel: false })
          return
        }
        void assertPublicBrowserNetworkUrl(details.url).then(
          () => callback({ cancel: false }),
          () => callback({ cancel: true })
        )
      })
      ses.on('will-download',(event)=>event.preventDefault())
    }
    this.window=new BrowserWindow({width:1280,height:850,show:true,title:'AIRA Browser',backgroundColor:'#0a0e0c',webPreferences:{session:ses,nodeIntegration:false,contextIsolation:true,sandbox:true}})
    this.window.on('closed',()=>{this.window=null})
    // Popups/new windows are deliberately denied. Navigations in the existing
    // controlled window still pass through the DNS/IP policy above.
    this.window.webContents.setWindowOpenHandler(()=>({action:'deny'}))
    this.window.webContents.on('will-navigate',(event,url)=>{if(!/^https?:\/\//i.test(url))event.preventDefault()})
    return this.window
  }

  async open(url:string){
    const safe=await assertPublicHttpUrl(url)
    const win=this.ensureWindow()
    await win.loadURL(safe.toString())
    return{url:win.webContents.getURL(),title:win.getTitle()}
  }

  async snapshot():Promise<BrowserSnapshot>{const win=this.ensureWindow();const script=`(() => {
const visible=(el)=>{const r=el.getBoundingClientRect();const s=getComputedStyle(el);return r.width>1&&r.height>1&&s.visibility!=='hidden'&&s.display!=='none';};
const candidates=Array.from(document.querySelectorAll('a,button,input,textarea,select,[role="button"],[contenteditable="true"]')).filter(visible).slice(0,180);
const elements=candidates.map((el,i)=>{const ref='e'+i;el.setAttribute('data-aira-ref',ref);return{ref,tag:el.tagName.toLowerCase(),text:String(el.innerText||el.value||'').trim().slice(0,180),aria:String(el.getAttribute('aria-label')||'').slice(0,180),placeholder:String(el.getAttribute('placeholder')||'').slice(0,180),type:String(el.getAttribute('type')||'').slice(0,50)}});
return{url:location.href,title:document.title,text:String(document.body?.innerText||'').replace(/\\s+/g,' ').trim().slice(0,22000),elements};})()`;return(await win.webContents.executeJavaScript(script,true)) as BrowserSnapshot}
  async click(ref:string){const win=this.ensureWindow();const clean=JSON.stringify(ref);return Boolean(await win.webContents.executeJavaScript(`(() => { const el=document.querySelector('[data-aira-ref=' + ${clean} + ']'); if(!el)return false; el.scrollIntoView({block:'center',inline:'center'}); el.click(); return true; })()`,true))}
  async type(ref:string,text:string,submit=false){const win=this.ensureWindow();const cleanRef=JSON.stringify(ref);const cleanText=JSON.stringify(text.slice(0,20_000));return Boolean(await win.webContents.executeJavaScript(`(() => { const el=document.querySelector('[data-aira-ref=' + ${cleanRef} + ']'); if(!el)return false; el.focus(); const value=${cleanText}; if('value' in el){const setter=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el),'value')?.set;if(setter)setter.call(el,value);else el.value=value;}else{el.textContent=value;} el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));if(${submit?'true':'false'}){el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true}));el.form?.requestSubmit?.();}return true;})()`,true))}
  async back(){const win=this.ensureWindow();if(!win.webContents.canGoBack())return false;win.webContents.goBack();return true}
  async screenshot(){const win=this.ensureWindow();const image=await win.webContents.capturePage();const folder=path.join(app.getPath('userData'),'browser-captures');await fs.mkdir(folder,{recursive:true});const file=path.join(folder,`browser-${Date.now()}.png`);await fs.writeFile(file,image.toPNG());return{file}}
  close(){if(!this.window||this.window.isDestroyed())return false;this.window.close();this.window=null;return true}
}
export const browser=new BrowserController()
