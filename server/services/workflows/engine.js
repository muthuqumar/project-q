/**
 * Workflow Execution Engine
 * Handles task orchestration, dependency resolution, parallel/sequential execution.
 * Agent personas are inspired by the BMAD Method (bmad-code-org/BMAD-METHOD).
 */

const AIService = require('../ai')
const fs = require('fs-extra')
const path = require('path')
const { v4: uuidv4 } = require('uuid')

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
    this.ai = new AIService(aiConfig || {})
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

  // ── Main execution entry ────────────────────────────────────────────────────

  async run(executionId) {
    const wf = this.workflowDef
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
      this.log(executionId, 'Workflow complete ✓', 'success')
    } catch (err) {
      this.emit(executionId, 'error', { message: err.message })
      this.log(executionId, `Workflow failed: ${err.message}`, 'error')
      throw err
    }
  }

  // ── dev-now workflow ─────────────────────────────────────────────────────────

  async runDevNow(executionId) {
    const { prompt, clarifications } = this.input
    this.emit(executionId, 'step', { step: 'implement', status: 'in_progress' })
    this.log(executionId, 'James Bond is analyzing the codebase and implementing changes...')

    const systemPrompt = this.buildDevNowSystemPrompt()
    const userPrompt = this.buildDevNowUserPrompt(prompt, clarifications)

    let result = ''
    await this.ai.chatStream(
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
      const group = groups[i]
      const isParallel = group.length > 1

      this.log(executionId, `Group ${i + 1}/${groups.length}: ${isParallel ? 'parallel' : 'sequential'} — ${group.map(t => t.title).join(', ')}`)

      if (isParallel) {
        await Promise.all(group.map(task => this.executeTask(task, executionId)))
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
        await Promise.all(group.map(task => this.executeTask(task, executionId)))
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
        await Promise.all(group.map(task => this.executeTask(task, executionId, { brownfield: true })))
      } else {
        await this.executeTask(group[0], executionId, { brownfield: true })
      }
    }
  }

  // ── bug-fix workflow ──────────────────────────────────────────────────────────

  async runBugFix(executionId) {
    const { prompt } = this.input
    this.emit(executionId, 'step', { step: 'fix', status: 'in_progress' })
    this.log(executionId, 'Tanner is investigating the bug...')

    const systemPrompt = this.buildBugFixSystemPrompt()
    const userPrompt = `Investigate and fix the following bug:\n\n${prompt}`

    let result = ''
    await this.ai.chatStream(
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

  async executeTask(task, executionId, opts = {}) {
    this.log(executionId, `▶ James Bond starting task: ${task.title}`)
    await this.updateTaskStatus(task.id, 'in_progress', executionId)

    try {
      const systemPrompt = this.buildTaskSystemPrompt(task, opts)
      const userPrompt = this.buildTaskUserPrompt(task)

      let result = ''
      await this.ai.chatStream(
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
      const result = await this.ai.complete(prompt)
      this.emit(executionId, 'step', { step: step.id, status: 'done', result })
    }
  }

  // ── Single step handler (used by /api/workflows/:id/step) ────────────────────

  async runStep(workflowId, stepId, message, history) {
    if (workflowId === 'dev-now') return this.runDevNowStep(stepId, message, history)
    if (workflowId === 'feature-dev') return this.runFeatureDevStep(stepId, message, history)
    if (workflowId === 'greenfield') return this.runGreenfieldStep(stepId, message, history)
    if (workflowId === 'brownfield-feature') return this.runBrownfieldStep(stepId, message, history)
    if (workflowId === 'bug-fix') return this.runBugFixStep(stepId, message, history)
    return { reply: await this.ai.chat('You are a helpful assistant.', [...(history || []), { role: 'user', content: message }]) }
  }

  async runDevNowStep(step, message, history) {
    if (step === 'understand') {
      const reply = await this.ai.chat(this.buildDevNowUnderstandPrompt(), [
        ...(history || []),
        { role: 'user', content: message }
      ])
      return { reply, step: 'understand' }
    }

    if (step === 'clarify') {
      const reply = await this.ai.chat(this.buildDevNowClarifyPrompt(), [
        ...(history || []),
        { role: 'user', content: message }
      ])
      const doneMatch = reply.match(/<ready-to-implement>([\s\S]*?)<\/ready-to-implement>/)
      return {
        reply: doneMatch ? reply.replace(/<ready-to-implement>[\s\S]*?<\/ready-to-implement>/, '').trim() : reply,
        step: 'clarify',
        readyToImplement: !!doneMatch,
        summary: doneMatch ? doneMatch[1].trim() : null
      }
    }

    return { reply: 'Unknown step', step }
  }

  async runFeatureDevStep(step, message, history) {
    if (step === 'requirements') {
      const reply = await this.ai.chat(this.buildFeatureDevRequirementsPrompt(), [
        ...(history || []),
        { role: 'user', content: message }
      ])
      const doneMatch = reply.match(/<requirements-finalized>([\s\S]*?)<\/requirements-finalized>/)
      return {
        reply: doneMatch ? reply.replace(/<requirements-finalized>[\s\S]*?<\/requirements-finalized>/, '').trim() : reply,
        step: 'requirements',
        requirementsFinalized: !!doneMatch,
        requirements: doneMatch ? doneMatch[1].trim() : null
      }
    }

    if (step === 'spec') {
      const reply = await this.ai.chat(this.buildTechSpecPrompt(), [
        ...(history || []),
        { role: 'user', content: message }
      ])
      return { reply, step: 'spec' }
    }

    if (step === 'tasks') {
      const reply = await this.ai.chat(this.buildTaskPlanningPrompt(), [
        ...(history || []),
        { role: 'user', content: message }
      ])
      const tasksMatch = reply.match(/<tasks>([\s\S]*?)<\/tasks>/)
      let tasks = []
      if (tasksMatch) {
        try { tasks = JSON.parse(tasksMatch[1]) } catch (e) {}
      }
      return { reply, step: 'tasks', tasks }
    }

    return { reply: 'Unknown step', step }
  }

  async runGreenfieldStep(step, message, history) {
    const stepPrompts = {
      discovery:     () => this.buildGreenfieldDiscoveryPrompt(),
      prd:           () => this.buildGreenfieldPRDPrompt(),
      architecture:  () => this.buildGreenfieldArchPrompt(),
      stories:       () => this.buildGreenfieldStoriesPrompt(),
      tasks:         () => this.buildTaskPlanningPrompt(),
    }

    const promptBuilder = stepPrompts[step]
    if (!promptBuilder) return { reply: 'Unknown step', step }

    const reply = await this.ai.chat(promptBuilder(), [
      ...(history || []),
      { role: 'user', content: message }
    ])

    // Check for finalization signals depending on step
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

    return {
      reply: match ? reply.replace(signal, '').trim() : reply,
      step,
      done: !!match,
      content: match ? match[1].trim() : null,
      tasks: parsed,
    }
  }

  async runBrownfieldStep(step, message, history) {
    // Brownfield uses same steps as feature-dev but with brownfield-aware prompts
    if (step === 'requirements') {
      const reply = await this.ai.chat(this.buildBrownfieldRequirementsPrompt(), [
        ...(history || []),
        { role: 'user', content: message }
      ])
      const doneMatch = reply.match(/<requirements-finalized>([\s\S]*?)<\/requirements-finalized>/)
      return {
        reply: doneMatch ? reply.replace(/<requirements-finalized>[\s\S]*?<\/requirements-finalized>/, '').trim() : reply,
        step: 'requirements',
        requirementsFinalized: !!doneMatch,
        requirements: doneMatch ? doneMatch[1].trim() : null
      }
    }

    if (step === 'spec') {
      const reply = await this.ai.chat(this.buildBrownfieldSpecPrompt(), [
        ...(history || []),
        { role: 'user', content: message }
      ])
      return { reply, step: 'spec' }
    }

    if (step === 'tasks') {
      const reply = await this.ai.chat(this.buildTaskPlanningPrompt(), [
        ...(history || []),
        { role: 'user', content: message }
      ])
      const tasksMatch = reply.match(/<tasks>([\s\S]*?)<\/tasks>/)
      let tasks = []
      if (tasksMatch) {
        try { tasks = JSON.parse(tasksMatch[1]) } catch (e) {}
      }
      return { reply, step: 'tasks', tasks }
    }

    return { reply: 'Unknown step', step }
  }

  async runBugFixStep(step, message, history) {
    if (step === 'investigate') {
      const reply = await this.ai.chat(this.buildBugInvestigatePrompt(), [
        ...(history || []),
        { role: 'user', content: message }
      ])
      const doneMatch = reply.match(/<root-cause>([\s\S]*?)<\/root-cause>/)
      return {
        reply: doneMatch ? reply.replace(/<root-cause>[\s\S]*?<\/root-cause>/, '').trim() : reply,
        step: 'investigate',
        rootCauseFound: !!doneMatch,
        rootCause: doneMatch ? doneMatch[1].trim() : null
      }
    }

    if (step === 'fix') {
      const reply = await this.ai.chat(this.buildBugFixSystemPrompt(), [
        ...(history || []),
        { role: 'user', content: message }
      ])
      return { reply, step: 'fix' }
    }

    return { reply: 'Unknown step', step }
  }

  // ── System Prompts ────────────────────────────────────────────────────────────

  buildContextBlock() {
    const parts = []
    if (this.context.PRD) parts.push(`## Project PRD\n${this.context.PRD.slice(0, 1500)}`)
    if (this.context.ARCHITECTURE) parts.push(`## Architecture\n${this.context.ARCHITECTURE.slice(0, 1000)}`)
    if (this.context.TECH_STACK) parts.push(`## Tech Stack\n${this.context.TECH_STACK.slice(0, 800)}`)
    if (this.context.PERSONAS) parts.push(`## Project Agent Personas\n${this.context.PERSONAS.slice(0, 1000)}`)
    return parts.length ? `---\n## Project Context\n${parts.join('\n\n')}\n---` : ''
  }

  // dev-now prompts ─────────────────────────────────────────

  buildDevNowSystemPrompt() {
    return `${PERSONAS.DEVELOPER}

${this.buildContextBlock()}

Project directory: ${this.projectDir}

When implementing changes, output file changes in this exact format:
<file path="relative/path/to/file.ext">
[COMPLETE file content — never partial]
</file>

For deletions:
<delete path="relative/path/to/file.ext" />

Think step by step. Match existing code conventions. Handle errors explicitly. Only change what's needed.`
  }

  buildDevNowUnderstandPrompt() {
    return `${PERSONAS.ORCHESTRATOR}

${this.buildContextBlock()}

When given a development request, analyze it as the orchestrator:
1. Identify which agent(s) are needed (Mary for ambiguous, James for clear implementation)
2. Restate your understanding of the request
3. List files likely affected (with brief reason)
4. Estimate complexity: trivial / small / medium / large
5. Estimate effort: <1h / 1–4h / 4–8h / 1–2d / 2d+
6. Confirm: "Does this match what you intended?" before proceeding

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

  buildFeatureDevRequirementsPrompt() {
    return `${PERSONAS.ANALYST}

${this.buildContextBlock()}

Conduct a thorough requirements gathering session for the requested feature. Cover:
- User stories with acceptance criteria
- Edge cases and error scenarios
- UI/UX behavior (if applicable)
- Data models and schemas needed
- API contracts (if applicable)
- Performance and security requirements
- Testing requirements

Ask one topic at a time. Be thorough — no detail is too small.

When requirements are fully finalized, respond with:
<requirements-finalized>
[structured requirements document in markdown]
</requirements-finalized>

Do NOT finalize prematurely. Resolve all ambiguities first.`
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

${this.buildContextBlock()}

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

${this.buildContextBlock()}

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

${this.buildContextBlock()}

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

${this.buildContextBlock()}

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

  buildBrownfieldRequirementsPrompt() {
    return `${PERSONAS.ANALYST}

${this.buildContextBlock()}

You are gathering requirements for a NEW FEATURE on an EXISTING codebase.

Critical brownfield considerations to explore:
- How does this feature interact with existing functionality?
- What existing code/data will be affected or reused?
- Are there existing patterns to follow (or deliberately break)?
- What are the migration/backwards-compatibility requirements?
- What could break if done wrong? (risk areas)
- What does "done" look like without disrupting what already works?

Be thorough. Brownfield features have higher integration risk than greenfield.

When requirements are fully finalized:
<requirements-finalized>
[structured requirements document in markdown]
</requirements-finalized>`
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

  buildBugInvestigatePrompt() {
    return `${PERSONAS.QA}

${this.buildContextBlock()}

Investigate this bug systematically:

**Investigation process:**
1. Restate the bug as: "When [action], [observed behavior], but [expected behavior]"
2. Hypothesize possible root causes (list 3–5 candidates)
3. Ask clarifying questions to narrow the root cause
4. For each hypothesis, describe how you'd confirm or rule it out

**Questions to ask:**
- When did this start? What changed?
- Is it reproducible? Under what conditions?
- What's the error message / stack trace?
- Does it affect all users or specific cases?

When root cause is identified:
<root-cause>
[Root cause, evidence, and proposed fix strategy]
</root-cause>`
  }

  buildBugFixSystemPrompt() {
    return `${PERSONAS.DEVELOPER}

${this.buildContextBlock()}

Project directory: ${this.projectDir}

You are fixing a confirmed bug. Follow this approach:
1. Explain the root cause in one sentence
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
${this.buildContextBlock()}

Current task: ${task.title}
Description: ${task.description}
${task.techSpec ? `Tech Spec context:\n${task.techSpec.slice(0, 1500)}` : ''}

Project directory: ${this.projectDir}

Output COMPLETE file content only:
<file path="relative/path/to/file.ext">
[complete file content — never truncated]
</file>

Only change files necessary for this specific task. Be precise. Be correct.`
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
