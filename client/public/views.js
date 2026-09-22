/* One renderer per page. Each returns HTML for the main region. */

import { t, ago } from './i18n.js';
import { api, icon, esc, markdown, chip, roleChip, pageHeader, empty, skeleton } from './ui.js';

const ROLES = ['po', 'dev', 'qc'];
const COLUMNS = ['todo', 'in-progress', 'review', 'changes-requested', 'done', 'blocked'];

/* ------------------------------------------------------- overview */

function agentCard(role, cfg, secret, state) {
  const busy = state.tasks.find(
    (task) =>
      (role === 'dev' && task.status === 'in-progress') ||
      (role === 'qc' && task.status === 'review')
  );
  const hasKey = secret?.set;
  return `
  <article class="agent-card ${role}">
    <div class="agent-card-head">
      <span class="avatar ${role}">${icon('agents', 18)}</span>
      <div>
        <b>${esc(t(`role.${role}`))}</b>
        <small>${esc(t(`role.${role}.blurb`))}</small>
      </div>
    </div>
    <dl class="agent-meta">
      <div><dt>${esc(t('agents.model'))}</dt><dd><code>${esc(cfg?.model ?? '—')}</code></dd></div>
      <div><dt>${esc(t('agents.key'))}</dt><dd>${
        hasKey
          ? `<span class="ok">${icon('check', 13)} ${esc(t('agents.keySet', { when: ago(secret.updated_at) }))}</span>`
          : `<a class="warn" href="#/agents">${icon('alert', 13)} ${esc(t('overview.noKey'))}</a>`
      }</dd></div>
    </dl>
    <footer class="agent-status ${busy ? 'busy' : ''}">
      ${busy
        ? `<span class="pip"></span><a href="#/task/${busy.number}">${esc(t('overview.working', { n: busy.number }))}</a>`
        : `<span>${esc(t('overview.waiting'))}</span>`}
    </footer>
  </article>`;
}

export function overview(state, config) {
  const done = state.counts?.done ?? 0;
  const total = state.total ?? 0;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const missingKeys = config?.secrets?.filter((s) => ROLES.includes(s.role) && !s.set) ?? [];

  const banner = missingKeys.length
    ? `<div class="banner warn">
         ${icon('key', 18)}
         <div><b>${esc(t('overview.needsKeys'))}</b></div>
         <a class="btn small" href="#/agents">${esc(t('overview.setKeys'))}</a>
       </div>`
    : '';

  const statusCard = `
  <section class="hero ${state.pipelineRunning ? 'live' : ''}">
    <div class="hero-main">
      <span class="hero-dot"></span>
      <div>
        <b>${esc(state.pipelineRunning ? t('overview.running') : t('overview.idle'))}</b>
        <small>${esc(state.repo ?? '')}</small>
      </div>
    </div>
    ${total
      ? `<div class="hero-progress">
           <div class="progress"><span style="inline-size:${pct}%"></span></div>
           <small><b>${done}</b> / ${total} ${esc(t('overview.merged'))}</small>
         </div>`
      : `<p class="hero-empty">${esc(t('overview.start'))}</p>`}
  </section>`;

  const activity = (state.activity ?? []).slice(0, 6);
  const runs = (state.runs ?? []).slice(0, 4);

  return (
    pageHeader({
      title: t('overview.title'),
      subtitle: t('overview.subtitle'),
      actions: `<button class="btn primary" data-act="new-project">${icon('plus')}${esc(t('action.newProject'))}</button>`,
    }) +
    banner +
    statusCard +
    `<div class="grid-3 mt">${ROLES.map((r) =>
      agentCard(r, config?.agents?.agents?.[r], config?.secrets?.find((s) => s.role === r), state)
    ).join('')}</div>` +
    `<div class="split mt">
      <section class="card">
        <div class="card-head"><h2>${esc(t('overview.recent'))}</h2><a class="link" href="#/activity">${esc(t('action.viewAll'))}</a></div>
        ${activity.length ? `<div class="feed">${activity.map(feedItem).join('')}</div>` : empty(t('activity.empty'))}
      </section>
      <section class="card">
        <div class="card-head"><h2>${esc(t('overview.runs'))}</h2><a class="link" href="#/runs">${esc(t('action.viewAll'))}</a></div>
        ${runs.length ? `<div class="rows">${runs.map(runRow).join('')}</div>` : empty(t('runs.empty'))}
      </section>
    </div>`
  );
}

