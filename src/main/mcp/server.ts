import { createServer, type Server } from 'node:http'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { z } from 'zod'
import { callEditor, captureWindow, registerBridge } from './bridge'
import { GUIDES, GUIDE_TOPICS } from '../agent/guides'
import { MCP_INSTRUCTIONS } from '../agent/prompt'
import { styleDetail, styleList, STYLES } from '../agent/styles'
import { findIcons, ICON_SETS } from './icons'

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
  'get_guide',
  'batch',
  'get_variables',
  'export_code',
  'set_variables',
  'get_style',
  'find_icons',
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
  const server = new McpServer({ name: 'suikopen', version: '0.1.0' }, { instructions: MCP_INSTRUCTIONS })

  server.registerTool(
    'get_guide',
    {
      description:
        'Design guidance for one kind of output. Call once before building: web-app, landing-page, mobile-app, slides, dashboard (also tables), components (design systems), design-to-code (turning a design into project code), or schema (the node format).',
      inputSchema: { topic: z.enum(GUIDE_TOPICS) },
    },
    ({ topic }) => ({ content: [{ type: 'text' as const, text: GUIDES[topic] }] })
  )

  server.registerTool(
    'batch',
    {
      description:
        'Run several edits as one step: one undo for the user, and nothing is applied if any operation fails. Each op is {"tool": "create_node" | "update_node" | "move_node" | "set_text" | "delete_nodes", ...that tool\'s parameters}. Later ops can use ids created by earlier ones. Returns each result and any layout problems in the touched screens. Use it for one section at a time so the user sees progress.',
      inputSchema: {
        ops: z
          .array(z.looseObject({ tool: z.enum(['create_node', 'update_node', 'move_node', 'set_text', 'delete_nodes']) }))
          .min(1)
          .max(200),
      },
    },
    ({ ops }) => tool('batch', { ops })
  )

  server.registerTool(
    'get_variables',
    {
      description: 'Design tokens declared by the document (colours, numbers, strings) with their theme variants, plus the same tokens as CSS custom properties.',
      inputSchema: {},
    },
    () => tool('get_variables')
  )

  server.registerTool(
    'export_code',
    {
      description:
        'Turn a node and everything inside it into HTML, as a starting point for project code. format "html-tailwind" (default) gives Tailwind classes; "html-css" gives class names plus a stylesheet. Variables stay as CSS custom properties (var(--name)), defined in "css". Also lists fonts and image URLs used. Adapt the result to the project\'s framework and components; call get_guide("design-to-code") first.',
      inputSchema: { id: z.string(), format: z.enum(['html-tailwind', 'html-css']).optional() },
    },
    ({ id, format }) => tool('export_code', { id, format })
  )

  server.registerTool(
    'set_variables',
    {
      description:
        'Add or change design tokens. Each variable is {"type": "color" | "number" | "string" | "boolean", "value": v} or, for theme variants, {"type": "color", "value": [{"value": "#fff"}, {"value": "#000", "theme": {"mode": "dark"}}]}. Merges with existing variables unless replace is true. Theme axes are declared automatically.',
      inputSchema: { variables: z.record(z.string(), z.unknown()), replace: z.boolean().optional() },
    },
    ({ variables, replace }) => tool('set_variables', { variables, replace })
  )

  server.registerTool(
    'get_style',
    {
      description: `Ready-made visual styles (fonts, colour tokens with light and dark values, type scale, radius, layout notes) for when the user has no brand. Without a name, lists them: ${STYLES.map((style) => style.name).join(', ')}. With a name, returns the full style and variables ready for set_variables.`,
      inputSchema: { name: z.string().optional() },
    },
    ({ name }) => {
      try {
        return text(name ? styleDetail(name) : styleList())
      } catch (error) {
        return failure(error)
      }
    }
  )

  server.registerTool(
    'find_icons',
    {
      description:
        'Search an icon set and get SVG URLs. Put an icon in a small rectangle (16-24) whose only fill is {"type":"image","url":"<url>","mode":"contain"}. Change the colour by editing the url\'s color parameter (url-encoded hex, %23 for #). Sets: lucide (default, UI icons), tabler, ph (Phosphor), mdi, simple-icons (brand logos).',
      inputSchema: { query: z.string().min(1), set: z.enum(ICON_SETS).optional(), limit: z.number().int().min(1).max(32).optional() },
    },
    async ({ query, set, limit }) => {
      try {
        return text(await findIcons((url) => fetch(url, { signal: AbortSignal.timeout(10_000) }), query, set, limit))
      } catch (error) {
        return failure(error)
      }
    }
  )

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
      description:
        'PNG of one node rendered on its own at 2x, wherever it sits on the canvas, plus any layout problems found inside it. Without an id, the whole editor window.',
      inputSchema: { id: z.string().optional() },
    },
    async ({ id }) => {
      try {
        if (!id) {
          return { content: [{ type: 'image' as const, data: await captureWindow(), mimeType: 'image/png' }] }
        }
        const { png } = (await callEditor('render_node', { id })) as { png: string }
        const problems = (await callEditor('get_problems', { id })) as unknown[]
        return {
          content: [
            { type: 'image' as const, data: png, mimeType: 'image/png' },
            { type: 'text' as const, text: problems.length ? JSON.stringify({ problems }, null, 2) : 'No layout problems found.' },
          ],
        }
      } catch (error) {
        return failure(error)
      }
    }
  )

  return server
}

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])

export function allowedRequest(origin: string | undefined, host: string | undefined, port: number): boolean {
  if (!host || !LOCAL_HOSTS.has(host.replace(new RegExp(`:${port}$`), ''))) {
    return false
  }
  if (origin === undefined) {
    return true
  }
  try {
    const parsed = new URL(origin)
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && LOCAL_HOSTS.has(parsed.hostname)
  } catch {
    return false
  }
}

export async function startMcpServer(port = MCP_PORT): Promise<{ http: Server; close: () => Promise<void> }> {
  registerBridge()

  const http = createServer((request, response) => {
    if (!allowedRequest(request.headers.origin, request.headers.host, port)) {
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
