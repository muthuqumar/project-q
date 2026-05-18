/**
 * Workflow Execution Engine
 * Handles task orchestration, dependency resolution, parallel/sequential execution.
 * Agent personas are inspired by the BMAD Method (bmad-code-org/BMAD-METHOD).
 */

const AIService = require('../ai')
const fs = require('fs-extra')
const path = require('path')
const { v4: uuidv4 } = require('uuid')
const executionRegistry = require('./execution-registry')

// ── BMAD Agent Persona Library ────────────────────────────────────────────────
// Each persona is injected into the system prompt for its corresponding phase.
// Inspired by BMAD Method agent roles — enhanced for project-q.

const PERSONAS = {

  ANALYST: `## Your Role: Analyst — "Moneypenny"
You are Moneypenny, a razor-sharp Business Analyst with an uncanny ability to extract what people mean, not just what they say. Your superpower is asking the questions nobody else thinks to ask. You specialize in discovery: uncovering hidden requirements, surfacing unstated assumptions, and mapping business problems to technical opportunities.

**How you operate:**
- You lead with curiosity, not conclusions
- You ask one focused question at a time and wait for the answer before proceeding
- You draw out edge cases by thinking like a user, not an engineer
- You summarize what you've learned before moving forward
- You flag contradictions or ambiguities immediately and ask for resolution
- You never skip the "why" — you always understand the business motivation before the technical detail

**Your output style:** Concise, structured, numbered where helpful. You use plain language the business understands.`,

  PM: `## Your Role: Product Manager — "Mallory"
You are Mallory, a seasoned Product Manager who has shipped products under pressure and impossible deadlines. You bridge business goals and engineering reality with cool authority. You are rigorous about requirements but pragmatic about tradeoffs.

**How you operate:**
- You think in user stories: "As a [user], I want [goal] so that [value]"
- You prioritize ruthlessly: every feature must justify its cost
- You write acceptance criteria that leave no ambiguity
- You identify risks and dependencies before they become blockers
- You write PRDs that engineers love: detailed enough to build from, tight enough to stay on track
- You challenge scope creep firmly but constructively

**Your output style:** Structured documents with clear sections. Acceptance criteria as checklists. Always includes success metrics.`,

  ARCHITECT: `## Your Role: Software Architect — "Quartermaster"
You are Quartermaster (Q), a principal engineer with deep expertise across distributed systems, API design, and front-end architecture. You have invented solutions to problems others haven't imagined yet, and you've seen every architecture mistake — you know exactly how to avoid them.

**How you operate:**
- You start with constraints and non-functional requirements before proposing solutions
- You think in trade-offs: every architectural decision has pros, cons, and alternatives
- You document decisions as Architecture Decision Records (ADRs) when appropriate
- You design for the next 18 months, not the next 5 years (avoid over-engineering)
- You always consider: security, observability, testability, and operational simplicity
- You sketch ASCII diagrams to make abstractions concrete
- You call out integration seams and failure modes explicitly

**Your output style:** Structured technical documents. ADRs when relevant. Code snippets to validate feasibility. Always includes "Key Decisions & Rationale" section.`,

  DEVELOPER: `## Your Role: Senior Developer — "James Bond"
You are James Bond, a full-stack senior engineer who executes with precision under pressure. You write clean, tested, production-quality code and always complete the mission — no matter the complexity. You leave the codebase better than you found it.

**How you operate:**
- You read the existing code before writing new code — you match conventions and patterns
- You write code that is obvious, not clever
- You handle errors explicitly — you never silently swallow exceptions
- You think about the reviewer when writing: clear variable names, small functions, comments on the "why" not the "what"
- You write or update tests alongside implementation
- You output COMPLETE file content — never partial snippets or "... rest of file unchanged"
- You announce file changes clearly so they can be applied atomically

**Your output style:** Full file content inside <file path="...">...</file> tags. Brief explanation of what changed and why before the code blocks.`,

  QA: `## Your Role: QA Engineer — "Tanner"
You are Tanner, a meticulous QA engineer who thinks in failure modes. You find the bugs before users do — and before the mission goes sideways. Your instinct for what can go wrong is unmatched.

**How you operate:**
- You write test cases that cover happy path, edge cases, and error states equally
- You think adversarially: "how would a malicious user break this?"
- You validate both behavior and non-functional requirements (performance, accessibility, security)
- You write clear bug reports: steps to reproduce, expected vs actual, environment
- You automate what can be automated; document what must be manual
- You never sign off without checking the acceptance criteria line by line

**Your output style:** Test plans as numbered checklists. Bug reports in structured format. Test code that is readable and maintainable.`,

  SM: `## Your Role: Scrum Master — "Felix"
You are Felix, a calm and experienced Scrum Master who keeps the team moving and the mission on track. You remove blockers, protect the team from chaos, and ensure the delivery train never derails.

**How you operate:**
- You break large work into sprint-sized slices (2–5 day chunks)
- You identify and surface dependencies before they block progress
- You assign parallel work explicitly: "these 3 tasks can run concurrently"
- You track risk and flag when the plan needs a replanning conversation
- You write tasks in imperative form with clear "done when" criteria
- You ensure every task is atomic, independently deployable where possible

**Your output style:** Task lists with executionOrder assignments. Clear parallel/sequential groupings. Dependency graph when complex.`,

  ORCHESTRATOR: `## Your Role: Orchestrator
You are the project-q orchestrator. You are the mission controller of the AI development team. You receive the user's request, assess which specialist is needed, and either delegate directly or guide through a multi-agent workflow.

**Your team:**
- Moneypenny (Analyst) — discovery, requirements clarification
- Mallory (PM) — PRD, user stories, acceptance criteria
- Quartermaster (Architect) — technical design, architecture decisions
- James Bond (Developer) — implementation, code changes
- Tanner (QA) — test plans, quality validation
- Felix (Scrum Master) — task breakdown, sprint planning

**How you operate:**
- You route requests to the right specialist without the user having to ask
- For simple requests → go straight to James Bond
- For ambiguous requests → start with Moneypenny, then Mallory
- For complex features → full pipeline: Moneypenny → Mallory → Quartermaster → Felix → James Bond → Tanner
- You always tell the user which phase and agent they're working with`,
}

// ── WorkflowEngine Class ──────────────────────────────────────────────────────

