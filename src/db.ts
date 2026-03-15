import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

import { ASSISTANT_NAME, DATA_DIR, STORE_DIR } from './config.js';
import { isValidGroupFolder } from './group-folder.js';
import { logger } from './logger.js';
import {
  NewMessage,
  RegisteredGroup,
  ScheduledTask,
  TaskRunLog,
} from './types.js';

let db: Database.Database;

function createSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS chats (
      jid TEXT PRIMARY KEY,
      name TEXT,
      last_message_time TEXT,
      channel TEXT,
      is_group INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT,
      chat_jid TEXT,
      sender TEXT,
      sender_name TEXT,
      content TEXT,
      timestamp TEXT,
      is_from_me INTEGER,
      is_bot_message INTEGER DEFAULT 0,
      edited INTEGER DEFAULT 0,
      edited_at TEXT,
      recalled INTEGER DEFAULT 0,
      recalled_at TEXT,
      PRIMARY KEY (id, chat_jid),
      FOREIGN KEY (chat_jid) REFERENCES chats(jid)
    );
    CREATE INDEX IF NOT EXISTS idx_timestamp ON messages(timestamp);

    CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id TEXT PRIMARY KEY,
      group_folder TEXT NOT NULL,
      chat_jid TEXT NOT NULL,
      prompt TEXT NOT NULL,
      schedule_type TEXT NOT NULL,
      schedule_value TEXT NOT NULL,
      next_run TEXT,
      last_run TEXT,
      last_result TEXT,
      status TEXT DEFAULT 'active',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_next_run ON scheduled_tasks(next_run);
    CREATE INDEX IF NOT EXISTS idx_status ON scheduled_tasks(status);

    CREATE TABLE IF NOT EXISTS task_run_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      run_at TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      status TEXT NOT NULL,
      result TEXT,
      error TEXT,
      FOREIGN KEY (task_id) REFERENCES scheduled_tasks(id)
    );
    CREATE INDEX IF NOT EXISTS idx_task_run_logs ON task_run_logs(task_id, run_at);

    CREATE TABLE IF NOT EXISTS router_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      group_folder TEXT PRIMARY KEY,
      session_id TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS unread_state (
      chat_jid TEXT NOT NULL,
      actor TEXT NOT NULL,
      last_read_timestamp TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (chat_jid, actor)
    );
    CREATE TABLE IF NOT EXISTS presence_state (
      actor TEXT PRIMARY KEY,
      online INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'offline',
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS notification_user_settings (
      actor TEXT PRIMARY KEY,
      global_level TEXT NOT NULL DEFAULT 'all',
      dnd_enabled INTEGER NOT NULL DEFAULT 0,
      dnd_start TEXT,
      dnd_end TEXT,
      keywords TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS notification_chat_settings (
      actor TEXT NOT NULL,
      chat_jid TEXT NOT NULL,
      muted INTEGER NOT NULL DEFAULT 0,
      allow_mentions INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (actor, chat_jid)
    );
    CREATE TABLE IF NOT EXISTS registered_groups (
      jid TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      folder TEXT NOT NULL UNIQUE,
      trigger_pattern TEXT NOT NULL,
      added_at TEXT NOT NULL,
      container_config TEXT,
      requires_trigger INTEGER DEFAULT 1
    );
  `);

  // Add context_mode column if it doesn't exist (migration for existing DBs)
  try {
    database.exec(
      `ALTER TABLE scheduled_tasks ADD COLUMN context_mode TEXT DEFAULT 'isolated'`,
    );
  } catch {
    /* column already exists */
  }

  // Add is_bot_message column if it doesn't exist (migration for existing DBs)
  try {
    database.exec(
      `ALTER TABLE messages ADD COLUMN is_bot_message INTEGER DEFAULT 0`,
    );
    // Backfill: mark existing bot messages that used the content prefix pattern
    database
      .prepare(`UPDATE messages SET is_bot_message = 1 WHERE content LIKE ?`)
      .run(`${ASSISTANT_NAME}:%`);
  } catch {
    /* column already exists */
  }

  try {
    database.exec(`ALTER TABLE messages ADD COLUMN edited INTEGER DEFAULT 0`);
  } catch {
    /* column already exists */
  }

  try {
    database.exec(`ALTER TABLE messages ADD COLUMN edited_at TEXT`);
  } catch {
    /* column already exists */
  }

  try {
    database.exec(`ALTER TABLE messages ADD COLUMN recalled INTEGER DEFAULT 0`);
  } catch {
    /* column already exists */
  }

  try {
    database.exec(`ALTER TABLE messages ADD COLUMN recalled_at TEXT`);
  } catch {
    /* column already exists */
  }

  // Add is_main column if it doesn't exist (migration for existing DBs)
  try {
    database.exec(
      `ALTER TABLE registered_groups ADD COLUMN is_main INTEGER DEFAULT 0`,
    );
    // Backfill: existing rows with folder = 'main' are the main group
    database.exec(
      `UPDATE registered_groups SET is_main = 1 WHERE folder = 'main'`,
    );
  } catch {
    /* column already exists */
  }

  // Add channel and is_group columns if they don't exist (migration for existing DBs)
  try {
    database.exec(`ALTER TABLE chats ADD COLUMN channel TEXT`);
    database.exec(`ALTER TABLE chats ADD COLUMN is_group INTEGER DEFAULT 0`);
    // Backfill from JID patterns
    database.exec(
      `UPDATE chats SET channel = 'whatsapp', is_group = 1 WHERE jid LIKE '%@g.us'`,
    );
    database.exec(
      `UPDATE chats SET channel = 'whatsapp', is_group = 0 WHERE jid LIKE '%@s.whatsapp.net'`,
    );
    database.exec(
      `UPDATE chats SET channel = 'discord', is_group = 1 WHERE jid LIKE 'dc:%'`,
    );
    database.exec(
      `UPDATE chats SET channel = 'telegram', is_group = 1 WHERE jid LIKE 'tg:%'`,
    );
  } catch {
    /* columns already exist */
  }
}

export function initDatabase(): void {
  const dbPath = path.join(STORE_DIR, 'messages.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  db = new Database(dbPath);
  createSchema(db);

  // Migrate from JSON files if they exist
  migrateJsonState();
}

/** @internal - for tests only. Creates a fresh in-memory database. */
export function _initTestDatabase(): void {
  db = new Database(':memory:');
  createSchema(db);
}

/**
 * Store chat metadata only (no message content).
 * Used for all chats to enable group discovery without storing sensitive content.
 */
export function storeChatMetadata(
  chatJid: string,
  timestamp: string,
  name?: string,
  channel?: string,
  isGroup?: boolean,
): void {
  const ch = channel ?? null;
  const group = isGroup === undefined ? null : isGroup ? 1 : 0;

  if (name) {
    // Update with name, preserving existing timestamp if newer
    db.prepare(
      `
      INSERT INTO chats (jid, name, last_message_time, channel, is_group) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(jid) DO UPDATE SET
        name = excluded.name,
        last_message_time = MAX(last_message_time, excluded.last_message_time),
        channel = COALESCE(excluded.channel, channel),
        is_group = COALESCE(excluded.is_group, is_group)
    `,
    ).run(chatJid, name, timestamp, ch, group);
  } else {
    // Update timestamp only, preserve existing name if any
    db.prepare(
      `
      INSERT INTO chats (jid, name, last_message_time, channel, is_group) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(jid) DO UPDATE SET
        last_message_time = MAX(last_message_time, excluded.last_message_time),
        channel = COALESCE(excluded.channel, channel),
        is_group = COALESCE(excluded.is_group, is_group)
    `,
    ).run(chatJid, chatJid, timestamp, ch, group);
  }
}

/**
 * Update chat name without changing timestamp for existing chats.
 * New chats get the current time as their initial timestamp.
 * Used during group metadata sync.
 */
export function updateChatName(chatJid: string, name: string): void {
  db.prepare(
    `
    INSERT INTO chats (jid, name, last_message_time) VALUES (?, ?, ?)
    ON CONFLICT(jid) DO UPDATE SET name = excluded.name
  `,
  ).run(chatJid, name, new Date().toISOString());
}

export interface ChatInfo {
  jid: string;
  name: string;
  last_message_time: string;
  channel: string;
  is_group: number;
}

/**
 * Get all known chats, ordered by most recent activity.
 */
export function getAllChats(): ChatInfo[] {
  return db
    .prepare(
      `
    SELECT jid, name, last_message_time, channel, is_group
    FROM chats
    ORDER BY last_message_time DESC
  `,
    )
    .all() as ChatInfo[];
}

/**
 * Get timestamp of last group metadata sync.
 */
export function getLastGroupSync(): string | null {
  // Store sync time in a special chat entry
  const row = db
    .prepare(`SELECT last_message_time FROM chats WHERE jid = '__group_sync__'`)
    .get() as { last_message_time: string } | undefined;
  return row?.last_message_time || null;
}

/**
 * Record that group metadata was synced.
 */
export function setLastGroupSync(): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT OR REPLACE INTO chats (jid, name, last_message_time) VALUES ('__group_sync__', '__group_sync__', ?)`,
  ).run(now);
}

