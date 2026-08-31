import { openDB, type DBSchema, type IDBPDatabase } from "idb"

// ---------------------------------------------------------------------------
// Local-first data model.
//
// IndexedDB is the primary source of truth for the UI. Every record carries a
// client-generated string `id` (localId) so it can be created entirely offline,
// plus a nullable `serverId` that is filled in once the record syncs to Neon.
// `dirty` marks records that still need to be pushed; `deleted` is a tombstone
// so deletions can be propagated to the server on the next sync.
// ---------------------------------------------------------------------------

export type LocalStudent = {
  id: string
  serverId: number | null
  name: string
  grade: string | null
  notes: string | null
  updatedAt: string
  dirty: boolean
  deleted: boolean
}

export type LocalNote = {
  id: string
  serverId: number | null
  studentId: string // student localId
  date: string
  subject: string | null
  topic: string | null
  description: string | null
  whiteboardData: unknown
  updatedAt: string
  dirty: boolean
  deleted: boolean
}

interface WhiteboardDB extends DBSchema {
  students: {
    key: string
    value: LocalStudent
    indexes: { byServerId: number }
  }
  notes: {
    key: string
    value: LocalNote
    indexes: { byServerId: number; byStudentDate: [string, string] }
  }
  meta: {
    key: string
    value: { key: string; value: string }
  }
}

const DB_NAME = "teacher-whiteboard"
const DB_VERSION = 1

let dbPromise: Promise<IDBPDatabase<WhiteboardDB>> | null = null

export function getDB() {
  if (typeof window === "undefined") {
    throw new Error("IndexedDB is only available in the browser")
  }
  if (!dbPromise) {
    dbPromise = openDB<WhiteboardDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const students = db.createObjectStore("students", { keyPath: "id" })
        students.createIndex("byServerId", "serverId")

        const notes = db.createObjectStore("notes", { keyPath: "id" })
        notes.createIndex("byServerId", "serverId")
        notes.createIndex("byStudentDate", ["studentId", "date"])

        db.createObjectStore("meta", { keyPath: "key" })
      },
    })
  }
  return dbPromise
}

export function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function nowISO() {
  return new Date().toISOString()
}

// ---- Meta helpers ---------------------------------------------------------

export async function getMeta(key: string): Promise<string | null> {
  const db = await getDB()
  const row = await db.get("meta", key)
  return row?.value ?? null
}

export async function setMeta(key: string, value: string) {
  const db = await getDB()
  await db.put("meta", { key, value })
}