class WorkflowEngine {
  constructor({ workflowDef, pqDir, projectDir, io, aiConfig, context, input, executionPlan }) {
    this.workflowDef = workflowDef
    this.pqDir = pqDir
    this.projectDir = projectDir
    this.io = io
    this.aiConfig = aiConfig
    this.context = context || {}
    this.input = input || {}
    this.executionPlan = executionPlan || null

    // codeAI: Claude CLI with projectDir — file-aware, used for all implementation steps.
    // Claude CLI natively reads CLAUDE.md, Glob/Grep/Read tools, full project context.
    this.codeAI = new AIService({ ...(aiConfig || {}), projectDir: this.projectDir })

    // chatAI: Anthropic API — fast, no project scan, used for all conversational steps.
    // Falls back to CLI without cwd when no API key is configured.
    this.chatAI = this._createChatAI(aiConfig)
  }

  // Build a chat-only AI service that never scans the project.
  // Preference order: Anthropic API → OpenAI API → Gemini API → CLI (no cwd).
  _createChatAI(aiConfig) {
    const apiKey = aiConfig?.apiKey || process.env.ANTHROPIC_API_KEY
    if (apiKey) {
      console.log('[engine] chatAI: Anthropic API (claude-sonnet-4-6)')
      return new AIService({ provider: 'claude', model: 'claude-sonnet-4-6', apiKey })
    }
    if (process.env.OPENAI_API_KEY) {
      console.log('[engine] chatAI: OpenAI API (gpt-4o)')
      return new AIService({ provider: 'openai', model: 'gpt-4o' })
    }
    if (process.env.GEMINI_API_KEY) {
      console.log('[engine] chatAI: Gemini API (gemini-1.5-pro)')
      return new AIService({ provider: 'gemini', model: 'gemini-1.5-pro' })
    }
    // No API key — fall back to CLI without cwd (no project scan, fast startup)
    console.log('[engine] chatAI: CLI fallback (no API key found — set ANTHROPIC_API_KEY in .env for best results)')
    return new AIService({ ...(aiConfig || {}), projectDir: null })
  }

  emit(executionId, event, data) {
    if (this.io) {
      this.io.emit(`execution:${executionId}:${event}`, data)
      this.io.to('tasks').emit(`execution:${event}`, { executionId, ...data })
    }
  }

  log(executionId, message, type = 'info') {
    const entry = { timestamp: new Date().toISOString(), message, type }
    this.emit(executionId, 'log', entry)
    console.log(`[${type.toUpperCase()}] ${message}`)
  }

  // Throws a StoppedError if the user requested cancellation
  checkStopped(executionId) {
    if (executionRegistry.isStopped(executionId)) {
      const err = new Error('EXECUTION_STOPPED')
      err.stopped = true
      throw err
    }
  }

  // ── Main execution entry ────────────────────────────────────────────────────

  async run(executionId) {
    const wf = this.workflowDef
    executionRegistry.register(executionId)
    this.emit(executionId, 'started', { workflowId: wf.id, executionId })
    this.log(executionId, `Starting workflow: ${wf.name}`)

    try {
      if (wf.id === 'dev-now') {
        await this.runDevNow(executionId)
      } else if (wf.id === 'feature-dev') {
        await this.runFeatureDev(executionId)
      } else if (wf.id === 'greenfield') {
        await this.runGreenfield(executionId)
      } else if (wf.id === 'brownfield-feature') {
        await this.runBrownfieldFeature(executionId)
      } else if (wf.id === 'bug-fix') {
        await this.runBugFix(executionId)
      } else {
        await this.runCustomWorkflow(executionId)
      }
      this.emit(executionId, 'complete', { workflowId: wf.id, executionId })
      this.log(executionId, 'Workflow complete', 'success')
    } catch (err) {
      if (err.stopped) {
        this.emit(executionId, 'stopped', { executionId })
        this.log(executionId, 'Execution stopped by user', 'warn')
      } else {
        this.emit(executionId, 'error', { message: err.message })
        this.log(executionId, `Workflow failed: ${err.message}`, 'error')
        throw err
      }
    } finally {
      executionRegistry.unregister(executionId)
    }
  }

  // ── dev-now workflow ─────────────────────────────────────────────────────────

  async runDevNow(executionId) {
    const { prompt, clarifications } = this.input
    this.emit(executionId, 'step', { step: 'implement', status: 'in_progress' })
    this.log(executionId, `James Bond is implementing changes in ${path.basename(this.projectDir)}...`)

    this.checkStopped(executionId)
    const systemPrompt = this.buildDevNowSystemPrompt()
    const userPrompt = this.buildDevNowUserPrompt(prompt, clarifications)

    let result = ''
    await this.codeAI.chatStream(
      systemPrompt,
      [{ role: 'user', content: userPrompt }],
      (chunk) => {
        result += chunk
        this.emit(executionId, 'stream', { chunk })
      }
    )

    const changes = this.parseFileChanges(result)
    if (changes.length > 0) {
      this.log(executionId, `Applying ${changes.length} file change(s)...`)
      await this.applyFileChanges(changes, executionId)
    }

    this.emit(executionId, 'step', { step: 'implement', status: 'done', result, changes })
    return { result, changes }
  }

  // ── feature-dev workflow ─────────────────────────────────────────────────────

  async runFeatureDev(executionId) {
    const { tasks, approvedPlan } = this.input

    if (!tasks || tasks.length === 0) {
      throw new Error('No tasks provided for feature-dev execution')
    }

    const sortedTasks = [...tasks].sort((a, b) => (a.executionOrder || 0) - (b.executionOrder || 0))
    const groups = this.buildExecutionGroups(sortedTasks)

    this.log(executionId, `James Bond executing ${tasks.length} tasks in ${groups.length} group(s)`)
    this.emit(executionId, 'plan', { groups: groups.map(g => g.map(t => t.id)) })

    for (let i = 0; i < groups.length; i++) {
      this.checkStopped(executionId)
      const group = groups[i]
      const isParallel = group.length > 1

      this.log(executionId, `Group ${i + 1}/${groups.length}: ${isParallel ? 'parallel' : 'sequential'} — ${group.map(t => t.title).join(', ')}`)

      if (isParallel) {
        await this._runLimited(group, 2, task => this.executeTask(task, executionId))
      } else {
        await this.executeTask(group[0], executionId)
      }
    }
  }

  // ── greenfield workflow ──────────────────────────────────────────────────────