/**
 * Store a message with full content.
 * Only call this for registered groups where message history is needed.
 */
export function storeMessage(msg: NewMessage): void {
  db.prepare(
    `INSERT OR REPLACE INTO messages (id, chat_jid, sender, sender_name, content, timestamp, is_from_me, is_bot_message, edited, edited_at, recalled, recalled_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    msg.id,
    msg.chat_jid,
    msg.sender,
    msg.sender_name,
    msg.content,
    msg.timestamp,
    msg.is_from_me ? 1 : 0,
    msg.is_bot_message ? 1 : 0,
    0,
    null,
    0,
    null,
  );
}

/**
 * Store a message directly.
 */
export function storeMessageDirect(msg: {
  id: string;
  chat_jid: string;
  sender: string;
  sender_name: string;
  content: string;
  timestamp: string;
  is_from_me: boolean;
  is_bot_message?: boolean;
  edited?: boolean;
  edited_at?: string | null;
  recalled?: boolean;
  recalled_at?: string | null;
}): void {
  db.prepare(
    `INSERT OR REPLACE INTO messages (id, chat_jid, sender, sender_name, content, timestamp, is_from_me, is_bot_message, edited, edited_at, recalled, recalled_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    msg.id,
    msg.chat_jid,
    msg.sender,
    msg.sender_name,
    msg.content,
    msg.timestamp,
    msg.is_from_me ? 1 : 0,
    msg.is_bot_message ? 1 : 0,
    msg.edited ? 1 : 0,
    msg.edited_at ?? null,
    msg.recalled ? 1 : 0,
    msg.recalled_at ?? null,
  );
}

export interface StoredMessageRecord {
  id: string;
  chat_jid: string;
  sender: string;
  sender_name: string;
  content: string;
  timestamp: string;
  is_from_me: number;
  edited: number;
  edited_at: string | null;
  recalled: number;
  recalled_at: string | null;
}

export function getMessageById(
  chatJid: string,
  messageId: string,
): StoredMessageRecord | undefined {
  return db
    .prepare(
      `
      SELECT id, chat_jid, sender, sender_name, content, timestamp, is_from_me, edited, edited_at, recalled, recalled_at
      FROM messages
      WHERE chat_jid = ? AND id = ?
    `,
    )
    .get(chatJid, messageId) as StoredMessageRecord | undefined;
}

export function editMessage(
  chatJid: string,
  messageId: string,
  content: string,
  editedAt: string,
): boolean {
  const result = db
    .prepare(
      `
      UPDATE messages
      SET content = ?, edited = 1, edited_at = ?
      WHERE chat_jid = ? AND id = ? AND recalled = 0
    `,
    )
    .run(content, editedAt, chatJid, messageId);
  return result.changes > 0;
}

export function recallMessage(
  chatJid: string,
  messageId: string,
  recalledAt: string,
): boolean {
  const result = db
    .prepare(
      `
      UPDATE messages
      SET recalled = 1, recalled_at = ?, content = ''
      WHERE chat_jid = ? AND id = ? AND recalled = 0
    `,
    )
    .run(recalledAt, chatJid, messageId);
  return result.changes > 0;
}

export function getNewMessages(
  jids: string[],
  lastTimestamp: string,
  botPrefix: string,
  limit: number = 200,
): { messages: NewMessage[]; newTimestamp: string } {
  if (jids.length === 0) return { messages: [], newTimestamp: lastTimestamp };

  const placeholders = jids.map(() => '?').join(',');
  // Filter bot messages using both the is_bot_message flag AND the content
  // prefix as a backstop for messages written before the migration ran.
  // Subquery takes the N most recent, outer query re-sorts chronologically.
  const sql = `
    SELECT * FROM (
      SELECT id, chat_jid, sender, sender_name, content, timestamp, is_from_me, edited, edited_at, recalled, recalled_at
      FROM messages
      WHERE timestamp > ? AND chat_jid IN (${placeholders})
        AND is_bot_message = 0 AND content NOT LIKE ?
        AND content != '' AND content IS NOT NULL
      ORDER BY timestamp DESC
      LIMIT ?
    ) ORDER BY timestamp
  `;

  const rows = db
    .prepare(sql)
    .all(lastTimestamp, ...jids, `${botPrefix}:%`, limit) as NewMessage[];

  let newTimestamp = lastTimestamp;
  for (const row of rows) {
    if (row.timestamp > newTimestamp) newTimestamp = row.timestamp;
  }

  return { messages: rows, newTimestamp };
}

export function getMessagesSince(
  chatJid: string,
  sinceTimestamp: string,
  botPrefix: string,
  limit: number = 200,
): NewMessage[] {
  // Filter bot messages using both the is_bot_message flag AND the content
  // prefix as a backstop for messages written before the migration ran.
  // Subquery takes the N most recent, outer query re-sorts chronologically.
  const sql = `
    SELECT * FROM (
      SELECT id, chat_jid, sender, sender_name, content, timestamp, is_from_me, edited, edited_at, recalled, recalled_at
      FROM messages
      WHERE chat_jid = ? AND timestamp > ?
        AND is_bot_message = 0 AND content NOT LIKE ?
        AND content != '' AND content IS NOT NULL
      ORDER BY timestamp DESC
      LIMIT ?
    ) ORDER BY timestamp
  `;
  return db
    .prepare(sql)
    .all(chatJid, sinceTimestamp, `${botPrefix}:%`, limit) as NewMessage[];
}

export interface ChatUnreadState {
  chatJid: string;
  actor: string;
  unreadCount: number;
  lastReadTimestamp: string | null;
  latestMessageTimestamp: string | null;
}

export function getChatUnreadState(
  chatJid: string,
  actor: string,
  botPrefix: string,
): ChatUnreadState {
  const state = db
    .prepare(
      `
      SELECT last_read_timestamp
      FROM unread_state
      WHERE chat_jid = ? AND actor = ?
    `,
    )
    .get(chatJid, actor) as { last_read_timestamp: string } | undefined;

  const lastReadTimestamp = state?.last_read_timestamp || null;
  const latestRow = db
    .prepare(
      `
      SELECT MAX(timestamp) AS latest
      FROM messages
      WHERE chat_jid = ?
        AND is_bot_message = 0 AND content NOT LIKE ?
        AND content != '' AND content IS NOT NULL
    `,
    )
    .get(chatJid, `${botPrefix}:%`) as { latest: string | null };

  const unreadRow = db
    .prepare(
      `
      SELECT COUNT(*) AS total
      FROM messages
      WHERE chat_jid = ?
        AND (? IS NULL OR timestamp > ?)
        AND is_bot_message = 0 AND content NOT LIKE ?
        AND content != '' AND content IS NOT NULL
    `,
    )
    .get(
      chatJid,
      lastReadTimestamp,
      lastReadTimestamp,
      `${botPrefix}:%`,
    ) as { total: number };

  return {
    chatJid,
    actor,
    unreadCount: Number(unreadRow.total || 0),
    lastReadTimestamp,
    latestMessageTimestamp: latestRow.latest || null,
  };
}

export function markChatAsRead(
  chatJid: string,
  actor: string,
  botPrefix: string,
  explicitLastReadTimestamp?: string,
): ChatUnreadState {
  let targetTimestamp = explicitLastReadTimestamp || '';
  if (!targetTimestamp) {
    const latestRow = db
      .prepare(
        `
        SELECT MAX(timestamp) AS latest
        FROM messages
        WHERE chat_jid = ?
          AND is_bot_message = 0 AND content NOT LIKE ?
          AND content != '' AND content IS NOT NULL
      `,
      )
      .get(chatJid, `${botPrefix}:%`) as { latest: string | null };
    targetTimestamp = latestRow.latest || '';
  }
  const nowIso = new Date().toISOString();
  db.prepare(
    `
    INSERT INTO unread_state (chat_jid, actor, last_read_timestamp, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(chat_jid, actor) DO UPDATE SET
      last_read_timestamp = excluded.last_read_timestamp,
      updated_at = excluded.updated_at
  `,
  ).run(chatJid, actor, targetTimestamp, nowIso);
  return getChatUnreadState(chatJid, actor, botPrefix);
}

export function getUnreadAggregate(
  actor: string,
  botPrefix: string,
): {
  actor: string;
  totalUnread: number;
  chats: ChatUnreadState[];
} {
  const chats = db
    .prepare(
      `
      SELECT jid FROM chats
      WHERE jid != '__group_sync__'
      ORDER BY last_message_time DESC
    `,
    )
    .all() as Array<{ jid: string }>;

  const items = chats.map((chat) => getChatUnreadState(chat.jid, actor, botPrefix));
  const totalUnread = items.reduce((acc, item) => acc + item.unreadCount, 0);
  return { actor, totalUnread, chats: items };
}

export interface PresenceState {
  actor: string;
  online: boolean;
  status: 'online' | 'away' | 'offline';
  updatedAt: string;
}

export function setPresenceState(
  actor: string,
  online: boolean,
  status: 'online' | 'away' | 'offline',
): PresenceState {
  const nowIso = new Date().toISOString();
  db.prepare(
    `
    INSERT INTO presence_state (actor, online, status, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(actor) DO UPDATE SET
      online = excluded.online,
      status = excluded.status,
      updated_at = excluded.updated_at
  `,
  ).run(actor, online ? 1 : 0, status, nowIso);
  return { actor, online, status, updatedAt: nowIso };
}

export function getPresenceStates(): PresenceState[] {
  const rows = db
    .prepare(
      `
      SELECT actor, online, status, updated_at
      FROM presence_state
      ORDER BY updated_at DESC
    `,
    )
    .all() as Array<{
    actor: string;
    online: number;
    status: 'online' | 'away' | 'offline';
    updated_at: string;
  }>;
  return rows.map((row) => ({
    actor: row.actor,
    online: row.online === 1,
    status: row.status,
    updatedAt: row.updated_at,
  }));
}

export type GlobalNotificationLevel = 'all' | 'mentions' | 'none';

export interface UserNotificationSettings {
  actor: string;
  globalLevel: GlobalNotificationLevel;
  dndEnabled: boolean;
  dndStart: string | null;
  dndEnd: string | null;
  keywords: string[];
  updatedAt: string;
}

export interface ChatNotificationSettings {
  actor: string;
  chatJid: string;
  muted: boolean;
  allowMentions: boolean;
  updatedAt: string;
}

export function getUserNotificationSettings(actor: string): UserNotificationSettings {
  const row = db
    .prepare(
      `
      SELECT actor, global_level, dnd_enabled, dnd_start, dnd_end, keywords, updated_at
      FROM notification_user_settings
      WHERE actor = ?
    `,
    )
    .get(actor) as
    | {
        actor: string;
        global_level: GlobalNotificationLevel;
        dnd_enabled: number;
        dnd_start: string | null;
        dnd_end: string | null;
        keywords: string;
        updated_at: string;
      }
    | undefined;

  if (!row) {
    return {
      actor,
      globalLevel: 'all',
      dndEnabled: false,
      dndStart: null,
      dndEnd: null,
      keywords: [],
      updatedAt: '',
    };
  }
  let keywords: string[] = [];
  try {
    const parsed = JSON.parse(row.keywords);
    if (Array.isArray(parsed)) {
      keywords = parsed
        .map((value) => String(value).trim())
        .filter((value) => value.length > 0);
    }
  } catch {
    keywords = [];
  }
  return {
    actor: row.actor,
    globalLevel: row.global_level,
    dndEnabled: row.dnd_enabled === 1,
    dndStart: row.dnd_start,
    dndEnd: row.dnd_end,
    keywords,
    updatedAt: row.updated_at,
  };
}

export function setUserNotificationSettings(
  actor: string,
  input: {
    globalLevel: GlobalNotificationLevel;
    dndEnabled: boolean;
    dndStart: string | null;
    dndEnd: string | null;
    keywords: string[];
  },
): UserNotificationSettings {
  const nowIso = new Date().toISOString();
  db.prepare(
    `
    INSERT INTO notification_user_settings (
      actor, global_level, dnd_enabled, dnd_start, dnd_end, keywords, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(actor) DO UPDATE SET
      global_level = excluded.global_level,
      dnd_enabled = excluded.dnd_enabled,
      dnd_start = excluded.dnd_start,
      dnd_end = excluded.dnd_end,
      keywords = excluded.keywords,
      updated_at = excluded.updated_at
  `,
  ).run(
    actor,
    input.globalLevel,
    input.dndEnabled ? 1 : 0,
    input.dndStart,
    input.dndEnd,
    JSON.stringify(input.keywords),
    nowIso,
  );
  return {
    actor,
    globalLevel: input.globalLevel,
    dndEnabled: input.dndEnabled,
    dndStart: input.dndStart,
    dndEnd: input.dndEnd,
    keywords: input.keywords,
    updatedAt: nowIso,
  };
}

export function getChatNotificationSettings(
  actor: string,
  chatJid: string,
): ChatNotificationSettings {
  const row = db
    .prepare(
      `
      SELECT actor, chat_jid, muted, allow_mentions, updated_at
      FROM notification_chat_settings
      WHERE actor = ? AND chat_jid = ?
    `,
    )
    .get(actor, chatJid) as
    | {
        actor: string;
        chat_jid: string;
        muted: number;
        allow_mentions: number;
        updated_at: string;
      }
    | undefined;
  if (!row) {
    return {
      actor,
      chatJid,
      muted: false,
      allowMentions: true,
      updatedAt: '',
    };
  }
  return {
    actor: row.actor,
    chatJid: row.chat_jid,
    muted: row.muted === 1,
    allowMentions: row.allow_mentions === 1,
    updatedAt: row.updated_at,
  };
}

export function setChatNotificationSettings(
  actor: string,
  chatJid: string,
  muted: boolean,
  allowMentions: boolean,
): ChatNotificationSettings {
  const nowIso = new Date().toISOString();
  db.prepare(
    `
    INSERT INTO notification_chat_settings (
      actor, chat_jid, muted, allow_mentions, updated_at
    ) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(actor, chat_jid) DO UPDATE SET
      muted = excluded.muted,
      allow_mentions = excluded.allow_mentions,
      updated_at = excluded.updated_at
  `,
  ).run(actor, chatJid, muted ? 1 : 0, allowMentions ? 1 : 0, nowIso);
  return {
    actor,
    chatJid,
    muted,
    allowMentions,
    updatedAt: nowIso,
  };
}

export function createTask(
  task: Omit<ScheduledTask, 'last_run' | 'last_result'>,
): void {
  db.prepare(
    `
    INSERT INTO scheduled_tasks (id, group_folder, chat_jid, prompt, schedule_type, schedule_value, context_mode, next_run, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    task.id,
    task.group_folder,
    task.chat_jid,
    task.prompt,
    task.schedule_type,
    task.schedule_value,
    task.context_mode || 'isolated',
    task.next_run,
    task.status,
    task.created_at,
  );
}

export function getTaskById(id: string): ScheduledTask | undefined {
  return db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(id) as
    | ScheduledTask
    | undefined;
}

export function getTasksForGroup(groupFolder: string): ScheduledTask[] {
  return db
    .prepare(
      'SELECT * FROM scheduled_tasks WHERE group_folder = ? ORDER BY created_at DESC',
    )
    .all(groupFolder) as ScheduledTask[];
}

export function getAllTasks(): ScheduledTask[] {
  return db
    .prepare('SELECT * FROM scheduled_tasks ORDER BY created_at DESC')
    .all() as ScheduledTask[];
}

export function updateTask(
  id: string,
  updates: Partial<
    Pick<
      ScheduledTask,
      'prompt' | 'schedule_type' | 'schedule_value' | 'next_run' | 'status'
    >
  >,
): void {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.prompt !== undefined) {
    fields.push('prompt = ?');
    values.push(updates.prompt);
  }
  if (updates.schedule_type !== undefined) {
    fields.push('schedule_type = ?');
    values.push(updates.schedule_type);
  }
  if (updates.schedule_value !== undefined) {
    fields.push('schedule_value = ?');
    values.push(updates.schedule_value);
  }
  if (updates.next_run !== undefined) {
    fields.push('next_run = ?');
    values.push(updates.next_run);
  }
  if (updates.status !== undefined) {
    fields.push('status = ?');
    values.push(updates.status);
  }

  if (fields.length === 0) return;

  values.push(id);
  db.prepare(
    `UPDATE scheduled_tasks SET ${fields.join(', ')} WHERE id = ?`,
  ).run(...values);
}

export function deleteTask(id: string): void {
  // Delete child records first (FK constraint)
  db.prepare('DELETE FROM task_run_logs WHERE task_id = ?').run(id);
  db.prepare('DELETE FROM scheduled_tasks WHERE id = ?').run(id);
}

export function getDueTasks(): ScheduledTask[] {
  const now = new Date().toISOString();
  return db
    .prepare(
      `
    SELECT * FROM scheduled_tasks
    WHERE status = 'active' AND next_run IS NOT NULL AND next_run <= ?
    ORDER BY next_run
  `,
    )
    .all(now) as ScheduledTask[];
}

export function updateTaskAfterRun(
  id: string,
  nextRun: string | null,
  lastResult: string,
): void {
  const now = new Date().toISOString();
  db.prepare(
    `
    UPDATE scheduled_tasks
    SET next_run = ?, last_run = ?, last_result = ?, status = CASE WHEN ? IS NULL THEN 'completed' ELSE status END
    WHERE id = ?
  `,
  ).run(nextRun, now, lastResult, nextRun, id);
}

export function logTaskRun(log: TaskRunLog): void {
  db.prepare(
    `
    INSERT INTO task_run_logs (task_id, run_at, duration_ms, status, result, error)
    VALUES (?, ?, ?, ?, ?, ?)
  `,
  ).run(
    log.task_id,
    log.run_at,
    log.duration_ms,
    log.status,
    log.result,
    log.error,
  );
}

// --- Router state accessors ---

export function getRouterState(key: string): string | undefined {
  const row = db
    .prepare('SELECT value FROM router_state WHERE key = ?')
    .get(key) as { value: string } | undefined;
  return row?.value;
}

export function setRouterState(key: string, value: string): void {
  db.prepare(
    'INSERT OR REPLACE INTO router_state (key, value) VALUES (?, ?)',
  ).run(key, value);
}

// --- Session accessors ---

export function getSession(groupFolder: string): string | undefined {
  const row = db
    .prepare('SELECT session_id FROM sessions WHERE group_folder = ?')
    .get(groupFolder) as { session_id: string } | undefined;
  return row?.session_id;
}

export function setSession(groupFolder: string, sessionId: string): void {
  db.prepare(
    'INSERT OR REPLACE INTO sessions (group_folder, session_id) VALUES (?, ?)',
  ).run(groupFolder, sessionId);
}

export function getAllSessions(): Record<string, string> {
  const rows = db
    .prepare('SELECT group_folder, session_id FROM sessions')
    .all() as Array<{ group_folder: string; session_id: string }>;
  const result: Record<string, string> = {};
  for (const row of rows) {
    result[row.group_folder] = row.session_id;
  }
  return result;
}

// --- Registered group accessors ---

export function getRegisteredGroup(
  jid: string,
): (RegisteredGroup & { jid: string }) | undefined {
  const row = db
    .prepare('SELECT * FROM registered_groups WHERE jid = ?')
    .get(jid) as
    | {
        jid: string;
        name: string;
        folder: string;
        trigger_pattern: string;
        added_at: string;
        container_config: string | null;
        requires_trigger: number | null;
        is_main: number | null;
      }
    | undefined;
  if (!row) return undefined;
  if (!isValidGroupFolder(row.folder)) {
    logger.warn(
      { jid: row.jid, folder: row.folder },
      'Skipping registered group with invalid folder',
    );
    return undefined;
  }
  return {
    jid: row.jid,
    name: row.name,
    folder: row.folder,
    trigger: row.trigger_pattern,
    added_at: row.added_at,
    containerConfig: row.container_config
      ? JSON.parse(row.container_config)
      : undefined,
    requiresTrigger:
      row.requires_trigger === null ? undefined : row.requires_trigger === 1,
    isMain: row.is_main === 1 ? true : undefined,
  };
}

export function setRegisteredGroup(jid: string, group: RegisteredGroup): void {
  if (!isValidGroupFolder(group.folder)) {
    throw new Error(`Invalid group folder "${group.folder}" for JID ${jid}`);
  }
  db.prepare(
    `INSERT OR REPLACE INTO registered_groups (jid, name, folder, trigger_pattern, added_at, container_config, requires_trigger, is_main)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    jid,
    group.name,
    group.folder,
    group.trigger,
    group.added_at,
    group.containerConfig ? JSON.stringify(group.containerConfig) : null,
    group.requiresTrigger === undefined ? 1 : group.requiresTrigger ? 1 : 0,
    group.isMain ? 1 : 0,
  );
}

export function getAllRegisteredGroups(): Record<string, RegisteredGroup> {
  const rows = db.prepare('SELECT * FROM registered_groups').all() as Array<{
    jid: string;
    name: string;
    folder: string;
    trigger_pattern: string;
    added_at: string;
    container_config: string | null;
    requires_trigger: number | null;
    is_main: number | null;
  }>;
  const result: Record<string, RegisteredGroup> = {};
  for (const row of rows) {
    if (!isValidGroupFolder(row.folder)) {
      logger.warn(
        { jid: row.jid, folder: row.folder },
        'Skipping registered group with invalid folder',
      );
      continue;
    }
    result[row.jid] = {
      name: row.name,
      folder: row.folder,
      trigger: row.trigger_pattern,
      added_at: row.added_at,
      containerConfig: row.container_config
        ? JSON.parse(row.container_config)
        : undefined,
      requiresTrigger:
        row.requires_trigger === null ? undefined : row.requires_trigger === 1,
      isMain: row.is_main === 1 ? true : undefined,
    };
  }
  return result;
}

// --- JSON migration ---

function migrateJsonState(): void {
  const migrateFile = (filename: string) => {
    const filePath = path.join(DATA_DIR, filename);
    if (!fs.existsSync(filePath)) return null;
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      fs.renameSync(filePath, `${filePath}.migrated`);
      return data;
    } catch {
      return null;
    }
  };

  // Migrate router_state.json
  const routerState = migrateFile('router_state.json') as {
    last_timestamp?: string;
    last_agent_timestamp?: Record<string, string>;
  } | null;
  if (routerState) {
    if (routerState.last_timestamp) {
      setRouterState('last_timestamp', routerState.last_timestamp);
    }
    if (routerState.last_agent_timestamp) {
      setRouterState(
        'last_agent_timestamp',
        JSON.stringify(routerState.last_agent_timestamp),
      );
    }
  }

  // Migrate sessions.json
  const sessions = migrateFile('sessions.json') as Record<
    string,
    string
  > | null;
  if (sessions) {
    for (const [folder, sessionId] of Object.entries(sessions)) {
      setSession(folder, sessionId);
    }
  }

  // Migrate registered_groups.json
  const groups = migrateFile('registered_groups.json') as Record<
    string,
    RegisteredGroup
  > | null;
  if (groups) {
    for (const [jid, group] of Object.entries(groups)) {
      try {
        setRegisteredGroup(jid, group);
      } catch (err) {
        logger.warn(
          { jid, folder: group.folder, err },
          'Skipping migrated registered group with invalid folder',
        );
      }
    }
  }
}
