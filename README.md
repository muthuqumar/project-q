# project-q

AI-powered development workflow agent — inspired by BMAD Method.

**project-q** embeds inside any development project and gives you a local web UI with AI-driven workflows, a drag-drop Kanban board, and an intelligent agent team that understands your codebase.

---

## Features

- **dev-now** — Quick implementation workflow: describe what you want, AI estimates scope, asks targeted questions, implements
- **feature-dev** — Full feature workflow: requirements gathering, tech spec generation, Kanban task creation, sequential/parallel execution with approval gates
- **greenfield** — End-to-end new project workflow: discovery through sprint planning
- **brownfield-feature** — Integration-aware feature development for existing codebases
- **bug-fix** — Investigation-first bug resolution with structured root cause analysis
- **Custom workflows** — Build multi-step AI workflows with a visual editor
- **Kanban board** — Drag-drop board with columns: Backlog, Todo, In Progress, Review, Done
- **Multi-AI support** — Claude, OpenAI/Codex, Gemini, Ollama, and local CLI providers
- **Auto-generated context** — Scans your codebase and generates PRD, Architecture, Tech Stack, and Agent Persona docs automatically
- **Real-time updates** — WebSocket keeps the Kanban board live as AI executes tasks

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

### 3. Optional: set an API key

For API-based providers (Anthropic, OpenAI, Gemini), create a `.env` in the project-q directory:

```env
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=...
```

CLI providers (Claude Code, Ollama, Codex CLI) work without an API key.

---

## Workflows

### dev-now

Best for: quick fixes, small features, refactors.

1. Describe what you want to build
2. AI analyses scope and estimates complexity
3. AI asks up to 3 clarifying questions
4. Click **Implement** — changes applied via your configured AI CLI

### feature-dev

Best for: new features, complex changes, multi-file work.

1. Describe the feature (high level is fine)
2. AI asks detailed questions until requirements are fully clear
3. AI generates a **Tech Spec** document
4. AI generates a **task plan** with execution order (sequential/parallel)
5. Review and **approve** the task plan
6. Tasks appear in the **Kanban board**
7. Click **Execute** — AI runs tasks in planned order

### greenfield

Full new-project workflow spanning discovery, PRD creation, architecture design, story breakdown, and sprint planning. Activates the full MI6 agent team.

### brownfield-feature

Adds a feature to an existing codebase. Includes a codebase audit phase before spec writing to ensure safe integration.

### bug-fix

Tanner investigates the bug first, produces a root cause analysis, then James Bond implements the fix.

### Custom workflows

1. Go to **Workflows → New workflow**
2. Name it, add steps (conversation, analysis, generation, execution, approval)
3. Use `{{input}}` in prompts to reference the user's initial request
4. Save and run from the sidebar

---

## Agent Team (MI6)

Each workflow phase activates the appropriate specialist:

| Codename | Role | Responsibilities |
|----------|------|-----------------|
| Moneypenny | Business Analyst | Discovery, requirements, edge cases |
| Mallory | Product Manager | PRD, user stories, acceptance criteria |
| Quartermaster | Software Architect | System design, ADRs, API design |
| James Bond | Senior Developer | Implementation, code review, refactoring |
| Tanner | QA Engineer | Test planning, bug investigation, validation |
| Felix | Scrum Master | Task breakdown, sprint planning, parallel execution |

---

## Project Structure

When project-q initialises in your project, it creates:

```
.project-q/
├── config.json         # AI provider, project settings
├── context/
│   ├── PRD.md          # Product Requirements Document
│   ├── ARCHITECTURE.md # System architecture
│   ├── TECH_STACK.md   # Technologies and conventions
│   └── PERSONAS.md     # Agent personas, project-specific notes
├── tasks/
│   └── tasks.json      # Kanban tasks
└── workflows/
    └── *.json          # Custom workflow definitions
```

---

## AI Providers

| Provider | Models | Auth |
|----------|--------|------|
| Claude Code (CLI) | claude-opus-4-6, sonnet-4-6, haiku-4-5 | `claude /login` |
| Anthropic API | opus-4-6, sonnet-4-6, haiku-4-5 | `ANTHROPIC_API_KEY` |
| OpenAI | gpt-4o, o1-preview | `OPENAI_API_KEY` |
| Gemini | 1.5-pro, 2.0-flash | `GEMINI_API_KEY` |
| Ollama | llama3, codellama, mistral, etc. | Local — no key needed |

---

## Architecture

```
project-q/
├── server/                    # Node.js + Express + Socket.io
│   ├── index.js               # Server entry point (port 3141)
│   ├── routes/
│   │   ├── init.js            # Codebase scan, context generation
│   │   ├── tasks.js           # Kanban task CRUD + bulk ops
│   │   ├── workflows.js       # Workflow management + execution
│   │   ├── ai.js              # Provider config, detection, testing
│   │   ├── context.js         # Context file management
│   │   └── files.js           # Project file tree + read/write
│   └── services/
│       ├── ai/                # Claude, OpenAI, Gemini, Ollama providers
│       └── workflows/
│           ├── engine.js      # Workflow execution engine (MI6 personas)
│           └── registry.js    # Built-in workflow definitions
└── client/                    # React + Vite
    └── src/
        ├── components/
        │   ├── Kanban/        # Board, Column, TaskCard, TaskDetail
        │   ├── Workflow/      # DevNow, MultiStepWorkflow, CustomWorkflow
        │   └── Common/        # Terminal, ChatBubble, Notifications
        ├── pages/             # Dashboard, Kanban, Workflows, Settings, Context
        ├── hooks/             # useSocket, useProject
        └── store/             # Zustand global state
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

1. Create `server/services/ai/yourprovider.js` — implement `complete()`, `chat()`, `chatStream()`
2. Register in `server/services/ai/index.js`
3. Add to the provider list in `server/routes/ai.js`

### Add a built-in workflow

1. Add definition to `server/services/workflows/registry.js`
2. Add execution handler to `server/services/workflows/engine.js`
3. Create a React component in `client/src/components/Workflow/`
4. Add the route in `client/src/pages/WorkflowsPage.jsx`

---

Inspired by [BMAD Method](https://github.com/bmad-code-org/BMAD-METHOD).