  async runGreenfield(executionId) {
    const { tasks } = this.input
    if (!tasks || tasks.length === 0) {
      throw new Error('No tasks provided for greenfield execution')
    }

    const sortedTasks = [...tasks].sort((a, b) => (a.executionOrder || 0) - (b.executionOrder || 0))
    const groups = this.buildExecutionGroups(sortedTasks)

    this.log(executionId, `🏗️  Greenfield build — ${tasks.length} tasks, ${groups.length} group(s) — James Bond on point`)
    this.emit(executionId, 'plan', { groups: groups.map(g => g.map(t => t.id)) })

    for (let i = 0; i < groups.length; i++) {
      const group = groups[i]
      const isParallel = group.length > 1
      this.log(executionId, `Sprint ${i + 1}/${groups.length}: ${isParallel ? 'parallel' : 'sequential'} — ${group.map(t => t.title).join(', ')}`)

      if (isParallel) {
        await this._runLimited(group, 2, task => this.executeTask(task, executionId))
      } else {
        await this.executeTask(group[0], executionId)
      }
    }
  }

  // ── brownfield-feature workflow ──────────────────────────────────────────────

  async runBrownfieldFeature(executionId) {
    const { tasks } = this.input
    if (!tasks || tasks.length === 0) {
      throw new Error('No tasks provided for brownfield-feature execution')
    }

    const sortedTasks = [...tasks].sort((a, b) => (a.executionOrder || 0) - (b.executionOrder || 0))
    const groups = this.buildExecutionGroups(sortedTasks)

    this.log(executionId, `🔧 Brownfield feature — James Bond reading existing code before each task...`)
    this.emit(executionId, 'plan', { groups: groups.map(g => g.map(t => t.id)) })

    for (let i = 0; i < groups.length; i++) {
      const group = groups[i]
      if (group.length > 1) {
        await this._runLimited(group, 2, task => this.executeTask(task, executionId, { brownfield: true }))
      } else {
        await this.executeTask(group[0], executionId, { brownfield: true })
      }
    }
  }

  // ── bug-fix workflow ──────────────────────────────────────────────────────────

  async runBugFix(executionId) {
    const { tasks, prompt } = this.input

    // New path: approved task list from the MultiStepWorkflow (investigate → tasks → approval → execute)
    if (tasks && tasks.length > 0) {
      const sortedTasks = [...tasks].sort((a, b) => (a.executionOrder || 0) - (b.executionOrder || 0))
      const groups = this.buildExecutionGroups(sortedTasks)

      this.log(executionId, `James Bond executing ${tasks.length} bug fix task(s) in ${groups.length} group(s)`)
      this.emit(executionId, 'plan', { groups: groups.map(g => g.map(t => t.id)) })

      for (let i = 0; i < groups.length; i++) {
        this.checkStopped(executionId)
        const group = groups[i]
        const isParallel = group.length > 1

        this.log(executionId, `Fix ${i + 1}/${groups.length}: ${isParallel ? 'parallel' : 'sequential'} — ${group.map(t => t.title).join(', ')}`)

        if (isParallel) {
          await this._runLimited(group, 2, task => this.executeTask(task, executionId, { brownfield: true }))
        } else {
          await this.executeTask(group[0], executionId, { brownfield: true })
        }
      }
      return
    }

    // Legacy path: single-shot investigation + fix from a plain prompt
    this.emit(executionId, 'step', { step: 'fix', status: 'in_progress' })
    this.log(executionId, 'James Bond is fixing the bug...')

    this.checkStopped(executionId)
    const systemPrompt = this.buildBugFixSystemPrompt()
    const userPrompt = `Investigate and fix the following bug:\n\n${prompt}`

    let result = ''
    await this.codeAI.chatStream(
      systemPrompt,
      [{ role: 'user', content: userPrompt }],
      (chunk) => {
        result += chunk
        this.emit(executionId, 'stream', { chunk })
      }
    )

    const changes = this.parseFileChanges(result)
    if (changes.length > 0) {
      this.log(executionId, `Applying ${changes.length} fix(es)...`)
      await this.applyFileChanges(changes, executionId)
    }

    this.emit(executionId, 'step', { step: 'fix', status: 'done', result, changes })
    return { result, changes }
  }

  buildExecutionGroups(tasks) {
    const groups = []
    let currentOrder = null
    let currentGroup = []

    for (const task of tasks) {
      const order = task.executionOrder ?? 0
      const isParallel = task.executionType === 'parallel'

      if (currentOrder === null || (!isParallel && order !== currentOrder)) {
        if (currentGroup.length > 0) groups.push(currentGroup)
        currentGroup = [task]
        currentOrder = order
      } else if (isParallel && order === currentOrder) {
        currentGroup.push(task)
      } else {
        if (currentGroup.length > 0) groups.push(currentGroup)
        currentGroup = [task]
        currentOrder = order
      }
    }
    if (currentGroup.length > 0) groups.push(currentGroup)
    return groups
  }

  // Run up to `max` tasks concurrently. Safer than raw Promise.all on large groups:
  // prevents Claude CLI from spawning dozens of processes simultaneously, which can
  // cause timeouts, port conflicts, and corrupted file writes.
  async _runLimited(tasks, max = 2, fn) {
    const results = new Array(tasks.length)
    let next = 0

    async function worker() {
      while (next < tasks.length) {
        const i = next++
        results[i] = await fn(tasks[i])
      }
    }

    const workers = Array.from({ length: Math.min(max, tasks.length) }, worker)
    await Promise.all(workers)
    return results
  }

  async executeTask(task, executionId, opts = {}) {
    this.log(executionId, `▶ James Bond starting task: ${task.title}`)
    await this.updateTaskStatus(task.id, 'in_progress', executionId)

    try {
      this.checkStopped(executionId)
      const systemPrompt = this.buildTaskSystemPrompt(task, opts)
      const userPrompt = this.buildTaskUserPrompt(task)

      let result = ''
      await this.codeAI.chatStream(
        systemPrompt,
        [{ role: 'user', content: userPrompt }],
        (chunk) => {
          result += chunk
          this.emit(executionId, 'task_stream', { taskId: task.id, chunk })
        }
      )

      const changes = this.parseFileChanges(result)
      if (changes.length > 0) {
        this.log(executionId, `  Applying ${changes.length} change(s) for: ${task.title}`)
        await this.applyFileChanges(changes, executionId)
      }

      await this.updateTaskStatus(task.id, 'review', executionId)
      this.log(executionId, `✓ James Bond completed: ${task.title}`, 'success')

      return { taskId: task.id, result, changes }
    } catch (err) {
      await this.updateTaskStatus(task.id, 'in_progress', executionId)
      this.log(executionId, `✗ Task failed: ${task.title} — ${err.message}`, 'error')
      throw err
    }
  }

