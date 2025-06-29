import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { sql } from 'drizzle-orm'
import * as schema from './schema.js'
import path from 'path'
import os from 'os'
import fs from 'fs'
import type { LibSQLDatabase } from 'drizzle-orm/libsql'

const DEFAULT_DB_PATH = path.join(os.homedir(), '.control', 'cli.db')

const dbConnections = new Map<string, LibSQLDatabase<typeof schema>>()

function ensureDbDirectory(dbPath: string) {
  const dbDir = path.dirname(dbPath)
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true })
  }
}

export function getDbConnection(
  dbPath: string = DEFAULT_DB_PATH,
): LibSQLDatabase<typeof schema> {
  const existingDb = dbConnections.get(dbPath)
  if (existingDb) {
    return existingDb
  }

  ensureDbDirectory(dbPath)
  const client = createClient({
    url: `file:${dbPath}`,
  })
  const newDb = drizzle(client, { schema })

  dbConnections.set(dbPath, newDb)

  return newDb
}

export const db = getDbConnection()

export function runMigrations(dbPath?: string) {
  const database = dbPath ? getDbConnection(dbPath) : db
  const migrationsPath = path.join(process.cwd(), 'drizzle')
  if (fs.existsSync(migrationsPath)) {
    migrate(database, { migrationsFolder: migrationsPath })
  }
}

export async function saveSession(session: schema.NewSession, dbPath?: string) {
  const database = dbPath ? getDbConnection(dbPath) : db
  return database.insert(schema.sessions).values(session).returning()
}

export async function getSession(sessionName: string, dbPath?: string) {
  const database = dbPath ? getDbConnection(dbPath) : db
  const result = await database
    .select()
    .from(schema.sessions)
    .where(sql`${schema.sessions.sessionName} = ${sessionName}`)
    .limit(1)

  return result[0] || null
}

export async function saveWindow(window: schema.NewWindow, dbPath?: string) {
  const database = dbPath ? getDbConnection(dbPath) : db
  return database.insert(schema.windows).values(window).returning()
}

export async function getWindowsForSession(
  sessionName: string,
  dbPath?: string,
) {
  const database = dbPath ? getDbConnection(dbPath) : db
  return database
    .select()
    .from(schema.windows)
    .where(sql`${schema.windows.sessionName} = ${sessionName}`)
    .orderBy(schema.windows.index)
}

export async function deleteSession(sessionName: string, dbPath?: string) {
  const database = dbPath ? getDbConnection(dbPath) : db
  return database
    .delete(schema.sessions)
    .where(sql`${schema.sessions.sessionName} = ${sessionName}`)
}

export async function getAllSessions(dbPath?: string) {
  const database = dbPath ? getDbConnection(dbPath) : db
  return database.select().from(schema.sessions)
}

export async function getSessionWithWindows(
  sessionName: string,
  dbPath?: string,
) {
  const session = await getSession(sessionName, dbPath)
  if (!session) return null

  const windows = await getWindowsForSession(sessionName, dbPath)
  return {
    ...session,
    windows,
  }
}
