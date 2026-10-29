import { readFile, realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, net } from 'electron'
import { readDocument, toCheckpoint, writeDocument, type Checkpoint } from './file-io'
import { createHistoryVault, createRecovery } from './recovery'
import type { Document } from '../shared/schema/document'
import { readFont, type FontRequest } from './fonts'
import { tabs } from './tabs'
import { setWindowTabs } from './menu'
import { allowedImageUrl } from '../shared/image-hosts'

export type OpenedDocument = {
  ok: true
  existing?: false
  tabId: string
  document: Document
  path: string | null
  assetBase: string | null
  recovered?: boolean
}
export type OpenResult = OpenedDocument | { ok: true; existing: true; tabId: string } | { ok: false; error: string }
export type SaveResult = { ok: true; path: string } | { ok: false; error: string } | { cancelled: true }
export type DiscardChoice = 'save' | 'discard' | 'cancel'

const FILTERS = [{ name: 'suikopen document', extensions: ['spen'] }]

function initialDocumentPath(): string {
  const root = app.isPackaged ? process.resourcesPath : app.getAppPath()
  return join(root, 'fixtures/hello.spen')
}

async function pickSavePath(suggested: string | null): Promise<string | null> {
  const result = await dialog.showSaveDialog({
    defaultPath: suggested ?? 'Untitled.spen',
    filters: FILTERS,
  })

  return result.canceled || !result.filePath ? null : result.filePath
}

const trustedPaths = new Set<string>()
let pendingPath: string | null = null

async function openPath(path: string): Promise<OpenResult> {
  const openTab = tabs.idForPath(path)
  if (openTab) {
    return { ok: true, existing: true, tabId: openTab }
  }
  try {
    const document = await readDocument(path)
    const imported = path.toLowerCase().endsWith('.pen')
    if (!imported) {
      trustedPaths.add(path)
      app.addRecentDocument(path)
    }
    const kept = imported ? null : path
    return { ok: true, tabId: tabs.open(kept).id, document, path: kept, assetBase: path }
  } catch (error) {
    return { ok: false, error: (error as Error).message }
  }
}

let stores: { recovery: ReturnType<typeof createRecovery>; history: ReturnType<typeof createHistoryVault> } | null = null

function persisted() {
  stores ??= {
    recovery: createRecovery(join(app.getPath('userData'), 'recovery')),
    history: createHistoryVault(join(app.getPath('userData'), 'history')),
  }
  return stores
}

export type InitialResult = { ok: true; tabs: OpenedDocument[]; activeTabId: string | null } | { ok: false; error: string }

export function endSession(): void {
  void persisted().recovery.clearCheckpoints()
}

async function askRestore(): Promise<boolean> {
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    buttons: ['Restore', 'Discard'],
    defaultId: 0,
    cancelId: 1,
    message: 'SuikoPen quit unexpectedly.',
    detail: 'Restore the unsaved changes in your open tabs?',
  })
  return response === 0
}

async function restoreSession(): Promise<{ tabs: OpenedDocument[]; activeTabId: string | null }> {
  const fromMemory = persisted().recovery.hasMemory()
  const { session, checkpoints } = fromMemory ? persisted().recovery.memory() : await persisted().recovery.read()
  persisted().recovery.reset()
  if (!session) {
    return { tabs: [], activeTabId: null }
  }

  const dirty = session.order.some((id) => checkpoints.get(id)?.dirty)
  const useCheckpoints = !dirty || fromMemory || (await askRestore())
  if (!useCheckpoints) {
    await persisted().recovery.clearCheckpoints()
  }

  const opened: OpenedDocument[] = []
  let activeTabId: string | null = null
  for (const oldId of session.order) {
    const saved = useCheckpoints ? checkpoints.get(oldId) : undefined
    const path = saved ? saved.path : (session.paths[oldId] ?? null)
    let entry: OpenedDocument | null = null

    if (saved?.dirty) {
      entry = { ok: true, tabId: '', document: saved.document, path: saved.path, assetBase: saved.assetBase, recovered: true }
    } else if (path) {
      try {
        entry = { ok: true, tabId: '', document: await readDocument(path), path, assetBase: path }
      } catch {
        entry = null
      }
    }

    if (!entry || (entry.path && tabs.idForPath(entry.path))) {
      continue
    }
    if (entry.path) {
      trustedPaths.add(entry.path)
    }
    entry.tabId = tabs.open(entry.path).id
    opened.push(entry)
    if (oldId === session.activeId) {
      activeTabId = entry.tabId
    }
  }

  return { tabs: opened, activeTabId: activeTabId ?? opened[0]?.tabId ?? null }
}

