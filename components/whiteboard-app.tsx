"use client"

import { getNote, saveNote, type NoteHistoryRow } from "@/app/actions/notes"
import { createStudent, deleteStudent, updateStudent } from "@/app/actions/students"
import { NotesHistory } from "@/components/notes-history"
import { StudentDialog } from "@/components/student-dialog"
import { Button } from "@/components/ui/button"
import { Whiteboard, type Tool, type WhiteboardDocument, type WhiteboardHandle } from "@/components/whiteboard"
import type { Student } from "@/lib/db/schema"
import {
  ChevronDown,
  Eraser,
  Highlighter,
  History,
  Pencil,
  Pencil as PencilEdit,
  Redo2,
  Save,
  Trash2,
  Type,
  Undo2,
  UserPlus,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

const PEN_COLORS = ["#0f172a", "#dc2626", "#2563eb", "#16a34a"]
const HIGHLIGHTER_COLOR = "#facc15"
const SIZES = [2, 4, 8]

type SaveStatus = "saved" | "saving" | "unsaved"

function todayISO() {
  const d = new Date()
  const off = d.getTimezoneOffset()
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10)
}

function formatDisplayDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  })
}

export function WhiteboardApp({ initialStudents }: { initialStudents: Student[] }) {
  const [students, setStudents] = useState<Student[]>(initialStudents)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [date, setDate] = useState(todayISO())
  const [subject, setSubject] = useState("")
  const [topic, setTopic] = useState("")
  const [description, setDescription] = useState("")

  const [tool, setTool] = useState<Tool>("pen")
  const [penColor, setPenColor] = useState(PEN_COLORS[0])
  const [size, setSize] = useState(SIZES[1])

  const [status, setStatus] = useState<SaveStatus>("saved")
  const [toast, setToast] = useState<string | null>(null)
  const [noteExists, setNoteExists] = useState(false)
  const [history, setHistory] = useState({ canUndo: false, canRedo: false })

  const [studentDialog, setStudentDialog] = useState<{ open: boolean; editing: Student | null }>({
    open: false,
    editing: null,
  })
  const [historyOpen, setHistoryOpen] = useState(false)
  const [controlsOpen, setControlsOpen] = useState(true)

  const boardRef = useRef<WhiteboardHandle>(null)
  const dirtyRef = useRef(false)
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const selectedStudent = useMemo(
    () => students.find((s) => s.id === selectedId) ?? null,
    [students, selectedId],
  )

  const activeColor = tool === "highlighter" ? HIGHLIGHTER_COLOR : penColor

  // Restore last-selected student for the session.
  useEffect(() => {
    const stored = sessionStorage.getItem("wb:lastStudent")
    if (stored && students.some((s) => s.id === Number(stored))) {
      setSelectedId(Number(stored))
    }
  }, [students])

  const loadNoteFor = useCallback(async (studentId: number, dateStr: string) => {
    const note = await getNote(studentId, dateStr)
    setSubject(note?.subject ?? "")
    setTopic(note?.topic ?? "")
    setDescription(note?.description ?? "")
    setNoteExists(!!note)
    boardRef.current?.load((note?.whiteboardData as WhiteboardDocument) ?? null)
    dirtyRef.current = false
    setStatus("saved")
  }, [])

  // Load note whenever student or date changes.
  useEffect(() => {
    if (selectedId == null) {
      setNoteExists(false)
      return
    }
    sessionStorage.setItem("wb:lastStudent", String(selectedId))
    loadNoteFor(selectedId, date)
  }, [selectedId, date, loadNoteFor])

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        e.preventDefault()
        e.returnValue = ""
      }
    }
    window.addEventListener("beforeunload", handler)
    return () => window.removeEventListener("beforeunload", handler)
  }, [])

  const persist = useCallback(
    async (opts?: { explicit?: boolean }) => {
      if (selectedId == null) {
        if (opts?.explicit) setToast("Please select a student before saving.")
        return
      }
      const doc = boardRef.current?.getDocument()
      setStatus("saving")
      try {
        await saveNote({
          studentId: selectedId,
          date,
          subject,
          topic,
          description,
          whiteboardData: doc,
        })
        dirtyRef.current = false
        setStatus("saved")
        setNoteExists(true)
        if (opts?.explicit) setToast("Notes saved successfully.")
      } catch (err) {
        setStatus("unsaved")
        setToast(err instanceof Error ? err.message : "Could not save notes.")
      }
    },
    [selectedId, date, subject, topic, description],
  )

  const scheduleAutoSave = useCallback(() => {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
    if (selectedId == null) return
    autoSaveTimer.current = setTimeout(() => {
      void persist()
    }, 2000)
  }, [persist, selectedId])

  const markDirty = useCallback(() => {
    dirtyRef.current = true
    setStatus("unsaved")
    scheduleAutoSave()
  }, [scheduleAutoSave])

  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 2500)
      return () => clearTimeout(t)
    }
  }, [toast])

  const guardUnsaved = useCallback(() => {
    if (dirtyRef.current) {
      return confirm("You have unsaved changes. Discard them?")
    }
    return true
  }, [])

  function handleSelectStudent(value: string) {
    const next = value ? Number(value) : null
    if (!guardUnsaved()) return
    setSelectedId(next)
  }

  function handleDateChange(value: string) {
    if (!guardUnsaved()) return
    setDate(value)
  }

  async function handleStudentSubmit(values: { name: string; grade: string; notes: string }) {
    if (studentDialog.editing) {
      const updated = await updateStudent({ id: studentDialog.editing.id, ...values })
      setStudents((prev) => prev.map((s) => (s.id === updated.id ? updated : s)))
    } else {
      const created = await createStudent(values)
      setStudents((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)))
      setSelectedId(created.id)
    }
  }

  async function handleDeleteStudent() {
    if (!selectedStudent) return
    if (!confirm(`Delete ${selectedStudent.name} and all their notes? This cannot be undone.`)) return
    await deleteStudent(selectedStudent.id)
    setStudents((prev) => prev.filter((s) => s.id !== selectedStudent.id))
    setSelectedId(null)
    boardRef.current?.load(null)
  }

  function handleNew() {
    if (!guardUnsaved()) return
    setDate(todayISO())
    setSubject("")
    setTopic("")
    setDescription("")
    boardRef.current?.load(null)
    dirtyRef.current = false
    setStatus("saved")
  }

  function handleLoad() {
    if (selectedId == null) {
      setToast("Select a student to load notes.")
      return
    }
    if (!guardUnsaved()) return
    loadNoteFor(selectedId, date)
  }

  function handleClear() {
    if (!confirm("Clear the whiteboard? You can undo this.")) return
    boardRef.current?.clear()
  }

  async function handleOpenFromHistory(row: NoteHistoryRow) {
    if (!guardUnsaved()) return
    setHistoryOpen(false)
    setSelectedId(row.studentId)
    setDate(row.date)
    // Effect will load the note for this student + date.
  }

  const statusLabel = status === "saving" ? "Saving..." : status === "unsaved" ? "Unsaved changes" : "Saved"
  const statusColor =
    status === "saving"
      ? "text-muted-foreground"
      : status === "unsaved"
        ? "text-destructive"
        : "text-green-600"

  return (
    <div className="flex h-screen flex-col bg-muted/30">
      {/* Header */}
      <header className="flex items-center justify-between gap-4 border-b border-border bg-card px-4 py-2.5">
        <h1 className="text-base font-semibold text-card-foreground">Teacher Whiteboard</h1>
        <Button variant="outline" size="sm" onClick={() => setHistoryOpen(true)}>
          <History className="mr-1.5 h-4 w-4" />
          Notes History
        </Button>
      </header>

      {/* Controls */}
      <div className="border-b border-border bg-card">
        <div className="flex items-center gap-2 px-4 py-2">
          <button
            type="button"
            onClick={() => setControlsOpen((v) => !v)}
            aria-expanded={controlsOpen}
            className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-sm font-medium text-card-foreground transition hover:bg-muted"
          >
            <ChevronDown
              className={`h-4 w-4 text-muted-foreground transition-transform ${controlsOpen ? "" : "-rotate-90"}`}
            />
            Lesson details
          </button>
          {!controlsOpen && (
            <span className="truncate text-xs text-muted-foreground">
              {selectedStudent ? selectedStudent.name : "No student"}
              {" · "}
              {formatDisplayDate(date)}
              {subject ? ` · ${subject}` : ""}
              {topic ? ` · ${topic}` : ""}
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            {noteExists && status === "saved" && (
              <span className="text-xs text-muted-foreground">Loaded saved notes</span>
            )}
            <span className={`text-xs font-medium ${statusColor}`}>{statusLabel}</span>
          </div>
        </div>

        {controlsOpen && (
          <div className="flex flex-wrap items-end gap-x-4 gap-y-2 px-4 pb-2.5">
            <div className="flex flex-col gap-1">
              <label htmlFor="student" className="text-xs font-medium text-muted-foreground">
                Student
              </label>
          <div className="flex items-center gap-1.5">
            <select
              id="student"
              value={selectedId ?? ""}
              onChange={(e) => handleSelectStudent(e.target.value)}
              className="h-9 w-44 rounded-md border border-input bg-background px-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">Select student...</option>
              {students.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.grade ? ` (${s.grade})` : ""}
                </option>
              ))}
            </select>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setStudentDialog({ open: true, editing: null })}
              title="Add student"
            >
              <UserPlus className="h-4 w-4" />
            </Button>
            {selectedStudent && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setStudentDialog({ open: true, editing: selectedStudent })}
                  title="Edit student"
                >
                  <PencilEdit className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="sm" onClick={handleDeleteStudent} title="Delete student">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="date" className="text-xs font-medium text-muted-foreground">
            Date
          </label>
          <input
            id="date"
            type="date"
            value={date}
            onChange={(e) => handleDateChange(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="subject" className="text-xs font-medium text-muted-foreground">
            Subject
          </label>
          <input
            id="subject"
            value={subject}
            onChange={(e) => {
              setSubject(e.target.value)
              markDirty()
            }}
            placeholder="Optional"
            className="h-9 w-36 rounded-md border border-input bg-background px-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="topic" className="text-xs font-medium text-muted-foreground">
            Topic
          </label>
          <input
            id="topic"
            value={topic}
            onChange={(e) => {
              setTopic(e.target.value)
              markDirty()
            }}
            placeholder="Optional"
            className="h-9 w-36 rounded-md border border-input bg-background px-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

          </div>
        )}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-4 py-2">
        <div className="flex items-center gap-1 rounded-md border border-border p-1">
          <ToolButton active={tool === "pen"} onClick={() => setTool("pen")} label="Pen">
            <Pencil className="h-4 w-4" />
          </ToolButton>
          <ToolButton active={tool === "highlighter"} onClick={() => setTool("highlighter")} label="Highlighter">
            <Highlighter className="h-4 w-4" />
          </ToolButton>
          <ToolButton active={tool === "eraser"} onClick={() => setTool("eraser")} label="Eraser">
            <Eraser className="h-4 w-4" />
          </ToolButton>
          <ToolButton active={tool === "text"} onClick={() => setTool("text")} label="Text">
            <Type className="h-4 w-4" />
          </ToolButton>
        </div>

        {/* Colors */}
        <div className="flex items-center gap-1">
          {PEN_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => {
                setPenColor(c)
                if (tool === "eraser" || tool === "highlighter") setTool("pen")
              }}
              className={`h-6 w-6 rounded-full border-2 transition ${
                penColor === c && tool !== "highlighter" ? "border-ring scale-110" : "border-border"
              }`}
              style={{ backgroundColor: c }}
              aria-label={`Color ${c}`}
            />
          ))}
        </div>

        {/* Sizes */}
        <div className="flex items-center gap-1 rounded-md border border-border p-1">
          {SIZES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSize(s)}
              className={`flex h-7 w-7 items-center justify-center rounded ${
                size === s ? "bg-secondary" : "hover:bg-muted"
              }`}
              aria-label={`Size ${s}`}
            >
              <span className="rounded-full bg-foreground" style={{ width: s + 2, height: s + 2 }} />
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1 rounded-md border border-border p-1">
          <ToolButton active={false} disabled={!history.canUndo} onClick={() => boardRef.current?.undo()} label="Undo">
            <Undo2 className="h-4 w-4" />
          </ToolButton>
          <ToolButton active={false} disabled={!history.canRedo} onClick={() => boardRef.current?.redo()} label="Redo">
            <Redo2 className="h-4 w-4" />
          </ToolButton>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <Button variant="outline" size="sm" onClick={handleNew}>
            New
          </Button>
          <Button variant="outline" size="sm" onClick={handleLoad}>
            Load
          </Button>
          <Button variant="outline" size="sm" onClick={handleClear}>
            Clear
          </Button>
          <Button size="sm" onClick={() => persist({ explicit: true })}>
            <Save className="mr-1.5 h-4 w-4" />
            Save
          </Button>
        </div>
      </div>

      {/* Whiteboard */}
      <div className="relative flex-1 overflow-hidden p-3">
        <div className="h-full w-full overflow-hidden rounded-lg border border-border shadow-sm">
          <Whiteboard
            ref={boardRef}
            tool={tool}
            color={activeColor}
            size={size}
            onDirty={markDirty}
            onHistoryChange={setHistory}
          />
        </div>
        {selectedId == null && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <p className="rounded-md bg-card/90 px-4 py-2 text-sm text-muted-foreground shadow-sm">
              Select or add a student to begin. You can draw now; pick a student before saving.
            </p>
          </div>
        )}
      </div>

      {/* Footer status */}
      <footer className="flex items-center justify-between border-t border-border bg-card px-4 py-1.5 text-xs text-muted-foreground">
        <span>{selectedStudent ? `${selectedStudent.name} · ${formatDisplayDate(date)}` : formatDisplayDate(date)}</span>
        <span className={statusColor}>{statusLabel}</span>
      </footer>

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-md bg-foreground px-4 py-2 text-sm text-background shadow-lg">
          {toast}
        </div>
      )}

      <StudentDialog
        open={studentDialog.open}
        initial={studentDialog.editing}
        onClose={() => setStudentDialog({ open: false, editing: null })}
        onSubmit={handleStudentSubmit}
      />

      <NotesHistory
        open={historyOpen}
        students={students}
        onClose={() => setHistoryOpen(false)}
        onOpenNote={handleOpenFromHistory}
      />
    </div>
  )
}

function ToolButton({
  active,
  disabled,
  onClick,
  label,
  children,
}: {
  active: boolean
  disabled?: boolean
  onClick: () => void
  label: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={`flex h-8 w-8 items-center justify-center rounded transition disabled:opacity-40 ${
        active ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-muted"
      }`}
    >
      {children}
    </button>
  )
}
