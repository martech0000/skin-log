const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const webpush = require('web-push');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');
const SUBSCRIPTIONS_FILE = path.join(DATA_DIR, 'subscriptions.json');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const PUBLIC_DIR = path.join(ROOT, 'public');

fs.mkdirSync(DATA_DIR, { recursive: true });

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function settings() {
  const fileValue = readJson(SETTINGS_FILE, {});
  const value = {
    ...fileValue,
    password: process.env.CHAT_PASSWORD || fileValue.password,
    roomName: process.env.ROOM_NAME || fileValue.roomName || 'skin log',
    sessionSecret: process.env.SESSION_SECRET || fileValue.sessionSecret,
    vapidPublicKey: process.env.VAPID_PUBLIC_KEY || fileValue.vapidPublicKey,
    vapidPrivateKey: process.env.VAPID_PRIVATE_KEY || fileValue.vapidPrivateKey,
    vapidSubject: process.env.VAPID_SUBJECT || fileValue.vapidSubject
  };
  return value.password ? value : null;
}

function messages() { return readJson(MESSAGES_FILE, []); }
function saveMessages(value) { fs.writeFileSync(MESSAGES_FILE, JSON.stringify(value, null, 2)); }
function subscriptions() { return readJson(SUBSCRIPTIONS_FILE, []); }
function saveSubscriptions(value) { fs.writeFileSync(SUBSCRIPTIONS_FILE, JSON.stringify(value, null, 2)); }

