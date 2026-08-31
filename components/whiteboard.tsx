"use client"

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react"

export type Tool = "pen" | "highlighter" | "eraser" | "text"

type Point = { x: number; y: number }

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

  // Persistent drawing state (kept in refs so pointer handlers stay stable).
  const elementsRef = useRef<Element[]>([])
  const redoRef = useRef<Element[]>([])
  const drawingRef = useRef(false)
  const currentStrokeRef = useRef<StrokeElement | null>(null)
  const logicalSizeRef = useRef({ width: 0, height: 0 })

  const toolRef = useRef(tool)
  const colorRef = useRef(color)
  const sizeRef = useRef(size)
  toolRef.current = tool
  colorRef.current = color
  sizeRef.current = size

  const [textEditor, setTextEditor] = useState<{ x: number; y: number; value: string } | null>(null)

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
    const container = containerRef.current
    if (!canvas || !container) return
    const rect = container.getBoundingClientRect()
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
    const ro = new ResizeObserver(() => setupCanvas())
    if (containerRef.current) ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [setupCanvas])

  const getPos = (e: PointerEvent | React.PointerEvent): Point => {
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

  const handlePointerDown = (e: React.PointerEvent) => {
    if (textEditor) return
    const p = getPos(e)
    const t = toolRef.current

    if (t === "text") {
      setTextEditor({ x: p.x, y: p.y, value: "" })
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

  const handlePointerMove = (e: React.PointerEvent) => {
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

  const commitText = useCallback(() => {
    setTextEditor((cur) => {
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

  useImperativeHandle(
    ref,
    () => ({
      getDocument: () => ({
        version: 1,
        width: logicalSizeRef.current.width,
        height: logicalSizeRef.current.height,
        elements: elementsRef.current,
      }),
      load: (doc) => {
        elementsRef.current = doc?.elements ? structuredClone(doc.elements) : []
        redoRef.current = []
        currentStrokeRef.current = null
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
    <div ref={containerRef} className="relative h-full w-full bg-white">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 touch-none"
        style={{ cursor }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      />
      {textEditor && (
        <textarea
          autoFocus
          value={textEditor.value}
          onChange={(e) => setTextEditor((c) => (c ? { ...c, value: e.target.value } : c))}
          onBlur={commitText}
          onKeyDown={(e) => {
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
  )
})
