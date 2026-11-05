/**
 * 浏览器扩展本地桥。
 *
 * 只监听 127.0.0.1，端口从 17893 开始尝试。扩展通过
 *   GET  /health
 *   GET  /items
 *   POST /add-text
 * 访问，并带上固定 token + chrome-extension:// Origin。
 *
 * 这不是公网 API；token 是本地约定值，主要用于阻止普通网页误写。
 */
import http from 'node:http';

import { extractCandidates } from '../../../../packages/core/src/ddl.js';

const PORTS = Array.from({ length: 11 }, (_, index) => 17893 + index);
const TOKEN = 'save-ddl-local-v1';
const MAX_BODY = 256 * 1024;

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function isExtensionOrigin(req) {
  const origin = String(req.headers.origin ?? '');
  if (!origin) return true;
  return (
    origin.startsWith('chrome-extension://') ||
    origin.startsWith('http://127.0.0.1') ||
    origin.startsWith('http://localhost')
  );
}

function applyCors(req, res) {
  const origin = String(req.headers.origin ?? '');
  if (origin.startsWith('chrome-extension://')) {
    res.setHeader('access-control-allow-origin', origin);
    res.setHeader('vary', 'origin');
    res.setHeader('access-control-allow-headers', 'content-type, x-save-ddl-token');
    res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
  }
}

export function createBridge({ store, onChanged, onShow, version = '0.1.0' }) {
  const server = http.createServer(async (req, res) => {
    applyCors(req, res);

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const path = url.pathname;

    if (path === '/health') {
      return sendJson(res, 200, { ok: true, name: 'save-ddl', version });
    }

    if (!isExtensionOrigin(req)) {
      return sendJson(res, 403, { ok: false, error: 'forbidden_origin' });
    }
    if (req.headers['x-save-ddl-token'] !== TOKEN) {
      return sendJson(res, 401, { ok: false, error: 'invalid_token' });
    }

    if (path === '/items' && req.method === 'GET') {
      const state = await store.read();
      return sendJson(res, 200, {
        ok: true,
        items: store.list(state, true),
      });
    }

    if (path === '/show' && req.method === 'POST') {
      onShow?.();
      return sendJson(res, 200, { ok: true });
    }

    if (path === '/add-text' && req.method === 'POST') {
      let body;
      try {
        body = JSON.parse(await readBody(req));
      } catch (error) {
        return sendJson(res, 400, { ok: false, error: String(error?.message ?? error) });
      }
      const text = typeof body?.text === 'string' ? body.text : '';
      const candidates = extractCandidates(text, { now: new Date(), max: 8 });
      let added = 0;
      for (const candidate of candidates) {
        const result = await store.update((state) =>
          store.add(state, {
            subject: candidate.subject,
            assignment: candidate.assignment,
            dueAt: candidate.dueAt,
            title: candidate.title,
            source: { kind: 'text' },
          }),
        );
        if (!result.duplicate) added += 1;
      }
      onChanged?.();
      const state = await store.read();
      return sendJson(res, 200, {
        ok: true,
        added,
        candidates,
        items: store.list(state, true),
        message:
          candidates.length === 0
            ? '没有识别到截止时间'
            : added > 0
              ? `已加入 ${added} 条 DDL`
              : '识别到的 DDL 已经存在',
      });
    }

    return sendJson(res, 404, { ok: false, error: 'not_found' });
  });

  let port = 0;

  function listenAt(index) {
    return new Promise((resolve, reject) => {
      if (index >= PORTS.length) {
        reject(new Error('没有可用端口'));
        return;
      }
      const candidate = PORTS[index];
      const onError = (error) => {
        server.removeListener('error', onError);
        if (error?.code === 'EADDRINUSE') {
          resolve(listenAt(index + 1));
          return;
        }
        reject(error);
      };
      server.once('error', onError);
      server.listen(candidate, '127.0.0.1', () => {
        server.removeListener('error', onError);
        port = candidate;
        resolve({ port });
      });
    });
  }

  return {
    async start() {
      const result = await listenAt(0);
      return result.port;
    },
    stop() {
      return new Promise((resolve) => server.close(() => resolve()));
    },
    get port() {
      return port;
    },
  };
}