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

  it('creates dm session through nav api', async () => {
    const created = await makeRequest(port, '/api/nav/dm', {
      method: 'POST',
      body: { jid: 'u2@s.whatsapp.net', name: 'Bob' },
    });
    expect(created.statusCode).toBe(201);

    const listed = await makeRequest(port, '/api/nav/sessions');
    const body = listed.body as {
      sessions: Array<{ jid: string; type: string }>;
    };
    const dm = body.sessions.find((item) => item.jid === 'u2@s.whatsapp.net');
    expect(dm?.type).toBe('dm');
  });

  it('blocks member channel policy change and writes audit log', async () => {
    const chatJid = encodeURIComponent('g1@g.us');
    const denied = await makeRequest(port, `/api/channel-policy/${chatJid}`, {
      method: 'PUT',
      body: {
        actor: 'alice',
        role: 'member',
        isPrivate: true,
        archived: false,
        reason: 'try overreach',
      },
    });
    expect(denied.statusCode).toBe(403);
    const deniedBody = denied.body as { code: string; audit: { action: string } };
    expect(deniedBody.code).toBe('RBAC_FORBIDDEN');
    expect(deniedBody.audit.action).toBe('CHANNEL_POLICY_UPDATE_DENIED');

    const audits = await makeRequest(
      port,
      '/api/audit/logs?action=CHANNEL_POLICY_UPDATE_DENIED&limit=20',
    );
    expect(audits.statusCode).toBe(200);
    const auditsBody = audits.body as {
      logs: Array<{ actor: string; targetType: string; targetId: string; ip: string | null }>;
    };
    expect(auditsBody.logs.length).toBeGreaterThan(0);
    expect(auditsBody.logs[0].actor).toBe('alice');
    expect(auditsBody.logs[0].targetType).toBe('channel');
    expect(auditsBody.logs[0].targetId).toBe('g1@g.us');
    expect(auditsBody.logs[0].ip).toBeTruthy();
  });

  it('updates channel private and archived policy for admin', async () => {
    const chatJid = encodeURIComponent('g1@g.us');
    const updated = await makeRequest(port, `/api/channel-policy/${chatJid}`, {
      method: 'PUT',
      body: {
        actor: 'ops-admin',
        role: 'workspace_admin',
        isPrivate: true,
        archived: true,
        reason: 'compliance lock',
      },
    });
    expect(updated.statusCode).toBe(200);
    const updatedBody = updated.body as {
      policy: { chatJid: string; isPrivate: boolean; archived: boolean; archivedAt: string | null };
      audit: { action: string; role: string };
    };
    expect(updatedBody.policy.chatJid).toBe('g1@g.us');
    expect(updatedBody.policy.isPrivate).toBe(true);
    expect(updatedBody.policy.archived).toBe(true);
    expect(updatedBody.policy.archivedAt).toBeTruthy();
    expect(updatedBody.audit.action).toBe('CHANNEL_POLICY_UPDATED');
    expect(updatedBody.audit.role).toBe('workspace_admin');

    const queried = await makeRequest(port, `/api/channel-policy/${chatJid}`);
    expect(queried.statusCode).toBe(200);
    const queriedBody = queried.body as {
      policy: { isPrivate: boolean; archived: boolean };
    };
    expect(queriedBody.policy.isPrivate).toBe(true);
    expect(queriedBody.policy.archived).toBe(true);

    const logs = await makeRequest(
      port,
      '/api/audit/logs?action=CHANNEL_POLICY_UPDATED&targetType=channel&limit=20',
    );
    expect(logs.statusCode).toBe(200);
    const logsBody = logs.body as {
      logs: Array<{
        actor: string;
        role: string;
        action: string;
        targetType: string;
        targetId: string;
        details: { before: { isPrivate: boolean }; after: { isPrivate: boolean } };
        createdAt: string;
      }>;
    };
    expect(logsBody.logs.length).toBeGreaterThan(0);
    expect(logsBody.logs[0].actor).toBe('ops-admin');
    expect(logsBody.logs[0].role).toBe('workspace_admin');
    expect(logsBody.logs[0].action).toBe('CHANNEL_POLICY_UPDATED');
    expect(logsBody.logs[0].targetType).toBe('channel');
    expect(logsBody.logs[0].targetId).toBe('g1@g.us');
    expect(logsBody.logs[0].details.before.isPrivate).toBe(false);
    expect(logsBody.logs[0].details.after.isPrivate).toBe(true);
    expect(logsBody.logs[0].createdAt).toContain('T');
  });

  it('creates and archives thread', async () => {
    const created = await makeRequest(port, '/api/nav/threads', {
      method: 'POST',
      body: {
        chatJid: 'g1@g.us',
        title: 'incident-thread',
        createdBy: 'alice',
      },
    });
    expect(created.statusCode).toBe(201);
    const createdBody = created.body as { thread: { id: string } };
    const threadId = createdBody.thread.id;

    const listed = await makeRequest(
      port,
      `/api/nav/threads?chatJid=${encodeURIComponent('g1@g.us')}`,
    );
    expect(listed.statusCode).toBe(200);
    const listedBody = listed.body as { threads: Array<{ id: string }> };
    expect(listedBody.threads.some((item) => item.id === threadId)).toBe(true);

    const archived = await makeRequest(
      port,
      `/api/nav/threads/${encodeURIComponent(threadId)}/archive`,
      { method: 'POST' },
    );
    expect(archived.statusCode).toBe(200);

    const listedAfter = await makeRequest(
      port,
      `/api/nav/threads?chatJid=${encodeURIComponent('g1@g.us')}`,
    );
    const listedAfterBody = listedAfter.body as {
      threads: Array<{ id: string }>;
    };
    expect(listedAfterBody.threads.some((item) => item.id === threadId)).toBe(
      false,
    );
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

  it('deduplicates concurrent same emoji reactions', async () => {
    const chatJid = encodeURIComponent('g1@g.us');
    const messageId = encodeURIComponent('m1');
    const first = await makeRequest(
      port,
      `/api/messages/${chatJid}/${messageId}/reactions`,
      {
        method: 'POST',
        body: { actor: 'alice', emoji: '👍' },
      },
    );
    expect(first.statusCode).toBe(200);
    const second = await makeRequest(
      port,
      `/api/messages/${chatJid}/${messageId}/reactions`,
      {
        method: 'POST',
        body: { actor: 'alice', emoji: '👍' },
      },
    );
    expect(second.statusCode).toBe(200);
    const secondBody = second.body as { deduplicated: boolean; count: number };
    expect(secondBody.deduplicated).toBe(true);
    expect(secondBody.count).toBe(1);

    const summary = await makeRequest(
      port,
      `/api/messages/${chatJid}/${messageId}/reactions`,
    );
    expect(summary.statusCode).toBe(200);
    const summaryBody = summary.body as {
      reactions: Array<{ emoji: string; count: number }>;
    };
    expect(summaryBody.reactions[0].emoji).toBe('👍');
    expect(summaryBody.reactions[0].count).toBe(1);
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

  it('returns r4 acceptance page and script', async () => {
    const page = await makeTextRequest(port, '/r4-acceptance');
    expect(page.statusCode).toBe(200);
    expect(page.contentType).toContain('text/html');
    expect(page.body).toContain('R4 搜索与文件中心验收');
    expect(page.body).toContain('/r4-acceptance.js');

    const script = await makeTextRequest(port, '/r4-acceptance.js');
    expect(script.statusCode).toBe(200);
    expect(script.contentType).toContain('application/javascript');
    expect(script.body).toContain('bindR4Acceptance');
    expect(script.body).toContain('/api/search/messages');
    expect(script.body).toContain('/api/files');
  });

  it('searches messages by keyword sender and time range', async () => {
    storeMessageDirect({
      id: 'm4',
      chat_jid: 'g1@g.us',
      sender: 'alice',
      sender_name: 'Alice',
      content: 'release checklist ready',
      timestamp: '2026-03-20T10:03:00.000Z',
      is_from_me: false,
    });
    storeMessageDirect({
      id: 'm5',
      chat_jid: 'g1@g.us',
      sender: 'bob',
      sender_name: 'Bob',
      content: 'release checklist ready',
      timestamp: '2026-03-20T10:04:00.000Z',
      is_from_me: false,
    });
    storeMessageDirect({
      id: 'm6',
      chat_jid: 'g1@g.us',
      sender: 'alice',
      sender_name: 'Alice',
      content: 'release other topic',
      timestamp: '2026-01-20T10:05:00.000Z',
      is_from_me: false,
    });
    const res = await makeRequest(
      port,
      `/api/search/messages?keyword=${encodeURIComponent(
        'release checklist',
      )}&sender=alice&chatJid=${encodeURIComponent(
        'g1@g.us',
      )}&from=2026-03-01T00:00:00.000Z&to=2026-03-31T23:59:59.999Z&limit=20`,
    );
    expect(res.statusCode).toBe(200);
    const body = res.body as {
      total: number;
      results: Array<{ id: string; sender: string }>;
    };
    expect(body.total).toBe(1);
    expect(body.results[0].id).toBe('m4');
    expect(body.results[0].sender).toBe('alice');
  });

  it('creates file asset and supports metadata fallback with download', async () => {
    const created = await makeRequest(port, '/api/files', {
      method: 'POST',
      body: {
        chatJid: 'g1@g.us',
        fileName: 'manual.zip',
        mimeType: 'application/zip',
        size: 2048,
        storagePath: '/files/manual.zip',
      },
    });
    expect(created.statusCode).toBe(201);
    const createdBody = created.body as {
      asset: { id: string; previewable: boolean };
    };
    expect(createdBody.asset.previewable).toBe(false);
    const fileId = createdBody.asset.id;

    const detail = await makeRequest(
      port,
      `/api/files/${encodeURIComponent(fileId)}`,
    );
    expect(detail.statusCode).toBe(200);
    const detailBody = detail.body as {
      preview: { mode: string; available: boolean };
      downloadUrl: string;
    };
    expect(detailBody.preview.mode).toBe('metadata');
    expect(detailBody.preview.available).toBe(false);
    expect(detailBody.downloadUrl).toContain('/download');

    const download = await makeRequest(
      port,
      `/api/files/${encodeURIComponent(fileId)}/download`,
    );
    expect(download.statusCode).toBe(200);
    const downloadBody = download.body as {
      fileName: string;
      storagePath: string;
    };
    expect(downloadBody.fileName).toBe('manual.zip');
    expect(downloadBody.storagePath).toBe('/files/manual.zip');

    const listed = await makeRequest(
      port,
      `/api/files?chatJid=${encodeURIComponent('g1@g.us')}&keyword=${encodeURIComponent('manual')}&limit=20`,
    );
    expect(listed.statusCode).toBe(200);
    const listedBody = listed.body as { total: number };
    expect(listedBody.total).toBeGreaterThan(0);
  });

  it('tracks unread and supports mark-as-read', async () => {
    const chatJid = encodeURIComponent('g1@g.us');
    const before = await makeRequest(
      port,
      `/api/unread/${chatJid}?actor=alice`,
    );
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

  it('stores deferred notifications into center and supports replay', async () => {
    await makeRequest(port, '/api/notifications/users/alice/settings', {
      method: 'PUT',
      body: {
        globalLevel: 'all',
        dndEnabled: true,
        dndStart: '22:00',
        dndEnd: '08:00',
      },
    });
    const evaluated = await makeRequest(port, '/api/notifications/evaluate', {
      method: 'POST',
      body: {
        actor: 'alice',
        chatJid: 'g1@g.us',
        mentionType: 'none',
        now: '2026-03-15T23:00:00.000Z',
      },
    });
    expect(evaluated.statusCode).toBe(200);
    const evalBody = evaluated.body as { deferredEventId: number | null };
    expect(evalBody.deferredEventId).not.toBeNull();

    const listed = await makeRequest(
      port,
      '/api/notifications/center?actor=alice&onlyPending=true&limit=20',
    );
    expect(listed.statusCode).toBe(200);
    const listedBody = listed.body as {
      events: Array<{ id: number }>;
    };
    expect(listedBody.events.length).toBeGreaterThan(0);

    const replay = await makeRequest(port, '/api/notifications/center/replay', {
      method: 'POST',
      body: { actor: 'alice', ids: [listedBody.events[0].id] },
    });
    expect(replay.statusCode).toBe(200);
    const replayBody = replay.body as { replayed: number };
    expect(replayBody.replayed).toBe(1);
  });

  it('evaluates search metrics and returns top10 precision recall', async () => {
    const res = await makeRequest(port, '/api/search/evaluate', {
      method: 'POST',
      body: {
        cases: [
          {
            query: 'hello',
            expectedIds: ['m1'],
            filters: { chatJid: 'g1@g.us' },
          },
          {
            query: 'world',
            expectedIds: ['m2'],
            filters: { chatJid: 'g1@g.us' },
          },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.body as {
      top10HitRate: number;
      precision: number;
      recall: number;
    };
    expect(body.top10HitRate).toBeGreaterThan(0);
    expect(body.precision).toBeGreaterThan(0);
    expect(body.recall).toBeGreaterThan(0);
  });
});
