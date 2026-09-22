# Control panel

A local dashboard for the pipeline. It shows what every agent is doing, what each one said, and lets you set the API keys and start a run without leaving the page.

```bash
node client/server.mjs
```

Then open <http://127.0.0.1:4317>.

It binds to the loopback interface only — nothing is exposed to the network, and there is nothing to deploy. The interface ships in Persian and English; the toggle sits at the bottom of the sidebar and switches direction along with the language.

## The pages

| Page | What it is for |
| --- | --- |
| **Overview** | The state of the team in one screen: whether the pipeline is running, how much of the backlog is merged, and a card per agent showing its model, whether its key is set, and which task it is on right now. |
| **Projects** | One card per brief, with its progress. Open one to read the brief, the generated PRD, and the tasks it produced. |
| **Board** | A column per status — waiting, building, in review, changes asked, done, needs you. The fastest way to see where work is piling up. |
| **Tasks** | The backlog in execution order, filterable by status and searchable by title. |
| **Task detail** | The description, the acceptance criteria as a real checklist, the pull request with its file list and diff stat, and the full conversation between the developer and QC. Contextual buttons let you re-run the developer, ask for another review, or unblock a task the pipeline gave up on. |
| **Activity** | Every comment in the repository, newest first, filterable by agent. This is the fastest way to see *why* something is stuck. |
| **Runs** | Recent workflow runs with their status, linked to the full logs. |
| **Agents** | The model, provider, step budget and API key for each role. |
| **Settings** | Connection, pipeline policy, language, and links to the documentation. |

The board polls every twelve seconds, and the dot in the sidebar turns green while a run is in flight.

## Setting the API keys

The **Agents** page has a key field per role. Paste a key, press Save, and it goes straight into a GitHub Actions secret.

The panel shells out to the GitHub CLI to do this, because a repository secret has to be encrypted with the repository's public key before it is sent. That means:

- the key is never written to disk by the panel
- the key never passes through anything but your machine and GitHub
- the panel can tell you **whether** a key is set and when it last changed, never what it is — GitHub cannot read it back either, by design

Install the CLI from [cli.github.com](https://cli.github.com) if the page tells you it is missing. Without it you can still set the secrets in the repository settings by hand; everything else in the panel works either way.

| Field | Secret | Used by |
| --- | --- | --- |
| Product Owner | `PO_API_KEY` | the agent that writes the PRD and backlog |
| Developer | `DEV_API_KEY` | the agent that writes the code |
| QC | `QC_API_KEY` | the agent that reviews and merges |
| Shared key | `CODENEVIS_API_KEY` | any agent whose own key is missing |
| GitHub token | `GH_PAT` | optional — lets QC post a real approval |

## Models and policy

The **Agents** page also edits `config/agents.json`: model id, provider, and the tool-call budget per role. **Settings → Policy** covers the QC round cap, how many tasks a run attempts, and whether an approved pull request merges automatically.

These write to the file in your working copy. **Commit and push for them to reach Actions** — a change that only exists locally will not affect the next run.

## Starting and steering work

**New project** opens a dialog: a title, a description in plain language, and a checkbox to start the pipeline right away. It creates the brief issue with the `agent:po` label and dispatches the pipeline.

**Continue backlog** dispatches a run that skips planning and picks up the next unfinished task. Use it after a run hits its task cap, or after you have unblocked something by hand.

From a task's own page you can also:

- **Run the developer again** — re-dispatch the developer agent for that task
- **Review again** — re-dispatch QC for its pull request
- **Unblock** — clear `needs:human` and put the task back in the queue

## Connection

The panel finds your repository from the `origin` remote and your token from `gh auth token` or `$GITHUB_TOKEN`. Override either under **Settings → Connection**; the values are stored in `.codenevis/local.json`, which is gitignored.

The token needs `repo` scope to read issues and dispatch workflows. Reading which secrets exist also needs admin access to the repository — if that part shows everything as unset while the repository settings disagree, that is the reason, and it does not affect anything else.

## Troubleshooting

**"No GitHub token found"** — run `gh auth login`, or paste a token under Settings → Connection.

**Saving a key fails with a `gh` error** — check `gh auth status`. The CLI needs to be signed in as an account with admin access to the repository.

**A dispatch returns 404** — the workflow file has to exist on the default branch before it can be dispatched. Push first.

**The board is empty but the repository has issues** — the panel only lists issues labelled `task` and `agent:po`. Those labels are created on the pipeline's first run.

## Layout

```
client/
  server.mjs        local API server — GitHub proxy, secrets, config, dispatch
  public/
    index.html      the shell: sidebar, topbar, dialog
    style.css       the design system, light and dark, LTR and RTL
    i18n.js         Persian and English strings
    ui.js           fetch wrapper, icons, markdown, chips, toast
    views.js        one renderer per page
    app.js          router, shell, and every action
```

No build step and no dependencies — the browser loads the ES modules directly.
