import { randomUUID } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { app, nativeImage } from 'electron'
import { classifyAttachment, MAX_ATTACHMENT_BYTES, type AgentAttachment, type AgentAttachmentResult } from '../../shared/agent'

const THUMBNAIL_SIZE = 96
const TEXT_LIMIT = 200_000

function thumbnail(path: string): string | undefined {
  const image = nativeImage.createFromPath(path)
  if (image.isEmpty()) return undefined
  const { width, height } = image.getSize()
  const scale = THUMBNAIL_SIZE / Math.min(width, height)
  return image.resize(scale < 1 ? { width: Math.round(width * scale), height: Math.round(height * scale) } : { width, height }).toDataURL()
}

export async function describeAttachment(path: string): Promise<AgentAttachmentResult> {
  const name = basename(path)
  const type = classifyAttachment(name)
  if (!type) return { name, error: "This file type isn't supported." }
  try {
    const info = await stat(path)
    if (!info.isFile()) return { name, error: "This isn't a file." }
    if (info.size > MAX_ATTACHMENT_BYTES) return { name, error: 'Too large. Max 10 MB.' }
    const attachment: AgentAttachment = { path, name, kind: type.kind, mime: type.mime, size: info.size }
    const thumb = type.kind === 'image' ? thumbnail(path) : undefined
    return thumb ? { ...attachment, thumbnail: thumb } : attachment
  } catch {
    return { name, error: "Couldn't read this file." }
  }
}

export async function savePasted(name: string, data: ArrayBuffer): Promise<AgentAttachmentResult> {
  if (data.byteLength > MAX_ATTACHMENT_BYTES) return { name, error: 'Too large. Max 10 MB.' }
  const directory = join(app.getPath('userData'), 'attachments')
  await mkdir(directory, { recursive: true })
  const path = join(directory, `${randomUUID().slice(0, 8)}-${basename(name)}`)
  await writeFile(path, Buffer.from(data))
  return describeAttachment(path)
}

export async function readBase64(attachment: AgentAttachment): Promise<string> {
  return (await readFile(attachment.path)).toString('base64')
}

export async function textAttachments(attachments: AgentAttachment[]): Promise<string> {
  const parts: string[] = []
  for (const attachment of attachments.filter((entry) => entry.kind === 'text')) {
    const text = (await readFile(attachment.path, 'utf8')).slice(0, TEXT_LIMIT)
    parts.push(`<attached_file name="${attachment.name}">\n${text}\n</attached_file>`)
  }
  return parts.join('\n\n')
}

export async function promptWithText(prompt: string, attachments: AgentAttachment[]): Promise<string> {
  const text = await textAttachments(attachments)
  return text ? `${text}\n\n${prompt}` : prompt
}
