import { mkdir, readdir, readFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { readCheckpoint, writeCheckpoint, writeFileAtomic, type Checkpoint } from './file-io'

export type Session = { order: string[]; activeId: string | null; paths: Record<string, string | null> }

const SESSION_FILE = 'session.json'
const ID = /^[A-Za-z0-9_-]{1,64}$/

export function createRecovery(dir: string) {
  const memory = new Map<string, Checkpoint>()
  let session: Session | null = null
  let queue: Promise<unknown> = Promise.resolve()

  function enqueue(task: () => Promise<unknown>): Promise<void> {
    queue = queue.then(task).catch((error: Error) => console.error('[recovery]', error.message))
    return queue.then(() => undefined)
  }

  const file = (id: string): string => join(dir, `${id}.json`)

  return {
    hasMemory: (): boolean => session !== null,
    memory: (): { session: Session | null; checkpoints: Map<string, Checkpoint> } => ({ session, checkpoints: new Map(memory) }),
    write(id: string, checkpoint: Checkpoint): Promise<void> {
      if (!ID.test(id)) {
        return Promise.resolve()
      }
      memory.set(id, checkpoint)
      return enqueue(async () => {
        await mkdir(dir, { recursive: true })
        await writeCheckpoint(file(id), checkpoint)
      })
    },
    remove(id: string): Promise<void> {
      if (!ID.test(id)) {
        return Promise.resolve()
      }
      memory.delete(id)
      return enqueue(() => unlink(file(id)).catch(() => {}))
    },
    writeSession(next: Session): Promise<void> {
      session = next
      return enqueue(async () => {
        await mkdir(dir, { recursive: true })
        await writeCheckpoint(join(dir, SESSION_FILE), next as never)
      })
    },
    async read(): Promise<{ session: Session | null; checkpoints: Map<string, Checkpoint> }> {
      await queue
      const checkpoints = new Map<string, Checkpoint>()
      let saved: Session | null = null
      try {
        const raw = JSON.parse(await readFile(join(dir, SESSION_FILE), 'utf8')) as Partial<Session>
        if (Array.isArray(raw.order)) {
          saved = {
            order: raw.order.filter((id): id is string => typeof id === 'string' && ID.test(id)),
            activeId: typeof raw.activeId === 'string' ? raw.activeId : null,
            paths: typeof raw.paths === 'object' && raw.paths ? (raw.paths as Record<string, string | null>) : {},
          }
        }
      } catch {}
      let names: string[] = []
      try {
        names = await readdir(dir)
      } catch {}
      for (const name of names) {
        const id = name.replace(/\.json$/, '')
        if (name === SESSION_FILE || !name.endsWith('.json') || !ID.test(id)) {
          continue
        }
        const checkpoint = await readCheckpoint(join(dir, name))
        if (checkpoint) {
          checkpoints.set(id, checkpoint)
        }
      }
      return { session: saved, checkpoints }
    },
    clearCheckpoints(): Promise<void> {
      memory.clear()
      return enqueue(async () => {
        let names: string[] = []
        try {
          names = await readdir(dir)
        } catch {}
        await Promise.all(
          names.filter((name) => name.endsWith('.json') && name !== SESSION_FILE).map((name) => unlink(join(dir, name)).catch(() => {}))
        )
      })
    },
    reset(): void {
      memory.clear()
      session = null
    },
  }
}

export function createHistoryVault(dir: string) {
  const file = (id: string): string => join(dir, `${id}.json`)

  return {
    async spill(id: string, json: string): Promise<void> {
      if (!ID.test(id) || typeof json !== 'string') {
        return
      }
      await mkdir(dir, { recursive: true })
      await writeFileAtomic(file(id), json)
    },
    async take(id: string): Promise<string | null> {
      if (!ID.test(id)) {
        return null
      }
      try {
        const json = await readFile(file(id), 'utf8')
        await unlink(file(id)).catch(() => {})
        return json
      } catch {
        return null
      }
    },
    async clear(): Promise<void> {
      let names: string[] = []
      try {
        names = await readdir(dir)
      } catch {}
      await Promise.all(names.map((name) => unlink(join(dir, name)).catch(() => {})))
    },
  }
}