  async runCustomWorkflow(executionId) {
    const steps = this.workflowDef.steps || []
    for (const step of steps) {
      this.emit(executionId, 'step', { step: step.id, status: 'in_progress', name: step.name })
      this.log(executionId, `Running step: ${step.name}`)

      const prompt = this.interpolateTemplate(step.prompt || '', this.input)
      const result = await this.codeAI.complete(prompt)
      this.emit(executionId, 'step', { step: step.id, status: 'done', result })
    }
  }

  // ── Shared streaming chat helper ─────────────────────────────────────────────
  // Used by conversational steps (requirements, clarify, spec, etc.).
  // Intentionally runs WITHOUT projectDir so Claude CLI skips the project scan —
  // conversational steps don't need file access and this cuts startup from ~30s to ~5s.
  // Project context is injected inline via buildContextBlock() instead.

  // Strip client-side UI metadata from history before sending to any AI provider.
  // The client stores phase transitions (role:'system'), streaming flags (_streaming),
  // step annotations (_step), etc. None of these should go to the AI — they'll
  // cause API errors (Anthropic rejects role:'system' in messages) or confuse the CLI.
  _cleanHistory(history) {
    if (!history) return []
    return history
      .filter(m => (m.role === 'user' || m.role === 'assistant') && m.content)
      .map(m => ({ role: m.role, content: String(m.content) }))
  }

  async _streamChat(systemPrompt, messages, onChunk = null) {
    // All conversational steps go through chatAI (API-based, no project scan).
    // Inline context is injected via buildContextBlock() in each prompt builder.
    const cleaned = this._cleanHistory(messages)
    if (onChunk) {
      let full = ''
      await this.chatAI.chatStream(systemPrompt, cleaned, (chunk) => {
        full += chunk
        onChunk(chunk)
      })
      return full
    }
    return this.chatAI.chat(systemPrompt, cleaned)
  }

  // Inject a concise context block into conversational prompts.
  // Always includes the target project directory so Claude knows which codebase this is about.
  // (Implementation prompts don't need this — CLAUDE.md covers them via cwd.)
  buildContextBlock(allowFileTools = false) {
    const parts = []
    if (this.projectDir) {
      const note = allowFileTools
        ? `Directory: \`${this.projectDir}\`\nUse your Read/Grep/Glob tools to inspect the codebase.`
        : `Directory: \`${this.projectDir}\`\nNote: You are in a conversational step — do NOT use filesystem tools here. Reason from context.`
      parts.push(`## Target Project\n${note}`)
    }
    if (this.context.PRD)          parts.push(`## Product Requirements\n${this.context.PRD.slice(0, 1200)}`)
    if (this.context.ARCHITECTURE) parts.push(`## Architecture\n${this.context.ARCHITECTURE.slice(0, 800)}`)
    if (this.context.TECH_STACK)   parts.push(`## Tech Stack\n${this.context.TECH_STACK.slice(0, 600)}`)
    return parts.length ? `---\n## Project Context\n${parts.join('\n\n')}\n---` : ''
  }

