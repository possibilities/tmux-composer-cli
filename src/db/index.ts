import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { sql } from 'drizzle-orm'
import * as schema from './schema.js'
import path from 'path'
import os from 'os'
import fs from 'fs'

const DB_PATH = path.join(os.homedir(), '.control', 'cli.db')
const DB_DIR = path.dirname(DB_PATH)

if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true })
}

const client = createClient({
  url: `file:${DB_PATH}`,
})
export const db = drizzle(client, { schema })

export function runMigrations() {
  const migrationsPath = path.join(process.cwd(), 'drizzle')
  if (fs.existsSync(migrationsPath)) {
    migrate(db, { migrationsFolder: migrationsPath })
  }
}

export async function saveSession(session: schema.NewSession) {
  return db.insert(schema.sessions).values(session).returning()
}

export async function getSession(sessionName: string) {
  const result = await db
    .select()
    .from(schema.sessions)
    .where(sql`${schema.sessions.sessionName} = ${sessionName}`)
    .limit(1)

  return result[0] || null
}

export async function saveWindow(window: schema.NewWindow) {
  return db.insert(schema.windows).values(window).returning()
}

export async function getWindowsForSession(sessionName: string) {
  return db
    .select()
    .from(schema.windows)
    .where(sql`${schema.windows.sessionName} = ${sessionName}`)
    .orderBy(schema.windows.index)
}

export async function deleteSession(sessionName: string) {
  return db
    .delete(schema.sessions)
    .where(sql`${schema.sessions.sessionName} = ${sessionName}`)
}
