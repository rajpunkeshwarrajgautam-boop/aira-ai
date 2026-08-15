import { app, desktopCapturer, screen } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import type { AppSettings } from './config'
import { visionJson, visionText } from './model'

export interface ScreenCapture { file: string; width: number; height: number }
export async function capturePrimaryScreen(): Promise<ScreenCapture> {
  const display=screen.getPrimaryDisplay(); const {width,height}=display.bounds
  const sources=await desktopCapturer.getSources({types:['screen'],thumbnailSize:{width:Math.max(1280,width),height:Math.max(720,height)}})
  const source=sources[0]; if(!source)throw new Error('No display source is available.')
  const folder=path.join(app.getPath('userData'),'captures'); await fs.mkdir(folder,{recursive:true}); const file=path.join(folder,`screen-${Date.now()}.png`); await fs.writeFile(file,source.thumbnail.toPNG()); return {file,width,height}
}
export async function analyzeScreen(settings:AppSettings,prompt:string):Promise<{capture:ScreenCapture;analysis:string}>{const capture=await capturePrimaryScreen();const analysis=await visionText(settings,capture.file,`${prompt}\nThis is a Windows desktop screenshot. Screen coordinate space is ${capture.width}x${capture.height}.`);return{capture,analysis}}
export async function locateOnScreen(settings:AppSettings,description:string):Promise<{x:number;y:number;confidence:number;reason:string;capture:ScreenCapture}>{
  const capture=await capturePrimaryScreen(); const schema={type:'object',properties:{x:{type:'number'},y:{type:'number'},confidence:{type:'number'},reason:{type:'string'}},required:['x','y','confidence','reason']}
  const result=await visionJson<{x:number;y:number;confidence:number;reason:string}>(settings,capture.file,`Locate the center point of this UI target: "${description}". Return absolute pixel coordinates for a ${capture.width}x${capture.height} screen. If uncertain, lower confidence. Do not guess outside the image.`,schema)
  return{x:Math.max(0,Math.min(capture.width-1,Math.round(Number(result.x)||0))),y:Math.max(0,Math.min(capture.height-1,Math.round(Number(result.y)||0))),confidence:Math.max(0,Math.min(1,Number(result.confidence)||0)),reason:String(result.reason||''),capture}
}