/* ------------------------------------------------------- projects */

export function projects(state) {
  if (!state.briefs.length) {
    return (
      pageHeader({
        title: t('projects.title'),
        subtitle: t('projects.subtitle'),
        actions: `<button class="btn primary" data-act="new-project">${icon('plus')}${esc(t('action.newProject'))}</button>`,
      }) + `<div class="card">${empty(t('projects.empty'))}</div>`
    );
  }

  return (
    pageHeader({
      title: t('projects.title'),
      subtitle: t('projects.subtitle'),
      actions: `<button class="btn primary" data-act="new-project">${icon('plus')}${esc(t('action.newProject'))}</button>`,
    }) +
    `<div class="grid-2">${state.briefs
      .map((b) => {
        const tasks = state.tasks;
        const done = tasks.filter((x) => x.status === 'done').length;
        const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
        return `
        <a class="card project-card" href="#/project/${b.number}">
          <div class="card-head">
            <h3>${esc(b.title.replace(/^\[Brief\]\s*/, ''))}</h3>
            ${chip(b.planned ? 'done' : 'todo', b.planned ? t('projects.planned') : t('projects.new'))}
          </div>
          <div class="progress slim"><span style="inline-size:${pct}%"></span></div>
          <footer class="muted">
            <span>#${b.number}</span>
            <span>${esc(t('projects.tasks', { n: tasks.length }))}</span>
            <span>${esc(ago(b.updated_at))}</span>
          </footer>
        </a>`;
      })
      .join('')}</div>`
  );
}

export async function project(state, number) {
  const [{ issue, comments }, prd] = await Promise.all([
    api('GET', `/api/issue?number=${number}`),
    api('GET', '/api/file?path=docs/PRD.md').catch(() => null),
  ]);

  const tasks = state.tasks;
  const done = tasks.filter((x) => x.status === 'done').length;
  const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;

  return (
    pageHeader({
      title: issue.title.replace(/^\[Brief\]\s*/, ''),
      subtitle: `#${issue.number}`,
      back: { href: '#/projects', label: t('nav.projects') },
      actions: `<a class="btn" href="${issue.url}" target="_blank" rel="noopener">${icon('external')}${esc(t('action.github'))}</a>`,
    }) +
    `<div class="progress"><span style="inline-size:${pct}%"></span></div>
     <p class="muted mb"><b>${done}</b> / ${tasks.length} ${esc(t('overview.merged'))}</p>` +
    `<div class="split">
      <div>
        <section class="card">
          <h2>${esc(t('project.brief'))}</h2>
          <div class="md">${markdown(issue.body ?? '')}</div>
        </section>
        <section class="card mt">
          <div class="card-head">
            <h2>${esc(t('project.prd'))}</h2>
            ${prd ? `<a class="link" href="${prd.url}" target="_blank" rel="noopener">${icon('external', 13)}</a>` : ''}
          </div>
          ${prd ? `<div class="md scrollable">${markdown(prd.content)}</div>` : empty(t('project.noPrd'))}
        </section>
      </div>
      <section class="card">
        <h2>${esc(t('project.tasksTitle'))}</h2>
        ${tasks.length ? `<div class="rows">${tasks.map(taskRow).join('')}</div>` : empty(t('tasks.none'))}
        ${comments.length ? `<h2 class="mt">${esc(t('task.comments', { n: comments.length }))}</h2>${comments.map(commentBlock).join('')}` : ''}
      </section>
    </div>`
  );
}

/* ---------------------------------------------------------- board */

