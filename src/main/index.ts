import { join } from 'node:path'
import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { openFileInWindow, registerAssetHandlers, registerDocumentHandlers } from './ipc'
import { createApplicationMenu } from './menu'
import { MCP_PORT, startMcpServer } from './mcp/server'
import { mcpToken } from './mcp/token'
import { registerAgentHandlers } from './agent/ipc'

const userData = app.getPath('userData')
app.setName('SuikoPen')
app.setPath('userData', userData)

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#1e1f22',
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

let mcp: { close: () => Promise<void> } | null = null

app.whenReady().then(async () => {
  registerDocumentHandlers()
  registerAssetHandlers()
  registerAgentHandlers()
  createApplicationMenu()
  createWindow()

  try {
    mcp = await startMcpServer(MCP_PORT, await mcpToken())
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
