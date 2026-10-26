import { createServer, type Server } from 'node:http'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { z } from 'zod'
import { callEditor, captureWindow, registerBridge } from './bridge'

export const MCP_PORT = 29980
export const MCP_PATH = '/mcp'
export const MCP_SERVER_NAME = 'suikopen'

export const TOOL_NAMES = [
  'get_document_info',
  'get_tree',
  'get_node',
  'find_nodes',
  'get_selection',
  'set_selection',
  'create_node',
  'update_node',
  'move_node',
  'set_text',
  'delete_nodes',
  'get_theme',
  'set_theme',
  'detach_instance',
  'screenshot',
] as const

function text(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] }
}

function failure(error: unknown) {
  return { isError: true, content: [{ type: 'text' as const, text: (error as Error).message }] }
}

function tool(method: string, params: Record<string, unknown> = {}) {
  return callEditor(method, params).then(text).catch(failure)
}

export function createMcpServer(): McpServer {
  const server = new McpServer({ name: 'suikopen', version: '0.1.0' })

  server.registerTool(
    'get_document_info',
    { description: 'Identity and size of the document currently open in suikopen.', inputSchema: {} },
    () => tool('get_document_info')
  )

  server.registerTool(
    'get_tree',
    {
      description: 'The node tree of the open document, as a flat list in paint order.',
      inputSchema: { maxDepth: z.number().int().min(0).max(20).optional() },
    },
    ({ maxDepth }) => tool('get_tree', { maxDepth })
  )

  server.registerTool(
    'get_node',
    { description: 'One node in full, with its computed layout rect.', inputSchema: { id: z.string() } },
    ({ id }) => tool('get_node', { id })
  )

  server.registerTool(
    'find_nodes',
    {
      description: 'Find nodes by name substring and/or node type.',
      inputSchema: { name: z.string().optional(), type: z.string().optional() },
    },
    ({ name, type }) => tool('find_nodes', { name, type })
  )

  server.registerTool(
    'get_selection',
    { description: 'What the user currently has selected.', inputSchema: {} },
    () => tool('get_selection')
  )

  server.registerTool(
    'set_selection',
    { description: 'Replace the selection.', inputSchema: { ids: z.array(z.string()) } },
    ({ ids }) => tool('set_selection', { ids })
  )

  server.registerTool(
    'create_node',
    {
      description: 'Add a node to the document, optionally inside a frame or group.',
      inputSchema: { parentId: z.string().optional(), node: z.record(z.string(), z.unknown()) },
    },
    ({ parentId, node }) => tool('create_node', { parentId, node })
  )

  server.registerTool(
    'update_node',
    {
      description: 'Set properties on a node. Unknown properties are rejected by the schema on the next load.',
      inputSchema: { id: z.string(), props: z.record(z.string(), z.unknown()) },
    },
    ({ id, props }) => tool('update_node', { id, props })
  )

  server.registerTool(
    'move_node',
    { description: 'Move a node to a position in its parent.', inputSchema: { id: z.string(), x: z.number().optional(), y: z.number().optional() } },
    ({ id, x, y }) => tool('move_node', { id, x, y })
  )

  server.registerTool(
    'set_text',
    { description: 'Replace the content of a text node.', inputSchema: { id: z.string(), content: z.string() } },
    ({ id, content }) => tool('set_text', { id, content })
  )

  server.registerTool(
    'delete_nodes',
    { description: 'Delete nodes and everything inside them.', inputSchema: { ids: z.array(z.string()) } },
    ({ ids }) => tool('delete_nodes', { ids })
  )

  server.registerTool(
    'get_theme',
    { description: 'Theme axes declared by the document and the one currently applied.', inputSchema: {} },
    () => tool('get_theme')
  )

  server.registerTool(
    'set_theme',
    {
      description: 'Apply a theme selection, as an axis-to-value map. Affects rendering only; it is not saved.',
      inputSchema: { theme: z.record(z.string(), z.string()) },
    },
    ({ theme }) => tool('set_theme', { theme })
  )

  server.registerTool(
    'detach_instance',
    {
      description: 'Replace a component instance with an independent copy of its expanded contents.',
      inputSchema: { id: z.string() },
    },
    ({ id }) => tool('detach_instance', { id })
  )

  server.registerTool(
    'screenshot',
    {
      description: 'PNG of one node rendered on its own at 2x, wherever it sits on the canvas. Without an id, the whole editor window.',
      inputSchema: { id: z.string().optional() },
    },
    async ({ id }) => {
      try {
        const data = id ? ((await callEditor('render_node', { id })) as { png: string }).png : await captureWindow()
        return { content: [{ type: 'image' as const, data, mimeType: 'image/png' }] }
      } catch (error) {
        return failure(error)
      }
    }
  )

  return server
}

function allowed(origin: string | undefined): boolean {
  return origin === undefined || origin.startsWith('http://127.0.0.1') || origin.startsWith('http://localhost')
}

export async function startMcpServer(port = MCP_PORT): Promise<{ http: Server; close: () => Promise<void> }> {
  registerBridge()

  const http = createServer((request, response) => {
    if (!allowed(request.headers.origin)) {
      response.writeHead(403).end('Forbidden')
      return
    }

    if (!request.url?.startsWith(MCP_PATH)) {
      response.writeHead(404).end('Not found')
      return
    }

    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      void (async () => {
        try {
          const body = Buffer.concat(chunks).toString('utf8')
          const headers = new Headers()
          for (const [name, value] of Object.entries(request.headers)) {
            if (typeof value === 'string') {
              headers.set(name, value)
            }
          }

          const webRequest = new Request(`http://127.0.0.1:${port}${request.url}`, {
            method: request.method ?? 'POST',
            headers,
            ...(body.length > 0 ? { body } : {}),
          })

          const mcp = createMcpServer()
          const transport = new WebStandardStreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
            enableJsonResponse: true,
          })
          await mcp.connect(transport)

          try {
            const result = await transport.handleRequest(webRequest)
            const payload = await result.text()

            response.writeHead(result.status, Object.fromEntries(result.headers.entries()))
            response.end(payload)
          } finally {
            await mcp.close()
          }
        } catch (error) {
          console.error('[mcp] request failed:', (error as Error).stack ?? (error as Error).message)
          if (!response.headersSent) {
            response.writeHead(500).end('MCP request failed')
          }
        }
      })()
    })
  })

  await new Promise<void>((resolve) => http.listen(port, '127.0.0.1', resolve))

  return {
    http,
    close: async () => {
      await new Promise<void>((resolve) => http.close(() => resolve()))
    },
  }
}
