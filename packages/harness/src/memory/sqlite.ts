// hot/warm 层存储（memory/sessions.db，DDL 见 v3.0 §2.3）

import Database from 'better-sqlite3'
import type { ChatConversationSummary, Turn, WarmItem } from '@petsona/shared'

const DDL = `
CREATE TABLE IF NOT EXISTS turns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL DEFAULT 'default',
  role TEXT NOT NULL CHECK(role IN ('user','pet')),
  text TEXT NOT NULL,
  t INTEGER NOT NULL,
  topics TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS warm_segments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  turn_start INTEGER NOT NULL, turn_end INTEGER NOT NULL,
  summary TEXT NOT NULL,
  topics TEXT NOT NULL DEFAULT '[]',
  t INTEGER NOT NULL
);
`

type TurnRow = { id: number; conversation_id?: string; role: 'user' | 'pet'; text: string; t: number; topics: string }
type WarmRow = { id: number; turn_start: number; turn_end: number; summary: string; topics: string; t: number }

function rowToTurn(r: TurnRow): Turn {
  return { id: r.id, conversationId: r.conversation_id ?? 'default', role: r.role, text: r.text, t: r.t, topics: safeTopics(r.topics) }
}
function rowToWarm(r: WarmRow): WarmItem {
  return { id: r.id, turnStart: r.turn_start, turnEnd: r.turn_end, summary: r.summary, topics: safeTopics(r.topics), t: r.t }
}
function safeTopics(s: string): string[] {
  try {
    const v = JSON.parse(s)
    return Array.isArray(v) ? v : ['_untagged']
  } catch {
    return ['_untagged']
  }
}

export class SessionsDb {
  private db: Database.Database

  constructor(dbPath: string) {
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.exec(DDL)
    this.migrate()
  }

  close(): void { this.db.close() }

  // ---------- hot ----------

  insertTurn(role: 'user' | 'pet', text: string, t: number, opts: { conversationId?: string } = {}): number {
    const conversationId = normalizeConversationId(opts.conversationId)
    const r = this.db
      .prepare('INSERT INTO turns (conversation_id, role, text, t) VALUES (?, ?, ?, ?)')
      .run(conversationId, role, text, t)
    return Number(r.lastInsertRowid)
  }

  setTurnTopics(id: number, topics: string[]): void {
    this.db.prepare('UPDATE turns SET topics = ? WHERE id = ?').run(JSON.stringify(topics), id)
  }

  hotCount(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM turns').get() as { n: number }).n
  }

  recentTurns(limit: number): Turn[] {
    const rows = this.db.prepare('SELECT * FROM turns ORDER BY id DESC LIMIT ?').all(limit) as TurnRow[]
    return rows.reverse().map(rowToTurn)
  }

  recentTurnsByConversation(conversationId: string, limit: number): Turn[] {
    const rows = this.db
      .prepare('SELECT * FROM turns WHERE conversation_id = ? ORDER BY id DESC LIMIT ?')
      .all(normalizeConversationId(conversationId), limit) as TurnRow[]
    return rows.reverse().map(rowToTurn)
  }

  recentConversations(limit: number): ChatConversationSummary[] {
    const rows = this.db
      .prepare(`
        SELECT
          conversation_id AS id,
          MIN(t) AS t,
          MAX(t) AS updatedAt,
          COUNT(*) AS messageCount,
          COALESCE(
            (SELECT text FROM turns first_user
             WHERE first_user.conversation_id = turns.conversation_id AND first_user.role = 'user'
             ORDER BY first_user.id ASC LIMIT 1),
            (SELECT text FROM turns first_turn
             WHERE first_turn.conversation_id = turns.conversation_id
             ORDER BY first_turn.id ASC LIMIT 1),
            '新聊天'
          ) AS title
        FROM turns
        GROUP BY conversation_id
        ORDER BY updatedAt DESC
        LIMIT ?
      `)
      .all(limit) as Array<{ id: string; title: string; t: number; updatedAt: number; messageCount: number }>
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      t: row.t,
      updatedAt: row.updatedAt,
      messageCount: row.messageCount,
    }))
  }

  oldestTurns(limit: number): Turn[] {
    const rows = this.db.prepare('SELECT * FROM turns ORDER BY id ASC LIMIT ?').all(limit) as TurnRow[]
    return rows.map(rowToTurn)
  }

  turnsByTopics(topics: string[], limit: number, excludeIds: number[]): Turn[] {
    if (topics.length === 0) return []
    // topics 为 JSON 字符串，LIKE 命中即算（SPEC-GAP: 规格未指定话题匹配算法，用包含匹配）
    const likes = topics.map(() => `topics LIKE ?`).join(' OR ')
    const notIn = excludeIds.length ? `AND id NOT IN (${excludeIds.map(() => '?').join(',')})` : ''
    const rows = this.db
      .prepare(`SELECT * FROM turns WHERE (${likes}) ${notIn} ORDER BY id DESC LIMIT ?`)
      .all(...topics.map((tp) => `%"${tp}"%`), ...excludeIds, limit) as TurnRow[]
    return rows.map(rowToTurn)
  }

  deleteTurns(ids: number[]): void {
    if (!ids.length) return
    this.db.prepare(`DELETE FROM turns WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids)
  }

  allTurns(): Turn[] {
    return (this.db.prepare('SELECT * FROM turns ORDER BY id ASC').all() as TurnRow[]).map(rowToTurn)
  }

  private migrate(): void {
    const cols = this.db.prepare('PRAGMA table_info(turns)').all() as Array<{ name: string }>
    if (!cols.some((col) => col.name === 'conversation_id')) {
      this.db.exec("ALTER TABLE turns ADD COLUMN conversation_id TEXT NOT NULL DEFAULT 'default'")
    }
  }

  // ---------- warm ----------

  insertWarm(seg: Omit<WarmItem, 'id'>): number {
    const r = this.db
      .prepare('INSERT INTO warm_segments (turn_start, turn_end, summary, topics, t) VALUES (?, ?, ?, ?, ?)')
      .run(seg.turnStart, seg.turnEnd, seg.summary, JSON.stringify(seg.topics), seg.t)
    return Number(r.lastInsertRowid)
  }

  warmCount(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM warm_segments').get() as { n: number }).n
  }

  recentWarm(limit: number): WarmItem[] {
    const rows = this.db.prepare('SELECT * FROM warm_segments ORDER BY id DESC LIMIT ?').all(limit) as WarmRow[]
    return rows.map(rowToWarm)
  }

  warmByTopics(topics: string[], limit: number): WarmItem[] {
    if (topics.length === 0) return []
    const likes = topics.map(() => `topics LIKE ?`).join(' OR ')
    const rows = this.db
      .prepare(`SELECT * FROM warm_segments WHERE ${likes} ORDER BY id DESC LIMIT ?`)
      .all(...topics.map((tp) => `%"${tp}"%`), limit) as WarmRow[]
    return rows.map(rowToWarm)
  }

  oldestWarm(limit: number): WarmItem[] {
    const rows = this.db.prepare('SELECT * FROM warm_segments ORDER BY id ASC LIMIT ?').all(limit) as WarmRow[]
    return rows.map(rowToWarm)
  }

  deleteWarm(ids: number[]): void {
    if (!ids.length) return
    this.db.prepare(`DELETE FROM warm_segments WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids)
  }
}

function normalizeConversationId(id: string | undefined): string {
  const trimmed = id?.trim()
  return trimmed || 'default'
}
