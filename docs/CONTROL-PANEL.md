# Control panel

A local dashboard for the pipeline. It shows what every agent is doing, what each one said, and lets you set the API keys and start a run without leaving the page.

```bash
node client/server.mjs
```

Then open <http://127.0.0.1:4317>.

It binds to the loopback interface only — nothing is exposed to the network, and there is nothing to deploy.

## What it shows

**Board** — the backlog in execution order, each task with its status, its pull request, and how long since it moved. Click any task to read its description, acceptance criteria, and the whole comment thread. Click a `PR #n` chip to see the diff summary and the QC review.

**Activity** — every comment across the repository, newest first, tagged with the agent that wrote it. This is the fastest way to see *why* something is stuck: QC's findings, the developer's reply, and the pipeline's own run reports all land here.

**Runs** — recent workflow runs with their status, linked to the full logs on GitHub.

**Settings** — API keys, models, and policy.

The board polls every twelve seconds, and the dot beside the repository name turns green while a pipeline run is in flight.

## Setting the API keys

The **API keys** section has one field per role. Paste a key, press Save, and it goes straight into a GitHub Actions secret.

The panel shells out to the GitHub CLI to do this, because a repository secret has to be encrypted with the repository's public key before it is sent. That means:

- the key is never written to disk by the panel
- the key never passes through anything but your machine and GitHub
- the panel can tell you **whether** a key is set and when it last changed, never what it is — GitHub cannot read it back either, by design

Install the CLI from [cli.github.com](https://cli.github.com) if the section tells you it is missing. Without it you can still set the secrets in the repository settings by hand; everything else in the panel works either way.

| Field | Secret | Used by |
| --- | --- | --- |
| Product Owner | `PO_API_KEY` | the agent that writes the PRD and backlog |
| Developer | `DEV_API_KEY` | the agent that writes the code |
| QC | `QC_API_KEY` | the agent that reviews and merges |
| Shared fallback | `CODENEVIS_API_KEY` | any agent whose own key is missing |
| GitHub token | `GH_PAT` | optional — lets QC post a real approval |

## Models and policy

The **Models** section edits `config/agents.json` — model id, provider, and the tool-call budget per role. **Policy** covers the QC round cap, how many tasks a run attempts, and whether an approved pull request merges automatically.

These write to the file in your working copy. **Commit and push for them to reach Actions** — the panel says so after each save, because a change that only exists locally will not affect the next run.

## Starting work

**New project** opens a dialog: a title, a description in plain language, and a checkbox to start the pipeline right away. It creates the brief issue with the `agent:po` label and dispatches the pipeline.

**Continue backlog** dispatches a run that skips planning and picks up the next unfinished task. Use it after a run hits its task cap, or after you have unblocked something by hand.

## Connection

The panel finds your repository from the `origin` remote and your token from `gh auth token` or `$GITHUB_TOKEN`. Override either under **Settings → Connection**; the values are stored in `.codenevis/local.json`, which is gitignored.

The token needs `repo` scope to read issues and dispatch workflows. Reading which secrets exist also needs admin access to the repository — if that part shows everything as unset while the repository settings disagree, that is the reason, and it does not affect anything else.

## Troubleshooting

**"No GitHub token found"** — run `gh auth login`, or paste a token under Settings → Connection.

**Saving a key fails with a `gh` error** — check `gh auth status`. The CLI needs to be signed in as an account with admin access to the repository.

**A dispatch returns 404** — the workflow file has to exist on the default branch before it can be dispatched. Push first.

**The board is empty but the repository has issues** — the panel only lists issues labelled `task` and `agent:po`. Those labels are created on the pipeline's first run.
