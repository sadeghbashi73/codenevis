/* codenevis control panel */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const ROLE_LABEL = { po: 'PO agent', dev: 'Developer', qc: 'QC', pipeline: 'Pipeline', bot: 'Bot', human: 'You' };

let state = null;
let config = null;
let pollTimer = null;

/* ----------------------------------------------------------- api */

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `${method} ${path} failed`);
  return data;
}

function toast(message, isError = false) {
  const el = $('#toast');
  el.textContent = message;
  el.className = `toast show${isError ? ' error' : ''}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (el.className = 'toast'), isError ? 6000 : 3000);
}

/* -------------------------------------------------------- helpers */

function ago(iso) {
  const seconds = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (seconds < 60) return 'just now';
  const units = [['m', 60], ['h', 60], ['d', 24], ['w', 7]];
  let value = Math.floor(seconds / 60);
  let unit = 'm';
  for (const [next, factor] of [['h', 60], ['d', 24], ['w', 7]]) {
    if (value < factor) break;
    value = Math.floor(value / factor);
    unit = next;
  }
  return `${value}${unit} ago`;
}

const escapeHtml = (s = '') =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Just enough markdown for issue bodies and agent comments. */
function markdown(src = '') {
  const lines = escapeHtml(src).split('\n');
  const out = [];
  let inCode = false;
  let inList = false;

  const closeList = () => { if (inList) { out.push('</ul>'); inList = false; } };

  for (const line of lines) {
    if (/^```/.test(line)) {
      closeList();
      out.push(inCode ? '</pre>' : '<pre>');
      inCode = !inCode;
      continue;
    }
    if (inCode) { out.push(line); continue; }

    if (/^\s*$/.test(line)) { closeList(); continue; }
    if (/^#{1,6}\s/.test(line)) {
      closeList();
      out.push(`<h4>${line.replace(/^#{1,6}\s/, '')}</h4>`);
      continue;
    }
    if (/^---+$/.test(line)) { closeList(); out.push('<hr>'); continue; }
    if (/^&gt;\s?/.test(line)) { closeList(); out.push(`<blockquote>${inline(line.replace(/^&gt;\s?/, ''))}</blockquote>`); continue; }
    if (/^\s*[-*]\s/.test(line)) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push(`<li>${inline(line.replace(/^\s*[-*]\s/, ''))}</li>`);
      continue;
    }
    closeList();
    out.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  if (inCode) out.push('</pre>');
  return out.join('\n');
}

function inline(s) {
  return s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/(^|\s)#(\d+)\b/g, '$1<a href="#" data-issue="$2">#$2</a>')
    .replace(/\[([ xX])\]/g, (_, c) => (c.trim() ? '☑' : '☐'));
}

/* ---------------------------------------------------------- board */

function renderStats() {
  const c = state.counts ?? {};
  const cards = [
    ['total', state.total ?? 0, 'Tasks'],
    ['done', c.done ?? 0, 'Merged'],
    ['in-progress', c['in-progress'] ?? 0, 'Building'],
    ['review', c.review ?? 0, 'In review'],
    ['todo', c.todo ?? 0, 'Waiting'],
    ['blocked', c.blocked ?? 0, 'Need you'],
  ];
  $('#stats').innerHTML = cards
    .map(([cls, n, label]) => `<div class="stat ${cls}"><b>${n}</b><span>${label}</span></div>`)
    .join('');
}

