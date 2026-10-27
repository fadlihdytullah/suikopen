import { readFile, realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, net } from 'electron'
import { readDocument, writeDocument } from './file-io'
import type { Document } from '../shared/schema/document'
import { readFont, type FontRequest } from './fonts'
import { allowedImageUrl } from '../shared/image-hosts'

export type OpenResult =
  | { ok: true; document: Document; path: string | null; assetBase: string }
  | { ok: false; error: string }
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
  try {
    const document = await readDocument(path)
    const imported = path.toLowerCase().endsWith('.pen')
    if (!imported) {
      trustedPaths.add(path)
      app.addRecentDocument(path)
    }
    return { ok: true, document, path: imported ? null : path, assetBase: path }
  } catch (error) {
    return { ok: false, error: (error as Error).message }
  }
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
  ipcMain.handle('document:open-initial', async (): Promise<OpenResult> => {
    if (pendingPath) {
      const path = pendingPath
      pendingPath = null
      return openPath(path)
    }
    try {
      const source = initialDocumentPath()
      return { ok: true, document: await readDocument(source), path: null, assetBase: source }
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
    async (_event, request: { path: string | null; document: Document; saveAs?: boolean }): Promise<SaveResult> => {
      const trusted = request.path !== null && trustedPaths.has(request.path)
      const path = request.saveAs || !trusted ? await pickSavePath(request.path) : request.path

      if (!path) {
        return { cancelled: true }
      }

      try {
        await writeDocument(path, request.document)
        trustedPaths.add(path)
        app.addRecentDocument(path)
        return { ok: true, path }
      } catch (error) {
        return { ok: false, error: (error as Error).message }
      }
    }
  )

  ipcMain.handle('window:set-state', (event, state: { path: string | null; edited: boolean }) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) {
      return
    }

    window.setTitle(state.path ? basename(state.path) : 'Untitled')
    window.setDocumentEdited(state.edited)
    if (state.path) {
      window.setRepresentedFilename(state.path)
    }
  })

  ipcMain.handle('app:confirm-discard', async (event): Promise<DiscardChoice> => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const options = {
      type: 'warning' as const,
      buttons: ['Save', 'Discard', 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      message: 'This document has unsaved changes.',
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