function base64url(value) { return Buffer.from(value).toString('base64url'); }
function sign(value, secret) {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}
function makeToken(name, secret) {
  const payload = base64url(JSON.stringify({ name, expires: Date.now() + 1000 * 60 * 60 * 24 * 30 }));
  return `${payload}.${sign(payload, secret)}`;
}
function verifyToken(token, secret) {
  const [payload, signature] = String(token || '').split('.');
  const expected = sign(payload || '', secret);
  if (!payload || !signature || signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const body = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return body.expires > Date.now() ? body : null;
  } catch { return null; }
}
function notificationReady(config) { return config?.vapidPublicKey && config?.vapidPrivateKey && config?.vapidSubject; }
async function notifyOtherPerson(sender, text, config) {
  if (!notificationReady(config)) return;
  webpush.setVapidDetails(config.vapidSubject, config.vapidPublicKey, config.vapidPrivateKey);
  const active = [];
  await Promise.all(subscriptions().map(async item => {
    if (item.name === sender) { active.push(item); return; }
    try {
      await webpush.sendNotification(item.subscription, JSON.stringify({ title: config.roomName || 'ふたりのトーク', body: `${sender}: ${text.slice(0, 70)}`, url: '/' }));
      active.push(item);
    } catch (error) { if (error.statusCode !== 404 && error.statusCode !== 410) active.push(item); }
  }));
  saveSubscriptions(active);
}
function cookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').filter(Boolean).map(v => {
    const i = v.indexOf('='); return [v.slice(0, i).trim(), decodeURIComponent(v.slice(i + 1))];
  }));
}
function currentUser(req) {
  const config = settings();
  return config ? verifyToken(cookies(req).futari_session, config.sessionSecret || config.password) : null;
}
function send(res, status, data, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(data));
}
function body(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; if (raw.length > 7 * 1024 * 1024) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch { reject(new Error('invalid json')); } });
  });
}
function serveFile(res, file, type) {
  fs.readFile(file, (error, data) => {
    if (error) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const config = settings();

  if (url.pathname === '/api/status') {
    const user = currentUser(req);
    return send(res, 200, { configured: Boolean(config), authenticated: Boolean(user), user: user?.name, roomName: config?.roomName || 'ふたりのトーク' });
  }
  if (url.pathname === '/api/login' && req.method === 'POST') {
    if (!config) return send(res, 503, { error: '管理者設定がまだ完了していません。' });
    try {
      const { password, name } = await body(req);
      const displayName = String(name || '').trim().slice(0, 80);
      if (!displayName || String(password || '') !== config.password) return send(res, 401, { error: '合言葉または名前が違います。' });
      const token = makeToken(displayName, config.sessionSecret || config.password);
      return send(res, 200, { ok: true }, { 'Set-Cookie': `futari_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000` });
    } catch { return send(res, 400, { error: '入力を確認してください。' }); }
  }
  if (url.pathname === '/api/logout' && req.method === 'POST') {
    return send(res, 200, { ok: true }, { 'Set-Cookie': 'futari_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' });
  }
  if (url.pathname === '/api/messages') {
    const user = currentUser(req);
    if (!user) return send(res, 401, { error: 'ログインしてください。' });
    if (req.method === 'GET') return send(res, 200, { messages: messages() });
    if (req.method === 'POST') {
      try {
        const { text, imageUrl } = await body(req);
        const clean = String(text || '').trim().slice(0, 1000);
        if (!clean && !imageUrl) return send(res, 400, { error: 'メッセージまたは写真を入力してください。' });
        const all = messages();
        const message = { id: crypto.randomUUID(), text: clean, imageUrl: imageUrl || null, sender: user.name, readBy: [user.name], createdAt: new Date().toISOString() };
        all.push(message); saveMessages(all);
        notifyOtherPerson(user.name, clean, config).catch(() => {});
        return send(res, 201, { message });
      } catch { return send(res, 400, { error: '送信に失敗しました。' }); }
    }
  }
  if (url.pathname === '/api/read' && req.method === 'POST') {
    const user = currentUser(req);
    if (!user) return send(res, 401, { error: 'ログインしてください。' });
    const all = messages(); let changed = false;
    all.forEach(message => {
      if (message.sender !== user.name && !(message.readBy || []).includes(user.name)) {
        message.readBy = [...(message.readBy || []), user.name]; changed = true;
      }
    });
    if (changed) saveMessages(all);
    return send(res, 200, { ok: true });
  }
  if (url.pathname === '/api/uploads' && req.method === 'POST') {
    const user = currentUser(req);
    if (!user) return send(res, 401, { error: 'ログインしてください。' });
    try {
      const { dataUrl } = await body(req);
      const match = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
      if (!match) throw new Error('invalid image');
      const bytes = Buffer.from(match[2], 'base64');
      if (bytes.length > 5 * 1024 * 1024) return send(res, 413, { error: '写真は5MB以下にしてください。' });
      fs.mkdirSync(UPLOADS_DIR, { recursive: true });
      const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }[match[1]];
      const filename = `${crypto.randomUUID()}.${ext}`;
      fs.writeFileSync(path.join(UPLOADS_DIR, filename), bytes);
      return send(res, 201, { imageUrl: `/uploads/${filename}` });
    } catch { return send(res, 400, { error: '写真の読み込みに失敗しました。' }); }
  }
  if (url.pathname === '/api/notifications/public-key') {
    const user = currentUser(req);
    if (!user) return send(res, 401, { error: 'ログインしてください。' });
    return send(res, 200, { publicKey: notificationReady(config) ? config.vapidPublicKey : null });
  }
  if (url.pathname === '/api/notifications/subscribe' && req.method === 'POST') {
    const user = currentUser(req);
    if (!user) return send(res, 401, { error: 'ログインしてください。' });
    if (!notificationReady(config)) return send(res, 503, { error: '通知のサーバー設定がまだ完了していません。' });
    try {
      const { subscription } = await body(req);
      if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) throw new Error('invalid');
      const all = subscriptions().filter(item => item.subscription.endpoint !== subscription.endpoint);
      all.push({ name: user.name, subscription, createdAt: new Date().toISOString() }); saveSubscriptions(all);
      return send(res, 201, { ok: true });
    } catch { return send(res, 400, { error: '通知登録に失敗しました。' }); }
  }
  if (url.pathname === '/') return serveFile(res, path.join(PUBLIC_DIR, 'index.html'), 'text/html; charset=utf-8');
  if (url.pathname === '/app.js') return serveFile(res, path.join(PUBLIC_DIR, 'app.js'), 'text/javascript; charset=utf-8');
  if (url.pathname === '/style.css') return serveFile(res, path.join(PUBLIC_DIR, 'style.css'), 'text/css; charset=utf-8');
  if (url.pathname === '/manifest.webmanifest') return serveFile(res, path.join(PUBLIC_DIR, 'manifest.webmanifest'), 'application/manifest+json');
  if (url.pathname === '/sw.js') return serveFile(res, path.join(PUBLIC_DIR, 'sw.js'), 'text/javascript; charset=utf-8');
  if (url.pathname.startsWith('/uploads/')) {
    const file = path.basename(url.pathname);
    return serveFile(res, path.join(UPLOADS_DIR, file), file.endsWith('.png') ? 'image/png' : file.endsWith('.webp') ? 'image/webp' : file.endsWith('.gif') ? 'image/gif' : 'image/jpeg');
  }
  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, '0.0.0.0', () => console.log(`ふたりチャット: http://localhost:${PORT}`));
