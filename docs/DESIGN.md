# Design notes

Why the pipeline is shaped the way it is. Read this before changing it.

## The loop runs in one job

The obvious design is one workflow per agent, each triggering the next: the PO workflow creates task issues, an issue-created trigger starts the developer workflow, a PR-opened trigger starts QC, a merge trigger starts the next task.

That design does not work with `GITHUB_TOKEN`. GitHub deliberately refuses to let events caused by the default token trigger further workflow runs — otherwise a workflow that pushes a commit would trigger itself forever. So a chain of workflows needs a personal access token in every link, and the pipeline breaks silently for anyone who did not set one up.

`agents/pipeline.mjs` sidesteps this by running the entire loop inside a single job. It calls the agents as child processes and orchestrates them in a plain `while` loop. No cross-workflow triggering, no PAT required, and the whole run is one readable log.

The cost is the six-hour job limit, which is why `policy.maxTasksPerRun` exists. When a run hits the cap it reports which task is next; dispatching the workflow again picks up exactly there, because all the state lives in GitHub issues and labels rather than in the job.

## Each agent is its own process

`spawnSync` rather than an import. An agent that throws, leaks memory, or wedges on a runaway shell command takes down its own process and nothing else — the orchestrator sees a non-zero exit, labels the task `needs:human`, and moves on. It also means each agent gets a clean environment holding only its own API key.

## State lives in GitHub, not in the runner

Every decision the pipeline makes is reconstructed from issues, labels, and comments:

- what to build next — the open issue labelled `task` with the lowest `order` marker
- whether a brief was planned — the `po:done` label
- how many times QC has bounced a task — comments carrying the `<!-- codenevis:qc-changes -->` marker
- whether a task is converging — the `needs:human` label

Nothing is cached between runs. A run can be cancelled at any point and the next one resumes correctly, because there is no in-memory state to lose. It also means you can intervene by hand — relabel an issue, close a task, edit acceptance criteria — and the pipeline respects it on the next run.

## Agents cannot touch the pipeline

Three layers, because one is not enough:

1. `Workspace.assertWritable` rejects writes to `.github/workflows/`, `agents/`, and `config/agents.json` at the tool layer.
2. `Workspace.safeEnv` strips every API key and token from the environment before any shell command runs, so a `run` call cannot read a key, and a leaked key cannot end up in a commit or a test fixture.
3. QC blocks any pull request whose diff touches those paths, regardless of what the model concluded — the check in `qc.mjs` runs after the verdict and overrides it.

The first layer is the one that matters; the other two exist because a model that finds a way around the first should still not be able to do damage.

## QC cannot rubber-stamp by accident

The QC agent checks out the pull request head and runs the test suite itself. The developer agent's claim that tests pass is treated as a hypothesis, not evidence — that is stated explicitly in `agents/prompts/qc.md`, and the developer's own `tests_passed: false` is surfaced as a comment on the PR so the reviewer cannot miss it.

`createReview` falls back from `APPROVE` to a comment review when GitHub returns 422, which happens whenever the developer and the reviewer are the same identity — the default when no `GH_PAT` is configured. The merge itself still goes through; only the review label changes.

## Review rounds are capped

Three rounds by default. A developer and a reviewer that disagree can ping-pong indefinitely, and each round costs two model runs. When the cap is hit the task is labelled `needs:human` and the orchestrator moves to the next one rather than stalling the backlog behind one bad task.

`agents/prompts/qc.md` tells the reviewer about the cap on the final round, so it can weigh "block this again" against "approve with notes and let a human see it".

## The prompts are files, not strings

`agents/prompts/*.md` are read at runtime. Changing how the developer agent works is a documentation edit, reviewable in a diff, with no code change and no redeploy. There is no prompt text hidden anywhere else in the codebase.

## No dependencies

Node 22's built-in `fetch`, `node:fs`, and `node:child_process`. No `package.json`, no lockfile, no install step, no supply chain. The runner starts in under a second and there is nothing to keep up to date.

This also keeps the agents' workspace clean: when the developer agent runs `npm install` for the *product* it is building, it is not fighting with the pipeline's own dependency tree.