  // ── Signal-tag renderer ───────────────────────────────────────────────────────
  // Instead of stripping completion signal tags from the displayed reply (which
  // leaves the message ending mid-sentence), replace them with formatted markdown
  // so the content is visible in the chat bubble.
  _renderSignal(reply, tagName, heading) {
    return reply.replace(
      new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`),
      (_, content) => `\n\n---\n\n**${heading}**\n\n${content.trim()}`
    ).trim()
  }

  // ── Single step handler (used by /api/workflows/:id/step) ────────────────────

  async runStep(workflowId, stepId, message, history, onChunk = null) {
    if (workflowId === 'dev-now') return this.runDevNowStep(stepId, message, history, onChunk)
    if (workflowId === 'feature-dev') return this.runFeatureDevStep(stepId, message, history, onChunk)
    if (workflowId === 'greenfield') return this.runGreenfieldStep(stepId, message, history, onChunk)
    if (workflowId === 'brownfield-feature') return this.runBrownfieldStep(stepId, message, history, onChunk)
    if (workflowId === 'bug-fix') return this.runBugFixStep(stepId, message, history, onChunk)
    // Unknown workflow — continue conversationally so users never see an error string
    return this._continueConversation(message, history, onChunk)
  }

  // Generic fallback: keeps the conversation going with the project context in scope.
  // Called whenever a step ID has no dedicated handler — this way nothing ever breaks silently.
  async _continueConversation(message, history, onChunk = null) {
    const systemPrompt = `You are a helpful AI development assistant with access to this project's context.

${this.buildContextBlock()}

Continue the conversation helpfully. If the user is describing requirements, a bug, or a feature, ask focused questions to understand it fully before summarising what you've learned.`
    const reply = await this._streamChat(systemPrompt, [...(history || []), { role: 'user', content: message }], onChunk)
    return { reply }
  }

  async runDevNowStep(step, message, history, onChunk = null) {
    if (step === 'understand') {
      const reply = await this._streamChat(
        this.buildDevNowUnderstandPrompt(),
        [...(history || []), { role: 'user', content: message }],
        onChunk
      )
      return { reply, step: 'understand' }
    }

    if (step === 'clarify') {
      const reply = await this._streamChat(
        this.buildDevNowClarifyPrompt(),
        [...(history || []), { role: 'user', content: message }],
        onChunk
      )
      const doneMatch = reply.match(/<ready-to-implement>([\s\S]*?)<\/ready-to-implement>/)
      return {
        reply: doneMatch ? this._renderSignal(reply, 'ready-to-implement', 'Implementation brief ✓') : reply,
        step: 'clarify',
        readyToImplement: !!doneMatch,
        summary: doneMatch ? doneMatch[1].trim() : null
      }
    }

    return this._continueConversation(message, history, onChunk)
  }

  async runFeatureDevStep(step, message, history, onChunk = null) {
    if (step === 'requirements') {
      // Count how many assistant turns have already happened in this step.
      // We require at least 1 full exchange before allowing finalization —
      // prevents Claude from immediately finalizing a clear-sounding request
      // without actually gathering requirements.
      const priorAssistantTurns = (history || []).filter(m => m.role === 'assistant').length
      const reply = await this._streamChat(
        this.buildFeatureDevRequirementsPrompt(priorAssistantTurns),
        [...(history || []), { role: 'user', content: message }],
        onChunk
      )
      // Only allow finalization if at least 1 prior exchange has happened
      const doneMatch = priorAssistantTurns >= 1
        ? reply.match(/<requirements-finalized>([\s\S]*?)<\/requirements-finalized>/)
        : null
      return {
        reply: doneMatch ? this._renderSignal(reply, 'requirements-finalized', 'Requirements captured ✓') : reply,
        step: 'requirements',
        requirementsFinalized: !!doneMatch,
        requirements: doneMatch ? doneMatch[1].trim() : null
      }
    }

    if (step === 'spec') {
      const reply = await this._streamChat(this.buildTechSpecPrompt(), [...(history || []), { role: 'user', content: message }], onChunk)
      return { reply, step: 'spec' }
    }

    if (step === 'tasks') {
      const reply = await this._streamChat(this.buildTaskPlanningPrompt(), [...(history || []), { role: 'user', content: message }], onChunk)
      const tasksMatch = reply.match(/<tasks>([\s\S]*?)<\/tasks>/)
      let tasks = []
      if (tasksMatch) {
        try { tasks = JSON.parse(tasksMatch[1]) } catch (e) {}
      }
      return { reply, step: 'tasks', tasks }
    }

    return this._continueConversation(message, history, onChunk)
  }

  async runGreenfieldStep(step, message, history, onChunk = null) {
    const stepPrompts = {
      discovery:     () => this.buildGreenfieldDiscoveryPrompt(),
      prd:           () => this.buildGreenfieldPRDPrompt(),
      architecture:  () => this.buildGreenfieldArchPrompt(),
      stories:       () => this.buildGreenfieldStoriesPrompt(),
      tasks:         () => this.buildTaskPlanningPrompt(),
    }

    const promptBuilder = stepPrompts[step]
    if (!promptBuilder) return this._continueConversation(message, history, onChunk)

    const reply = await this._streamChat(
      promptBuilder(),
      [...(history || []), { role: 'user', content: message }],
      onChunk
    )

    const signals = {
      discovery:    /<discovery-complete>([\s\S]*?)<\/discovery-complete>/,
      prd:          /<prd-complete>([\s\S]*?)<\/prd-complete>/,
      architecture: /<architecture-complete>([\s\S]*?)<\/architecture-complete>/,
      stories:      /<stories-complete>([\s\S]*?)<\/stories-complete>/,
      tasks:        /<tasks>([\s\S]*?)<\/tasks>/,
    }

    const signal = signals[step]
    const match = signal ? reply.match(signal) : null

    let parsed = null
    if (match && step === 'tasks') {
      try { parsed = JSON.parse(match[1]) } catch (e) {}
    }

    const signalHeadings = {
      discovery:    'Discovery complete ✓',
      prd:          'PRD complete ✓',
      architecture: 'Architecture complete ✓',
      stories:      'Sprint plan complete ✓',
      tasks:        null,  // tasks JSON is not for display — strip it
    }
    const heading = signalHeadings[step]

    return {
      reply: match
        ? (heading
            ? this._renderSignal(reply, Object.keys(signals).find(k => signals[k] === signal), heading)
            : reply.replace(signal, '').trim())
        : reply,
      step,
      done: !!match,
      content: match ? match[1].trim() : null,
      tasks: parsed,
    }
  }

  async runBrownfieldStep(step, message, history, onChunk = null) {
    if (step === 'requirements') {
      const priorAssistantTurns = (history || []).filter(m => m.role === 'assistant').length
      const reply = await this._streamChat(
        this.buildBrownfieldRequirementsPrompt(priorAssistantTurns),
        [...(history || []), { role: 'user', content: message }],
        onChunk
      )
      const doneMatch = priorAssistantTurns >= 1
        ? reply.match(/<requirements-finalized>([\s\S]*?)<\/requirements-finalized>/)
        : null
      return {
        reply: doneMatch ? this._renderSignal(reply, 'requirements-finalized', 'Requirements captured ✓') : reply,
        step: 'requirements',
        requirementsFinalized: !!doneMatch,
        requirements: doneMatch ? doneMatch[1].trim() : null
      }
    }

    if (step === 'spec') {
      const reply = await this._streamChat(this.buildBrownfieldSpecPrompt(), [...(history || []), { role: 'user', content: message }], onChunk)
      return { reply, step: 'spec' }
    }

    if (step === 'tasks') {
      const reply = await this._streamChat(this.buildTaskPlanningPrompt(), [...(history || []), { role: 'user', content: message }], onChunk)
      const tasksMatch = reply.match(/<tasks>([\s\S]*?)<\/tasks>/)
      let tasks = []
      if (tasksMatch) {
        try { tasks = JSON.parse(tasksMatch[1]) } catch (e) {}
      }
      return { reply, step: 'tasks', tasks }
    }

    return this._continueConversation(message, history, onChunk)
  }

  async runBugFixStep(step, message, history, onChunk = null) {
    if (step === 'investigate') {
      const cleanedHistory = this._cleanHistory(history)
      const priorAssistantTurns = cleanedHistory.filter(m => m.role === 'assistant').length

      // Investigation needs real file access — use codeAI (Claude CLI with projectDir)
      // so Tanner can grep, read files, and find the actual root cause in the codebase.
      const investigateMessages = [...cleanedHistory, { role: 'user', content: message }]
      let reply = ''
      if (onChunk) {
        await this.codeAI.chatStream(
          this.buildBugInvestigatePrompt(priorAssistantTurns),
          investigateMessages,
          (chunk) => { reply += chunk; onChunk(chunk) }
        )
      } else {
        reply = await this.codeAI.chat(
          this.buildBugInvestigatePrompt(priorAssistantTurns),
          investigateMessages
        )
      }
      // Require at least 1 prior assistant turn before allowing root-cause finalization.
      // Turn 0: Tanner restates + asks initial questions (first-turn rule in prompt prevents conclusion).
      // Turn 1+: Tanner may conclude when the prompt's checklist is satisfied.
      const doneMatch = priorAssistantTurns >= 1
        ? reply.match(/<root-cause>([\s\S]*?)<\/root-cause>/)
        : null
      return {
        reply: doneMatch ? this._renderSignal(reply, 'root-cause', 'Root cause identified ✓') : reply,
        step: 'investigate',
        rootCauseFound: !!doneMatch,
        rootCause: doneMatch ? doneMatch[1].trim() : null
      }
    }

    if (step === 'tasks') {
      // Use codeAI (CLI with projectDir) — same provider that runs Tanner's investigation.
      // chatAI CLI-fallback has a conflicting base system prompt that prevents reliable
      // <tasks> JSON output. codeAI's non-agentic --print mode produces clean text only
      // (no file tools are invoked in chatStream mode) and works consistently.
      const planMessages = [...this._cleanHistory(history), { role: 'user', content: message }]
      let reply = ''
      if (onChunk) {
        await this.codeAI.chatStream(this.buildBugFixPlanPrompt(), planMessages, (chunk) => {
          reply += chunk
          onChunk(chunk)
        })
      } else {
        reply = await this.codeAI.chat(this.buildBugFixPlanPrompt(), planMessages)
      }
      const tasksMatch = reply.match(/<tasks>([\s\S]*?)<\/tasks>/)
      let tasks = []
      if (tasksMatch) {
        try {
          tasks = JSON.parse(tasksMatch[1])
          console.log(`[bug-fix:tasks] Parsed ${tasks.length} tasks`)
        } catch (e) {
          console.error(`[bug-fix:tasks] JSON parse failed: ${e.message}`)
          console.error(`[bug-fix:tasks] Raw JSON:\n${tasksMatch[1].slice(0, 500)}`)
        }
      } else {
        console.warn(`[bug-fix:tasks] No <tasks> block found in reply (${reply.length} chars)`)
        // Log the full reply so we can see exactly what the model produced
        console.warn(`[bug-fix:tasks] Full reply:\n${reply}`)
      }
      return { reply, step: 'tasks', tasks }
    }

    if (step === 'fix') {
      const reply = await this._streamChat(
        this.buildBugFixSystemPrompt(),
        [...(history || []), { role: 'user', content: message }],
        onChunk
      )
      return { reply, step: 'fix' }
    }

    return this._continueConversation(message, history, onChunk)
  }

  // ── System Prompts ────────────────────────────────────────────────────────────
  // Context (PRD, architecture, tech stack, personas) is in CLAUDE.md at the
  // project root — Claude CLI reads it automatically. Prompts here contain only
  // the agent persona + task-specific instructions + output format.

  // dev-now prompts ─────────────────────────────────────────

  buildDevNowSystemPrompt() {
    return `${PERSONAS.DEVELOPER}

**Target project directory:** \`${this.projectDir}\`

Project context (PRD, architecture, tech stack, conventions) is in CLAUDE.md.
Use your Read/Glob/Grep tools to explore the codebase before writing anything.
Match existing code style, patterns, and naming conventions exactly.

When implementing changes, output file changes in this exact format:
<file path="relative/path/to/file.ext">
[COMPLETE file content — never partial]
</file>

For deletions: <delete path="relative/path/to/file.ext" />

Paths are relative to the project root. Think step by step. Handle errors explicitly.`
  }

  buildDevNowUnderstandPrompt() {
    return `${PERSONAS.ORCHESTRATOR}

${this.buildContextBlock()}

When given a development request, analyze it as the orchestrator. You are in a CONVERSATIONAL step — reason from the project context above, do NOT attempt to read files or run commands.

1. Identify which agent(s) are needed (Moneypenny for ambiguous, James Bond for clear implementation)
2. Restate your understanding of the request in your own words
3. Based on the project context and your knowledge of typical project structures, list files that are LIKELY affected (inference only — James Bond will do the actual file inspection during implementation)
4. Estimate complexity: trivial / small / medium / large
5. Estimate effort: <1h / 1–4h / 4–8h / 1–2d / 2d+
6. Ask: "Does this match what you intended?" before proceeding

Be concise and structured.`
  }

  buildDevNowClarifyPrompt() {
    return `${PERSONAS.ANALYST}

${this.buildContextBlock()}

Your job: Ask the minimum necessary questions to fully understand the implementation requirements. Max 3 questions per turn.

Prioritize:
- Ambiguities that would force a different implementation approach
- Edge cases that affect the data model or API contract
- Error states the developer needs to handle

When you have enough information to hand off to James Bond, respond with:
<ready-to-implement>
[concise implementation brief: what to build, how, key decisions]
</ready-to-implement>`
  }

  buildDevNowUserPrompt(prompt, clarifications) {
    let userPrompt = `Implement the following:\n\n${prompt}`
    if (clarifications && clarifications.length > 0) {
      userPrompt += `\n\nAdditional context from clarification:\n${clarifications.join('\n')}`
    }
    return userPrompt
  }

  // feature-dev prompts ──────────────────────────────────────

  buildFeatureDevRequirementsPrompt(priorAssistantTurns = 0) {
    const firstTurnRule = `
IMPORTANT — This is the first message. You must NOT finalize yet. Instead:

**If the request is clear and unambiguous** (you understand exactly what needs to be done, no missing details):
- Briefly confirm your understanding in 2–3 sentences
- Ask: "This looks straightforward — shall I proceed to generating the tech spec and task plan? Or is there anything you'd like to clarify or add first?"
- Wait for the user's answer. Do NOT output <requirements-finalized> yet.

**If the request has ambiguities or missing details** (you're unsure about scope, approach, edge cases, or affected systems):
- Ask up to 3 focused clarifying questions, one topic at a time
- Do NOT output <requirements-finalized> yet.`

    const subsequentTurnRule = `
Continue the requirements conversation. When the user confirms they're ready to proceed, OR when you have gathered enough to write a complete requirements document, output:
<requirements-finalized>
[structured requirements document in markdown covering: what, why, acceptance criteria, edge cases, affected areas]
</requirements-finalized>`

    return `${PERSONAS.ANALYST}

${this.buildContextBlock()}

Your role: conduct a requirements gathering session. For complex features this means thorough discovery. For simple tasks this means confirming understanding and letting the user choose to proceed quickly.

Areas to cover when relevant:
- What exactly needs to change and why
- Acceptance criteria (how do we know it's done?)
- Edge cases and error scenarios
- Files / systems affected
- Anything that could go wrong

${priorAssistantTurns === 0 ? firstTurnRule : subsequentTurnRule}`
  }

  buildTechSpecPrompt() {
    return `${PERSONAS.ARCHITECT}

${this.buildContextBlock()}

Generate a comprehensive technical specification document:

# Technical Specification: [Feature Name]
## Overview
## Requirements Summary
## Architecture Changes
## Data Models / Schemas
## API Endpoints (if applicable)
## Component Design (if applicable)
## Key Technical Decisions & Rationale
## Implementation Plan (ordered steps)
## Edge Cases & Error Handling
## Testing Strategy
## Definition of Done

Be precise. Include code snippets to validate feasibility. Reference existing patterns in the codebase.`
  }

  buildTaskPlanningPrompt() {
    return `${PERSONAS.SM}

${this.buildContextBlock()}

Break down the technical spec into executable Kanban tasks. Generate a JSON array inside <tasks></tasks> tags.

Each task must follow this schema:
{
  "title": "Imperative verb + specific outcome",
  "description": "Detailed description — enough for James to implement without asking questions",
  "executionOrder": 0,
  "executionType": "sequential",   // "sequential" or "parallel"
  "priority": "high",              // high | medium | low
  "assignedTo": "claude",
  "tags": ["backend", "api"],
  "estimatedHours": 2,
  "dependencies": []
}

**Parallel execution rules (Bob's law):**
- Tasks with the SAME executionOrder value run in PARALLEL
- Only make tasks parallel if they truly have no shared file dependencies
- Foundation/scaffold tasks must run first (executionOrder: 0)
- Integration tasks must run last

Explain the execution strategy briefly before the <tasks> block.`
  }

  // greenfield prompts ────────────────────────────────────────

  buildGreenfieldDiscoveryPrompt() {
    return `${PERSONAS.ANALYST}

You are running the Discovery phase of a greenfield project build.

Your mission: Understand the project well enough to hand off to John (PM) for PRD creation. Explore:
- The core problem being solved and for whom
- Business model and key success metrics
- Must-have vs nice-to-have features for v1
- Competitive landscape awareness
- Technical constraints and preferences
- Timeline and resource constraints

Ask one topic at a time. Be curious. Challenge assumptions gently.

When you have a complete picture, respond with:
<discovery-complete>
[structured discovery summary: problem, users, goals, v1 scope, constraints]
</discovery-complete>`
  }

  buildGreenfieldPRDPrompt() {
    return `${PERSONAS.PM}

Write a comprehensive Product Requirements Document for this greenfield project.

# Product Requirements Document
## Executive Summary
## Problem Statement
## Goals & Success Metrics
## Target Users & Personas
## User Stories (v1)
## Feature Specifications
## Non-Goals (explicitly out of scope for v1)
## Constraints & Assumptions
## Open Questions
## Timeline Estimate

Make acceptance criteria explicit and testable. Flag any stories that need further clarification.

When the PRD is complete, respond with:
<prd-complete>
[the full PRD document]
</prd-complete>`
  }

  buildGreenfieldArchPrompt() {
    return `${PERSONAS.ARCHITECT}

Design the architecture for this greenfield project.

# Architecture Document
## System Overview
## Architecture Diagram (ASCII)
## Technology Stack Decisions (with rationale)
## Component Architecture
## Data Model
## API Design
## Authentication & Security
## Deployment Architecture
## Observability (logging, metrics, tracing)
## Key Architectural Decisions & Alternatives Considered

After each major decision, add: **Why not [alternative]:** [one-line reason].

When architecture is complete, respond with:
<architecture-complete>
[the full architecture document]
</architecture-complete>`
  }

  buildGreenfieldStoriesPrompt() {
    return `${PERSONAS.SM}

Organize the PRD user stories into sprint-ready work. For each story:
- Write a clear "done when" definition
- Identify technical subtasks
- Flag dependencies between stories
- Mark which stories can run in parallel

Structure as sprint slices (Sprint 1 = foundation, Sprint 2 = core features, Sprint 3 = polish).

When complete, respond with:
<stories-complete>
[structured sprint plan with stories and acceptance criteria]
</stories-complete>`
  }

  // brownfield prompts ────────────────────────────────────────

  buildBrownfieldRequirementsPrompt(priorAssistantTurns = 0) {
    const firstTurnRule = priorAssistantTurns === 0
      ? `IMPORTANT — This is the first message. Do NOT finalize yet.
- If the request is clear: confirm your understanding and ask "This looks clear — shall I proceed to generating the integration spec and task plan? Or would you like to add anything first?"
- If the request is ambiguous: ask up to 3 focused questions about integration risk, scope, and backwards compatibility.
Do NOT output <requirements-finalized> on this turn.`
      : `When you have enough to write a complete requirements document, output:
<requirements-finalized>
[structured requirements document in markdown]
</requirements-finalized>`

    return `${PERSONAS.ANALYST}

${this.buildContextBlock()}

You are gathering requirements for a NEW FEATURE on an EXISTING codebase. Brownfield features carry integration risk — be thorough about:
- How this interacts with existing functionality
- What existing code/data will be affected or reused
- Migration and backwards-compatibility requirements
- What could break if done wrong

${firstTurnRule}`
  }

  buildBrownfieldSpecPrompt() {
    return `${PERSONAS.ARCHITECT}

${this.buildContextBlock()}

Write a technical specification for adding this feature to the EXISTING codebase.

Brownfield-specific sections REQUIRED:
- **Existing Code Analysis**: What currently exists that's relevant
- **Integration Points**: Exactly where the new code connects to existing code
- **Migration Plan**: Any data migrations or API versioning needed
- **Backwards Compatibility**: What must not break
- **Risk Areas**: What could go wrong and mitigation strategies

Standard sections:
- Architecture Changes
- Data Model Changes
- API Changes
- Component Changes
- Testing Strategy (include regression tests)
- Definition of Done`
  }

  // bug-fix prompts ───────────────────────────────────────────

  buildBugInvestigatePrompt(priorAssistantTurns = 0) {
    const firstTurnRule = `IMPORTANT — This is the first message. Do NOT output <root-cause> yet, no matter how clear the report seems.
- Restate the bug in your own words: "When [action], [observed behavior], but [expected behavior]."
- Use your Grep/Read/Glob tools immediately to start locating relevant code (component names, API routes, selectors mentioned in the report).
- Identify what information you still need: reproduction steps, error message or stack trace, when it started, affected users/conditions.
- Ask the 1–2 most important missing questions after sharing what you've already found in the code.`

    const investigatingRule = `Continue narrowing down the root cause. Use your tools — Grep, Read, Glob — to search the actual codebase and verify your hypotheses against real code.

**How to investigate:**
- Use Grep to search for relevant function names, selectors, component names, event handlers, API routes
- Use Read to read specific files once you've found them
- Use Glob to list files in relevant directories
- Cross-reference what the user tells you with what you actually find in the code
- When you find the responsible code, quote the exact file path and line(s)

You may output <root-cause> ONLY when ALL of the following are true:
1. You have read the actual file(s) involved — not just guessed
2. You can point to the exact line or block that causes the bug
3. You have a clear explanation for WHY that code produces the observed behavior
4. The user has confirmed your understanding of the bug

When ready, output:
<root-cause>
**Bug:** [precise restatement]
**Root cause:** [why it happens, referencing the actual code]
**File:** [path/to/file.ext, line N]
**Fix strategy:** [the minimal change needed]
</root-cause>`

    return `${PERSONAS.QA}

${this.buildContextBlock(true)}

Your mission: fully understand this bug and find its exact location in the codebase. You have access to the project files — use your Read, Grep, and Glob tools to investigate. Do not guess; verify against real code.

**STRICT LIMITS — you are the investigator, not the fixer:**
- Do NOT write code or file changes
- Do NOT pretend to create tasks, tickets, or Kanban items — you have no ability to do this
- Do NOT say "I've created X tasks" or "tasks have been added" — this is false and confusing
- If the user says "create tasks", "fix it", "make the changes", or "generate the tasks", respond:
  "I'm Tanner — I investigate, I don't implement. Once I've identified the root cause, click the **'Investigation complete — proceed to fix plan'** button above. That will automatically generate a task list for James Bond to implement."
- Then output your <root-cause> block if ready, or ask the next focused question if not

${priorAssistantTurns === 0 ? firstTurnRule : investigatingRule}`
  }

  buildBugFixPlanPrompt() {
    // Uses SM persona (Felix) — NOT Developer (James Bond).
    // Developer persona says "output complete file content in <file> tags" which
    // directly conflicts with the <tasks> JSON output we need here. Felix's output
    // style is "task lists with executionOrder assignments" — exactly right for planning.
    return `${PERSONAS.SM}

${this.buildContextBlock()}

Based on the bug investigation above, create a minimal, targeted fix plan. Do NOT over-engineer — this is a bug fix, not a feature. Do NOT write any code — James Bond handles implementation in the next step.

Rules:
- Prefer the smallest change that fixes the root cause
- Do NOT refactor unrelated code
- Include a regression test task to prevent recurrence
- Keep execution order linear (sequential fixes, no risky parallelism for bugs)

Generate a JSON array inside <tasks></tasks> tags. Each task must follow this schema exactly:
{
  "title": "Imperative verb + specific fix (e.g. 'Fix label ternary in FormUtils.tsx')",
  "description": "Exact change to make — file path, function name, and what to change. No ambiguity.",
  "executionOrder": 0,
  "executionType": "sequential",
  "priority": "high",
  "assignedTo": "claude",
  "tags": ["bug-fix"],
  "estimatedHours": 1,
  "dependencies": []
}

Brief fix strategy (2–3 sentences) before the <tasks> block. Output ONLY valid JSON inside the tags — no comments, no trailing commas.`
  }

  buildBugFixSystemPrompt() {
    return `${PERSONAS.DEVELOPER}

**Target project directory:** \`${this.projectDir}\`

Project context is in CLAUDE.md. Use your Read/Grep tools to explore the bug's context before proposing a fix.

You are fixing a confirmed bug. Follow this approach:
1. Explain the root cause in one sentence — referencing the actual file and line
2. Describe the minimal change needed (don't refactor while fixing)
3. Implement the fix with full file content
4. Add or update tests that would have caught this bug
5. Note any related issues discovered (don't fix them now)

Output changes in:
<file path="relative/path/to/file.ext">
[COMPLETE file content]
</file>`
  }

  // task execution prompt ─────────────────────────────────────

  buildTaskSystemPrompt(task, opts = {}) {
    const brownfieldNote = opts.brownfield
      ? '\n**IMPORTANT: This is a brownfield task. Read and match existing code patterns before writing anything new. Never break existing behavior.**\n'
      : ''

    return `${PERSONAS.DEVELOPER}
${brownfieldNote}
**Target project directory:** \`${this.projectDir}\`

Project context is in CLAUDE.md. Use your Read/Glob/Grep tools to explore the codebase before writing anything.
Study existing code structure and conventions — never invent patterns that aren't already there.

**Current task:** ${task.title}
**Description:** ${task.description}
${task.techSpec ? `**Tech Spec context:**\n${task.techSpec.slice(0, 1500)}` : ''}

Output COMPLETE file content only — never partial snippets:
<file path="relative/path/to/file.ext">
[complete file content — never truncated]
</file>

Paths are relative to the project root shown above. Only change files necessary for this specific task.`
  }

  buildTaskUserPrompt(task) {
    return `Execute this task completely:

**${task.title}**

${task.description}

Apply all necessary code changes. Output complete file content.`
  }

  // ── File Change Parser & Applier ──────────────────────────────────────────────

  parseFileChanges(text) {
    const changes = []

    const fileRegex = /<file path="([^"]+)">([\s\S]*?)<\/file>/g
    let match
    while ((match = fileRegex.exec(text)) !== null) {
      changes.push({ type: 'write', path: match[1], content: match[2].trim() })
    }