export function board(state) {
  const columns = COLUMNS.map((status) => {
    const items = state.tasks.filter((x) => x.status === status);
    return `
    <section class="column" data-status="${status}">
      <header>
        ${chip(status)}
        <span class="count">${items.length}</span>
      </header>
      <div class="column-body">
        ${items.length
          ? items.map((task) => `
            <a class="task-card" href="#/task/${task.number}">
              <span class="num">#${task.number}</span>
              <b>${esc(task.title.replace(/^\[T\d+\]\s*/, ''))}</b>
              <footer>
                ${task.pr ? `<span class="chip ${task.pr.state}">PR #${task.pr.number}</span>` : '<span></span>'}
                <time>${esc(ago(task.updated_at))}</time>
              </footer>
            </a>`).join('')
          : `<p class="column-empty">${esc(t('board.empty'))}</p>`}
      </div>
    </section>`;
  }).join('');

  return (
    pageHeader({ title: t('board.title'), subtitle: t('board.subtitle') }) +
    `<div class="board">${columns}</div>`
  );
}

/* ---------------------------------------------------------- tasks */

const taskRow = (task) => `
  <a class="row" href="#/task/${task.number}">
    <span class="num">#${task.number}</span>
    <span class="row-title">${esc(task.title.replace(/^\[T\d+\]\s*/, ''))}</span>
    ${task.pr ? `<span class="chip ${task.pr.state}">PR #${task.pr.number}</span>` : ''}
    ${chip(task.status)}
    <time>${esc(ago(task.updated_at))}</time>
  </a>`;

export function tasks(state, { filter = 'all', query = '' } = {}) {
  const filters = ['all', ...COLUMNS];
  const visible = state.tasks.filter(
    (task) =>
      (filter === 'all' || task.status === filter) &&
      (!query || task.title.toLowerCase().includes(query.toLowerCase()))
  );

  const bar = `
  <div class="filters">
    <div class="filter-chips">
      ${filters
        .map((f) => {
          const n = f === 'all' ? state.tasks.length : state.tasks.filter((x) => x.status === f).length;
          return `<button class="filter${f === filter ? ' active' : ''}" data-filter="${f}">
            ${esc(f === 'all' ? t('tasks.all') : t(`status.${f}`))}<span>${n}</span>
          </button>`;
        })
        .join('')}
    </div>
    <input class="search" id="taskSearch" placeholder="${esc(t('tasks.search'))}" value="${esc(query)}">
  </div>`;

  return (
    pageHeader({
      title: t('tasks.title'),
      subtitle: t('tasks.subtitle'),
      actions: `<button class="btn" data-act="continue">${icon('play')}${esc(t('action.continue'))}</button>`,
    }) +
    bar +
    `<div class="card">${
      !state.tasks.length ? empty(t('tasks.none'))
        : visible.length ? `<div class="rows">${visible.map(taskRow).join('')}</div>`
        : empty(t('tasks.empty'))
    }</div>`
  );
}

/* ----------------------------------------------------- task detail */

const commentBlock = (c) => `
  <article class="comment">
    <header>
      ${roleChip(c.role)}
      <b>${esc(c.author)}</b>
      <time>${esc(ago(c.created_at))}</time>
    </header>
    <div class="md">${markdown(c.body)}</div>
  </article>`;

export async function task(state, number) {
  const { issue, comments } = await api('GET', `/api/issue?number=${number}`);
  const meta = state.tasks.find((x) => x.number === Number(number));
  const pr = meta?.pr;
  let prDetail = null;
  if (pr) prDetail = await api('GET', `/api/pr?number=${pr.number}`).catch(() => null);

  const actions = [
    `<a class="btn" href="${issue.url}" target="_blank" rel="noopener">${icon('external')}${esc(t('action.github'))}</a>`,
    issue.status === 'blocked'
      ? `<button class="btn" data-act="unblock" data-number="${issue.number}">${esc(t('action.unblock'))}</button>`
      : '',
    issue.state === 'open'
      ? `<button class="btn" data-act="run-dev" data-number="${issue.number}">${icon('play')}${esc(t('action.retry'))}</button>`
      : '',
    pr && pr.state === 'open'
      ? `<button class="btn" data-act="run-qc" data-number="${pr.number}">${icon('play')}${esc(t('action.review'))}</button>`
      : '',
  ].join('');

  const prSection = prDetail
    ? `<section class="card">
        <div class="card-head">
          <h2>${esc(t('task.pr'))} #${prDetail.pr.number}</h2>
          <a class="link" href="${prDetail.pr.url}" target="_blank" rel="noopener">${icon('external', 13)}</a>
        </div>
        <div class="pr-meta">
          ${chip(prDetail.pr.state)}
          <span class="branch">${icon('branch', 13)} <code>${esc(prDetail.pr.branch)}</code></span>
          <span class="diffstat"><b class="add">+${prDetail.pr.additions}</b> <b class="del">−${prDetail.pr.deletions}</b></span>
        </div>
        <h3 class="sub">${esc(t('task.files'))} (${prDetail.files.length})</h3>
        <div class="files">
          ${prDetail.files
            .map((f) => `<div class="file"><code>${esc(f.filename)}</code><span><b class="add">+${f.additions}</b> <b class="del">−${f.deletions}</b></span></div>`)
            .join('')}
        </div>
        ${prDetail.reviews.map(
          (r) => `<article class="comment review">
            <header>
              ${roleChip(r.role)}
              <b>${esc(r.author)}</b>
              ${chip(r.state === 'APPROVED' ? 'done' : r.state === 'CHANGES_REQUESTED' ? 'blocked' : 'todo', r.state.toLowerCase().replace('_', ' '))}
              <time>${r.submitted_at ? esc(ago(r.submitted_at)) : ''}</time>
            </header>
            <div class="md">${markdown(r.body)}</div>
          </article>`
        ).join('')}
      </section>`
    : '';

  return (
    pageHeader({
      title: issue.title.replace(/^\[T\d+\]\s*/, ''),
      subtitle: `#${issue.number}`,
      back: { href: '#/tasks', label: t('nav.tasks') },
      actions,
    }) +
    `<div class="status-strip">${chip(issue.status)}${issue.labels
      .filter((l) => !l.startsWith('status:'))
      .map((l) => `<span class="chip ghost">${esc(l)}</span>`)
      .join('')}</div>` +
    `<div class="split">
      <section class="card">
        <h2>${esc(t('task.description'))}</h2>
        <div class="md">${markdown(issue.body ?? '')}</div>
      </section>
      <div>
        ${prSection}
        <section class="card ${prSection ? 'mt' : ''}">
          <h2>${esc(t('task.conversation'))}</h2>
          ${comments.length ? comments.map(commentBlock).join('') : empty(t('task.noComments'))}
        </section>
      </div>
    </div>`
  );
}