function renderTasks() {
  const list = $('#taskList');
  if (!state.tasks.length) {
    list.innerHTML = `<div class="empty">No tasks yet. Create a project and the PO agent will fill this in.</div>`;
    return;
  }
  list.innerHTML = state.tasks
    .map(
      (t) => `
    <div class="item" data-issue="${t.number}">
      <span class="num">#${t.number}</span>
      <span class="title">${escapeHtml(t.title)}</span>
      ${t.pr ? `<span class="chip ${t.pr.state}" data-pr="${t.pr.number}">PR #${t.pr.number}</span>` : ''}
      <span class="chip ${t.status}">${t.status}</span>
      <span class="meta">${ago(t.updated_at)}</span>
    </div>`
    )
    .join('');
}

function renderBriefs() {
  const list = $('#briefList');
  if (!state.briefs.length) {
    list.innerHTML = `<div class="empty">No projects yet.</div>`;
    return;
  }
  list.innerHTML = state.briefs
    .map(
      (b) => `
    <div class="item" data-issue="${b.number}">
      <span class="num">#${b.number}</span>
      <span class="title">${escapeHtml(b.title)}</span>
      <span class="chip ${b.planned ? 'done' : 'todo'}">${b.planned ? 'planned' : 'new'}</span>
    </div>`
    )
    .join('');
}

function renderPRs() {
  const prs = state.tasks.filter((t) => t.pr);
  const list = $('#prList');
  if (!prs.length) {
    list.innerHTML = `<div class="empty">No pull requests yet.</div>`;
    return;
  }
  list.innerHTML = prs
    .map(
      (t) => `
    <div class="item" data-pr="${t.pr.number}">
      <span class="num">#${t.pr.number}</span>
      <span class="title">${escapeHtml(t.title)}</span>
      <span class="chip ${t.pr.state}">${t.pr.state}</span>
    </div>`
    )
    .join('');
}

function renderActivity() {
  const list = $('#activityList');
  if (!state.activity?.length) {
    list.innerHTML = `<div class="empty">Nothing has been said yet.</div>`;
    return;
  }
  list.innerHTML = state.activity
    .map(
      (a) => `
    <div class="feed-item" data-issue="${a.issue}">
      <div class="feed-side">
        <span class="chip ${a.role}">${ROLE_LABEL[a.role] ?? a.role}</span>
        <span class="when">${ago(a.created_at)}</span>
      </div>
      <div>
        <div class="feed-head">
          <span class="who">${escapeHtml(a.author)}</span>
          <span class="where">on #${a.issue} ${escapeHtml(a.issue_title)}</span>
        </div>
        <div class="feed-body">${escapeHtml(a.excerpt)}</div>
      </div>
    </div>`
    )
    .join('');
}

function renderRuns() {
  const list = $('#runList');
  if (!state.runs?.length) {
    list.innerHTML = `<div class="empty">No workflow runs yet.</div>`;
    return;
  }
  const chipFor = (r) => {
    if (r.status !== 'completed') return `<span class="chip in-progress">${r.status.replace('_', ' ')}</span>`;
    const cls = r.conclusion === 'success' ? 'done' : r.conclusion === 'cancelled' ? 'todo' : 'blocked';
    return `<span class="chip ${cls}">${r.conclusion}</span>`;
  };
  list.innerHTML = state.runs
    .map(
      (r) => `
    <a class="item" href="${r.url}" target="_blank" rel="noopener">
      <span class="title">${escapeHtml(r.name)}</span>
      <span class="meta">${r.event}</span>
      ${chipFor(r)}
      <span class="meta">${ago(r.created_at)}</span>
    </a>`
    )
    .join('');
}

function renderAll() {
  $('#repo').textContent = state.repo ?? '';
  $('#pulse').className = `dot${state.pipelineRunning ? ' live' : ''}`;
  $('#pipelineState').textContent = state.pipelineRunning ? 'pipeline running' : '';
  $('#runPipeline').disabled = state.pipelineRunning;
  renderStats();
  renderTasks();
  renderBriefs();
  renderPRs();
  renderActivity();
  renderRuns();
}

/* --------------------------------------------------------- drawer */

function openDrawer() {
  $('#drawer').classList.add('open');
  $('#scrim').classList.add('open');
}

function closeDrawer() {
  $('#drawer').classList.remove('open');
  $('#scrim').classList.remove('open');
}

async function showIssue(number) {
  openDrawer();
  $('#drawerKind').textContent = 'loading';
  $('#drawerTitle').textContent = `#${number}`;
  $('#drawerBody').innerHTML = `<div class="empty">Loading…</div>`;

  try {
    const { issue, comments } = await api('GET', `/api/issue?number=${number}`);
    $('#drawerKind').textContent = issue.labels.includes('task') ? 'task' : 'issue';
    $('#drawerKind').className = `chip ${issue.status}`;
    $('#drawerTitle').textContent = issue.title;
    $('#drawerLink').href = issue.url;

    const body = [
      `<div class="md">${markdown(issue.body ?? '')}</div>`,
      comments.length ? `<div class="section-label">${comments.length} comment${comments.length === 1 ? '' : 's'}</div>` : '',
      ...comments.map(
        (c) => `
        <div class="comment">
          <div class="comment-head">
            <span class="chip ${c.role}">${ROLE_LABEL[c.role] ?? c.role}</span>
            <span class="who">${escapeHtml(c.author)}</span>
            <span class="when">${ago(c.created_at)}</span>
          </div>
          <div class="md">${markdown(c.body)}</div>
        </div>`
      ),
    ].join('');

    $('#drawerBody').innerHTML = body;
  } catch (err) {
    $('#drawerBody').innerHTML = `<div class="empty">${escapeHtml(err.message)}</div>`;
  }
}

async function showPR(number) {
  openDrawer();
  $('#drawerKind').textContent = 'pull request';
  $('#drawerTitle').textContent = `PR #${number}`;
  $('#drawerBody').innerHTML = `<div class="empty">Loading…</div>`;

  try {
    const { pr, reviews, files } = await api('GET', `/api/pr?number=${number}`);
    $('#drawerKind').className = `chip ${pr.state}`;
    $('#drawerKind').textContent = pr.state;
    $('#drawerTitle').textContent = pr.title;
    $('#drawerLink').href = pr.url;

    $('#drawerBody').innerHTML = [
      `<div class="md">${markdown(pr.body ?? '')}</div>`,
      `<div class="section-label">${files.length} file${files.length === 1 ? '' : 's'} · +${pr.additions} −${pr.deletions}</div>`,
      `<div class="list">${files
        .map(
          (f) => `<div class="item" style="cursor:default">
            <span class="title"><code>${escapeHtml(f.filename)}</code></span>
            <span class="meta">+${f.additions} −${f.deletions}</span>
          </div>`
        )
        .join('')}</div>`,
      reviews.length ? `<div class="section-label">${reviews.length} review${reviews.length === 1 ? '' : 's'}</div>` : '',
      ...reviews.map(
        (r) => `
        <div class="comment">
          <div class="comment-head">
            <span class="chip ${r.role}">${ROLE_LABEL[r.role] ?? r.role}</span>
            <span class="who">${escapeHtml(r.author)}</span>
            <span class="chip ${r.state === 'APPROVED' ? 'done' : r.state === 'CHANGES_REQUESTED' ? 'blocked' : 'todo'}">${r.state.toLowerCase().replace('_', ' ')}</span>
            <span class="when">${r.submitted_at ? ago(r.submitted_at) : ''}</span>
          </div>
          <div class="md">${markdown(r.body)}</div>
        </div>`
      ),
    ].join('');
  } catch (err) {
    $('#drawerBody').innerHTML = `<div class="empty">${escapeHtml(err.message)}</div>`;
  }
}

/* ------------------------------------------------------- settings */

function renderSecrets() {
  $('#secretList').innerHTML = config.secrets
    .map(
      (s) => `
    <div class="secret" data-secret="${s.name}">
      <div class="who">
        <b>${s.label}</b>
        <small>${s.blurb}</small>
      </div>
      <input type="password" placeholder="${s.set ? '•••••••••• — type a new value to replace' : `paste the key for ${s.name}`}" autocomplete="off">
      <div class="row">
        <span class="state ${s.set ? 'set' : 'unset'}">${s.set ? `set ${ago(s.updated_at)}` : 'not set'}</span>
        <button class="btn small save">Save</button>
      </div>
    </div>`
    )
    .join('');

  if (!config.ghCli) {
    $('#secretList').insertAdjacentHTML(
      'afterbegin',
      `<div class="empty">The GitHub CLI is not installed, so keys cannot be set from here —
       the value has to be encrypted with the repository public key before it is sent.
       Install it from <a href="https://cli.github.com" target="_blank" rel="noopener">cli.github.com</a>,
       or add the secrets in the repository settings.</div>`
    );
  }
}

const PROVIDERS = ['anthropic', 'openai'];

function renderModels() {
  const agents = config.agents.agents;
  $('#modelList').innerHTML = Object.entries(agents)
    .map(
      ([role, a]) => `
    <div class="model-row" data-role="${role}">
      <b>${role === 'po' ? 'Product Owner' : role === 'dev' ? 'Developer' : 'QC'}</b>
      <input class="model" value="${escapeHtml(a.model ?? '')}" placeholder="model id">
      <select class="provider">
        ${PROVIDERS.map(
          (p) => `<option value="${p}"${(a.provider ?? config.agents.defaults.provider) === p ? ' selected' : ''}>${p}</option>`
        ).join('')}
      </select>
      <input class="steps" type="number" min="1" max="200" value="${a.maxSteps ?? 40}" title="tool-call budget">
    </div>`
    )
    .join('');

  const policy = config.agents.policy;
  $('#policyList').innerHTML = `
    <div class="model-row" style="grid-template-columns:1fr 110px">
      <b>QC rounds before a task is escalated to you</b>
      <input class="policy" data-key="maxQcRounds" type="number" min="1" max="10" value="${policy.maxQcRounds}">
    </div>
    <div class="model-row" style="grid-template-columns:1fr 110px">
      <b>Tasks attempted per pipeline run</b>
      <input class="policy" data-key="maxTasksPerRun" type="number" min="1" max="50" value="${policy.maxTasksPerRun}">
    </div>
    <div class="model-row" style="grid-template-columns:1fr 110px">
      <b>Merge automatically once QC approves</b>
      <input class="policy" data-key="autoMerge" type="checkbox" ${policy.autoMerge ? 'checked' : ''} style="width:auto;justify-self:start">
    </div>`;
}

async function loadConfig() {
  config = await api('GET', '/api/config');
  renderSecrets();
  renderModels();
}

async function saveModels() {
  const agents = {};
  for (const row of $$('#modelList .model-row')) {
    agents[row.dataset.role] = {
      ...config.agents.agents[row.dataset.role],
      model: row.querySelector('.model').value.trim(),
      provider: row.querySelector('.provider').value,
      maxSteps: Number(row.querySelector('.steps').value),
    };
  }
  const policy = {};
  for (const input of $$('#policyList .policy')) {
    policy[input.dataset.key] = input.type === 'checkbox' ? input.checked : Number(input.value);
  }

  const res = await api('POST', '/api/config', { agents, policy });
  config.agents = res.agents;
  $('#modelSaved').textContent = res.note;
  toast('Saved to config/agents.json');
}

/* ---------------------------------------------------------- boot */

async function refresh() {
  try {
    state = await api('GET', '/api/state');
    renderAll();
  } catch (err) {
    toast(err.message, true);
  }
}

function switchView(name) {
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === name));
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${name}`));
  if (name === 'settings' && !config) loadConfig().catch((e) => toast(e.message, true));
}

document.addEventListener('click', async (event) => {
  const tab = event.target.closest('.tab');
  if (tab) return switchView(tab.dataset.view);

  const prChip = event.target.closest('[data-pr]');
  if (prChip) {
    event.stopPropagation();
    return showPR(Number(prChip.dataset.pr));
  }

  const issueEl = event.target.closest('[data-issue]');
  if (issueEl) {
    event.preventDefault();
    return showIssue(Number(issueEl.dataset.issue));
  }

  const save = event.target.closest('.secret .save');
  if (save) {
    const row = save.closest('.secret');
    const input = row.querySelector('input');
    const value = input.value;
    if (!value.trim()) return toast('Nothing to save — the field is empty', true);
    save.disabled = true;
    save.textContent = 'Saving…';
    try {
      const res = await api('POST', '/api/secret', { name: row.dataset.secret, value });
      config.secrets = res.secrets;
      input.value = '';
      renderSecrets();
      toast(`${row.dataset.secret} saved`);
    } catch (err) {
      toast(err.message, true);
      save.disabled = false;
      save.textContent = 'Save';
    }
  }
});

$('#refresh').addEventListener('click', () => {
  $('#refresh').firstChild.textContent = '↻';
  refresh();
});
$('#drawerClose').addEventListener('click', closeDrawer);
$('#scrim').addEventListener('click', closeDrawer);
document.addEventListener('keydown', (e) => e.key === 'Escape' && closeDrawer());

$('#saveModels').addEventListener('click', () => saveModels().catch((e) => toast(e.message, true)));

$('#saveConn').addEventListener('click', async () => {
  try {
    await api('POST', '/api/settings', {
      repo: $('#repoInput').value.trim() || undefined,
      token: $('#tokenInput').value.trim() || undefined,
    });
    $('#tokenInput').value = '';
    $('#connSaved').textContent = 'Saved to .codenevis/local.json';
    toast('Connection saved');
    await refresh();
  } catch (err) {
    toast(err.message, true);
  }
});

$('#runPipeline').addEventListener('click', async () => {
  try {
    await api('POST', '/api/dispatch', { workflow: 'pipeline', inputs: { skip_po: true, max_tasks: '5' } });
    toast('Pipeline started — it will pick up the next task');
    setTimeout(refresh, 2500);
  } catch (err) {
    toast(err.message, true);
  }
});

$('#newBrief').addEventListener('click', () => $('#briefDialog').showModal());

$('#briefForm').addEventListener('submit', async (event) => {
  if ($('#briefSubmit') !== document.activeElement && event.submitter?.value !== 'create') return;
  const title = $('#briefTitle').value.trim();
  const description = $('#briefBody').value.trim();
  if (!title || !description) return;
  try {
    const { number, url } = await api('POST', '/api/brief', { title, description });
    toast(`Project #${number} created`);
    $('#briefTitle').value = '';
    $('#briefBody').value = '';
    if ($('#briefStart').checked) {
      await api('POST', '/api/dispatch', { workflow: 'pipeline', inputs: { brief_issue: String(number), max_tasks: '5' } });
      toast(`Project #${number} created — the PO agent is planning it now`);
    }
    setTimeout(refresh, 2500);
  } catch (err) {
    toast(err.message, true);
  }
});

(async function boot() {
  const health = await api('GET', '/api/health').catch(() => ({}));
  $('#repoInput').value = health.repo ?? '';
  if (!health.tokenPresent) {
    toast('No GitHub token found. Add one under Settings → Connection, or run `gh auth login`.', true);
    switchView('settings');
    await loadConfig().catch(() => {});
  }
  await refresh();
  pollTimer = setInterval(refresh, 12000);
  document.addEventListener('visibilitychange', () => {
    clearInterval(pollTimer);
    if (!document.hidden) {
      refresh();
      pollTimer = setInterval(refresh, 12000);
    }
  });
})();
