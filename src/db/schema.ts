import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

export const sessions = sqliteTable('sessions', {
  sessionName: text('session_name').primaryKey(),
  projectName: text('project_name').notNull(),
  worktreePath: text('worktree_path').notNull(),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(datetime('now'))`),
})

export const windows = sqliteTable('windows', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sessionName: text('session_name')
    .notNull()
    .references(() => sessions.sessionName, { onDelete: 'cascade' }),
  index: integer('index').notNull(),
  name: text('name').notNull(),
  command: text('command').notNull(),
  description: text('description').notNull(),
  port: integer('port'),
})

export type Session = typeof sessions.$inferSelect
export type NewSession = typeof sessions.$inferInsert
export type Window = typeof windows.$inferSelect
export type NewWindow = typeof windows.$inferInsert