export async function openFileInWindow(path: string): Promise<boolean> {
  const window = BrowserWindow.getAllWindows()[0]
  if (!window) {
    pendingPath = path
    return false
  }
  window.webContents.send('document:opened', await openPath(path))
  window.focus()
  return true
}

export function registerDocumentHandlers(): void {
  ipcMain.handle('document:open-initial', async (): Promise<InitialResult> => {
    tabs.clear()
    await persisted().history.clear()
    const restored = await restoreSession()

    if (pendingPath) {
      const path = pendingPath
      pendingPath = null
      const result = await openPath(path)
      if (result.ok && !result.existing) {
        restored.tabs.push(result)
        restored.activeTabId = result.tabId
      } else if (result.ok) {
        restored.activeTabId = result.tabId
      }
    }

    if (restored.tabs.length > 0) {
      return { ok: true, ...restored }
    }

    try {
      const source = initialDocumentPath()
      const tabId = tabs.open(null).id
      return { ok: true, tabs: [{ ok: true, tabId, document: await readDocument(source), path: null, assetBase: source }], activeTabId: tabId }
    } catch (error) {
      return { ok: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('document:open-dialog', async (): Promise<OpenResult | { cancelled: true }> => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'suikopen or Pen document', extensions: ['spen', 'pen'] }],
    })
    const path = result.filePaths[0]

    if (result.canceled || !path) {
      return { cancelled: true }
    }

    return openPath(path)
  })

  ipcMain.handle(
    'document:save',
    async (_event, request: { tabId?: string; path: string | null; document: Document; saveAs?: boolean }): Promise<SaveResult> => {
      const trusted = request.path !== null && trustedPaths.has(request.path)
      const path = request.saveAs || !trusted ? await pickSavePath(request.path) : request.path

      if (!path) {
        return { cancelled: true }
      }

      try {
        await writeDocument(path, request.document)
        trustedPaths.add(path)
        app.addRecentDocument(path)
        if (request.tabId) {
          tabs.rename(request.tabId, path)
        }
        return { ok: true, path }
      } catch (error) {
        return { ok: false, error: (error as Error).message }
      }
    }
  )

  ipcMain.handle('tabs:new', () => tabs.open(null).id)
  ipcMain.on('tabs:closed', (_event, id: string) => {
    tabs.close(id)
    void persisted().recovery.remove(id)
    void persisted().history.take(id)
  })
  ipcMain.handle('tabs:spill-history', (_event, id: string, json: string) => persisted().history.spill(id, json))
  ipcMain.handle('tabs:take-history', (_event, id: string) => persisted().history.take(id))
  ipcMain.on('tabs:sync', (event, list: { id: string; name: string; active: boolean }[]) => {
    if (!BrowserWindow.fromWebContents(event.sender)) {
      return
    }
    setWindowTabs(list)
    const paths = Object.fromEntries(tabs.list().map((entry) => [entry.id, entry.path]))
    void persisted().recovery.writeSession({
      order: list.map((entry) => entry.id).filter((id) => id in paths),
      activeId: list.find((entry) => entry.active)?.id ?? null,
      paths,
    })
  })

  ipcMain.on('document:checkpoint', (_event, state: Checkpoint & { tabId: string }) => {
    if (!tabs.has(state.tabId)) {
      return
    }
    const document = toCheckpoint(state)
    if (!document) {
      return
    }
    void persisted().recovery.write(state.tabId, { ...document, path: document.path !== null && trustedPaths.has(document.path) ? document.path : null })
  })

  ipcMain.handle('window:set-state', (event, state: { path: string | null; edited: boolean }) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) {
      return
    }

    window.setTitle(state.path ? basename(state.path) : 'Untitled')
    window.setDocumentEdited(state.edited)
    window.setRepresentedFilename(state.path ?? '')
  })

  ipcMain.handle('app:confirm-stop-agent', async (event, name: string): Promise<boolean> => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const options = {
      type: 'warning' as const,
      buttons: ['Stop and Close', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message: `The agent is still working in "${name}". Stop it and close?`,
    }
    const result = window ? await dialog.showMessageBox(window, options) : await dialog.showMessageBox(options)
    return result.response === 0
  })

  ipcMain.handle('app:confirm-discard', async (event, name?: string): Promise<DiscardChoice> => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const options = {
      type: 'warning' as const,
      buttons: ['Save', "Don't Save", 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      message: name ? `Save changes to "${name}"?` : 'This document has unsaved changes.',
    }

    const result = window
      ? await dialog.showMessageBox(window, options)
      : await dialog.showMessageBox(options)

    return (['save', 'discard', 'cancel'] as const)[result.response] ?? 'cancel'
  })
}

