import { randomUUID } from 'node:crypto'

export type TabRegistry = ReturnType<typeof createTabRegistry>

export function createTabRegistry(makeId: () => string = () => `t-${randomUUID().slice(0, 8)}`) {
  const paths = new Map<string, string | null>()

  function idForPath(path: string): string | null {
    for (const [id, open] of paths) {
      if (open === path) {
        return id
      }
    }
    return null
  }

  return {
    open(path: string | null): { id: string; existing: boolean } {
      const found = path ? idForPath(path) : null
      if (found) {
        return { id: found, existing: true }
      }
      const id = makeId()
      paths.set(id, path)
      return { id, existing: false }
    },
    rename(id: string, path: string): void {
      if (paths.has(id)) {
        paths.set(id, path)
      }
    },
    close(id: string): void {
      paths.delete(id)
    },
    clear(): void {
      paths.clear()
    },
    has: (id: string): boolean => paths.has(id),
    idForPath,
    list: (): { id: string; path: string | null }[] => [...paths].map(([id, path]) => ({ id, path })),
  }
}

export const tabs = createTabRegistry()