/* ------------------------------------------------------- activity */

const feedItem = (a) => `
  <a class="feed-item" href="#/task/${a.issue}">
    <div class="feed-side">
      ${roleChip(a.role)}
      <time>${esc(ago(a.created_at))}</time>
    </div>
    <div class="feed-main">
      <header><b>${esc(a.author)}</b><span>${esc(t('activity.on'))} #${a.issue} ${esc(a.issue_title)}</span></header>
      <p>${esc(a.excerpt)}</p>
    </div>
  </a>`;

export function activity(state, { role = 'all' } = {}) {
  const roles = ['all', 'po', 'dev', 'qc', 'human'];
  const visible = (state.activity ?? []).filter((a) => role === 'all' || a.role === role);

  return (
    pageHeader({ title: t('activity.title'), subtitle: t('activity.subtitle') }) +
    `<div class="filters">
      <div class="filter-chips">
        ${roles
          .map((r) => {
            const n = r === 'all' ? state.activity.length : state.activity.filter((a) => a.role === r).length;
            return `<button class="filter${r === role ? ' active' : ''}" data-role="${r}">
              ${esc(r === 'all' ? t('tasks.all') : t(`role.${r}`))}<span>${n}</span>
            </button>`;
          })
          .join('')}
      </div>
    </div>` +
    `<div class="card">${visible.length ? `<div class="feed">${visible.map(feedItem).join('')}</div>` : empty(t('activity.empty'))}</div>`
  );
}

