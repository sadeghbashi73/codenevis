/* Shared UI primitives: fetch wrapper, icons, markdown, chips, toast. */

import { t, ago } from './i18n.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/* ------------------------------------------------------------- api */

export async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `${method} ${path} failed`);
  return data;
}

/* ----------------------------------------------------------- toast */

let toastTimer;
export function toast(message, isError = false) {
  const el = $('#toast');
  el.textContent = message;
  el.className = `toast show${isError ? ' error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = 'toast'), isError ? 6500 : 3200);
}

/* ----------------------------------------------------------- icons */

const PATHS = {
  overview: 'M4 13h6V4H4v9Zm0 7h6v-5H4v5Zm10 0h6v-9h-6v9Zm0-16v5h6V4h-6Z',
  projects: 'M4 6a2 2 0 0 1 2-2h3.6l2 2H18a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6Z',
  board: 'M4 5h4v14H4zM10 5h4v9h-4zM16 5h4v6h-4z',
  tasks: 'M4 7h16M4 12h16M4 17h10',
  activity: 'M3 12h4l2.5-7 4 14L16 12h5',
  runs: 'M5 3l14 9-14 9V3Z',
  agents: 'M9 3h6v3h3v5a6 6 0 0 1-12 0V6h3V3Zm-3 18h12M9 11h.01M15 11h.01',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8.4-3a8.4 8.4 0 0 0-.14-1.5l2-1.5-2-3.5-2.4 1a8.3 8.3 0 0 0-2.6-1.5L15 2H9l-.26 2.5a8.3 8.3 0 0 0-2.6 1.5l-2.4-1-2 3.5 2 1.5A8.4 8.4 0 0 0 3.6 12c0 .5.05 1 .14 1.5l-2 1.5 2 3.5 2.4-1c.78.65 1.66 1.16 2.6 1.5L9 22h6l.26-2.5a8.3 8.3 0 0 0 2.6-1.5l2.4 1 2-3.5-2-1.5c.09-.5.14-1 .14-1.5Z',
  refresh: 'M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5',
  plus: 'M12 5v14M5 12h14',
  play: 'M6 4l12 8-12 8V4Z',
  external: 'M14 4h6v6M20 4l-8 8M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4',
  back: 'M15 5l-7 7 7 7',
  forward: 'M9 5l7 7-7 7',
  check: 'M4 12l5 5L20 6',
  alert: 'M12 8v5m0 3h.01M10.3 3.9 2.6 17a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
  key: 'M14.5 3a6.5 6.5 0 1 0-4.2 11.5L9 16H7v2H5v2H2v-3l7.3-7.3',
  doc: 'M14 3v5h5M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z',
  branch: 'M6 4v12m0 0a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm0-12a3 3 0 1 1 0 6 3 3 0 0 1 0-6Zm12 0a3 3 0 1 1 0 6 3 3 0 0 1 0-6Zm0 6c0 4-6 2-6 8',
};

export function icon(name, size = 16) {
  const d = PATHS[name];
  if (!d) return '';
  return `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"
    aria-hidden="true"><path d="${d}"/></svg>`;
}

/* ------------------------------------------------------------ text */

export const esc = (s = '') =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function inline(s) {
  return s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/(^|[\s(])#(\d+)\b/g, '$1<a href="#/task/$2">#$2</a>');
}

/** Enough markdown for issue bodies, PRDs and agent comments. */
export function markdown(src = '') {
  const lines = esc(src).split('\n');
  const out = [];
  let inCode = false;
  let inList = false;
  const closeList = () => { if (inList) { out.push('</ul>'); inList = false; } };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (/^```/.test(line)) {
      closeList();
      out.push(inCode ? '</pre>' : '<pre>');
      inCode = !inCode;
      continue;
    }
    if (inCode) { out.push(line); continue; }
    if (!line.trim()) { closeList(); continue; }

    if (/^\|/.test(line)) { closeList(); out.push(`<div class="tbl-row">${inline(line)}</div>`); continue; }
    if (/^#{1,6}\s/.test(line)) { closeList(); out.push(`<h4>${inline(line.replace(/^#{1,6}\s/, ''))}</h4>`); continue; }
    if (/^(---+|\*\*\*+)$/.test(line)) { closeList(); out.push('<hr>'); continue; }
    if (/^&gt;\s?/.test(line)) { closeList(); out.push(`<blockquote>${inline(line.replace(/^&gt;\s?/, ''))}</blockquote>`); continue; }
    if (/^\s*[-*]\s+\[[ xX]\]\s/.test(line)) {
      if (!inList) { out.push('<ul class="checks">'); inList = true; }
      const checked = /\[[xX]\]/.test(line);
      out.push(
        `<li class="${checked ? 'checked' : ''}"><span class="box">${checked ? icon('check', 12) : ''}</span>` +
          `${inline(line.replace(/^\s*[-*]\s+\[[ xX]\]\s/, ''))}</li>`
      );
      continue;
    }
    if (/^\s*[-*]\s/.test(line)) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push(`<li>${inline(line.replace(/^\s*[-*]\s/, ''))}</li>`);
      continue;
    }
    if (/^\s*\d+\.\s/.test(line)) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push(`<li>${inline(line.replace(/^\s*\d+\.\s/, ''))}</li>`);
      continue;
    }
    closeList();
    out.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  if (inCode) out.push('</pre>');
  return out.join('\n');
}

/* ----------------------------------------------------------- chips */

export const chip = (status, label) =>
  `<span class="chip ${status}">${esc(label ?? t(`status.${status}`))}</span>`;

export const roleChip = (role) => `<span class="chip role-${role}">${esc(t(`role.${role}`))}</span>`;

export const when = ago;

/* --------------------------------------------------------- layout */

export function pageHeader({ title, subtitle, actions = '', back }) {
  return `
  <header class="page-head">
    <div class="page-head-text">
      ${back ? `<a class="back" href="${back.href}">${icon('back', 14)}<span>${esc(back.label)}</span></a>` : ''}
      <h1>${esc(title)}</h1>
      ${subtitle ? `<p>${esc(subtitle)}</p>` : ''}
    </div>
    ${actions ? `<div class="page-head-actions">${actions}</div>` : ''}
  </header>`;
}

export const empty = (message) => `<div class="empty">${esc(message)}</div>`;

export const skeleton = () => `<div class="skeleton"><span></span><span></span><span></span></div>`;
