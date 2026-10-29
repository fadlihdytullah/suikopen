import { appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { endSession, openFileInWindow, registerAssetHandlers, registerDocumentHandlers } from './ipc'
import { createApplicationMenu } from './menu'
import { MCP_PORT, startMcpServer } from './mcp/server'
import { mcpToken } from './mcp/token'
import { refreshSkills } from './mcp/install'
import { registerAgentHandlers } from './agent/ipc'

const userData = app.getPath('userData')
app.setName('SuikoPen')
app.setPath('userData', userData)

const RELOAD_COOLDOWN_MS = 5000

function logCrash(message: string): void {
  console.error(message)
  void appendFile(join(userData, 'crash.log'), `${new Date().toISOString()} ${message}\n`).catch(() => {})
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#1e1f22',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 14, y: 12 },
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  window.once('ready-to-show', () => window.show())

  window.webContents.on('will-navigate', (event) => event.preventDefault())

  let lastReload = 0
  const reload = (): void => {
    const now = Date.now()
    if (now - lastReload < RELOAD_COOLDOWN_MS || window.isDestroyed()) {
      return
    }
    lastReload = now
    window.webContents.reload()
  }

  window.webContents.on('render-process-gone', (_event, details) => {
    logCrash(`[renderer] gone: ${details.reason} (exit ${details.exitCode})`)
    if (details.reason !== 'clean-exit') {
      reload()
    }
  })

  const onRendererError = (event: Electron.IpcMainEvent, message: unknown, fatal: unknown): void => {
    if (event.sender !== window.webContents) {
      return
    }
    logCrash(`[canvas] ${String(message).slice(0, 2000)}`)
    if (fatal === true) {
      reload()
    }
  }
  ipcMain.on('app:renderer-error', onRendererError)
  window.on('closed', () => ipcMain.off('app:renderer-error', onRendererError))

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  let allowClose = false
  const onAllowClose = (event: Electron.IpcMainEvent): void => {
    if (event.sender !== window.webContents) {
      return
    }
    allowClose = true
    endSession()
    window.close()
  }
  ipcMain.on('app:allow-close', onAllowClose)
  window.on('closed', () => ipcMain.off('app:allow-close', onAllowClose))

  window.on('close', (event) => {
    if (allowClose) {
      return
    }
    event.preventDefault()
    window.webContents.send('app:close-request')
  })

  const devServerURL = process.env['ELECTRON_RENDERER_URL']
  if (devServerURL) {
    window.loadURL(devServerURL)
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.on('open-file', (event, path) => {
  event.preventDefault()
  void openFileInWindow(path).then((opened) => {
    if (!opened && app.isReady()) {
      createWindow()
    }
  })
})

app.on('child-process-gone', (_event, details) => {
  logCrash(`[${details.type}] gone: ${details.reason} (exit ${details.exitCode})`)
})

let mcp: { close: () => Promise<void> } | null = null

app.whenReady().then(async () => {
  registerDocumentHandlers()
  registerAssetHandlers()
  registerAgentHandlers()
  createApplicationMenu()
  createWindow()

  try {
    mcp = await startMcpServer(MCP_PORT, await mcpToken())
    void refreshSkills()
  } catch (error) {
    console.error('[mcp] could not start:', (error as Error).message)
  }
})

app.on('will-quit', () => {
  void mcp?.close()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
