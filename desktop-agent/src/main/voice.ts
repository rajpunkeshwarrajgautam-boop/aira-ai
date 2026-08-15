import { spawn, type ChildProcess } from 'child_process'
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)
let recognizer: ChildProcess | null = null
let speaker: ChildProcess | null = null

function ps(script: string): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 90_000, maxBuffer: 1024 * 1024 })
}

export async function listenOnce(): Promise<string> {
  const script = `
Add-Type -AssemblyName System.Speech
$r = New-Object System.Speech.Recognition.SpeechRecognitionEngine
$r.SetInputToDefaultAudioDevice()
$r.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
$result = $r.Recognize([TimeSpan]::FromSeconds(15))
if ($result) { $result.Text }
$r.Dispose()
`
  const { stdout } = await ps(script)
  return stdout.trim()
}

export async function speak(text: string): Promise<void> {
  stopSpeaking()
  const safe = text.slice(0, 12_000).replace(/'/g, "''")
  speaker = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Add-Type -AssemblyName System.Speech; $s=New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.Speak('${safe}'); $s.Dispose()`], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  await new Promise<void>((resolve, reject) => { speaker?.once('error', reject); speaker?.once('exit', () => resolve()) })
  speaker = null
}
export function stopSpeaking(): void { if (speaker && !speaker.killed) speaker.kill(); speaker = null }
export function startContinuous(onText: (text: string) => void): boolean {
  if (recognizer && !recognizer.killed) return false
  const script = `
Add-Type -AssemblyName System.Speech
$r = New-Object System.Speech.Recognition.SpeechRecognitionEngine
$r.SetInputToDefaultAudioDevice()
$r.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
while ($true) {
  try {
    $result = $r.Recognize([TimeSpan]::FromSeconds(3))
    if ($result -and $result.Text) { [Console]::Out.WriteLine($result.Text); [Console]::Out.Flush() }
  } catch {}
}
`
  recognizer = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let buffer = ''
  recognizer.stdout?.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8')
    const lines = buffer.split(/\r?\n/); buffer = lines.pop() || ''
    for (const line of lines) { const clean = line.trim(); if (clean) onText(clean) }
  })
  recognizer.once('exit', () => { recognizer = null })
  return true
}
export function stopContinuous(): boolean { if (!recognizer || recognizer.killed) return false; recognizer.kill(); recognizer = null; return true }
