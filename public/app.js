const $ = (selector) => document.querySelector(selector);
let me = null;
let lastSignature = '';
let openAdminAfterLogin = false;
let selectedImageFile = null;
let selectedImageUrl = null;
function urlBase64ToUint8Array(value) { const pad = '='.repeat((4 - value.length % 4) % 4); const base64 = (value + pad).replace(/-/g, '+').replace(/_/g, '/'); return Uint8Array.from(atob(base64), char => char.charCodeAt(0)); }
function makeId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (window.crypto?.getRandomValues) window.crypto.getRandomValues(bytes); else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
}
function deviceId() { let value = localStorage.getItem('futari-device-id'); if (!value) { value = makeId(); localStorage.setItem('futari-device-id', value); } return value; }

function show(id) { ['setup', 'login', 'dashboard', 'chat'].forEach(x => $(`#${x}`).classList.toggle('hidden', x !== id)); }
function escape(text) { const el = document.createElement('div'); el.textContent = text; return el.innerHTML; }
function time(iso) { return new Intl.DateTimeFormat('ja-JP', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso)); }
function autoGrow() { const el = $('#message-input'); el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 110)}px`; }
function skinNotes() { try { return JSON.parse(localStorage.getItem('skin-log-notes') || '[]'); } catch { return []; } }
function renderSkinNotes() {
  const items = skinNotes();
  $('#skin-note-list').innerHTML = items.slice(0, 8).map(note => `<article><time>${new Intl.DateTimeFormat('ja-JP', { month: 'numeric', day: 'numeric' }).format(new Date(note.createdAt))}</time><p>${escape(note.text)}</p></article>`).join('');
}

async function api(url, options = {}) {
  const response = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...options });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '通信に失敗しました。');
  return data;
}
function render(items) {
  const signature = JSON.stringify(items);
  if (signature === lastSignature) return;
  lastSignature = signature;
  const box = $('#messages');
  box.innerHTML = items.map((message, index) => {
    const previous = items[index - 1];
    const newDay = !previous || new Date(previous.createdAt).toDateString() !== new Date(message.createdAt).toDateString();
    const own = message.sender === me;
    const read = own && (message.readBy || []).some(id => id !== me);
    return `${newDay ? `<div class="date">${new Intl.DateTimeFormat('ja-JP', { month: 'long', day: 'numeric', weekday: 'short' }).format(new Date(message.createdAt))}</div>` : ''}<article class="message ${own ? 'own' : ''}" data-id="${message.id}">${own ? `<button class="message-menu" aria-label="送信メニュー" data-id="${message.id}">•••</button>` : ''}<div class="bubble">${message.imageUrl ? `<img src="${message.imageUrl}" alt="送信された写真">` : ''}${message.text ? escape(message.text).replace(/\n/g, '<br>') : ''}</div><div class="message-meta">${read ? '<span class="read">既読</span>' : ''}<time>${time(message.createdAt)}</time></div></article>`;
  }).join('');
  box.scrollTop = box.scrollHeight;
}
async function refresh() {
  try { const data = await api('/api/messages'); render(data.messages); api('/api/read', { method: 'POST', body: '{}' }).catch(() => {}); } catch (error) { if (/ログイン/.test(error.message)) location.reload(); }
}
async function initialize() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.getRegistrations().then(registrations => registrations.forEach(registration => registration.unregister()));
  const state = await api('/api/status');
  $('#room-name').textContent = state.roomName;
  if (!state.authenticated) return show('dashboard');
  me = state.user;
  if (openAdminAfterLogin) { show('chat'); await refresh(); } else show('dashboard');
  setInterval(refresh, 2500);
}

$('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault(); $('#login-error').textContent = '';
  try { await api('/api/login', { method: 'POST', body: JSON.stringify({ name: deviceId(), password: $('#password').value }) }); await initialize(); }
  catch (error) { $('#login-error').textContent = error.message; }
});
$('#message-input').addEventListener('input', autoGrow);
$('#message-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const input = $('#message-input'); const text = input.value.trim(); if (!text) return;
  input.value = ''; autoGrow(); $('#send').disabled = true;
  try { await api('/api/messages', { method: 'POST', body: JSON.stringify({ text }) }); await refresh(); }
  catch (error) { alert(error.message); input.value = text; autoGrow(); } finally { $('#send').disabled = false; input.focus(); }
});
$('#attach').addEventListener('click', () => $('#image-input').click());
$('#image-input').addEventListener('change', event => {
  const file = event.target.files[0]; if (!file) return;
  if (file.size > 5 * 1024 * 1024) return alert('写真は5MB以下にしてください。');
  selectedImageFile = file; if (selectedImageUrl) URL.revokeObjectURL(selectedImageUrl); selectedImageUrl = URL.createObjectURL(file); $('#image-preview-img').src = selectedImageUrl; $('#image-preview').classList.remove('hidden');
});
function clearSelectedImage() { if (selectedImageUrl) URL.revokeObjectURL(selectedImageUrl); selectedImageFile = null; selectedImageUrl = null; $('#image-input').value = ''; $('#image-preview').classList.add('hidden'); }
$('#cancel-image').addEventListener('click', clearSelectedImage);
$('#send-image').addEventListener('click', () => {
  if (!selectedImageFile) return; const file = selectedImageFile; const reader = new FileReader(); $('#send-image').disabled = true;
  reader.onload = async () => {
    try { const { imageUrl } = await api('/api/uploads', { method: 'POST', body: JSON.stringify({ dataUrl: reader.result }) }); await api('/api/messages', { method: 'POST', body: JSON.stringify({ imageUrl }) }); clearSelectedImage(); await refresh(); }
    catch (error) { alert(error.message); } finally { $('#send-image').disabled = false; }
  }; reader.readAsDataURL(file);
});
async function cancelMessage(id) { if (!confirm('この送信を取り消しますか？')) return; try { await api(`/api/messages/${id}`, { method: 'DELETE', body: '{}' }); await refresh(); } catch (error) { alert(error.message); } }
$('#messages').addEventListener('click', event => { const menu = event.target.closest('.message-menu'); if (menu) cancelMessage(menu.dataset.id); });
$('#logout').addEventListener('click', async () => { await api('/api/logout', { method: 'POST', body: '{}' }); location.reload(); });
$('#dashboard-logout').addEventListener('click', async () => { await api('/api/logout', { method: 'POST', body: '{}' }); location.reload(); });
$('#open-admin').addEventListener('click', () => {
  if (me) { show('chat'); refresh(); return; }
  openAdminAfterLogin = true; $('#login-error').textContent = ''; $('#password').value = ''; show('login'); $('#password').focus();
});
$('#back-dashboard').addEventListener('click', () => show('dashboard'));
$('#skin-note-form').addEventListener('submit', event => {
  event.preventDefault(); const input = $('#skin-note-input'); const value = input.value.trim(); if (!value) return;
  localStorage.setItem('skin-log-notes', JSON.stringify([{ text: value, createdAt: new Date().toISOString() }, ...skinNotes()])); input.value = ''; renderSkinNotes();
});
renderSkinNotes();
initialize().catch(() => show('login'));
