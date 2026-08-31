import { getStudents } from "@/app/actions/students"
import { WhiteboardApp } from "@/components/whiteboard-app"

export const dynamic = "force-dynamic"

export default async function Page() {
  const students = await getStudents()
  return <WhiteboardApp initialStudents={students} />
}
