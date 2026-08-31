"use server"

import { db } from "@/lib/db"
import { students } from "@/lib/db/schema"
import { asc, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"

export async function getStudents() {
  return db.select().from(students).orderBy(asc(students.name))
}

export async function createStudent(input: { name: string; grade?: string; notes?: string }) {
  const name = input.name?.trim()
  if (!name) throw new Error("Student name is required")

  const [row] = await db
    .insert(students)
    .values({
      name,
      grade: input.grade?.trim() || null,
      notes: input.notes?.trim() || null,
    })
    .returning()

  revalidatePath("/")
  return row
}

export async function updateStudent(input: { id: number; name: string; grade?: string; notes?: string }) {
  const name = input.name?.trim()
  if (!name) throw new Error("Student name is required")

  const [row] = await db
    .update(students)
    .set({
      name,
      grade: input.grade?.trim() || null,
      notes: input.notes?.trim() || null,
      updatedAt: new Date(),
    })
    .where(eq(students.id, input.id))
    .returning()

  revalidatePath("/")
  return row
}

export async function deleteStudent(id: number) {
  // Remove the student's notes first, then the student.
  const { classNotes } = await import("@/lib/db/schema")
  await db.delete(classNotes).where(eq(classNotes.studentId, id))
  await db.delete(students).where(eq(students.id, id))
  revalidatePath("/")
}
