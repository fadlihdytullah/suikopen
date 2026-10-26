import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AgentSkill } from '../../shared/agent'

const SKILLS_DIR = join(homedir(), '.agents/skills')

export function parseSkill(text: string, fallbackName: string): AgentSkill & { body: string } {
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(text)
  const field = (key: string) => match?.[1]?.match(new RegExp(`^${key}:\\s*(.*)$`, 'm'))?.[1]?.trim().replace(/^["']|["']$/g, '') ?? ''
  return { name: field('name') || fallbackName, description: field('description'), body: match ? text.slice(match[0].length) : text }
}

async function readSkill(directory: string): Promise<(AgentSkill & { body: string }) | null> {
  try {
    return parseSkill(await readFile(join(SKILLS_DIR, directory, 'SKILL.md'), 'utf8'), directory)
  } catch {
    return null
  }
}

export async function listSkills(): Promise<AgentSkill[]> {
  const entries = await readdir(SKILLS_DIR).catch(() => [] as string[])
  const skills = await Promise.all(entries.filter((entry) => !entry.startsWith('.')).map(readSkill))
  return skills
    .filter((skill): skill is AgentSkill & { body: string } => skill !== null)
    .map(({ name, description }) => ({ name, description }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export async function skillInstructions(names: string[]): Promise<string> {
  const entries = await readdir(SKILLS_DIR).catch(() => [] as string[])
  const skills = await Promise.all(entries.map(readSkill))
  return skills
    .filter((skill) => skill && names.includes(skill.name))
    .map((skill) => `<skill name="${skill!.name}">\n${skill!.body.trim()}\n</skill>`)
    .join('\n\n')
}
