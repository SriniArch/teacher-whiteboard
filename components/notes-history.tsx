"use client"

import { Button } from "@/components/ui/button"
import { deleteNote, getNotesHistory, type NoteHistoryRow } from "@/app/actions/notes"
import type { Student } from "@/lib/db/schema"
import { Trash2, X } from "lucide-react"
import { useEffect, useState } from "react"

type Props = {
  open: boolean
  students: Student[]
  onClose: () => void
  onOpenNote: (row: NoteHistoryRow) => void
}

function formatDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number)
  const dt = new Date(y, m - 1, d)
  return dt.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" })
}

export function NotesHistory({ open, students, onClose, onOpenNote }: Props) {
  const [filterStudent, setFilterStudent] = useState<string>("all")
  const [rows, setRows] = useState<NoteHistoryRow[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    const studentId = filterStudent === "all" ? undefined : Number(filterStudent)
    getNotesHistory(studentId)
      .then(setRows)
      .finally(() => setLoading(false))
  }, [open, filterStudent])

  if (!open) return null

  async function handleDelete(id: number) {
    if (!confirm("Delete this note permanently? This cannot be undone.")) return
    await deleteNote(id)
    setRows((r) => r.filter((row) => row.id !== id))
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-foreground/40" onMouseDown={onClose}>
      <aside
        className="flex h-full w-full max-w-xl flex-col border-l border-border bg-card shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="text-lg font-semibold text-card-foreground">Notes History</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex items-center gap-3 border-b border-border px-6 py-3">
          <label htmlFor="history-filter" className="text-sm font-medium text-muted-foreground">
            Student
          </label>
          <select
            id="history-filter"
            value={filterStudent}
            onChange={(e) => setFilterStudent(e.target.value)}
            className="h-9 flex-1 rounded-md border border-input bg-background px-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="all">All Students</option>
            {students.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex-1 overflow-auto">
          {loading ? (
            <p className="p-6 text-sm text-muted-foreground">Loading...</p>
          ) : rows.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">No saved notes yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted text-left text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Date</th>
                  <th className="px-4 py-2 font-medium">Student</th>
                  <th className="px-4 py-2 font-medium">Subject</th>
                  <th className="px-4 py-2 font-medium">Topic</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-t border-border hover:bg-muted/50">
                    <td className="whitespace-nowrap px-4 py-2 text-foreground">{formatDate(row.date)}</td>
                    <td className="px-4 py-2 text-foreground">{row.studentName}</td>
                    <td className="px-4 py-2 text-muted-foreground">{row.subject || "—"}</td>
                    <td className="px-4 py-2 text-muted-foreground">{row.topic || "—"}</td>
                    <td className="px-4 py-2">
                      <div className="flex items-center justify-end gap-1">
                        <Button size="sm" variant="outline" onClick={() => onOpenNote(row)}>
                          Open
                        </Button>
                        <button
                          type="button"
                          onClick={() => handleDelete(row.id)}
                          className="rounded-md p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          aria-label="Delete note"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </aside>
    </div>
  )
}
