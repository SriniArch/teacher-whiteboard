"use client"

import { Button } from "@/components/ui/button"
import type { Student } from "@/lib/db/schema"
import { X } from "lucide-react"
import { useEffect, useState } from "react"

type Props = {
  open: boolean
  initial?: Student | null
  onClose: () => void
  onSubmit: (values: { name: string; grade: string; notes: string }) => Promise<void>
}

export function StudentDialog({ open, initial, onClose, onSubmit }: Props) {
  const [name, setName] = useState("")
  const [grade, setGrade] = useState("")
  const [notes, setNotes] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setName(initial?.name ?? "")
      setGrade(initial?.grade ?? "")
      setNotes(initial?.notes ?? "")
      setError(null)
    }
  }, [open, initial])

  if (!open) return null

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) {
      setError("Student name is required.")
      return
    }
    setSubmitting(true)
    try {
      await onSubmit({ name, grade, notes })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4"
      onMouseDown={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-lg"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-card-foreground">
            {initial ? "Edit Student" : "Add Student"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="student-name" className="text-sm font-medium text-card-foreground">
              Student Name <span className="text-destructive">*</span>
            </label>
            <input
              id="student-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              className="h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
              placeholder="e.g. Arjun"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="student-grade" className="text-sm font-medium text-card-foreground">
              Grade / Class <span className="text-muted-foreground">(optional)</span>
            </label>
            <input
              id="student-grade"
              value={grade}
              onChange={(e) => setGrade(e.target.value)}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
              placeholder="e.g. Grade 6"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="student-notes" className="text-sm font-medium text-card-foreground">
              Notes <span className="text-muted-foreground">(optional)</span>
            </label>
            <textarea
              id="student-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="resize-none rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
              placeholder="Any details about this student"
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Saving..." : initial ? "Save Changes" : "Add Student"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
