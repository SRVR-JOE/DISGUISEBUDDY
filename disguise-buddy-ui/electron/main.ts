process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason)
})
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error)
})

import { app, BrowserWindow } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'
import { startApiServer } from './api-server.ts'

// ESM-compatible __dirname
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

let mainWindow: BrowserWindow | null = null
const isDev = !app.isPackaged

async function createWindow(): Promise<void> {
  await startApiServer()

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 850,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#0F0F14',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (isDev) {
    await mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    await mainWindow.loadFile(
      path.join(__dirname, '../dist-renderer/index.html'),
    )
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(createWindow).catch(console.error)

app.on('window-all-closed', () => {
  app.quit()
})

app.on('activate', () => {
  // macOS: re-create window when dock icon is clicked and no windows are open
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow().catch(console.error)
  }
})
