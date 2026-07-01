# project-q

AI-powered development workflow agent with a structured MI6 agent pipeline.

**project-q** embeds inside any development project and gives you a local web UI where you describe a task in plain English. An orchestrated team of specialist AI agents — each with a defined role, deliverable, and model tier — plan, design, implement, and test the work in sequence.

---

## How it works

Every mission flows through a four-agent pipeline:

```
Mallory → Quartermaster → James Bond → Moneypenny
(scope)    (design)        (implement)   (QA + tests)
```

Each agent reads the previous agent's deliverable before starting, ensuring every stage builds on verified context rather than assumptions. For small, self-contained tasks, **Felix** handles the work directly without a design phase.

---

## Quick Start

### 1. Install globally

```bash
git clone <project-q-repo>
cd project-q
npm run install:all
bash install.sh   # adds `pq` to your PATH
```

### 2. Use in any project

```bash
cd /path/to/your-project
pq start
```

project-q opens at `http://localhost:3141`, scans your codebase, and generates context files automatically.

> **Note:** Do not run `pq start` from inside the project-q directory itself — it will exit with an error. Always run from your target project.

### 3. Set an API key (for API providers)

Create a `.env` in the project-q directory:

```env
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=...
```

CLI providers (Claude Code, Ollama, Gemini CLI) work without an API key.

---

## The Agent Team

| Agent | Codename | Role | Deliverable |
|-------|----------|------|-------------|
| Mallory | Scoping | Reads the codebase, maps what exists, defines exact scope | `scope.md` |
| Quartermaster | Architect | Designs the solution — files to change, API contracts, data models | `design.md` |
| James Bond | Developer | Implements exactly what Quartermaster designed, runs verification | `implementation-summary.md` |
| Moneypenny | QA | Writes tests against Q's design and J's implementation | `test-plan.md` |
| Felix | Fast | Lightweight single-file tasks, no design phase needed | — |

### Deliverable chain

Each agent's output is automatically passed to the next:

- **Quartermaster** receives Mallory's `scope.md`
- **James Bond** receives Quartermaster's `design.md`
- **Moneypenny** receives both `design.md` and `implementation-summary.md`

Deliverables are stored in `.project-q/missions/<id>/` and are viewable inline in the UI.

### Post-implementation verification

After James Bond completes each step, project-q automatically runs any available scripts from the module's `package.json` in order: `lint` → `typecheck` / `type-check` / `tsc` → `test`. Results appear as coloured pills (✓ / ✗) in the step card.

---

## Mission lifecycle

```
planning → awaiting_info → planning (re-plan) → awaiting_approval → executing → complete
```

- **planning** — Orchestrator analyses the task and codebase, produces a plan
- **awaiting_info** — Orchestrator has questions; you answer them before work begins
- **awaiting_approval** — Plan is ready; review and approve the steps (or edit them)
- **executing** — Agents run in sequence; you can pause, skip steps, or require step-by-step approval
- **complete / failed** — Mission done or errored (failed missions with answered questions recover to `awaiting_info` so you can retry)

---

## AI Providers & Model Tiers

project-q assigns models by agent role, not a single global model:

| Role | Tier | Default (Anthropic) |
|------|------|---------------------|
| Orchestrator, Planner, Architect | Opus | `claude-opus-4-6` |
| Implementer, QA, Reviewer | Sonnet | `claude-sonnet-4-6` |
| Fast | Haiku | `claude-haiku-4-5` |

Supported providers:

| Provider | Auth |
|----------|------|
| Anthropic API | `ANTHROPIC_API_KEY` |
| Claude Code (CLI) | `claude /login` |
| OpenAI | `OPENAI_API_KEY` |
| Gemini API | `GEMINI_API_KEY` |
| Ollama | Local — no key needed |

Override per-role models in **Settings → AI Configuration**.

---

## Project Structure

When project-q initialises in your project, it creates:

```
.project-q/
├── config.json             # AI provider, project settings
├── context/
│   ├── PRD.md              # Product Requirements Document
│   ├── ARCHITECTURE.md     # System architecture
│   ├── TECH_STACK.md       # Technologies and conventions
│   └── PERSONAS.md         # Agent personas, project-specific notes
└── missions/
    └── <mission-id>/
        ├── mission.json           # Mission state, plan, logs
        ├── scope.md               # Mallory's deliverable
        ├── design.md              # Quartermaster's deliverable
        ├── implementation-summary.md  # James Bond's deliverable
        └── test-plan.md           # Moneypenny's deliverable
```

---

## Architecture

```
project-q/
├── server/                          # Node.js + Express + Socket.io
│   ├── index.js                     # Entry point (port 3141)
│   ├── routes/
│   │   ├── agents.js                # Mission CRUD, planning, execution, answers, approvals
│   │   ├── context.js               # Context file management
│   │   ├── ai.js                    # Provider config + connection testing
│   │   └── files.js                 # Project file tree + read/write
│   └── services/
│       ├── ai/
│       │   ├── model-factory.js     # Vercel AI SDK provider + role-to-model mapping
│       │   ├── claude-cli.js        # Claude CLI agentic streaming
│       │   └── index.js             # Provider selection
│       └── agents/
│           ├── registry.js          # Agent definitions + system prompt personas
│           ├── executor.js          # Step execution, deliverable injection, verification
│           ├── orchestrator.js      # Mission planning, codebase context building
│           ├── mission-store.js     # JSON-file mission persistence
│           ├── agent-tools.js       # Tool definitions (read, write, glob, grep, run)
│           └── context-guard.js     # Auto-generated context docs
└── client/                          # React + Vite
    └── src/
        ├── pages/
        │   ├── MissionBoardPage.jsx # Main UI — mission list + slide-over detail panel
        │   ├── SettingsPage.jsx     # AI config, context regeneration
        │   └── ContextPage.jsx      # Context file viewer/editor
        ├── components/
        │   ├── Layout.jsx
        │   └── Sidebar.jsx
        ├── hooks/
        │   ├── useSocket.js         # Real-time mission + step events
        │   └── useProject.js
        └── store/                   # Zustand global state
```

---

## Development

```bash
# Install all dependencies
npm run install:all

# Start dev server (hot reload — client on :5174, API on :3141)
npm run dev

# Build for production (outputs to server/public)
npm run build

# Start production server
npm start
```

---

## Extending project-q

### Add an AI provider

1. Create `server/services/ai/yourprovider.js` — implement `agenticStream(prompt, onChunk, onTool, opts)`
2. Register in `server/services/ai/index.js`
3. Add to the provider list in `server/routes/ai.js`
4. Add default role-to-model mappings in `server/services/ai/model-factory.js`

### Add a new agent

1. Add the agent definition and persona to `server/services/agents/registry.js`
2. Map the agent ID to a role in `AGENT_ROLES` in `executor.js`
3. Add exploration checklist in `getExplorationInstructions()` in `executor.js`
4. Optionally add a deliverable path entry in `getDeliverablePath()` and upstream injection in `buildAgenticPrompt()`

---

Inspired by [BMAD Method](https://github.com/bmad-code-org/BMAD-METHOD).