    const deleteRegex = /<delete path="([^"]+)"[^/]*\/>/g
    while ((match = deleteRegex.exec(text)) !== null) {
      changes.push({ type: 'delete', path: match[1] })
    }

    return changes
  }

  async applyFileChanges(changes, executionId) {
    for (const change of changes) {
      const fullPath = path.resolve(this.projectDir, change.path)

      if (!fullPath.startsWith(this.projectDir)) {
        this.log(executionId, `⚠ Skipping unsafe path: ${change.path}`, 'warn')
        continue
      }

      if (change.type === 'write') {
        await fs.ensureDir(path.dirname(fullPath))
        await fs.writeFile(fullPath, change.content, 'utf8')
        this.log(executionId, `  ✎ ${change.path}`)
        if (this.io) this.io.emit('file:written', { path: change.path })
      } else if (change.type === 'delete') {
        await fs.remove(fullPath)
        this.log(executionId, `  ✗ ${change.path} (deleted)`)
        if (this.io) this.io.emit('file:deleted', { path: change.path })
      }
    }
  }

  async updateTaskStatus(taskId, status, executionId) {
    try {
      const tasksPath = path.join(this.pqDir, 'tasks', 'tasks.json')
      if (!fs.existsSync(tasksPath)) return

      const tasks = await fs.readJson(tasksPath)
      const idx = tasks.findIndex(t => t.id === taskId)
      if (idx === -1) return

      const columnMap = {
        in_progress: 'in_progress',
        review: 'review',
        done: 'done',
        blocked: 'todo'
      }

      tasks[idx].column = columnMap[status] || status
      tasks[idx].updatedAt = new Date().toISOString()
      await fs.writeJson(tasksPath, tasks, { spaces: 2 })

      if (this.io) {
        this.io.to('tasks').emit('task:updated', tasks[idx])
      }
    } catch (e) {
      // Non-critical
    }
  }

  interpolateTemplate(template, vars) {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] || `{{${key}}}`)
  }
}

module.exports = WorkflowEngine
