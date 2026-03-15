import http from 'http';
import { URL } from 'url';

import { ASSISTANT_NAME } from './config.js';
import {
  ChatInfo,
  editMessage,
  getAllChats,
  getAllRegisteredGroups,
  getChatNotificationSettings,
  getChatUnreadState,
  getMessageById,
  getMessagesSince,
  getPresenceStates,
  getUnreadAggregate,
  getUserNotificationSettings,
  markChatAsRead,
  recallMessage,
  setChatNotificationSettings,
  setPresenceState,
  setUserNotificationSettings,
} from './db.js';
import { logger } from './logger.js';

interface SessionNavItem {
  jid: string;
  name: string;
  lastActivity: string;
  channel: string | null;
  type: 'channel' | 'dm';
  isRegistered: boolean;
  groupFolder: string | null;
  requiresTrigger: boolean | null;
  isMain: boolean | null;
}

interface MentionAgent {
  id: string;
  displayName: string;
  online: boolean;
}

type MentionType = 'none' | 'agent' | 'here' | 'everyone';

function toSessionNavItem(
  chat: ChatInfo,
  registered: ReturnType<typeof getAllRegisteredGroups>,
): SessionNavItem {
  const group = registered[chat.jid];
  return {
    jid: chat.jid,
    name: chat.name || chat.jid,
    lastActivity: chat.last_message_time,
    channel: chat.channel || null,
    type: chat.is_group ? 'channel' : 'dm',
    isRegistered: Boolean(group),
    groupFolder: group?.folder || null,
    requiresTrigger:
      group?.requiresTrigger === undefined ? null : Boolean(group.requiresTrigger),
    isMain: group?.isMain === undefined ? null : Boolean(group.isMain),
  };
}

function writeJson(
  res: http.ServerResponse,
  statusCode: number,
  payload: unknown,
): void {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  res.end(body);
}

