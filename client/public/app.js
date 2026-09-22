/* Router, shell rendering, and every action the panel can take. */

import { t, setLang, lang } from './i18n.js';
import { $, $$, api, toast, icon, esc } from './ui.js';
import * as views from './views.js';

let state = { tasks: [], briefs: [], activity: [], runs: [], counts: {} };
let config = null;
let health = {};
let pollTimer = null;

/** Per-page UI state that should survive a background refresh. */
const local = { taskFilter: 'all', taskQuery: '', activityRole: 'all' };

/* ------------------------------------------------------------ nav */

const NAV = [
  { section: 'work', items: ['overview', 'projects', 'board', 'tasks'] },
  { section: 'system', items: ['activity', 'runs', 'agents', 'settings'] },
];

function renderNav() {
  const route = currentRoute().page;
  $('#nav').innerHTML = NAV.map(
    ({ section, items }) => `
    <div class="nav-section">
      <span class="nav-label">${esc(t(`nav.section.${section}`))}</span>
      ${items
        .map(
          (name) => `<a class="nav-item${route === name ? ' active' : ''}" href="#/${name === 'overview' ? '' : name}">
            ${icon(name)}<span>${esc(t(`nav.${name}`))}</span>
            ${name === 'tasks' && state.counts?.blocked ? `<em class="badge">${state.counts.blocked}</em>` : ''}
          </a>`
        )
        .join('')}
    </div>`
  ).join('');
}

function renderShell() {
  $('#brandRepo').textContent = state.repo ?? '';
  $('#pulse').className = `pulse${state.pipelineRunning ? ' live' : ''}`;
  $('#langToggle').textContent = lang === 'fa' ? 'EN' : 'FA';
  $('#continueBtn').disabled = Boolean(state.pipelineRunning);
  $('#continueBtn').innerHTML = `${icon('play')}<span>${esc(t('action.continue'))}</span>`;
  $('#refreshBtn').title = t('action.refresh');
  renderNav();
}

/* --------------------------------------------------------- router */

