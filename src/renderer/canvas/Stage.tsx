import { useEffect, useRef } from 'react'
import { createPointerController, type Overlay } from '../tools/pointer-controller'
import { takeSwitchDuration, type Tab } from '../tabs/tabs-store'
import { onThemeChange } from '../document/resolved'
import { resolvedDocument } from '../document/current'
import { loadCanvasKit } from './canvaskit'
import { documentBounds, paintScene } from './paint'
import { invalidateSceneCaches, itemById, sceneItems, unionBounds } from './scene-index'
import { onFitRequest, onZoomRequest, publishViewport, type ZoomRequest } from './viewport-ref'
import { onImageLoaded } from './image-cache'
import { onCanvasAppearanceChange } from './canvas-theme'
import { resetLayoutCache } from '../layout/yoga-tree'
import { setTextMeasurer } from '../layout/text-measure'
import { ensureFont, DEFAULT_FAMILY, onFontLoaded } from '../text/font-manager'
import { measureParagraph } from '../text/paragraph'
import { createSurface, type SurfaceHandle } from './surface'
import { labelsOf } from './labels'
import { panelInsets } from '../ui/panel-state'
import { clampScale, fitToBounds, toScreen, zoomAt, type Viewport, IDENTITY_VIEWPORT } from './viewport'
import type { Rect } from './scene-index'

function fitVisible(bounds: Rect, width: number, height: number): Viewport {
  const { left, right } = panelInsets()
  const visible = Math.max(width - left - right, Math.min(width, 200))
  const offset = visible === width ? 0 : left
  const fitted = fitToBounds(bounds, visible, height)
  return { ...fitted, x: fitted.x + offset }
}

