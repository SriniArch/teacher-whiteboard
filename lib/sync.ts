import { createStudent, deleteStudent, getStudents, updateStudent } from "@/app/actions/students"
import { deleteNote, getAllNotes, saveNote } from "@/app/actions/notes"
import { getDB, nowISO, setMeta, type LocalNote, type LocalStudent } from "@/lib/local-db"

// ---------------------------------------------------------------------------
// Sync engine.
//
// Strategy: push every dirty/tombstoned local record to Neon, then pull the
// full server state back down and reconcile. Students sync before notes so a
// note always has a resolvable server studentId. Conflict resolution is
// last-write-wins with the local (dirty) copy winning, since a single teacher
// is the only writer.
// ---------------------------------------------------------------------------

export type SyncState = {
  online: boolean
  syncing: boolean
  lastSyncedAt: string | null
  pending: number
  error: string | null
}

type Listener = (state: SyncState) => void

let state: SyncState = {
  online: typeof navigator !== "undefined" ? navigator.onLine : true,
  syncing: false,
  lastSyncedAt: null,
  pending: 0,
  error: null,
}

const listeners = new Set<Listener>()

function emit() {
  for (const l of listeners) l(state)
}

function set(partial: Partial<SyncState>) {
  state = { ...state, ...partial }
  emit()
}

export function getSyncState() {
  return state
}

export function subscribeSync(listener: Listener) {
  listeners.add(listener)
  listener(state)
  return () => listeners.delete(listener)
}

export async function countPending(): Promise<number> {
  const db = await getDB()
  const students = await db.getAll("students")
  const notes = await db.getAll("notes")
  return students.filter((s) => s.dirty).length + notes.filter((n) => n.dirty).length
}

async function refreshPending() {
  set({ pending: await countPending() })
}

let syncing = false
let queued = false

export async function sync(): Promise<void> {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    set({ online: false })
    await refreshPending()
    return
  }
  // Collapse concurrent calls: run once, then run one more time if requested.
  if (syncing) {
    queued = true
    return
  }
  syncing = true
  set({ syncing: true, online: true, error: null })

  try {
    await pushStudents()
    await pushNotes()
    await pullStudents()
    await pullNotes()
    await setMeta("lastSyncedAt", nowISO())
    set({ lastSyncedAt: nowISO() })
  } catch (err) {
    set({ error: err instanceof Error ? err.message : "Sync failed" })
  } finally {
    syncing = false
    set({ syncing: false })
    await refreshPending()
    if (queued) {
      queued = false
      void sync()
    }
  }
}

// ---- Push -----------------------------------------------------------------

async function pushStudents() {
  const db = await getDB()
  const all = await db.getAll("students")
  const dirty = all.filter((s) => s.dirty)

  for (const s of dirty) {
    if (s.deleted) {
      if (s.serverId != null) await deleteStudent(s.serverId)
      await db.delete("students", s.id)
      continue
    }
    if (s.serverId != null) {
      await updateStudent({
        id: s.serverId,
        name: s.name,
        grade: s.grade ?? undefined,
        notes: s.notes ?? undefined,
      })
      await db.put("students", { ...s, dirty: false })
    } else {
      const row = await createStudent({
        name: s.name,
        grade: s.grade ?? undefined,
        notes: s.notes ?? undefined,
      })
      await db.put("students", { ...s, serverId: row.id, dirty: false })
    }
  }
}

async function pushNotes() {
  const db = await getDB()
  const all = await db.getAll("notes")
  const dirty = all.filter((n) => n.dirty)

  for (const n of dirty) {
    // Resolve the owning student's server id (student sync ran first).
    const student = await db.get("students", n.studentId)

    if (n.deleted) {
      if (n.serverId != null) await deleteNote(n.serverId)
      await db.delete("notes", n.id)
      continue
    }
    if (!student || student.serverId == null) {
      // Student not yet on the server; skip for now, next sync will catch it.
      continue
    }
    const row = await saveNote({
      studentId: student.serverId,
      date: n.date,
      subject: n.subject ?? undefined,
      topic: n.topic ?? undefined,
      description: n.description ?? undefined,
      whiteboardData: n.whiteboardData,
    })
    await db.put("notes", { ...n, serverId: row.id, dirty: false })
  }
}

// ---- Pull -----------------------------------------------------------------

async function pullStudents() {
  const db = await getDB()
  const serverRows = await getStudents()
  const serverIds = new Set(serverRows.map((r) => r.id))

  for (const row of serverRows) {
    const existing = await db.getFromIndex("students", "byServerId", row.id)
    if (existing) {
      if (!existing.dirty) {
        await db.put("students", {
          ...existing,
          name: row.name,
          grade: row.grade,
          notes: row.notes,
          updatedAt: (row.updatedAt as Date | string as string) ?? existing.updatedAt,
        })
      }
    } else {
      const local: LocalStudent = {
        id: crypto.randomUUID(),
        serverId: row.id,
        name: row.name,
        grade: row.grade,
        notes: row.notes,
        updatedAt: nowISO(),
        dirty: false,
        deleted: false,
      }
      await db.put("students", local)
    }
  }

  // Drop clean local students that no longer exist on the server.
  const local = await db.getAll("students")
  for (const s of local) {
    if (s.serverId != null && !serverIds.has(s.serverId) && !s.dirty) {
      await db.delete("students", s.id)
    }
  }
}

async function pullNotes() {
  const db = await getDB()
  const serverRows = await getAllNotes()
  const serverIds = new Set(serverRows.map((r) => r.id))

  // Map server studentId -> local studentId.
  const students = await db.getAll("students")
  const studentByServerId = new Map<number, string>()
  for (const s of students) {
    if (s.serverId != null) studentByServerId.set(s.serverId, s.id)
  }

  for (const row of serverRows) {
    const studentLocalId = studentByServerId.get(row.studentId)
    if (!studentLocalId) continue // owning student missing locally; skip

    const dateStr = typeof row.date === "string" ? row.date : String(row.date)
    const existing = await db.getFromIndex("notes", "byServerId", row.id)
    if (existing) {
      if (!existing.dirty) {
        await db.put("notes", {
          ...existing,
          studentId: studentLocalId,
          date: dateStr,
          subject: row.subject,
          topic: row.topic,
          description: row.description,
          whiteboardData: row.whiteboardData,
          updatedAt: (row.updatedAt as Date | string as string) ?? existing.updatedAt,
        })
      }
    } else {
      const local: LocalNote = {
        id: crypto.randomUUID(),
        serverId: row.id,
        studentId: studentLocalId,
        date: dateStr,
        subject: row.subject,
        topic: row.topic,
        description: row.description,
        whiteboardData: row.whiteboardData,
        updatedAt: nowISO(),
        dirty: false,
        deleted: false,
      }
      await db.put("notes", local)
    }
  }

  // Drop clean local notes that no longer exist on the server.
  const localNotes = await db.getAll("notes")
  for (const n of localNotes) {
    if (n.serverId != null && !serverIds.has(n.serverId) && !n.dirty) {
      await db.delete("notes", n.id)
    }
  }
}

// ---- Connectivity wiring --------------------------------------------------

let wired = false

export function initConnectivity() {
  if (wired || typeof window === "undefined") return
  wired = true

  window.addEventListener("online", () => {
    set({ online: true })
    void sync()
  })
  window.addEventListener("offline", () => set({ online: false }))

  // Opportunistic periodic sync while online.
  setInterval(() => {
    if (navigator.onLine) void sync()
  }, 30000)
}
