import { useEffect, useRef } from 'react'
import { createPointerController, type Overlay } from '../tools/pointer-controller'
import { useDocumentStore, useSelectionStore } from '../store/use-store'
import { onThemeChange } from '../document/resolved'
import { resolvedDocument } from '../document/current'
import { loadCanvasKit } from './canvaskit'
import { documentBounds, paintScene } from './paint'
import { invalidateSceneCaches, sceneItems, unionBounds } from './scene-index'
import { onFitRequest, onZoomRequest, publishViewport, type ZoomRequest } from './viewport-ref'
import { agentGlow, isAnimating, presence, subscribePresence } from '../agent/presence'
import { onImageLoaded } from './image-cache'
import { onCanvasAppearanceChange } from './canvas-theme'
import { resetLayoutCache } from '../layout/yoga-tree'
import { setTextMeasurer } from '../layout/text-measure'
import { ensureFont, DEFAULT_FAMILY, onFontLoaded } from '../text/font-manager'
import { measureParagraph } from '../text/paragraph'
import { createSurface, type SurfaceHandle } from './surface'
import { clampScale, fitToBounds, toScreen, zoomAt, type Viewport, IDENTITY_VIEWPORT } from './viewport'
import type { Rect } from './scene-index'

export function Stage(): React.ReactElement {
  const store = useDocumentStore()
  const selection = useSelectionStore()
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const viewportRef = useRef<Viewport>(IDENTITY_VIEWPORT)

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
    let fitted = false
    let overlay: Overlay = { marquee: null, guides: [] }
    let camera: { from: Viewport; to: Viewport; start: number } | null = null
    let followedAt = 0
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

      if (
        topLeft.x >= margin &&
        topLeft.y >= margin &&
        bottomRight.x <= box.width - margin &&
        bottomRight.y <= box.height - margin
      ) {
        return null
      }

      const fit = Math.min((box.width - margin * 2) / rect.width, (box.height - margin * 2) / rect.height)
      const scale = clampScale(Math.min(current.scale, fit))

      return {
        scale,
        x: box.width / 2 - (rect.x + rect.width / 2) * scale,
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
          viewportRef.current = fitToBounds(documentBounds(resolvedDocument(store)), rect.width, rect.height)
          fitted = true
        }

        paint()
      }

      function paint(): void {
        if (!handle) {
          return
        }
        const glow = agentGlow(performance.now())
        const box = canvas.getBoundingClientRect()
        publishViewport(viewportRef.current, { x: box.left, y: box.top })
        const document = resolvedDocument(store)
        const selected = selection.getState()

        paintScene(canvasKit, handle.surface, {
          document,
          viewport: viewportRef.current,
          dpr: handle.dpr,
          overlay: {
            selected: sceneItems(document).filter((item) => selected.has(item.node.id)),
            marquee: overlay.marquee,
            guides: overlay.guides,
            agentFocus: glow ? (() => {
              const item = sceneItems(document).find((entry) => entry.node.id === glow.id)
              return item ? { item, alpha: glow.alpha } : null
            })() : null,
          },
        })
        dirty = false
      }

      function tick(): void {
        const agent = presence()
        if (agent.focusId && agent.focusAt !== followedAt) {
          followedAt = agent.focusAt
          const item = sceneItems(resolvedDocument(store)).find((entry) => entry.node.id === agent.focusId)
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

        if (isAnimating()) {
          dirty = true
        }

        if (dirty) {
          paint()
        }
        frame = requestAnimationFrame(tick)
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
      const unsubscribePresence = subscribePresence(markDirty)
      const unsubscribeFit = onFitRequest(() => {
        const box = host.getBoundingClientRect()
        moveCamera(fitToBounds(documentBounds(resolvedDocument(store)), box.width, box.height))
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
            moveCamera(fitToBounds(bounds, box.width, box.height))
          }
        }
        markDirty()
      })
      const unsubscribeSelection = selection.subscribe(markDirty)
      const observer = new ResizeObserver(rebuild)
      observer.observe(host)
      window.addEventListener('resize', rebuild)

      rebuild()
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
        cancelAnimationFrame(frame)
        handle?.dispose()
        handle = null
      }
    })

    return () => {
      disposed = true
      ready.then((stop) => stop())
    }
  }, [store, selection])

  return (
    <div ref={hostRef} style={{ width: '100%', height: '100%' }}>
      <canvas ref={canvasRef} />
    </div>
  )
}