export function Stage({ tab }: { tab: Tab }): React.ReactElement {
  const { store, selection, presence } = tab
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const viewportRef = useRef<Viewport>(tab.viewport ?? IDENTITY_VIEWPORT)

  useEffect(() => {
    const hostElement = hostRef.current
    const canvasElement = canvasRef.current
    if (!hostElement || !canvasElement) {
      return
    }
    const host: HTMLDivElement = hostElement
    const canvas: HTMLCanvasElement = canvasElement

    let disposed = false
    let handle: SurfaceHandle | null = null
    let frame = 0
    let dirty = true
    let fitted = tab.viewport !== null
    let overlay: Overlay = { marquee: null, guides: [] }
    let camera: { from: Viewport; to: Viewport; start: number } | null = null
    let followedAt = 0
    let contextLost = false
    let lastRecovery = 0
    let failures = 0
    const CAMERA_MS = 360

    function moveCamera(to: Viewport | null): void {
      if (to) {
        camera = { from: viewportRef.current, to, start: performance.now() }
      }
    }

    function followTarget(rect: Rect): Viewport | null {
      const box = host.getBoundingClientRect()
      const current = viewportRef.current
      const topLeft = toScreen(current, { x: rect.x, y: rect.y })
      const bottomRight = toScreen(current, { x: rect.x + rect.width, y: rect.y + rect.height })
      const margin = 40
      const { left, right } = panelInsets()

      if (
        topLeft.x >= margin + left &&
        topLeft.y >= margin &&
        bottomRight.x <= box.width - margin - right &&
        bottomRight.y <= box.height - margin
      ) {
        return null
      }

      const visible = Math.max(box.width - left - right, 200)
      const fit = Math.min((visible - margin * 2) / rect.width, (box.height - margin * 2) / rect.height)
      const scale = clampScale(Math.min(current.scale, fit))

      return {
        scale,
        x: left + visible / 2 - (rect.x + rect.width / 2) * scale,
        y: box.height / 2 - (rect.y + rect.height / 2) * scale,
      }
    }

    function markDirty(): void {
      dirty = true
    }

    const ready = loadCanvasKit().then(async (canvasKit) => {
      if (disposed) {
        return () => {}
      }

      setTextMeasurer((node, width) => measureParagraph(canvasKit, node, width))
      onImageLoaded(markDirty)
      onFontLoaded(() => {
        resetLayoutCache()
        invalidateSceneCaches()
        markDirty()
      })
      await ensureFont(canvasKit, DEFAULT_FAMILY)

      function rebuild(): void {
        const rect = host.getBoundingClientRect()
        const dpr = window.devicePixelRatio
        if (handle && handle.dpr === dpr && handle.cssWidth === rect.width && handle.cssHeight === rect.height) {
          return
        }

        handle?.dispose()
        handle = createSurface(canvasKit, canvas, rect.width, rect.height, dpr)
        if (!handle) {
          throw new Error('Could not create a drawing surface')
        }

        if (!fitted && rect.width > 0 && rect.height > 0) {
          viewportRef.current = fitVisible(documentBounds(resolvedDocument(store)), rect.width, rect.height)
          fitted = true
        }

        paint()
      }

      function resetSurface(): void {
        try {
          handle?.dispose()
        } catch {}
        handle = null
        try {
          rebuild()
        } catch (error) {
          report('could not recreate the surface', error, true)
        }
      }

      function report(what: string, error: unknown, fatal: boolean): void {
        const heap = (canvasKit as unknown as { HEAPU8?: Uint8Array }).HEAPU8?.length ?? 0
        const message = `${what}: ${error instanceof Error ? (error.stack ?? error.message) : String(error)} (heap ${Math.round(heap / 1048576)}MB)`
        console.error(`[canvas] ${message}`)
        window.suikopen.reportError(message, fatal)
      }

      function recover(error: unknown): void {
        const now = performance.now()
        if (now - lastRecovery < 1000) {
          return
        }
        lastRecovery = now
        failures += 1
        if (failures >= 3) {
          report('paint keeps failing, reloading', error, true)
          return
        }
        report('paint failed, recreating the surface', error, false)
        resetSurface()
      }

      function onContextLost(event: Event): void {
        event.preventDefault()
        contextLost = true
      }

      function onContextRestored(): void {
        contextLost = false
        resetSurface()
      }

      function paint(): void {
        if (!handle || contextLost) {
          return
        }
        const glow = presence.glow(performance.now())
        const box = canvas.getBoundingClientRect()
        publishViewport(viewportRef.current, { x: box.left, y: box.top })
        const document = resolvedDocument(store)
        const selected = selection.getState()

        paintScene(canvasKit, handle.surface, {
          document,
          viewport: viewportRef.current,
          dpr: handle.dpr,
          reveal: presence.revealAlpha,
          overlay: {
            selected: sceneItems(document).filter((item) => selected.has(item.node.id)),
            marquee: overlay.marquee,
            labels: labelsOf(document, store.getState()),
            guides: overlay.guides,
            agentFocus: glow ? (() => {
              const item = itemById(document, glow.id)
              return item ? { item, alpha: glow.alpha } : null
            })() : null,
          },
        })
        dirty = false
        failures = 0
      }

      function step(): void {
        const agent = presence.state()
        if (agent.focusId && agent.focusAt !== followedAt) {
          followedAt = agent.focusAt
          const item = itemById(resolvedDocument(store), agent.focusId)
          if (item) {
            moveCamera(followTarget(item))
          }
        }

        if (camera) {
          const progress = Math.min(1, (performance.now() - camera.start) / CAMERA_MS)
          const eased = 1 - (1 - progress) ** 3
          const { from, to } = camera
          viewportRef.current =
            progress >= 1
              ? to
              : {
                  x: from.x + (to.x - from.x) * eased,
                  y: from.y + (to.y - from.y) * eased,
                  scale: from.scale + (to.scale - from.scale) * eased,
                }
          if (progress >= 1) {
            camera = null
          }
          dirty = true
        }

        if (presence.isAnimating()) {
          dirty = true
        }

        if (dirty) {
          paint()
        }
      }

      function tick(): void {
        frame = requestAnimationFrame(tick)
        try {
          step()
        } catch (error) {
          recover(error)
        }
      }

      const controller = createPointerController({
        store,
        selection,
        canvas,
        getViewport: () => viewportRef.current,
        setViewport: (next) => {
          camera = null
          viewportRef.current = next
        },
        setOverlay: (next) => {
          overlay = next
        },
        requestPaint: markDirty,
      })

      const unsubscribeDocument = store.subscribe(markDirty)
      const unsubscribeTheme = onThemeChange(markDirty)
      const unsubscribeAppearance = onCanvasAppearanceChange(markDirty)
      const unsubscribePresence = presence.subscribe(markDirty)
      const unsubscribeFit = onFitRequest(() => {
        const box = host.getBoundingClientRect()
        moveCamera(fitVisible(documentBounds(resolvedDocument(store)), box.width, box.height))
        markDirty()
      })
      const unsubscribeZoom = onZoomRequest((request: ZoomRequest) => {
        const box = host.getBoundingClientRect()
        const center = { x: box.width / 2, y: box.height / 2 }
        const current = camera?.to ?? viewportRef.current
        if (request === 'in' || request === 'out') {
          moveCamera(zoomAt(current, center, request === 'in' ? 2 : 0.5))
        } else if (request === 'actual') {
          moveCamera(zoomAt(current, center, 1 / current.scale))
        } else {
          const document = resolvedDocument(store)
          const selected = selection.getState()
          const bounds = request === 'selection' ? unionBounds(sceneItems(document).filter((item) => selected.has(item.node.id))) : documentBounds(document)
          if (bounds) {
            moveCamera(fitVisible(bounds, box.width, box.height))
          }
        }
        markDirty()
      })
      const unsubscribeSelection = selection.subscribe(markDirty)
      const observer = new ResizeObserver(rebuild)
      observer.observe(host)
      window.addEventListener('resize', rebuild)
      canvas.addEventListener('webglcontextlost', onContextLost)
      canvas.addEventListener('webglcontextrestored', onContextRestored)

      rebuild()
      const switchMs = takeSwitchDuration(performance.now())
      if (switchMs !== null && switchMs > 100) {
        console.warn(`[tabs] switch took ${Math.round(switchMs)}ms`)
      }
      tick()

      return () => {
        setTextMeasurer(null)
        controller.dispose()
        unsubscribeDocument()
        unsubscribeTheme()
        unsubscribeAppearance()
        unsubscribePresence()
        unsubscribeFit()
        unsubscribeZoom()
        unsubscribeSelection()
        observer.disconnect()
        window.removeEventListener('resize', rebuild)
        canvas.removeEventListener('webglcontextlost', onContextLost)
        canvas.removeEventListener('webglcontextrestored', onContextRestored)
        cancelAnimationFrame(frame)
        handle?.dispose()
        handle = null
      }
    })

    return () => {
      disposed = true
      tab.viewport = viewportRef.current
      ready.then((stop) => stop())
    }
  }, [tab, store, selection, presence])

  return (
    <div ref={hostRef} style={{ width: '100%', height: '100%' }}>
      <canvas ref={canvasRef} />
    </div>
  )
}