function writeHtml(
  res: http.ServerResponse,
  statusCode: number,
  html: string,
): void {
  res.writeHead(statusCode, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
}

function parseLimit(rawLimit: string | null): number {
  if (!rawLimit) return 100;
  const parsed = Number.parseInt(rawLimit, 10);
  if (!Number.isFinite(parsed)) return 100;
  return Math.max(1, Math.min(parsed, 500));
}

function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function parseWindowMinutes(
  envName: string,
  fallbackMinutes: number,
): number {
  const raw = process.env[envName];
  if (!raw) return fallbackMinutes;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallbackMinutes;
  return parsed;
}

function isActionExpired(
  timestamp: string,
  windowMinutes: number,
  nowIso: string,
): boolean {
  const sentAt = Date.parse(timestamp);
  const now = Date.parse(nowIso);
  if (!Number.isFinite(sentAt) || !Number.isFinite(now)) return true;
  return now - sentAt > windowMinutes * 60 * 1000;
}

function toMentionAgents(input: unknown): MentionAgent[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((item) => {
      const id =
        typeof item === 'object' && item && 'id' in item
          ? String(item.id)
          : '';
      const displayName =
        typeof item === 'object' && item && 'displayName' in item
          ? String(item.displayName)
          : '';
      const online =
        typeof item === 'object' && item && 'online' in item
          ? Boolean(item.online)
          : false;
      return { id, displayName, online };
    })
    .filter((agent) => agent.id && agent.displayName);
}

function parseActor(raw: string | null): string {
  const actor = String(raw || '').trim();
  return actor || 'default';
}

function parseBooleanLike(input: unknown, fallback: boolean): boolean {
  if (typeof input === 'boolean') return input;
  if (typeof input === 'string') {
    const value = input.trim().toLowerCase();
    if (value === 'true') return true;
    if (value === 'false') return false;
  }
  return fallback;
}

function parseMentionType(input: unknown): MentionType {
  const value = String(input || '').trim().toLowerCase();
  if (value === 'agent' || value === 'here' || value === 'everyone') {
    return value;
  }
  return 'none';
}

function isWithinDnd(nowIso: string, dndStart: string, dndEnd: string): boolean {
  const now = new Date(nowIso);
  if (Number.isNaN(now.getTime())) return false;
  const startMatch = dndStart.match(/^(\d{1,2}):(\d{2})$/);
  const endMatch = dndEnd.match(/^(\d{1,2}):(\d{2})$/);
  if (!startMatch || !endMatch) return false;

  const startMinutes = Number(startMatch[1]) * 60 + Number(startMatch[2]);
  const endMinutes = Number(endMatch[1]) * 60 + Number(endMatch[2]);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  if (startMinutes === endMinutes) return true;
  if (startMinutes < endMinutes) {
    return nowMinutes >= startMinutes && nowMinutes < endMinutes;
  }
  return nowMinutes >= startMinutes || nowMinutes < endMinutes;
}

function evaluateNotification(input: {
  globalLevel: 'all' | 'mentions' | 'none';
  dndEnabled: boolean;
  dndStart: string | null;
  dndEnd: string | null;
  muted: boolean;
  allowMentions: boolean;
  mentionType: MentionType;
  workspaceAllowEveryone: boolean;
  nowIso: string;
}): {
  deliver: boolean;
  deferred: boolean;
  reason: string;
} {
  if (input.globalLevel === 'none') {
    return { deliver: false, deferred: false, reason: 'USER_GLOBAL_OFF' };
  }

  if (input.mentionType === 'everyone' && !input.workspaceAllowEveryone) {
    return { deliver: false, deferred: false, reason: 'EVERYONE_BLOCKED' };
  }

  if (input.muted && input.mentionType === 'none') {
    return { deliver: false, deferred: false, reason: 'CHAT_MUTED' };
  }

  if (input.muted && input.mentionType !== 'none' && !input.allowMentions) {
    return { deliver: false, deferred: false, reason: 'CHAT_MUTED' };
  }

  if (
    input.dndEnabled &&
    input.dndStart &&
    input.dndEnd &&
    isWithinDnd(input.nowIso, input.dndStart, input.dndEnd) &&
    input.mentionType === 'none'
  ) {
    return { deliver: false, deferred: true, reason: 'DND_DEFERRED' };
  }

  if (input.globalLevel === 'mentions' && input.mentionType === 'none') {
    return { deliver: false, deferred: false, reason: 'MENTIONS_ONLY' };
  }

  return { deliver: true, deferred: false, reason: 'DELIVER' };
}

export function startWebuiApiServer(
  port: number,
  host: string = '0.0.0.0',
): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    if (!req.url) {
      writeJson(res, 400, { error: 'Missing request URL' });
      return;
    }

    const method = req.method || 'GET';
    const url = new URL(req.url, 'http://localhost');

    if (method === 'GET' && url.pathname === '/r1-acceptance') {
      writeHtml(
        res,
        200,
        `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>NanoClaw R1 验收页</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; margin: 24px; }
    h1 { margin-bottom: 8px; }
    .layout { display: grid; grid-template-columns: 320px 1fr; gap: 16px; }
    .card { border: 1px solid #ddd; border-radius: 8px; padding: 12px; }
    .row { padding: 8px; border-radius: 6px; cursor: pointer; border: 1px solid transparent; }
    .row:hover { background: #f5f7fb; border-color: #d8e0f0; }
    .meta { color: #666; font-size: 12px; }
    pre { white-space: pre-wrap; word-break: break-word; background: #f8f8f8; padding: 8px; border-radius: 6px; }
    .ok { color: #0a7f2e; }
  </style>
</head>
<body>
  <h1>R1 会话导航验收</h1>
  <div class="meta">点击左侧会话可查看最近消息（调用 /api/nav/sessions 与 /api/nav/sessions/:jid/messages）。</div>
  <div class="layout">
    <div class="card">
      <div id="sessionCount" class="meta">加载中...</div>
      <div id="sessions"></div>
    </div>
    <div class="card">
      <div id="selected" class="meta">未选择会话</div>
      <div id="messages"></div>
    </div>
  </div>
  <script>
    const sessionsEl = document.getElementById('sessions');
    const countEl = document.getElementById('sessionCount');
    const selectedEl = document.getElementById('selected');
    const messagesEl = document.getElementById('messages');

    function esc(v) {
      return String(v).replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
    }

    async function loadSessions() {
      const res = await fetch('/api/nav/sessions');
      const data = await res.json();
      const sessions = data.sessions || [];
      countEl.innerHTML = '<span class="ok">已加载</span> 会话数：' + sessions.length;
      sessionsEl.innerHTML = sessions.map((s) => (
        '<div class="row" data-jid="' + esc(s.jid) + '">' +
          '<div><strong>' + esc(s.name) + '</strong></div>' +
          '<div class="meta">' + esc(s.type) + ' · ' + esc(s.jid) + '</div>' +
          '<div class="meta">lastActivity: ' + esc(s.lastActivity || '') + '</div>' +
        '</div>'
      )).join('');
      for (const node of sessionsEl.querySelectorAll('.row')) {
        node.addEventListener('click', async () => {
          const jid = node.getAttribute('data-jid');
          await loadMessages(jid);
        });
      }
    }

    async function loadMessages(jid) {
      selectedEl.textContent = '当前会话：' + jid;
      const path = '/api/nav/sessions/' + encodeURIComponent(jid) + '/messages?limit=20';
      const res = await fetch(path);
      const data = await res.json();
      const list = data.messages || [];
      messagesEl.innerHTML = list.length === 0
        ? '<div class="meta">暂无消息</div>'
        : list.map((m) => '<pre>[' + esc(m.timestamp) + '] ' + esc(m.sender_name || m.sender || '') + '\\n' + esc(m.content || '') + '</pre>').join('');
    }

    loadSessions().catch((err) => {
      countEl.textContent = '加载失败：' + err.message;
    });
  </script>
</body>
</html>`,
      );
      return;
    }

    if (method === 'GET' && url.pathname === '/r2-acceptance') {
      writeHtml(
        res,
        200,
        `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>NanoClaw R2 验收页</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; margin: 24px; }
    h1 { margin-bottom: 8px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .card { border: 1px solid #ddd; border-radius: 8px; padding: 12px; }
    label { display:block; margin-top: 8px; font-size: 13px; color: #555; }
    input, textarea, button { width: 100%; box-sizing: border-box; margin-top: 6px; }
    textarea { min-height: 72px; }
    button { padding: 8px; margin-top: 10px; cursor: pointer; }
    pre { white-space: pre-wrap; background: #f8f8f8; padding: 8px; border-radius: 6px; }
  </style>
</head>
<body>
  <h1>R2 消息操作与提及规则验收</h1>
  <div class="grid">
    <div class="card">
      <h3>编辑消息</h3>
      <label>chatJid<input id="editChatJid" value="g1@g.us" /></label>
      <label>messageId<input id="editMessageId" value="editable-1" /></label>
      <label>actor<input id="editActor" value="alice" /></label>
      <label>content<textarea id="editContent">hello edited from r2 page</textarea></label>
      <button id="editBtn">提交编辑</button>
      <pre id="editResult"></pre>
    </div>
    <div class="card">
      <h3>撤回消息</h3>
      <label>chatJid<input id="recallChatJid" value="g1@g.us" /></label>
      <label>messageId<input id="recallMessageId" value="editable-1" /></label>
      <label>actor<input id="recallActor" value="alice" /></label>
      <button id="recallBtn">提交撤回</button>
      <pre id="recallResult"></pre>
    </div>
    <div class="card">
      <h3>提及解析</h3>
      <label>text<textarea id="mentionText">@here 请处理告警</textarea></label>
      <button id="mentionBtn">计算提及命中</button>
      <pre id="mentionResult"></pre>
    </div>
    <div class="card">
      <h3>门禁说明</h3>
      <ul>
        <li>消息编辑/撤回默认时限 15 分钟</li>
        <li>撤回超时返回 MESSAGE_RECALL_EXPIRED</li>
        <li>@here 只命中在线 Agent</li>
        <li>空频道 @agent 返回“请先邀请 Agent”</li>
      </ul>
      <div class="meta">接口：/api/messages/* 与 /api/mentions/resolve</div>
    </div>
  </div>
  <script src="/r2-acceptance.js"></script>
</body>
</html>`,
      );
      return;
    }

    if (method === 'GET' && url.pathname === '/r2-acceptance.js') {
      res.writeHead(200, {
        'content-type': 'application/javascript; charset=utf-8',
        'cache-control': 'no-store',
      });
      res.end(`
function safeGet(id) {
  return document.getElementById(id);
}

function showResult(id, value) {
  const el = safeGet(id);
  if (el) {
    el.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  }
}

async function callJson(path, method, body) {
  const res = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function bindR2Acceptance() {
  const editBtn = safeGet('editBtn');
  const recallBtn = safeGet('recallBtn');
  const mentionBtn = safeGet('mentionBtn');
  if (!editBtn || !recallBtn || !mentionBtn) {
    return;
  }

  editBtn.addEventListener('click', async () => {
    try {
      showResult('editResult', '请求中...');
      const chatJid = safeGet('editChatJid').value;
      const messageId = safeGet('editMessageId').value;
      const actor = safeGet('editActor').value;
      const content = safeGet('editContent').value;
      const path = '/api/messages/' + encodeURIComponent(chatJid) + '/' + encodeURIComponent(messageId) + '/edit';
      const result = await callJson(path, 'PATCH', { actor, content });
      showResult('editResult', result);
    } catch (err) {
      showResult('editResult', { error: String(err) });
    }
  });

  recallBtn.addEventListener('click', async () => {
    try {
      showResult('recallResult', '请求中...');
      const chatJid = safeGet('recallChatJid').value;
      const messageId = safeGet('recallMessageId').value;
      const actor = safeGet('recallActor').value;
      const path = '/api/messages/' + encodeURIComponent(chatJid) + '/' + encodeURIComponent(messageId) + '/recall';
      const result = await callJson(path, 'POST', { actor });
      showResult('recallResult', result);
    } catch (err) {
      showResult('recallResult', { error: String(err) });
    }
  });

  mentionBtn.addEventListener('click', async () => {
    try {
      showResult('mentionResult', '请求中...');
      const text = safeGet('mentionText').value;
      const result = await callJson('/api/mentions/resolve', 'POST', {
        chatJid: 'g1@g.us',
        text,
        allowEveryone: true,
        agents: [
          { id: 'a1', displayName: 'AlphaBot', online: true },
          { id: 'a2', displayName: 'BetaBot', online: false }
        ]
      });
      showResult('mentionResult', result);
    } catch (err) {
      showResult('mentionResult', { error: String(err) });
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bindR2Acceptance);
} else {
  bindR2Acceptance();
}
`);
      return;
    }

    if (method === 'GET' && url.pathname === '/r3-acceptance') {
      writeHtml(
        res,
        200,
        `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>NanoClaw R3 验收页</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; margin: 24px; }
    h1 { margin-bottom: 8px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .card { border: 1px solid #ddd; border-radius: 8px; padding: 12px; }
    label { display:block; margin-top: 8px; font-size: 13px; color: #555; }
    input, select, button { width: 100%; box-sizing: border-box; margin-top: 6px; }
    button { padding: 8px; margin-top: 10px; cursor: pointer; }
    pre { white-space: pre-wrap; background: #f8f8f8; padding: 8px; border-radius: 6px; min-height: 72px; }
  </style>
</head>
<body>
  <h1>R3 未读/在线/静音/通知冲突验收</h1>
  <div class="grid">
    <div class="card">
      <h3>未读聚合</h3>
      <label>actor<input id="unreadActor" value="alice" /></label>
      <label>chatJid<input id="unreadChatJid" value="g1@g.us" /></label>
      <button id="unreadFetchBtn">查询未读</button>
      <button id="unreadReadBtn">标记已读</button>
      <pre id="unreadResult"></pre>
    </div>
    <div class="card">
      <h3>在线状态</h3>
      <label>actor<input id="presenceActor" value="alice" /></label>
      <label>status
        <select id="presenceStatus">
          <option value="online">online</option>
          <option value="away">away</option>
          <option value="offline">offline</option>
        </select>
      </label>
      <button id="presenceSetBtn">更新状态</button>
      <button id="presenceListBtn">查询状态列表</button>
      <pre id="presenceResult"></pre>
    </div>
    <div class="card">
      <h3>会话静音与策略</h3>
      <label>actor<input id="notifyActor" value="alice" /></label>
      <label>chatJid<input id="notifyChatJid" value="g1@g.us" /></label>
      <label>globalLevel
        <select id="globalLevel">
          <option value="all">all</option>
          <option value="mentions">mentions</option>
          <option value="none">none</option>
        </select>
      </label>
      <label>DND开始(HH:mm)<input id="dndStart" value="22:00" /></label>
      <label>DND结束(HH:mm)<input id="dndEnd" value="08:00" /></label>
      <button id="notifySaveUserBtn">保存用户策略</button>
      <button id="notifyMuteBtn">切换会话静音</button>
      <pre id="notifyResult"></pre>
    </div>
    <div class="card">
      <h3>冲突优先级评估</h3>
      <label>mentionType
        <select id="mentionType">
          <option value="none">none</option>
          <option value="agent">agent</option>
          <option value="here">here</option>
          <option value="everyone">everyone</option>
        </select>
      </label>
      <label>workspaceAllowEveryone
        <select id="allowEveryone">
          <option value="false">false</option>
          <option value="true">true</option>
        </select>
      </label>
      <button id="notifyEvalBtn">评估通知结果</button>
      <pre id="notifyEvalResult"></pre>
    </div>
  </div>
  <script src="/r3-acceptance.js"></script>
</body>
</html>`,
      );
      return;
    }

    if (method === 'GET' && url.pathname === '/r3-acceptance.js') {
      res.writeHead(200, {
        'content-type': 'application/javascript; charset=utf-8',
        'cache-control': 'no-store',
      });
      res.end(`
function safeGet(id) {
  return document.getElementById(id);
}

function safeValue(id) {
  const el = safeGet(id);
  return el ? el.value : '';
}

function showResult(id, value) {
  const el = safeGet(id);
  if (el) {
    el.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  }
}

async function callJson(path, method, body) {
  const res = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function bindR3Acceptance() {
  const unreadFetchBtn = safeGet('unreadFetchBtn');
  const unreadReadBtn = safeGet('unreadReadBtn');
  const presenceSetBtn = safeGet('presenceSetBtn');
  const presenceListBtn = safeGet('presenceListBtn');
  const notifySaveUserBtn = safeGet('notifySaveUserBtn');
  const notifyMuteBtn = safeGet('notifyMuteBtn');
  const notifyEvalBtn = safeGet('notifyEvalBtn');
  if (!unreadFetchBtn || !unreadReadBtn || !presenceSetBtn || !presenceListBtn || !notifySaveUserBtn || !notifyMuteBtn || !notifyEvalBtn) {
    return;
  }

  unreadFetchBtn.addEventListener('click', async () => {
    try {
      const actor = safeValue('unreadActor');
      const chatJid = safeValue('unreadChatJid');
      showResult('unreadResult', '请求中...');
      const result = await callJson('/api/unread/' + encodeURIComponent(chatJid) + '?actor=' + encodeURIComponent(actor), 'GET');
      showResult('unreadResult', result);
    } catch (err) {
      showResult('unreadResult', { error: String(err) });
    }
  });

  unreadReadBtn.addEventListener('click', async () => {
    try {
      const actor = safeValue('unreadActor');
      const chatJid = safeValue('unreadChatJid');
      showResult('unreadResult', '请求中...');
      const result = await callJson('/api/unread/' + encodeURIComponent(chatJid) + '/read', 'POST', { actor });
      showResult('unreadResult', result);
    } catch (err) {
      showResult('unreadResult', { error: String(err) });
    }
  });

  presenceSetBtn.addEventListener('click', async () => {
    try {
      const actor = safeValue('presenceActor');
      const status = safeValue('presenceStatus');
      showResult('presenceResult', '请求中...');
      const result = await callJson('/api/presence/' + encodeURIComponent(actor), 'PUT', { status, online: status !== 'offline' });
      showResult('presenceResult', result);
    } catch (err) {
      showResult('presenceResult', { error: String(err) });
    }
  });

  presenceListBtn.addEventListener('click', async () => {
    try {
      showResult('presenceResult', '请求中...');
      const result = await callJson('/api/presence', 'GET');
      showResult('presenceResult', result);
    } catch (err) {
      showResult('presenceResult', { error: String(err) });
    }
  });

  notifySaveUserBtn.addEventListener('click', async () => {
    try {
      const actor = safeValue('notifyActor');
      const globalLevel = safeValue('globalLevel');
      const dndStart = safeValue('dndStart');
      const dndEnd = safeValue('dndEnd');
      showResult('notifyResult', '请求中...');
      const result = await callJson('/api/notifications/users/' + encodeURIComponent(actor) + '/settings', 'PUT', {
        globalLevel,
        dndEnabled: true,
        dndStart,
        dndEnd,
      });
      showResult('notifyResult', result);
    } catch (err) {
      showResult('notifyResult', { error: String(err) });
    }
  });

  notifyMuteBtn.addEventListener('click', async () => {
    try {
      const actor = safeValue('notifyActor');
      const chatJid = safeValue('notifyChatJid');
      showResult('notifyResult', '请求中...');
      const current = await callJson('/api/notifications/chats/' + encodeURIComponent(chatJid) + '/settings?actor=' + encodeURIComponent(actor), 'GET');
      const muted = !(current.data && current.data.settings && current.data.settings.muted);
      const result = await callJson('/api/notifications/chats/' + encodeURIComponent(chatJid) + '/settings', 'PUT', {
        actor,
        muted,
        allowMentions: true,
      });
      showResult('notifyResult', result);
    } catch (err) {
      showResult('notifyResult', { error: String(err) });
    }
  });

  notifyEvalBtn.addEventListener('click', async () => {
    try {
      const actor = safeValue('notifyActor');
      const chatJid = safeValue('notifyChatJid');
      const mentionType = safeValue('mentionType');
      const workspaceAllowEveryone = safeValue('allowEveryone') === 'true';
      showResult('notifyEvalResult', '请求中...');
      const result = await callJson('/api/notifications/evaluate', 'POST', {
        actor,
        chatJid,
        mentionType,
        workspaceAllowEveryone,
      });
      showResult('notifyEvalResult', result);
    } catch (err) {
      showResult('notifyEvalResult', { error: String(err) });
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bindR3Acceptance);
} else {
  bindR3Acceptance();
}
`);
      return;
    }

    if (method === 'GET' && url.pathname === '/api/nav/sessions') {
      const chats = getAllChats().filter((chat) => chat.jid !== '__group_sync__');
      const registered = getAllRegisteredGroups();
      const sessions = chats.map((chat) => toSessionNavItem(chat, registered));
      writeJson(res, 200, { sessions });
      return;
    }

    if (method === 'GET' && url.pathname.startsWith('/api/nav/sessions/')) {
      const match = url.pathname.match(/^\/api\/nav\/sessions\/([^/]+)\/messages$/);
      if (!match) {
        writeJson(res, 404, { error: 'Not Found' });
        return;
      }

      const chatJid = decodeURIComponent(match[1]);
      const since = url.searchParams.get('since') || '';
      const limit = parseLimit(url.searchParams.get('limit'));
      const messages = getMessagesSince(chatJid, since, ASSISTANT_NAME, limit);
      writeJson(res, 200, { chatJid, since, limit, messages });
      return;
    }

    if (method === 'GET' && url.pathname === '/api/unread/aggregate') {
      const actor = parseActor(url.searchParams.get('actor'));
      writeJson(res, 200, getUnreadAggregate(actor, ASSISTANT_NAME));
      return;
    }

    if (method === 'GET' && url.pathname.startsWith('/api/unread/')) {
      const match = url.pathname.match(/^\/api\/unread\/([^/]+)$/);
      if (match) {
        const chatJid = decodeURIComponent(match[1]);
        const actor = parseActor(url.searchParams.get('actor'));
        writeJson(res, 200, {
          state: getChatUnreadState(chatJid, actor, ASSISTANT_NAME),
        });
        return;
      }
    }

    if (method === 'POST' && url.pathname.startsWith('/api/unread/')) {
      const match = url.pathname.match(/^\/api\/unread\/([^/]+)\/read$/);
      if (match) {
        const chatJid = decodeURIComponent(match[1]);
        readJsonBody(req)
          .then((body) => {
            const payload =
              body && typeof body === 'object'
                ? (body as Record<string, unknown>)
                : {};
            const actor = parseActor(String(payload.actor || ''));
            const lastReadTimestamp =
              payload.lastReadTimestamp === undefined ||
              payload.lastReadTimestamp === null
                ? undefined
                : String(payload.lastReadTimestamp);
            const state = markChatAsRead(
              chatJid,
              actor,
              ASSISTANT_NAME,
              lastReadTimestamp,
            );
            writeJson(res, 200, { state });
          })
          .catch((err) => {
            logger.warn({ err }, 'Invalid unread mark payload');
            writeJson(res, 400, { code: 'INVALID_REQUEST' });
          });
        return;
      }
    }

    if (method === 'GET' && url.pathname === '/api/presence') {
      writeJson(res, 200, { states: getPresenceStates() });
      return;
    }

    if (method === 'PUT' && url.pathname.startsWith('/api/presence/')) {
      const match = url.pathname.match(/^\/api\/presence\/([^/]+)$/);
      if (match) {
        const actor = decodeURIComponent(match[1]).trim();
        if (!actor) {
          writeJson(res, 400, { code: 'INVALID_ACTOR' });
          return;
        }
        readJsonBody(req)
          .then((body) => {
            const payload =
              body && typeof body === 'object'
                ? (body as Record<string, unknown>)
                : {};
            const statusValue = String(payload.status || '')
              .trim()
              .toLowerCase();
            const status =
              statusValue === 'online' ||
              statusValue === 'away' ||
              statusValue === 'offline'
                ? statusValue
                : 'offline';
            const online = parseBooleanLike(payload.online, status !== 'offline');
            const state = setPresenceState(actor, online, status);
            writeJson(res, 200, { state });
          })
          .catch((err) => {
            logger.warn({ err }, 'Invalid presence payload');
            writeJson(res, 400, { code: 'INVALID_REQUEST' });
          });
        return;
      }
    }

    if (
      method === 'GET' &&
      url.pathname.startsWith('/api/notifications/chats/') &&
      url.pathname.endsWith('/settings')
    ) {
      const match = url.pathname.match(
        /^\/api\/notifications\/chats\/([^/]+)\/settings$/,
      );
      if (match) {
        const chatJid = decodeURIComponent(match[1]);
        const actor = parseActor(url.searchParams.get('actor'));
        writeJson(res, 200, {
          settings: getChatNotificationSettings(actor, chatJid),
        });
        return;
      }
    }

    if (
      method === 'PUT' &&
      url.pathname.startsWith('/api/notifications/users/') &&
      url.pathname.endsWith('/settings')
    ) {
      const match = url.pathname.match(
        /^\/api\/notifications\/users\/([^/]+)\/settings$/,
      );
      if (match) {
        const actor = decodeURIComponent(match[1]).trim();
        if (!actor) {
          writeJson(res, 400, { code: 'INVALID_ACTOR' });
          return;
        }
        readJsonBody(req)
          .then((body) => {
            const payload =
              body && typeof body === 'object'
                ? (body as Record<string, unknown>)
                : {};
            const globalRaw = String(payload.globalLevel || 'all')
              .trim()
              .toLowerCase();
            const globalLevel =
              globalRaw === 'all' || globalRaw === 'mentions' || globalRaw === 'none'
                ? globalRaw
                : 'all';
            const dndEnabled = parseBooleanLike(payload.dndEnabled, false);
            const dndStart =
              payload.dndStart === undefined || payload.dndStart === null
                ? null
                : String(payload.dndStart).trim();
            const dndEnd =
              payload.dndEnd === undefined || payload.dndEnd === null
                ? null
                : String(payload.dndEnd).trim();
            const keywords = Array.isArray(payload.keywords)
              ? payload.keywords
                  .map((value) => String(value).trim())
                  .filter((value) => value.length > 0)
              : [];
            const settings = setUserNotificationSettings(actor, {
              globalLevel,
              dndEnabled,
              dndStart,
              dndEnd,
              keywords,
            });
            writeJson(res, 200, { settings });
          })
          .catch((err) => {
            logger.warn({ err }, 'Invalid user notification payload');
            writeJson(res, 400, { code: 'INVALID_REQUEST' });
          });
        return;
      }
    }

    if (
      method === 'PUT' &&
      url.pathname.startsWith('/api/notifications/chats/') &&
      url.pathname.endsWith('/settings')
    ) {
      const match = url.pathname.match(
        /^\/api\/notifications\/chats\/([^/]+)\/settings$/,
      );
      if (match) {
        const chatJid = decodeURIComponent(match[1]);
        readJsonBody(req)
          .then((body) => {
            const payload =
              body && typeof body === 'object'
                ? (body as Record<string, unknown>)
                : {};
            const actor = parseActor(String(payload.actor || ''));
            const muted = parseBooleanLike(payload.muted, false);
            const allowMentions = parseBooleanLike(payload.allowMentions, true);
            const settings = setChatNotificationSettings(
              actor,
              chatJid,
              muted,
              allowMentions,
            );
            writeJson(res, 200, { settings });
          })
          .catch((err) => {
            logger.warn({ err }, 'Invalid chat notification payload');
            writeJson(res, 400, { code: 'INVALID_REQUEST' });
          });
        return;
      }
    }

    if (method === 'POST' && url.pathname === '/api/notifications/evaluate') {
      readJsonBody(req)
        .then((body) => {
          const payload =
            body && typeof body === 'object'
              ? (body as Record<string, unknown>)
              : {};
          const actor = parseActor(String(payload.actor || ''));
          const chatJid = String(payload.chatJid || '').trim();
          if (!chatJid) {
            writeJson(res, 400, { code: 'INVALID_CHAT_JID' });
            return;
          }
          const mentionType = parseMentionType(payload.mentionType);
          const workspaceAllowEveryone = parseBooleanLike(
            payload.workspaceAllowEveryone,
            false,
          );
          const nowIso = payload.now ? String(payload.now) : new Date().toISOString();

          const userSettings = getUserNotificationSettings(actor);
          const chatSettings = getChatNotificationSettings(actor, chatJid);
          const decision = evaluateNotification({
            globalLevel: userSettings.globalLevel,
            dndEnabled: userSettings.dndEnabled,
            dndStart: userSettings.dndStart,
            dndEnd: userSettings.dndEnd,
            muted: chatSettings.muted,
            allowMentions: chatSettings.allowMentions,
            mentionType,
            workspaceAllowEveryone,
            nowIso,
          });
          writeJson(res, 200, {
            actor,
            chatJid,
            mentionType,
            decision,
            userSettings,
            chatSettings,
          });
        })
        .catch((err) => {
          logger.warn({ err }, 'Invalid notification evaluate payload');
          writeJson(res, 400, { code: 'INVALID_REQUEST' });
        });
      return;
    }

    if (method === 'PATCH' && url.pathname.startsWith('/api/messages/')) {
      const match = url.pathname.match(/^\/api\/messages\/([^/]+)\/([^/]+)\/edit$/);
      if (!match) {
        writeJson(res, 404, { error: 'Not Found' });
        return;
      }

      const chatJid = decodeURIComponent(match[1]);
      const messageId = decodeURIComponent(match[2]);
      readJsonBody(req)
        .then((body) => {
          const payload =
            body && typeof body === 'object'
              ? (body as Record<string, unknown>)
              : {};
          const content = String(payload.content || '').trim();
          const actor = String(payload.actor || '').trim();
          if (!content) {
            writeJson(res, 400, { code: 'INVALID_CONTENT' });
            return;
          }
          const current = getMessageById(chatJid, messageId);
          if (!current) {
            writeJson(res, 404, { code: 'MESSAGE_NOT_FOUND' });
            return;
          }
          if (current.recalled === 1) {
            writeJson(res, 409, { code: 'MESSAGE_ALREADY_RECALLED' });
            return;
          }
          const nowIso = new Date().toISOString();
          const editWindowMinutes = parseWindowMinutes(
            'MESSAGE_EDIT_WINDOW_MINUTES',
            15,
          );
          if (isActionExpired(current.timestamp, editWindowMinutes, nowIso)) {
            writeJson(res, 409, { code: 'MESSAGE_EDIT_EXPIRED' });
            return;
          }
          const canEdit =
            current.is_from_me === 1 || !actor || actor === current.sender;
          if (!canEdit) {
            writeJson(res, 403, { code: 'MESSAGE_EDIT_FORBIDDEN' });
            return;
          }
          const changed = editMessage(chatJid, messageId, content, nowIso);
          if (!changed) {
            writeJson(res, 409, { code: 'MESSAGE_EDIT_CONFLICT' });
            return;
          }
          writeJson(res, 200, {
            chatJid,
            messageId,
            edited: true,
            editedAt: nowIso,
          });
        })
        .catch((err) => {
          logger.warn({ err }, 'Invalid edit message payload');
          writeJson(res, 400, { code: 'INVALID_REQUEST' });
        });
      return;
    }

    if (method === 'POST' && url.pathname.startsWith('/api/messages/')) {
      const match = url.pathname.match(
        /^\/api\/messages\/([^/]+)\/([^/]+)\/recall$/,
      );
      if (!match) {
        writeJson(res, 404, { error: 'Not Found' });
        return;
      }

      const chatJid = decodeURIComponent(match[1]);
      const messageId = decodeURIComponent(match[2]);
      readJsonBody(req)
        .then((body) => {
          const payload =
            body && typeof body === 'object'
              ? (body as Record<string, unknown>)
              : {};
          const actor = String(payload.actor || '').trim();
          const current = getMessageById(chatJid, messageId);
          if (!current) {
            writeJson(res, 404, { code: 'MESSAGE_NOT_FOUND' });
            return;
          }
          if (current.recalled === 1) {
            writeJson(res, 409, { code: 'MESSAGE_ALREADY_RECALLED' });
            return;
          }
          const nowIso = new Date().toISOString();
          const recallWindowMinutes = parseWindowMinutes(
            'MESSAGE_RECALL_WINDOW_MINUTES',
            15,
          );
          if (isActionExpired(current.timestamp, recallWindowMinutes, nowIso)) {
            writeJson(res, 409, { code: 'MESSAGE_RECALL_EXPIRED' });
            return;
          }
          const canRecall =
            current.is_from_me === 1 || !actor || actor === current.sender;
          if (!canRecall) {
            writeJson(res, 403, { code: 'MESSAGE_RECALL_FORBIDDEN' });
            return;
          }
          const changed = recallMessage(chatJid, messageId, nowIso);
          if (!changed) {
            writeJson(res, 409, { code: 'MESSAGE_RECALL_CONFLICT' });
            return;
          }
          writeJson(res, 200, {
            chatJid,
            messageId,
            recalled: true,
            recalledAt: nowIso,
          });
        })
        .catch((err) => {
          logger.warn({ err }, 'Invalid recall message payload');
          writeJson(res, 400, { code: 'INVALID_REQUEST' });
        });
      return;
    }

    if (method === 'POST' && url.pathname === '/api/mentions/resolve') {
      readJsonBody(req)
        .then((body) => {
          const payload =
            body && typeof body === 'object'
              ? (body as Record<string, unknown>)
              : {};
          const text = String(payload.text || '');
          const chatJid = String(payload.chatJid || '');
          const allowEveryone = Boolean(payload.allowEveryone);
          const agents = toMentionAgents(payload.agents);
          const warnings: string[] = [];

          const mentionAgent = /\B@agent\b/i.test(text);
          const mentionHere = /\B@here\b/i.test(text);
          const mentionEveryone = /\B@everyone\b/i.test(text);

          const targetedAgentIds = new Set<string>();
          const onlineAgentIds = new Set<string>();

          for (const agent of agents) {
            if (
              text.toLowerCase().includes(`@${agent.displayName.toLowerCase()}`)
            ) {
              targetedAgentIds.add(agent.id);
              if (agent.online) {
                onlineAgentIds.add(agent.id);
              }
            }
          }

          if (mentionAgent) {
            if (agents.length === 0) {
              warnings.push('请先邀请 Agent');
            } else {
              for (const agent of agents) {
                targetedAgentIds.add(agent.id);
                if (agent.online) {
                  onlineAgentIds.add(agent.id);
                }
              }
            }
          }

          if (mentionHere) {
            for (const agent of agents) {
              if (agent.online) {
                targetedAgentIds.add(agent.id);
                onlineAgentIds.add(agent.id);
              }
            }
          }

          if (mentionEveryone) {
            if (!allowEveryone) {
              warnings.push('@everyone is blocked by policy');
            } else {
              for (const agent of agents) {
                targetedAgentIds.add(agent.id);
                if (agent.online) {
                  onlineAgentIds.add(agent.id);
                }
              }
            }
          }

          if (agents.length === 0 && text.includes('@') && warnings.length === 0) {
            warnings.push('请先邀请 Agent');
          }

          writeJson(res, 200, {
            chatJid,
            mentions: {
              agentIds: Array.from(targetedAgentIds),
              onlineAgentIds: Array.from(onlineAgentIds),
              hereTriggered: mentionHere,
              everyoneTriggered: mentionEveryone && allowEveryone,
            },
            suggestionsEnabled: agents.length > 0,
            warnings,
          });
        })
        .catch((err) => {
          logger.warn({ err }, 'Invalid mention payload');
          writeJson(res, 400, { code: 'INVALID_REQUEST' });
        });
      return;
    }

    writeJson(res, 404, { error: 'Not Found' });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.removeListener('error', reject);
      logger.info({ host, port }, 'WebUI API server started');
      resolve(server);
    });
  });
}
