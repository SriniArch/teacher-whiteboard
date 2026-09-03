"use client"

import {
  type ChangeEvent,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react"

export type Tool = "pen" | "highlighter" | "eraser" | "text"

type Point = { x: number; y: number }

type ClientPointEvent = { clientX: number; clientY: number }

type StrokeElement = {
  type: "stroke"
  tool: "pen" | "highlighter"
  color: string
  size: number
  points: Point[]
}

type TextElement = {
  type: "text"
  x: number
  y: number
  text: string
  color: string
  size: number
}

type Element = StrokeElement | TextElement

type TextEditorState = { x: number; y: number; value: string }

export type WhiteboardDocument = {
  version: 1
  width: number
  height: number
  elements: Element[]
}

export type WhiteboardHandle = {
  getDocument: () => WhiteboardDocument
  load: (doc: WhiteboardDocument | null) => void
  clear: () => void
  undo: () => void
  redo: () => void
  canUndo: () => boolean
  canRedo: () => boolean
}

type Props = {
  tool: Tool
  color: string
  size: number
  onDirty?: () => void
  onHistoryChange?: (state: { canUndo: boolean; canRedo: boolean }) => void
}

const ERASER_RADIUS = 14

export const Whiteboard = forwardRef<WhiteboardHandle, Props>(function Whiteboard(
  { tool, color, size, onDirty, onHistoryChange },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const surfaceRef = useRef<HTMLDivElement>(null)
  const textEditorRef = useRef<HTMLTextAreaElement>(null)

  // Persistent drawing state (kept in refs so pointer handlers stay stable).
  const elementsRef = useRef<Element[]>([])
  const redoRef = useRef<Element[]>([])
  const drawingRef = useRef(false)
  const currentStrokeRef = useRef<StrokeElement | null>(null)
  const logicalSizeRef = useRef({ width: 0, height: 0 })
  const resizeRef = useRef<{
    active: boolean
    mode: "x" | "y" | "xy" | null
    startX: number
    startY: number
    startWidth: number
    startHeight: number
  }>({
    active: false,
    mode: null,
    startX: 0,
    startY: 0,
    startWidth: 0,
    startHeight: 0,
  })

  const toolRef = useRef(tool)
  const colorRef = useRef(color)
  const sizeRef = useRef(size)
  toolRef.current = tool
  colorRef.current = color
  sizeRef.current = size

  const [boardSize, setBoardSize] = useState({ width: 1200, height: 800 })
  const [textEditor, setTextEditor] = useState<TextEditorState | null>(null)

  logicalSizeRef.current = boardSize

  useEffect(() => {
    if (!textEditor) return

    const id = requestAnimationFrame(() => {
      const editor = textEditorRef.current
      if (!editor) return
      editor.focus()
      const len = editor.value.length
      editor.setSelectionRange(len, len)
    })

    return () => cancelAnimationFrame(id)
  }, [textEditor])

  const notifyHistory = useCallback(() => {
    onHistoryChange?.({
      canUndo: elementsRef.current.length > 0,
      canRedo: redoRef.current.length > 0,
    })
  }, [onHistoryChange])

  const drawElement = useCallback((ctx: CanvasRenderingContext2D, el: Element) => {
    if (el.type === "stroke") {
      if (el.points.length === 0) return
      ctx.save()
      ctx.strokeStyle = el.color
      ctx.lineWidth = el.size
      ctx.lineCap = "round"
      ctx.lineJoin = "round"
      ctx.globalAlpha = el.tool === "highlighter" ? 0.35 : 1
      ctx.beginPath()
      const [first, ...rest] = el.points
      ctx.moveTo(first.x, first.y)
      if (rest.length === 0) {
        // A single dot.
        ctx.lineTo(first.x + 0.01, first.y + 0.01)
      } else {
        for (const p of rest) ctx.lineTo(p.x, p.y)
      }
      ctx.stroke()
      ctx.restore()
    } else {
      ctx.save()
      ctx.fillStyle = el.color
      ctx.font = `${el.size}px ui-sans-serif, system-ui, sans-serif`
      ctx.textBaseline = "top"
      ctx.globalAlpha = 1
      const lines = el.text.split("\n")
      lines.forEach((line, i) => {
        ctx.fillText(line, el.x, el.y + i * el.size * 1.2)
      })
      ctx.restore()
    }
  }, [])

  const redraw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    const { width, height } = logicalSizeRef.current
    ctx.clearRect(0, 0, width, height)
    ctx.fillStyle = "#ffffff"
    ctx.fillRect(0, 0, width, height)
    for (const el of elementsRef.current) drawElement(ctx, el)
    if (currentStrokeRef.current) drawElement(ctx, currentStrokeRef.current)
  }, [drawElement])

  const setupCanvas = useCallback(() => {
    const canvas = canvasRef.current
    const surface = surfaceRef.current
    if (!canvas || !surface) return
    const rect = surface.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    logicalSizeRef.current = { width: rect.width, height: rect.height }
    canvas.width = Math.round(rect.width * dpr)
    canvas.height = Math.round(rect.height * dpr)
    canvas.style.width = `${rect.width}px`
    canvas.style.height = `${rect.height}px`
    const ctx = canvas.getContext("2d")
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    redraw()
  }, [redraw])

  useEffect(() => {
    setupCanvas()
  }, [setupCanvas, boardSize])

  useEffect(() => {
    if (boardSize.width > 0 && boardSize.height > 0) return
    const container = containerRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) {
      setBoardSize({
        width: Math.max(1024, Math.round(rect.width)),
        height: Math.max(768, Math.round(rect.height)),
      })
    }
  }, [boardSize.height, boardSize.width])

  const getPos = (e: ClientPointEvent): Point => {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const commitStroke = useCallback(() => {
    if (currentStrokeRef.current && currentStrokeRef.current.points.length > 0) {
      elementsRef.current.push(currentStrokeRef.current)
      redoRef.current = []
      onDirty?.()
      notifyHistory()
    }
    currentStrokeRef.current = null
  }, [onDirty, notifyHistory])

  const eraseAt = useCallback(
    (p: Point) => {
      const before = elementsRef.current.length
      elementsRef.current = elementsRef.current.filter((el) => {
        if (el.type === "stroke") {
          return !el.points.some((pt) => Math.hypot(pt.x - p.x, pt.y - p.y) <= ERASER_RADIUS + el.size / 2)
        }
        // Rough hit box for text.
        const approxWidth = el.text.length * el.size * 0.5
        return !(p.x >= el.x - 4 && p.x <= el.x + approxWidth + 4 && p.y >= el.y - 4 && p.y <= el.y + el.size + 4)
      })
      if (elementsRef.current.length !== before) {
        redoRef.current = []
        onDirty?.()
        notifyHistory()
        redraw()
      }
    },
    [onDirty, notifyHistory, redraw],
  )

  const handlePointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (textEditor) return
    const p = getPos(e)
    const t = toolRef.current

    if (t === "text") {
      e.preventDefault()
      return
    }

    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    drawingRef.current = true

    if (t === "eraser") {
      eraseAt(p)
      return
    }

    currentStrokeRef.current = {
      type: "stroke",
      tool: t,
      color: colorRef.current,
      size: sizeRef.current,
      points: [p],
    }
    redraw()
  }

  const handlePointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return
    const p = getPos(e)
    if (toolRef.current === "eraser") {
      eraseAt(p)
      return
    }
    if (currentStrokeRef.current) {
      currentStrokeRef.current.points.push(p)
      redraw()
    }
  }

  const handlePointerUp = () => {
    if (!drawingRef.current) return
    drawingRef.current = false
    if (toolRef.current !== "eraser") commitStroke()
    redraw()
  }

  const handleCanvasClick = (e: ReactMouseEvent<HTMLCanvasElement>) => {
    if (toolRef.current !== "text" || textEditor) return
    const p = getPos(e)
    setTextEditor({ x: p.x, y: p.y, value: "" })
  }

  const commitText = useCallback(() => {
    setTextEditor((cur: TextEditorState | null) => {
      if (cur && cur.value.trim()) {
        elementsRef.current.push({
          type: "text",
          x: cur.x,
          y: cur.y,
          text: cur.value,
          color: colorRef.current,
          size: Math.max(16, sizeRef.current * 4),
        })
        redoRef.current = []
        onDirty?.()
        notifyHistory()
        redraw()
      }
      return null
    })
  }, [onDirty, notifyHistory, redraw])

  const beginResize = useCallback(
    (mode: "x" | "y" | "xy") => (e: ReactPointerEvent<HTMLButtonElement>) => {
      e.preventDefault()
      e.stopPropagation()
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      resizeRef.current = {
        active: true,
        mode,
        startX: e.clientX,
        startY: e.clientY,
        startWidth: logicalSizeRef.current.width,
        startHeight: logicalSizeRef.current.height,
      }
    },
    [],
  )

  const handleResizeMove = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>) => {
      if (!resizeRef.current.active) return
      const { mode, startX, startY, startWidth, startHeight } = resizeRef.current
      const deltaX = e.clientX - startX
      const deltaY = e.clientY - startY
      const width = mode === "y" ? startWidth : Math.max(640, Math.round(startWidth + deltaX))
      const height = mode === "x" ? startHeight : Math.max(420, Math.round(startHeight + deltaY))

      setBoardSize({
        width: mode === "x" ? startWidth : width,
        height: mode === "y" ? startHeight : height,
      })
      onDirty?.()
    },
    [onDirty],
  )

  const endResize = useCallback(() => {
    if (!resizeRef.current.active) return
    resizeRef.current.active = false
    redraw()
    onDirty?.()
    notifyHistory()
  }, [notifyHistory, onDirty, redraw])

  useImperativeHandle(
    ref,
    () => ({
      getDocument: () => ({
        version: 1,
        width: logicalSizeRef.current.width,
        height: logicalSizeRef.current.height,
        elements: elementsRef.current,
      }),
      load: (doc: WhiteboardDocument | null) => {
        elementsRef.current = doc?.elements ? structuredClone(doc.elements) : []
        redoRef.current = []
        currentStrokeRef.current = null
        if (doc?.width && doc?.height) {
          setBoardSize({ width: doc.width, height: doc.height })
        }
        redraw()
        notifyHistory()
      },
      clear: () => {
        if (elementsRef.current.length === 0) return
        elementsRef.current = []
        redoRef.current = []
        currentStrokeRef.current = null
        onDirty?.()
        redraw()
        notifyHistory()
      },
      undo: () => {
        const el = elementsRef.current.pop()
        if (el) {
          redoRef.current.push(el)
          onDirty?.()
          redraw()
          notifyHistory()
        }
      },
      redo: () => {
        const el = redoRef.current.pop()
        if (el) {
          elementsRef.current.push(el)
          onDirty?.()
          redraw()
          notifyHistory()
        }
      },
      canUndo: () => elementsRef.current.length > 0,
      canRedo: () => redoRef.current.length > 0,
    }),
    [redraw, notifyHistory, onDirty],
  )

  const cursor =
    tool === "text" ? "text" : tool === "eraser" ? "cell" : "crosshair"

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-auto bg-white">
      <div
        ref={surfaceRef}
        className="relative bg-white"
        style={{ width: boardSize.width || "100%", height: boardSize.height || "100%" }}
      >
        <canvas
          ref={canvasRef}
          className="absolute inset-0 touch-none"
          style={{ cursor }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          onClick={handleCanvasClick}
        />
        <button
          type="button"
          aria-label="Resize board horizontally"
          title="Drag to extend board horizontally"
          className="absolute right-[-7px] top-1/2 z-20 flex h-16 w-4 -translate-y-1/2 cursor-col-resize items-center justify-center rounded-full border border-border bg-primary/80 shadow-lg ring-2 ring-white transition hover:bg-primary"
          onPointerDown={beginResize("x")}
          onPointerMove={handleResizeMove}
          onPointerUp={endResize}
          onPointerCancel={endResize}
        >
          <span className="flex h-8 flex-col justify-center gap-1">
            <span className="h-0.5 w-2 rounded-full bg-white/95" />
            <span className="h-0.5 w-2 rounded-full bg-white/95" />
            <span className="h-0.5 w-2 rounded-full bg-white/95" />
          </span>
        </button>
        <button
          type="button"
          aria-label="Resize board vertically"
          title="Drag to extend board vertically"
          className="absolute bottom-[-7px] left-1/2 z-20 flex h-4 w-16 -translate-x-1/2 cursor-row-resize items-center justify-center rounded-full border border-border bg-primary/80 shadow-lg ring-2 ring-white transition hover:bg-primary"
          onPointerDown={beginResize("y")}
          onPointerMove={handleResizeMove}
          onPointerUp={endResize}
          onPointerCancel={endResize}
        >
          <span className="flex w-8 justify-center gap-1">
            <span className="h-2 w-0.5 rounded-full bg-white/95" />
            <span className="h-2 w-0.5 rounded-full bg-white/95" />
            <span className="h-2 w-0.5 rounded-full bg-white/95" />
          </span>
        </button>
        <button
          type="button"
          aria-label="Resize board diagonally"
          title="Drag to extend board down and right"
          className="absolute bottom-[-8px] right-[-8px] z-20 flex h-5 w-5 cursor-nwse-resize items-center justify-center rounded-md border border-border bg-primary shadow-lg ring-2 ring-white transition hover:scale-105"
          onPointerDown={beginResize("xy")}
          onPointerMove={handleResizeMove}
          onPointerUp={endResize}
          onPointerCancel={endResize}
        >
          <span className="h-3 w-3 rounded-sm border-b-2 border-r-2 border-white/95" />
        </button>
        {textEditor && (
          <textarea
            ref={textEditorRef}
            autoFocus
            value={textEditor.value}
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
              setTextEditor((c: TextEditorState | null) => (c ? { ...c, value: e.target.value } : c))
            }
            onBlur={commitText}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e: KeyboardEvent<HTMLTextAreaElement>) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
                e.preventDefault()
                commitText()
              }
              if (e.key === "Escape") {
                e.preventDefault()
                setTextEditor(null)
              }
            }}
            className="absolute z-10 min-w-[120px] resize-none border border-dashed border-primary/60 bg-transparent p-1 text-foreground outline-none"
            style={{
              left: textEditor.x,
              top: textEditor.y,
              color,
              fontSize: Math.max(16, size * 4),
              lineHeight: 1.2,
            }}
            rows={1}
            placeholder="Type..."
          />
        )}
      </div>
    </div>
  )
})
