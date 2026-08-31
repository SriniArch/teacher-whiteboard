import {
  date,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core"

export const students = pgTable("students", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  grade: text("grade"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})

export const classNotes = pgTable(
  "class_notes",
  {
    id: serial("id").primaryKey(),
    studentId: integer("student_id").notNull(),
    date: date("date").notNull(),
    subject: text("subject"),
    topic: text("topic"),
    description: text("description"),
    whiteboardData: jsonb("whiteboard_data"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    studentDateUnique: unique("class_notes_student_date_unique").on(table.studentId, table.date),
  }),
)

export type Student = typeof students.$inferSelect
export type ClassNote = typeof classNotes.$inferSelect
