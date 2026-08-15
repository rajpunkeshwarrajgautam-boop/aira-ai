import { Notification } from 'electron'
import Store from 'electron-store'
import type { ScheduledTask, ToolContext } from './types'

interface TaskSchema { tasks: ScheduledTask[] }
const store = new Store<TaskSchema>({ name: 'scheduled-tasks', defaults: { tasks: [] } })
let timer: NodeJS.Timeout | null = null
let runner: ((prompt: string, context: ToolContext) => Promise<{ text: string }>) | null = null

function computeNext(task: ScheduledTask, now = Date.now()): string | undefined {
  if (task.intervalMinutes && task.intervalMinutes >= 1) return new Date(now + task.intervalMinutes * 60_000).toISOString()
  return undefined
}
export function listTasks(): ScheduledTask[] { return store.get('tasks', []) }
export function createTask(prompt: string, runAt?: string, intervalMinutes?: number): ScheduledTask {
  const clean = prompt.trim(); if (!clean) throw new Error('Task prompt is empty.')
  const interval = intervalMinutes ? Math.max(1, Math.min(60 * 24 * 30, Math.round(intervalMinutes))) : undefined
  let normalizedRunAt: string | undefined
  if (runAt) { const date = new Date(runAt); if (Number.isNaN(date.getTime())) throw new Error('Invalid runAt timestamp.'); normalizedRunAt = date.toISOString() }
  if (!normalizedRunAt && !interval) throw new Error('Provide runAt or intervalMinutes.')
  const now = Date.now()
  const task: ScheduledTask = { id: `${now}-${Math.random().toString(36).slice(2, 8)}`, prompt: clean.slice(0, 10_000), createdAt: new Date(now).toISOString(), runAt: normalizedRunAt, intervalMinutes: interval, enabled: true, nextRunAt: normalizedRunAt || (interval ? new Date(now + interval * 60_000).toISOString() : undefined) }
  store.set('tasks', [task, ...listTasks()].slice(0, 200)); return task
}
export function cancelTask(id: string): boolean { const tasks=listTasks(); const next=tasks.map(task=>task.id===id?{...task,enabled:false}:task); store.set('tasks',next); return next.some(task=>task.id===id) }
async function tick(): Promise<void> {
  if (!runner) return
  const now=Date.now(); const tasks=listTasks(); let changed=false
  for (const task of tasks) {
    if (!task.enabled || !task.nextRunAt || new Date(task.nextRunAt).getTime() > now) continue
    try {
      const result=await runner(task.prompt,{unattended:true,approve:async()=>false}); task.lastResult=result.text.slice(0,4000)
      if (Notification.isSupported()) new Notification({title:'AIRA scheduled task',body:result.text.slice(0,240)}).show()
    } catch(error) { task.lastResult=`Task error: ${error instanceof Error?error.message:String(error)}` }
    task.lastRunAt=new Date().toISOString(); task.nextRunAt=computeNext(task,now); if(!task.nextRunAt)task.enabled=false; changed=true
  }
  if(changed)store.set('tasks',tasks)
}
export function startScheduler(run:(prompt:string,context:ToolContext)=>Promise<{text:string}>):void { runner=run; if(timer)clearInterval(timer); timer=setInterval(()=>void tick(),30_000); void tick() }
export function stopScheduler():void { if(timer)clearInterval(timer); timer=null }
