import http from 'http';
import type { AddressInfo } from 'net';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() },
}));

import {
  _initTestDatabase,
  setRegisteredGroup,
  storeChatMetadata,
  storeMessageDirect,
} from './db.js';
import { startWebuiApiServer } from './webui-api.js';

function makeRequest(
  port: number,
  path: string,
  options?: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
  },
): Promise<{ statusCode: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const method = options?.method || 'GET';
    const bodyText =
      options?.body === undefined ? '' : JSON.stringify(options.body);
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          ...(options?.headers || {}),
          ...(bodyText
            ? {
                'content-type': 'application/json',
                'content-length': String(Buffer.byteLength(bodyText)),
              }
            : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString();
          resolve({
            statusCode: res.statusCode || 0,
            body: text ? JSON.parse(text) : {},
          });
        });
      },
    );
    req.on('error', reject);
    if (bodyText) {
      req.write(bodyText);
    }
    req.end();
  });
}

function makeTextRequest(
  port: number,
  path: string,
): Promise<{ statusCode: number; body: string; contentType: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'GET',
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode || 0,
            body: Buffer.concat(chunks).toString(),
            contentType: String(res.headers['content-type'] || ''),
          });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

describe('webui-api', () => {
  let server: http.Server;
  let port: number;

  beforeEach(async () => {
    _initTestDatabase();
    storeChatMetadata(
      'g1@g.us',
      '2026-03-15T10:00:00.000Z',
      'Alpha Group',
      'whatsapp',
      true,
    );
    storeChatMetadata(
      'u1@s.whatsapp.net',
      '2026-03-15T11:00:00.000Z',
      'Alice',
      'whatsapp',
      false,
    );
    setRegisteredGroup('g1@g.us', {
      name: 'Alpha Group',
      folder: 'alpha-group',
      trigger: '@Andy',
      added_at: '2026-03-15T10:00:00.000Z',
      requiresTrigger: true,
      isMain: true,
    });
    storeMessageDirect({
      id: 'm1',
      chat_jid: 'g1@g.us',
      sender: 'alice',
      sender_name: 'Alice',
      content: 'hello',
      timestamp: '2026-03-15T10:01:00.000Z',
      is_from_me: false,
    });
    storeMessageDirect({
      id: 'm2',
      chat_jid: 'g1@g.us',
      sender: 'bob',
      sender_name: 'Bob',
      content: 'world',
      timestamp: '2026-03-15T10:02:00.000Z',
      is_from_me: false,
    });

    server = await startWebuiApiServer(0, '127.0.0.1');
    port = (server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it('returns sessions for sidebar partitions', async () => {
    const res = await makeRequest(port, '/api/nav/sessions');
    expect(res.statusCode).toBe(200);
    const body = res.body as { sessions: Array<Record<string, unknown>> };
    expect(body.sessions).toHaveLength(2);
    expect(body.sessions[0].jid).toBe('u1@s.whatsapp.net');
    expect(body.sessions[0].type).toBe('dm');
    expect(body.sessions[1].jid).toBe('g1@g.us');
    expect(body.sessions[1].type).toBe('channel');
    expect(body.sessions[1].isRegistered).toBe(true);
    expect(body.sessions[1].groupFolder).toBe('alpha-group');
  });

  it('returns messages with limit and since filters', async () => {
    const encodedJid = encodeURIComponent('g1@g.us');
    const res = await makeRequest(
      port,
      `/api/nav/sessions/${encodedJid}/messages?since=2026-03-15T10:00:30.000Z&limit=1`,
    );
    expect(res.statusCode).toBe(200);
    const body = res.body as {
      messages: Array<{ id: string; timestamp: string }>;
      limit: number;
    };
    expect(body.limit).toBe(1);
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].id).toBe('m2');
  });

  it('returns 404 on unknown route', async () => {
    const res = await makeRequest(port, '/api/nav/unknown');
    expect(res.statusCode).toBe(404);
  });

  it('returns visual acceptance page', async () => {
    const res = await makeTextRequest(port, '/r1-acceptance');
    expect(res.statusCode).toBe(200);
    expect(res.contentType).toContain('text/html');
    expect(res.body).toContain('R1 会话导航验收');
    expect(res.body).toContain('/api/nav/sessions');
  });

  it('returns r2 acceptance page', async () => {
    const res = await makeTextRequest(port, '/r2-acceptance');
    expect(res.statusCode).toBe(200);
    expect(res.contentType).toContain('text/html');
    expect(res.body).toContain('R2 消息操作与提及规则验收');
    expect(res.body).toContain('/r2-acceptance.js');
  });

  it('returns r2 acceptance script', async () => {
    const res = await makeTextRequest(port, '/r2-acceptance.js');
    expect(res.statusCode).toBe(200);
    expect(res.contentType).toContain('application/javascript');
    expect(res.body).toContain('bindR2Acceptance');
    expect(res.body).toContain('/api/mentions/resolve');
  });

  it('edits message within window', async () => {
    const now = new Date().toISOString();
    storeMessageDirect({
      id: 'editable-1',
      chat_jid: 'g1@g.us',
      sender: 'alice',
      sender_name: 'Alice',
      content: 'hello',
      timestamp: now,
      is_from_me: false,
    });
    const chatJid = encodeURIComponent('g1@g.us');
    const messageId = encodeURIComponent('editable-1');
    const res = await makeRequest(
      port,
      `/api/messages/${chatJid}/${messageId}/edit`,
      {
        method: 'PATCH',
        body: { content: 'hello edited', actor: 'alice' },
      },
    );
    expect(res.statusCode).toBe(200);
    const body = res.body as { edited: boolean };
    expect(body.edited).toBe(true);

    const latest = await makeRequest(
      port,
      `/api/nav/sessions/${chatJid}/messages?since=2026-03-15T09:00:00.000Z&limit=10`,
    );
    const latestBody = latest.body as {
      messages: Array<{
        id: string;
        content: string;
        edited: number;
      }>;
    };
    const edited = latestBody.messages.find((m) => m.id === 'editable-1');
    expect(edited?.content).toBe('hello edited');
    expect(edited?.edited).toBe(1);
  });

  it('returns MESSAGE_RECALL_EXPIRED after recall window', async () => {
    storeMessageDirect({
      id: 'expired-1',
      chat_jid: 'g1@g.us',
      sender: 'alice',
      sender_name: 'Alice',
      content: 'old message',
      timestamp: '2026-03-10T10:02:00.000Z',
      is_from_me: false,
    });
    const chatJid = encodeURIComponent('g1@g.us');
    const messageId = encodeURIComponent('expired-1');
    const res = await makeRequest(
      port,
      `/api/messages/${chatJid}/${messageId}/recall`,
      {
        method: 'POST',
        body: { actor: 'alice' },
      },
    );
    expect(res.statusCode).toBe(409);
    const body = res.body as { code: string };
    expect(body.code).toBe('MESSAGE_RECALL_EXPIRED');
  });

  it('disables @agent suggestions when channel has no agents', async () => {
    const res = await makeRequest(port, '/api/mentions/resolve', {
      method: 'POST',
      body: { chatJid: 'g1@g.us', text: '@agent 请帮忙', agents: [] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.body as {
      suggestionsEnabled: boolean;
      warnings: string[];
    };
    expect(body.suggestionsEnabled).toBe(false);
    expect(body.warnings).toContain('请先邀请 Agent');
  });

  it('@here resolves online agents only', async () => {
    const res = await makeRequest(port, '/api/mentions/resolve', {
      method: 'POST',
      body: {
        chatJid: 'g1@g.us',
        text: '紧急 @here',
        agents: [
          { id: 'a1', displayName: 'AlphaBot', online: true },
          { id: 'a2', displayName: 'BetaBot', online: true },
          { id: 'a3', displayName: 'GammaBot', online: false },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.body as {
      mentions: { agentIds: string[]; onlineAgentIds: string[] };
    };
    expect(body.mentions.onlineAgentIds).toEqual(['a1', 'a2']);
    expect(body.mentions.agentIds).toEqual(['a1', 'a2']);
  });

  it('returns r3 acceptance page and script', async () => {
    const page = await makeTextRequest(port, '/r3-acceptance');
    expect(page.statusCode).toBe(200);
    expect(page.contentType).toContain('text/html');
    expect(page.body).toContain('R3 未读/在线/静音/通知冲突验收');
    expect(page.body).toContain('/r3-acceptance.js');

    const script = await makeTextRequest(port, '/r3-acceptance.js');
    expect(script.statusCode).toBe(200);
    expect(script.contentType).toContain('application/javascript');
    expect(script.body).toContain('bindR3Acceptance');
    expect(script.body).toContain('/api/notifications/evaluate');
  });

  it('tracks unread and supports mark-as-read', async () => {
    const chatJid = encodeURIComponent('g1@g.us');
    const before = await makeRequest(port, `/api/unread/${chatJid}?actor=alice`);
    expect(before.statusCode).toBe(200);
    const beforeBody = before.body as {
      state: { unreadCount: number; lastReadTimestamp: string | null };
    };
    expect(beforeBody.state.unreadCount).toBe(2);
    expect(beforeBody.state.lastReadTimestamp).toBeNull();

    const marked = await makeRequest(port, `/api/unread/${chatJid}/read`, {
      method: 'POST',
      body: { actor: 'alice' },
    });
    expect(marked.statusCode).toBe(200);
    const markedBody = marked.body as { state: { unreadCount: number } };
    expect(markedBody.state.unreadCount).toBe(0);

    storeMessageDirect({
      id: 'm3',
      chat_jid: 'g1@g.us',
      sender: 'carol',
      sender_name: 'Carol',
      content: 'after read',
      timestamp: '2026-03-15T10:03:00.000Z',
      is_from_me: false,
    });
    const after = await makeRequest(port, `/api/unread/${chatJid}?actor=alice`);
    const afterBody = after.body as { state: { unreadCount: number } };
    expect(afterBody.state.unreadCount).toBe(1);
  });

  it('updates presence state', async () => {
    const updated = await makeRequest(port, '/api/presence/alice', {
      method: 'PUT',
      body: { online: true, status: 'online' },
    });
    expect(updated.statusCode).toBe(200);

    const listed = await makeRequest(port, '/api/presence');
    expect(listed.statusCode).toBe(200);
    const listBody = listed.body as {
      states: Array<{ actor: string; online: boolean; status: string }>;
    };
    expect(listBody.states[0].actor).toBe('alice');
    expect(listBody.states[0].online).toBe(true);
    expect(listBody.states[0].status).toBe('online');
  });

  it('evaluates notification priority chain', async () => {
    const userSettings = await makeRequest(
      port,
      '/api/notifications/users/alice/settings',
      {
        method: 'PUT',
        body: {
          globalLevel: 'all',
          dndEnabled: true,
          dndStart: '22:00',
          dndEnd: '08:00',
        },
      },
    );
    expect(userSettings.statusCode).toBe(200);

    const muted = await makeRequest(
      port,
      `/api/notifications/chats/${encodeURIComponent('g1@g.us')}/settings`,
      {
        method: 'PUT',
        body: { actor: 'alice', muted: true, allowMentions: true },
      },
    );
    expect(muted.statusCode).toBe(200);

    const normal = await makeRequest(port, '/api/notifications/evaluate', {
      method: 'POST',
      body: {
        actor: 'alice',
        chatJid: 'g1@g.us',
        mentionType: 'none',
        now: '2026-03-15T23:00:00.000Z',
      },
    });
    expect(normal.statusCode).toBe(200);
    const normalBody = normal.body as {
      decision: { deliver: boolean; reason: string };
    };
    expect(normalBody.decision.deliver).toBe(false);
    expect(normalBody.decision.reason).toBe('CHAT_MUTED');

    const hereMention = await makeRequest(port, '/api/notifications/evaluate', {
      method: 'POST',
      body: {
        actor: 'alice',
        chatJid: 'g1@g.us',
        mentionType: 'here',
        now: '2026-03-15T23:00:00.000Z',
      },
    });
    expect(hereMention.statusCode).toBe(200);
    const mentionBody = hereMention.body as {
      decision: { deliver: boolean; reason: string };
    };
    expect(mentionBody.decision.deliver).toBe(true);
    expect(mentionBody.decision.reason).toBe('DELIVER');

    await makeRequest(port, '/api/notifications/users/alice/settings', {
      method: 'PUT',
      body: { globalLevel: 'none', dndEnabled: false },
    });
    const overridden = await makeRequest(port, '/api/notifications/evaluate', {
      method: 'POST',
      body: {
        actor: 'alice',
        chatJid: 'g1@g.us',
        mentionType: 'here',
      },
    });
    const overriddenBody = overridden.body as {
      decision: { deliver: boolean; reason: string };
    };
    expect(overriddenBody.decision.deliver).toBe(false);
    expect(overriddenBody.decision.reason).toBe('USER_GLOBAL_OFF');
  });
});