function currentRoute() {
  const hash = location.hash.replace(/^#\/?/, '');
  const [page = '', param] = hash.split('/');
  return { page: page || 'overview', param };
}

const PAGES = {
  overview: () => views.overview(state, config),
  projects: () => views.projects(state),
  project: (n) => views.project(state, n),
  board: () => views.board(state),
  tasks: () => views.tasks(state, { filter: local.taskFilter, query: local.taskQuery }),
  task: (n) => views.task(state, n),
  activity: () => views.activity(state, { role: local.activityRole }),
  runs: () => views.runs(state),
  agents: () => views.agents(state, config),
  settings: () => views.settings(state, config, health),
};

let renderToken = 0;

async function render() {
  const { page, param } = currentRoute();
  const view = PAGES[page] ?? PAGES.overview;
  const token = ++renderToken;
  const main = $('#main');

  translateStatic();
  renderShell();

  try {
    const html = await view(param);
    if (token !== renderToken) return; // a newer navigation won
    main.innerHTML = html;
    main.scrollTop = 0;
    if (page === 'tasks') {
      const search = $('#taskSearch');
      if (search && local.taskQuery) {
        search.focus();
        search.setSelectionRange(search.value.length, search.value.length);
      }
    }
  } catch (err) {
    if (token !== renderToken) return;
    main.innerHTML = `<div class="card"><div class="empty">${esc(err.message)}</div></div>`;
  }
}

window.addEventListener('hashchange', () => render());

/* ----------------------------------------------------------- data */

async function refresh({ quiet = false } = {}) {
  try {
    state = await api('GET', '/api/state');
    if (!quiet) await render();
    else renderShell();
  } catch (err) {
    toast(err.message, true);
  }
}

async function loadConfig() {
  config = await api('GET', '/api/config');
}

/* -------------------------------------------------------- actions */

const ACTIONS = {
  'new-project': () => $('#briefDialog').showModal(),

  continue: async () => {
    await api('POST', '/api/dispatch', { workflow: 'pipeline', inputs: { skip_po: true, max_tasks: '5' } });
    toast(t('toast.pipelineStarted'));
    setTimeout(() => refresh(), 2500);
  },

  'run-dev': async (el) => {
    await api('POST', '/api/dispatch', { workflow: 'dev', inputs: { task_issue: el.dataset.number } });
    toast(t('toast.dispatched'));
    setTimeout(() => refresh(), 2500);
  },

  'run-qc': async (el) => {
    await api('POST', '/api/dispatch', { workflow: 'qc', inputs: { pr_number: el.dataset.number } });
    toast(t('toast.dispatched'));
    setTimeout(() => refresh(), 2500);
  },

  unblock: async (el) => {
    await api('POST', '/api/labels', {
      number: Number(el.dataset.number),
      remove: ['needs:human', 'status:changes-requested'],
      add: ['status:todo', 'agent:dev'],
    });
    toast(t('toast.unblocked'));
    await refresh();
  },

  'save-models': async () => {
    const agents = {};
    for (const card of $$('.agent-editor')) {
      const role = card.dataset.role;
      agents[role] = {
        ...config.agents.agents[role],
        model: $('.model', card).value.trim(),
        provider: $('.provider', card).value,
        maxSteps: Number($('.steps', card).value),
      };
    }
    const policy = {};
    for (const input of $$('.policy')) {
      policy[input.dataset.key] = input.type === 'checkbox' ? input.checked : Number(input.value);
    }
    const res = await api('POST', '/api/config', {
      agents: Object.keys(agents).length ? agents : undefined,
      policy: Object.keys(policy).length ? policy : undefined,
    });
    config.agents = res.agents;
    toast(t('toast.modelsSaved'));
  },

  'save-conn': async () => {
    await api('POST', '/api/settings', {
      repo: $('#repoInput').value.trim() || undefined,
      token: $('#tokenInput').value.trim() || undefined,
    });
    $('#tokenInput').value = '';
    toast(t('toast.connSaved'));
    health = await api('GET', '/api/health');
    await refresh();
  },
};

/* --------------------------------------------------------- events */

document.addEventListener('click', async (event) => {
  const langBtn = event.target.closest('[data-lang], #langToggle');
  if (langBtn) {
    const next = langBtn.dataset.lang ?? (lang === 'fa' ? 'en' : 'fa');
    setLang(next);
    await render();
    return;
  }

  const filter = event.target.closest('[data-filter]');
  if (filter) {
    local.taskFilter = filter.dataset.filter;
    return render();
  }

  const roleFilter = event.target.closest('[data-role]:not(.agent-editor)');
  if (roleFilter && roleFilter.classList.contains('filter')) {
    local.activityRole = roleFilter.dataset.role;
    return render();
  }

  const saveSecret = event.target.closest('.save-secret');
  if (saveSecret) {
    const scope = saveSecret.closest('.agent-editor, .secret-row');
    const input = $('.secret-input', scope);
    if (!input.value.trim()) return toast(t('toast.emptyField'), true);
    const original = saveSecret.textContent;
    saveSecret.disabled = true;
    saveSecret.textContent = t('action.saving');
    try {
      const res = await api('POST', '/api/secret', { name: saveSecret.dataset.secret, value: input.value });
      config.secrets = res.secrets;
      toast(t('toast.keySaved', { name: saveSecret.dataset.secret }));
      await render();
    } catch (err) {
      toast(err.message, true);
      saveSecret.disabled = false;
      saveSecret.textContent = original;
    }
    return;
  }

  const actionEl = event.target.closest('[data-act]');
  if (actionEl) {
    const run = ACTIONS[actionEl.dataset.act];
    if (!run) return;
    actionEl.disabled = true;
    try {
      await run(actionEl);
    } catch (err) {
      toast(err.message, true);
    } finally {
      actionEl.disabled = false;
    }
  }
});

document.addEventListener('input', (event) => {
  if (event.target.id === 'taskSearch') {
    local.taskQuery = event.target.value;
    clearTimeout(document.searchTimer);
    document.searchTimer = setTimeout(render, 180);
  }
});

$('#refreshBtn').addEventListener('click', async () => {
  $('#refreshBtn').classList.add('spinning');
  await refresh();
  setTimeout(() => $('#refreshBtn').classList.remove('spinning'), 400);
});

$('#continueBtn').addEventListener('click', () => ACTIONS.continue().catch((e) => toast(e.message, true)));
$('#newProjectBtn').addEventListener('click', () => $('#briefDialog').showModal());
$('#menuBtn').addEventListener('click', () => document.body.classList.toggle('nav-open'));
$('#scrim').addEventListener('click', () => document.body.classList.remove('nav-open'));

$('#briefForm').addEventListener('submit', async (event) => {
  if (event.submitter?.value !== 'create') return;
  const title = $('#briefTitle').value.trim();
  const description = $('#briefBody').value.trim();
  if (!title || !description) return;
  try {
    const { number } = await api('POST', '/api/brief', { title, description });
    $('#briefTitle').value = '';
    $('#briefBody').value = '';
    if ($('#briefStart').checked) {
      await api('POST', '/api/dispatch', { workflow: 'pipeline', inputs: { brief_issue: String(number), max_tasks: '5' } });
      toast(t('toast.projectPlanning', { n: number }));
    } else {
      toast(t('toast.projectCreated', { n: number }));
    }
    location.hash = `#/project/${number}`;
    setTimeout(() => refresh(), 2500);
  } catch (err) {
    toast(err.message, true);
  }
});

/** Translate the parts of the dialog that live in the static HTML. */
function translateStatic() {
  $('#dlgTitle').textContent = t('dialog.newProject');
  $('#dlgHint').textContent = t('dialog.newProjectHint');
  $('#lblTitle').textContent = t('dialog.title');
  $('#lblBody').textContent = t('dialog.body');
  $('#lblStart').textContent = t('dialog.startNow');
  $('#briefTitle').placeholder = t('dialog.titlePlaceholder');
  $('#briefBody').placeholder = t('dialog.bodyPlaceholder');
  $('#dlgCancel').textContent = t('action.cancel');
  $('#dlgCreate').textContent = t('action.create');
  $('#newProjectBtn').innerHTML = `${icon('plus')}<span>${esc(t('action.newProject'))}</span>`;
}

/* ----------------------------------------------------------- boot */

(async function boot() {
  setLang(lang);
  health = await api('GET', '/api/health').catch(() => ({}));

  await Promise.all([
    refresh({ quiet: true }),
    loadConfig().catch(() => {}),
  ]);

  if (!health.tokenPresent) {
    toast(t('toast.noToken'), true);
    location.hash = '#/settings';
  }

  await render();

  const startPolling = () => {
    clearInterval(pollTimer);
    pollTimer = setInterval(async () => {
      const wasRunning = state.pipelineRunning;
      await refresh({ quiet: true });
      // Re-render the page only when something the page shows has changed.
      if (wasRunning !== state.pipelineRunning || ['overview', 'board', 'tasks', 'runs'].includes(currentRoute().page)) {
        await render();
      }
    }, 12000);
  };

  startPolling();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clearInterval(pollTimer);
    else {
      refresh();
      startPolling();
    }
  });
})();
