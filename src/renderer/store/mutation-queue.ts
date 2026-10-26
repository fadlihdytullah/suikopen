import type { DocumentStore } from './document-store'

export const GESTURE_WAIT_TIMEOUT_MS = 10_000

export type MutationQueue = {
  run: <T>(task: () => T | Promise<T>) => Promise<T>
  pending: () => number
  dispose: () => void
}

export function createMutationQueue(store: DocumentStore): MutationQueue {
  let tail: Promise<unknown> = Promise.resolve()
  let waiting = 0
  const waiters = new Set<() => void>()

  const unsubscribe = store.onGestureEnd(() => {
    for (const waiter of [...waiters]) {
      waiter()
    }
  })

  function whenIdle(): Promise<void> {
    if (!store.history.isOpen()) {
      return Promise.resolve()
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        waiters.delete(release)
        reject(new Error('The editor is busy with a direct edit; the request was not applied.'))
      }, GESTURE_WAIT_TIMEOUT_MS)

      function release(): void {
        if (store.history.isOpen()) {
          return
        }
        clearTimeout(timer)
        waiters.delete(release)
        resolve()
      }

      waiters.add(release)
    })
  }

  function run<T>(task: () => T | Promise<T>): Promise<T> {
    waiting += 1

    const result = tail.then(async () => {
      try {
        await whenIdle()
        return await task()
      } finally {
        waiting -= 1
      }
    })

    tail = result.catch(() => undefined)

    return result
  }

  return {
    run,
    pending: () => waiting,
    dispose: () => {
      unsubscribe()
      waiters.clear()
    },
  }
}
