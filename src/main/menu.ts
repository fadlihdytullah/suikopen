import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron'

export type MenuCommand =
  | 'new'
  | 'open'
  | 'save'
  | 'save-as'
  | 'undo'
  | 'redo'
  | 'select-all'
  | 'delete'
  | 'toggle-panels'
  | 'show-layers'
  | 'show-agent'
  | 'open-settings'
  | 'duplicate'
  | 'group'
  | 'ungroup'
  | 'frame-selection'
  | 'bring-forward'
  | 'send-backward'
  | 'bring-to-front'
  | 'send-to-back'
  | 'zoom-in'
  | 'zoom-out'

function send(command: MenuCommand): void {
  BrowserWindow.getFocusedWindow()?.webContents.send('menu:command', command)
}

export function createApplicationMenu(): void {
  const isMac = process.platform === 'darwin'

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => send('open-settings') },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ] satisfies MenuItemConstructorOptions[],
          },
        ]
      : []),
    {
      label: 'File',
      submenu: [
        { label: 'New', accelerator: 'CmdOrCtrl+N', click: () => send('new') },
        { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: () => send('open') },
        { role: 'recentDocuments', submenu: [{ role: 'clearRecentDocuments' }] },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => send('save') },
        { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: () => send('save-as') },
        { type: 'separator' },
        ...(isMac ? [] : [{ label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => send('open-settings') }, { type: 'separator' as const }]),
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: () => send('undo') },
        { label: 'Redo', accelerator: 'CmdOrCtrl+Shift+Z', click: () => send('redo') },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { label: 'Duplicate', accelerator: 'CmdOrCtrl+D', click: () => send('duplicate') },
        { type: 'separator' },
        { label: 'Select All', accelerator: 'CmdOrCtrl+A', click: () => send('select-all') },
        { label: 'Delete', click: () => send('delete') },
      ],
    },
    {
      label: 'Object',
      submenu: [
        { label: 'Group Selection', accelerator: 'CmdOrCtrl+G', click: () => send('group') },
        { label: 'Frame Selection', accelerator: 'CmdOrCtrl+Alt+G', click: () => send('frame-selection') },
        { label: 'Ungroup', accelerator: 'CmdOrCtrl+Shift+G', click: () => send('ungroup') },
        { type: 'separator' },
        { label: 'Bring Forward', accelerator: 'CmdOrCtrl+]', click: () => send('bring-forward') },
        { label: 'Send Backward', accelerator: 'CmdOrCtrl+[', click: () => send('send-backward') },
        { label: 'Bring to Front', accelerator: 'CmdOrCtrl+Alt+]', click: () => send('bring-to-front') },
        { label: 'Send to Back', accelerator: 'CmdOrCtrl+Alt+[', click: () => send('send-to-back') },
      ],
    },
    {
      label: 'Agent',
      submenu: [
        {
          label: 'Install MCP server in Claude Code…',
          click: async () => {
            const { dialog } = await import('electron')
            const { installIntoClaudeCode, claudeConfigPath } = await import('./mcp/install')
            const choice = await dialog.showMessageBox({
              type: 'question',
              buttons: ['Install', 'Cancel'],
              defaultId: 1,
              cancelId: 1,
              message: 'Add suikopen to Claude Code?',
              detail: `This edits ${claudeConfigPath()} and keeps a backup beside it.`,
            })
            if (choice.response !== 0) {
              return
            }
            try {
              const result = await installIntoClaudeCode()
              await dialog.showMessageBox({ message: result.changed ? 'Installed.' : 'Already installed.', detail: result.path })
            } catch (error) {
              await dialog.showErrorBox('Could not install', (error as Error).message)
            }
          },
        },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Show Layers', accelerator: 'Alt+1', click: () => send('show-layers') },
        { label: 'Show Agent', accelerator: 'Alt+2', click: () => send('show-agent') },
        { label: 'Toggle Panels', accelerator: 'CmdOrCtrl+\\', click: () => send('toggle-panels') },
        { type: 'separator' },
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', click: () => send('zoom-in') },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: () => send('zoom-out') },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
  void app
}
