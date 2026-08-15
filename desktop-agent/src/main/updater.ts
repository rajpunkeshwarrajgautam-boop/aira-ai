import { app, BrowserWindow } from 'electron'
import electronUpdater from 'electron-updater'
import { getSettings } from './config'

const { autoUpdater } = electronUpdater

export function initUpdater(getWindow: () => BrowserWindow | null): void {
  if (!app.isPackaged || !getSettings().autoUpdate) return
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('checking-for-update', () => getWindow()?.webContents.send('update:status', { state: 'checking' }))
  autoUpdater.on('update-available', (info) => getWindow()?.webContents.send('update:status', { state: 'available', version: info.version }))
  autoUpdater.on('update-not-available', () => getWindow()?.webContents.send('update:status', { state: 'current' }))
  autoUpdater.on('download-progress', (progress) => getWindow()?.webContents.send('update:status', { state: 'downloading', percent: Math.round(progress.percent) }))
  autoUpdater.on('update-downloaded', (info) => getWindow()?.webContents.send('update:status', { state: 'ready', version: info.version }))
  autoUpdater.on('error', (error) => getWindow()?.webContents.send('update:status', { state: 'error', error: error.message }))
  void autoUpdater.checkForUpdatesAndNotify().catch(() => undefined)
}
export async function checkForUpdates(): Promise<boolean> { if (!app.isPackaged) return false; await autoUpdater.checkForUpdates(); return true }
export function installUpdate(): boolean { if (!app.isPackaged) return false; autoUpdater.quitAndInstall(false, true); return true }