/* ----------------------------------------------------------- runs */

const runRow = (r) => {
  const cls = r.status !== 'completed' ? 'in-progress' : r.conclusion === 'success' ? 'done' : r.conclusion === 'cancelled' ? 'todo' : 'blocked';
  const label = r.status !== 'completed' ? r.status.replace('_', ' ') : r.conclusion;
  return `
  <a class="row" href="${r.url}" target="_blank" rel="noopener">
    <span class="row-title">${esc(r.name)}</span>
    <span class="muted">${esc(r.event)}</span>
    ${chip(cls, label)}
    <time>${esc(ago(r.created_at))}</time>
  </a>`;
};

export function runs(state) {
  return (
    pageHeader({
      title: t('runs.title'),
      subtitle: t('runs.subtitle'),
      actions: `<button class="btn primary" data-act="continue">${icon('play')}${esc(t('action.continue'))}</button>`,
    }) +
    `<div class="card">${state.runs?.length ? `<div class="rows">${state.runs.map(runRow).join('')}</div>` : empty(t('runs.empty'))}</div>`
  );
}

/* --------------------------------------------------------- agents */

const PROVIDERS = ['anthropic', 'openai'];

export function agents(state, config) {
  if (!config) return skeleton();
  const cfg = config.agents;

  const cards = ROLES.map((role) => {
    const a = cfg.agents[role] ?? {};
    const secret = config.secrets.find((s) => s.role === role) ?? {};
    return `
    <section class="card agent-editor" data-role="${role}">
      <div class="agent-card-head">
        <span class="avatar ${role}">${icon('agents', 18)}</span>
        <div>
          <b>${esc(t(`role.${role}`))}</b>
          <small>${esc(t(`role.${role}.blurb`))}</small>
        </div>
        <span class="state ${secret.set ? 'set' : 'unset'}">
          ${secret.set ? icon('check', 13) : icon('alert', 13)}
          ${esc(secret.set ? t('agents.keySet', { when: ago(secret.updated_at) }) : t('agents.keyUnset'))}
        </span>
      </div>

      <div class="field">
        <label>${esc(t('agents.key'))} <code>${esc(secret.name ?? '')}</code></label>
        <div class="input-row">
          <input type="password" class="secret-input" autocomplete="off"
            placeholder="${esc(secret.set ? t('agents.keyPlaceholderSet') : t('agents.keyPlaceholder', { name: secret.name ?? '' }))}">
          <button class="btn primary save-secret" data-secret="${esc(secret.name ?? '')}">${esc(t('action.save'))}</button>
        </div>
      </div>

      <div class="grid-3 tight">
        <div class="field">
          <label>${esc(t('agents.model'))}</label>
          <input class="model" value="${esc(a.model ?? '')}">
        </div>
        <div class="field">
          <label>${esc(t('agents.provider'))}</label>
          <select class="provider">
            ${PROVIDERS.map((p) => `<option value="${p}"${(a.provider ?? cfg.defaults.provider) === p ? ' selected' : ''}>${p}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label>${esc(t('agents.steps'))}</label>
          <input class="steps" type="number" min="1" max="200" value="${a.maxSteps ?? 40}">
        </div>
      </div>
    </section>`;
  }).join('');

  const extras = config.secrets
    .filter((s) => !ROLES.includes(s.role))
    .map(
      (s) => `
      <div class="secret-row">
        <div>
          <b>${esc(t(`role.${s.role}`))}</b>
          <small>${esc(t(`role.${s.role}.blurb`))} · <code>${esc(s.name)}</code></small>
        </div>
        <input type="password" class="secret-input" autocomplete="off"
          placeholder="${esc(s.set ? t('agents.keyPlaceholderSet') : t('agents.keyPlaceholder', { name: s.name }))}">
        <span class="state ${s.set ? 'set' : 'unset'}">${esc(s.set ? t('agents.keySet', { when: ago(s.updated_at) }) : t('agents.keyUnset'))}</span>
        <button class="btn save-secret" data-secret="${esc(s.name)}">${esc(t('action.save'))}</button>
      </div>`
    )
    .join('');

  return (
    pageHeader({
      title: t('agents.title'),
      subtitle: t('agents.subtitle'),
      actions: `<button class="btn primary" data-act="save-models">${esc(t('agents.saveModels'))}</button>`,
    }) +
    (config.ghCli ? '' : `<div class="banner warn">${icon('alert', 18)}<div>${esc(t('agents.noGh'))}</div></div>`) +
    `<p class="note">${icon('key', 14)} ${esc(t('agents.keyNote'))}</p>` +
    `<div class="agent-grid">${cards}</div>` +
    `<section class="card mt">
      <h2>${esc(t('agents.extra'))}</h2>
      <div class="secret-rows">${extras}</div>
    </section>` +
    `<p class="note mt">${esc(t('agents.note'))}</p>`
  );
}

/* ------------------------------------------------------- settings */

export function settings(state, config, health) {
  const policy = config?.agents?.policy ?? {};
  return (
    pageHeader({ title: t('settings.title'), subtitle: t('settings.subtitle') }) +
    `<div class="split">
      <div>
        <section class="card">
          <h2>${esc(t('settings.connection'))}</h2>
          <div class="field">
            <label for="repoInput">${esc(t('settings.repo'))}</label>
            <input id="repoInput" value="${esc(health?.repo ?? state.repo ?? '')}" placeholder="owner/name" autocomplete="off">
          </div>
          <div class="field">
            <label for="tokenInput">${esc(t('settings.token'))}</label>
            <input id="tokenInput" type="password" placeholder="${esc(t('settings.tokenHint'))}" autocomplete="off">
          </div>
          <div class="right"><button class="btn primary" data-act="save-conn">${esc(t('action.save'))}</button></div>
        </section>

        <section class="card mt">
          <h2>${esc(t('settings.language'))}</h2>
          <div class="lang-row">
            <button class="lang" data-lang="fa">فارسی</button>
            <button class="lang" data-lang="en">English</button>
          </div>
        </section>
      </div>

      <div>
        <section class="card">
          <h2>${esc(t('settings.policy'))}</h2>
          <div class="field inline">
            <label>${esc(t('settings.qcRounds'))}</label>
            <input class="policy" data-key="maxQcRounds" type="number" min="1" max="10" value="${policy.maxQcRounds ?? 3}">
          </div>
          <div class="field inline">
            <label>${esc(t('settings.tasksPerRun'))}</label>
            <input class="policy" data-key="maxTasksPerRun" type="number" min="1" max="50" value="${policy.maxTasksPerRun ?? 10}">
          </div>
          <div class="field inline">
            <label>${esc(t('settings.autoMerge'))}</label>
            <input class="policy" data-key="autoMerge" type="checkbox" ${policy.autoMerge ? 'checked' : ''}>
          </div>
          <div class="right"><button class="btn primary" data-act="save-models">${esc(t('action.save'))}</button></div>
        </section>

        <section class="card mt">
          <h2>${esc(t('settings.docs'))}</h2>
          <div class="rows">
            ${['README.md', 'docs/SETUP.md', 'docs/CONTROL-PANEL.md', 'docs/DESIGN.md']
              .map(
                (f) => `<a class="row" href="https://github.com/${esc(state.repo ?? '')}/blob/main/${f}" target="_blank" rel="noopener">
                  ${icon('doc', 14)}<span class="row-title">${esc(f)}</span>${icon('external', 13)}
                </a>`
              )
              .join('')}
          </div>
        </section>
      </div>
    </div>`
  );
}

export { feedItem, runRow, taskRow };
