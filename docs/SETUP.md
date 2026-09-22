# Setup

## 1. API keys

Each agent reads its own secret. Give them separate keys and you get separate rate limits, separate billing lines, and the freedom to run the roles on different providers — an expensive model for the developer, a cheap one for the reviewer.

```bash
./scripts/setup-secrets.sh
```

The script prompts for each key and writes it straight into GitHub Actions secrets through the `gh` CLI. Nothing touches disk.

To do it manually, go to **Settings → Secrets and variables → Actions → New repository secret**:

- `PO_API_KEY`
- `DEV_API_KEY`
- `QC_API_KEY`

If you only have one key, set `CODENEVIS_API_KEY` instead. Every agent falls back to it when its dedicated secret is missing.

### Where the keys come from

- **Anthropic** (the default): <https://console.anthropic.com/settings/keys> — a key starting `sk-ant-`.
- **OpenRouter** or any OpenAI-compatible provider: set the agent's `provider` to `openai` and its `baseUrl` to the endpoint, then use that provider's key.

## 2. Repository permissions

Under **Settings → Actions → General → Workflow permissions**:

- Select **Read and write permissions**
- Tick **Allow GitHub Actions to create and approve pull requests**

The developer agent cannot open a pull request without both.

## 3. Optional: a personal access token

Add `GH_PAT` — a fine-grained or classic token with `repo` and `workflow` scopes — to get two things:

- QC posts a genuine **Approved** review instead of a comment. GitHub refuses to let an identity approve its own pull request, and without a PAT both the developer and the reviewer are `github-actions[bot]`.
- Commits made by the agents can trigger other workflows. `GITHUB_TOKEN` deliberately cannot, to prevent runaway recursion.

The pipeline works without it. The review just shows up as a comment.

## 4. Your first project

Open a new issue using the **Project brief** template. Describe what you want in plain language; you do not need to specify a stack unless you care about one.

The template applies the `agent:po` label, which starts **Agent pipeline** automatically. To start it manually instead, go to **Actions → Agent pipeline → Run workflow** and give it the issue number.

### What happens

1. The PO agent reads your brief, commits `docs/PRD.md` and `docs/ARCHITECTURE.md`, and opens one issue per task — `[T01]`, `[T02]`, and so on.
2. For each task in order: the developer agent branches from `main`, implements it, runs the tests, and opens a pull request.
3. The QC agent checks out that branch, re-runs the tests itself, and either merges or posts findings and sends it back.
4. A comment on your original issue summarises the run.

A run attempts five tasks by default. Re-run the workflow with the brief field empty to continue where it left off.

## 5. Tuning

`config/agents.json`:

| Setting | Meaning |
| --- | --- |
| `agents.<role>.model` | Which model that role uses |
| `agents.<role>.provider` | `anthropic`, or `openai` for anything OpenAI-compatible |
| `agents.<role>.baseUrl` | Endpoint, for OpenAI-compatible providers |
| `agents.<role>.maxSteps` | Tool-call budget for one run — the main cost lever |
| `agents.<role>.temperature` | Lower for QC, higher for planning |
| `policy.maxQcRounds` | Review rounds before a task is escalated to a human |
| `policy.autoMerge` | Set `false` to have QC approve but leave merging to you |
| `policy.maxTasksPerRun` | Upper bound on tasks attempted per workflow run |
| `policy.baseBranch` | Defaults to `main` |

Repository **variables** override the file without a commit: `PO_MODEL`, `DEV_MODEL`, `QC_MODEL`, `PO_PROVIDER`, `DEV_PROVIDER`, `QC_PROVIDER`, `PO_BASE_URL`, `DEV_BASE_URL`, `QC_BASE_URL`.

The role definitions themselves are plain markdown in `agents/prompts/`. Editing `dev.md` changes how the developer agent works; there is no hidden prompt anywhere else.

## Troubleshooting

**`No API key for the "dev" agent`** — the `DEV_API_KEY` secret is missing or empty. Run `node agents/doctor.mjs` locally with the key exported to confirm the wiring.

**`GitHub POST /repos/.../pulls -> 403`** — workflow permissions are still read-only, or *Allow GitHub Actions to create and approve pull requests* is unticked.

**A task is labelled `needs:human`** — QC sent it back three times without converging, or the developer agent produced no changes. Read the findings on the task issue, fix it yourself, then re-run **Agent pipeline** with the brief field empty to continue the backlog.

**The pipeline did nothing on a labelled issue** — label-triggered runs only fire for `agent:po`, and only when the workflow file is already on the default branch. Push first, label second.

**Runs are too expensive** — lower `maxSteps` for the developer, point QC at a cheaper model, and lower `maxTasksPerRun` so each workflow run is bounded.
