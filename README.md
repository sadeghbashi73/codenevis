# codenevis

An autonomous software team that lives in a GitHub repository.

You open an issue describing what you want. A **Product Owner** agent turns it into a PRD and an ordered backlog. A **Developer** agent implements each task on its own branch. A **QC** agent reviews the pull request and either merges it or sends it back with specific findings. Then it moves to the next task.

Everything runs on GitHub Actions. There is no server to operate, no dashboard to log into, and no local process to keep alive. The repository *is* the product, the issue tracker *is* the backlog, and the pull requests *are* the audit trail.

```
issue (your brief)
   │
   ├─▶ PO agent ──▶ docs/PRD.md, docs/ARCHITECTURE.md
   │                 └─▶ task issues  [T01] [T02] [T03] …
   │
   └─▶ for each task, in order:
           Developer agent ──▶ branch + pull request
                                  │
                                  ▼
                            QC agent ──▶ approve ──▶ merge ──▶ next task
                                  │
                                  └───▶ request changes ──┐
                                            ▲             │
                                            └─────────────┘
                                         (up to 3 rounds, then a human)
```

## Getting started

**1. Add the API keys.** Each agent has its own, so you can give the roles different providers, different models, and separate billing.

```bash
./scripts/setup-secrets.sh
```

Or by hand, under **Settings → Secrets and variables → Actions**:

| Secret | Used by | Required |
| --- | --- | --- |
| `PO_API_KEY` | Product Owner agent | yes |
| `DEV_API_KEY` | Developer agent | yes |
| `QC_API_KEY` | QC agent | yes |
| `CODENEVIS_API_KEY` | fallback for any agent missing its own key | no |
| `GH_PAT` | lets QC post real approvals and lets agent commits trigger other workflows | no |

**2. Allow Actions to open pull requests.** Under **Settings → Actions → General → Workflow permissions**, select *Read and write permissions* and tick *Allow GitHub Actions to create and approve pull requests*. Without this the developer agent cannot open its PR.

**3. Describe your project.** Open a new issue with the **Project brief** template. It arrives labelled `agent:po`, which starts the pipeline on its own.

That is the whole setup. Watch it work in the **Actions** tab.

## Choosing models

`config/agents.json` is where each role's model lives. Keys never go in this file — it only names the secret that holds one.

```json
{
  "agents": {
    "po":  { "model": "claude-opus-5",   "apiKeyEnv": "PO_API_KEY",  "maxSteps": 30 },
    "dev": { "model": "claude-opus-5",   "apiKeyEnv": "DEV_API_KEY", "maxSteps": 80 },
    "qc":  { "model": "claude-sonnet-5", "apiKeyEnv": "QC_API_KEY",  "maxSteps": 50 }
  }
}
```

Any OpenAI-compatible endpoint works too — OpenRouter, Groq, Together, a local vLLM:

```json
"dev": {
  "provider": "openai",
  "baseUrl": "https://openrouter.ai/api/v1",
  "model": "qwen/qwen3-coder:free",
  "apiKeyEnv": "DEV_API_KEY"
}
```

You can also override any of it without a commit, using repository *variables*: `DEV_MODEL`, `QC_PROVIDER`, `PO_BASE_URL`, and so on.

Check your wiring at any time:

```bash
node agents/doctor.mjs
```

## The control panel

A local dashboard for the whole pipeline — no deployment, no account, loopback only.

```bash
node client/server.mjs
```

Open <http://127.0.0.1:4317> and you get the backlog in execution order, every comment each agent has made, the workflow runs, and a settings page where you paste the API keys. Keys are encrypted by the GitHub CLI before they leave the machine and written straight into repository secrets — the panel can tell you whether a key is set, never what it is.

**New project** creates the brief issue and starts the pipeline. **Continue backlog** picks up the next unfinished task. See `docs/CONTROL-PANEL.md`.

## Driving it by hand

The pipeline runs end to end on its own, but every stage is also a workflow you can dispatch from the Actions tab:

| Workflow | What it does |
| --- | --- |
| **Agent pipeline** | The full loop. Give it a brief issue number, or leave it empty to continue an existing backlog. |
| **PO agent** | Plans one brief and stops, so you can read and edit the backlog before any code is written. |
| **Developer agent** | Implements one task issue. Useful for retrying a single task. |
| **QC agent** | Reviews one pull request. Also fires automatically on any PR labelled `agent:qc` — including one a human wrote. |

Labels tell you where everything stands: `status:todo`, `status:in-progress`, `status:review`, `status:changes-requested`, `status:done`, and `needs:human` when the pipeline gave up and wants you.

## How the safety rails work

- **Agents cannot edit the pipeline.** Writes to `.github/workflows/`, `agents/`, and `config/agents.json` are rejected at the tool layer, and QC blocks any PR that touches them anyway. An agent cannot rewrite its own instructions or exfiltrate a key by editing a workflow.
- **Shell commands run without credentials.** Every API key and token is stripped from the environment before an agent's `run` command executes, so a key cannot end up in a commit, a log, or a test fixture.
- **Paths are sandboxed** to the repository root.
- **Review rounds are capped.** After three unsuccessful rounds the task is labelled `needs:human` and the pipeline moves on rather than burning tokens on a loop that is not converging.
- **Every step is reviewable.** Nothing reaches the base branch except through a pull request with a QC review attached.

## Layout

```
agents/
  pipeline.mjs      the orchestrator — runs the whole loop in one job
  po.mjs            brief   → PRD + backlog issues
  dev.mjs           task    → branch + pull request
  qc.mjs            PR      → approve and merge, or send back
  doctor.mjs        configuration check
  prompts/          the role definitions, as plain markdown
  lib/
    providers.mjs   Anthropic and OpenAI-compatible adapters
    runner.mjs      the agent loop
    tools.mjs       sandboxed file and shell tools
    github.mjs      GitHub REST client
    pipeline.mjs    labels, task format, git plumbing
    config.mjs      per-agent config resolution
client/
  server.mjs        the control panel's local server
  public/           its single-page UI
config/agents.json  models, providers, budgets, policy
scripts/
  selftest.mjs      tests for the pipeline itself
  setup-secrets.sh  interactive key setup
.github/workflows/  the five workflows
```

## Cost

Each task costs one developer run plus one QC run, and a re-review for every round QC sends it back. A ten-task project is roughly twenty to thirty model runs. Point the QC role at a cheaper model in `config/agents.json`, lower `maxSteps`, or lower `maxTasksPerRun` to keep a run bounded.

`docs/SETUP.md` walks through the first run in detail, `docs/CONTROL-PANEL.md` covers the dashboard, and `docs/DESIGN.md` explains why the pipeline is shaped the way it is.
