import { randomUUID } from 'node:crypto'
import { BrowserWindow, ipcMain } from 'electron'
import type { AgentResponse, TabRef } from '../../shared/mcp/contract'

export const CALL_TIMEOUT_MS = 15_000

type Pending = { resolve: (value: { value: unknown; tab?: TabRef }) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }

const pending = new Map<string, Pending>()

export function registerBridge(): void {
  ipcMain.on('agent:result', (_event, response: AgentResponse) => {
    const waiting = pending.get(response.id)
    if (!waiting) {
      return
    }

    clearTimeout(waiting.timer)
    pending.delete(response.id)

    if (response.ok) {
      waiting.resolve({ value: response.value, tab: response.tab })
    } else {
      waiting.reject(new Error(response.error))
    }
  })
}

export function callEditor(method: string, params: Record<string, unknown> = {}, tabId?: string): Promise<unknown> {
  return callEditorTab(method, params, tabId).then((reply) => reply.value)
}

export function callEditorTab(method: string, params: Record<string, unknown> = {}, tabId?: string): Promise<{ value: unknown; tab?: TabRef }> {
  const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]

  if (!window || window.isDestroyed()) {
    return Promise.reject(new Error('suikopen is not running, or has no open window.'))
  }

  const id = randomUUID()

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`The editor did not answer "${method}" within ${CALL_TIMEOUT_MS}ms.`))
    }, CALL_TIMEOUT_MS)

    pending.set(id, { resolve, reject, timer })
    window.webContents.send('agent:call', { id, method, params, ...(tabId ? { tabId } : {}) })
  })
}

export async function captureWindow(rect?: { x: number; y: number; width: number; height: number }): Promise<string> {
  const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  if (!window || window.isDestroyed()) {
    throw new Error('suikopen is not running, or has no open window.')
  }

  const image = rect && rect.width > 0 && rect.height > 0 ? await window.webContents.capturePage(rect) : await window.webContents.capturePage()

  return image.toPNG().toString('base64')
}
