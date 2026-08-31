"use server"

import { db } from "@/lib/db"
import { classNotes, students } from "@/lib/db/schema"
import { and, desc, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"

export type WhiteboardData = unknown

export async function getNote(studentId: number, date: string) {
  const [row] = await db
    .select()
    .from(classNotes)
    .where(and(eq(classNotes.studentId, studentId), eq(classNotes.date, date)))
    .limit(1)
  return row ?? null
}

export async function saveNote(input: {
  studentId: number
  date: string
  subject?: string
  topic?: string
  description?: string
  whiteboardData: WhiteboardData
}) {
  if (!input.studentId) throw new Error("Please select a student before saving.")
  if (!input.date) throw new Error("Please select a date before saving.")

  const [row] = await db
    .insert(classNotes)
    .values({
      studentId: input.studentId,
      date: input.date,
      subject: input.subject?.trim() || null,
      topic: input.topic?.trim() || null,
      description: input.description?.trim() || null,
      whiteboardData: input.whiteboardData as never,
    })
    .onConflictDoUpdate({
      target: [classNotes.studentId, classNotes.date],
      set: {
        subject: input.subject?.trim() || null,
        topic: input.topic?.trim() || null,
        description: input.description?.trim() || null,
        whiteboardData: input.whiteboardData as never,
        updatedAt: new Date(),
      },
    })
    .returning()

  revalidatePath("/")
  return row
}

export type NoteHistoryRow = {
  id: number
  studentId: number
  studentName: string
  date: string
  subject: string | null
  topic: string | null
}

export async function getNotesHistory(studentId?: number): Promise<NoteHistoryRow[]> {
  const rows = await db
    .select({
      id: classNotes.id,
      studentId: classNotes.studentId,
      studentName: students.name,
      date: classNotes.date,
      subject: classNotes.subject,
      topic: classNotes.topic,
    })
    .from(classNotes)
    .innerJoin(students, eq(classNotes.studentId, students.id))
    .where(studentId ? eq(classNotes.studentId, studentId) : undefined)
    .orderBy(desc(classNotes.date))
  return rows
}

export async function deleteNote(id: number) {
  await db.delete(classNotes).where(eq(classNotes.id, id))
  revalidatePath("/")
}

// Full note payloads for the local-first sync engine (pull step).
export async function getAllNotes() {
  return db
    .select({
      id: classNotes.id,
      studentId: classNotes.studentId,
      date: classNotes.date,
      subject: classNotes.subject,
      topic: classNotes.topic,
      description: classNotes.description,
      whiteboardData: classNotes.whiteboardData,
      updatedAt: classNotes.updatedAt,
    })
    .from(classNotes)
    .orderBy(desc(classNotes.date))
}