export type Asset = { bytes: ArrayBuffer; type: string }

const REMOTE_ASSET_LIMIT = 5 * 1024 * 1024
const REMOTE_ASSET_TIMEOUT_MS = 10_000
const remoteCache = new Map<string, Promise<Asset | null>>()

function fetchRemoteAsset(url: string): Promise<Asset | null> {
  const cached = remoteCache.get(url)
  if (cached) {
    return cached
  }

  const pending = (async (): Promise<Asset | null> => {
    try {
      const response = await net.fetch(url, { redirect: 'error', signal: AbortSignal.timeout(REMOTE_ASSET_TIMEOUT_MS) })
      const type = response.headers.get('content-type') ?? ''
      if (!response.ok || !type.startsWith('image/') || Number(response.headers.get('content-length') ?? 0) > REMOTE_ASSET_LIMIT) {
        return null
      }
      const bytes = await response.arrayBuffer()
      return bytes.byteLength > REMOTE_ASSET_LIMIT ? null : { bytes, type }
    } catch {
      return null
    }
  })()

  remoteCache.set(url, pending)
  pending.then((asset) => {
    if (!asset) {
      remoteCache.delete(url)
    }
  })

  return pending
}

const IMAGE_EXTENSION = /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i

export function insideRoot(root: string, target: string): boolean {
  const path = relative(root, target)
  return path !== '' && !path.startsWith('..') && !isAbsolute(path)
}

export function registerAssetHandlers(): void {
  ipcMain.handle('asset:read', async (_event, request: { base: string | null; url: string }): Promise<Asset | null> => {
    if (/^https?:\/\//i.test(request.url)) {
      return allowedImageUrl(request.url) ? fetchRemoteAsset(request.url) : null
    }

    if (!IMAGE_EXTENSION.test(request.url)) {
      return null
    }

    try {
      const root = await realpath(request.base ? dirname(request.base) : app.getAppPath())
      const target = await realpath(resolve(root, request.url))
      if (!insideRoot(root, target)) {
        return null
      }
      const bytes = await readFile(target)
      return {
        bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        type: target.toLowerCase().endsWith('.svg') ? 'image/svg+xml' : 'image/*',
      }
    } catch {
      return null
    }
  })

  ipcMain.handle('font:read', (_event, request: FontRequest) =>
    readFont(request, join(app.getPath('userData'), 'fonts'), (url, init) => net.fetch(url, init))
  )
}
