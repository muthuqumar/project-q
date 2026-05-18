const express = require('express')
const router = express.Router()
const fs = require('fs-extra')
const path = require('path')
const { v4: uuidv4 } = require('uuid')
const AIService = require('../services/ai')
const { syncContextToCLAUDEMD } = require('../services/context-sync')

// GET /api/init/status — check if project is initialized
router.get('/status', async (req, res) => {
  const pqDir = req.app.get('pqDir')
  const projectDir = req.app.get('projectDir')
  const configPath = path.join(pqDir, 'config.json')

  if (!fs.existsSync(configPath)) {
    return res.json({ initialized: false, projectDir })
  }

  const config = await fs.readJson(configPath)
  // Always reflect the live projectDir (env var may differ from saved config)
  config.projectDir = projectDir
  const contextFiles = await fs.readdir(path.join(pqDir, 'context')).catch(() => [])

  res.json({
    initialized: true,
    config,
    projectDir,
    hasContext: contextFiles.length > 0,
    contextFiles
  })
})

// POST /api/init/start — initialize project-q with context generation
router.post('/start', async (req, res) => {
  const pqDir = req.app.get('pqDir')
  const projectDir = req.app.get('projectDir')
  const io = req.app.get('io')
  const { aiConfig } = req.body

  try {
    // Save config
    const config = {
      version: '1.0.0',
      projectDir,
      initialized: new Date().toISOString(),
      ai: aiConfig || { provider: 'claude', model: 'claude-opus-4-6' },
      workflows: ['dev-now', 'feature-dev', 'greenfield', 'brownfield-feature', 'bug-fix']
    }
    await fs.writeJson(path.join(pqDir, 'config.json'), config, { spaces: 2 })

    // Make aiConfig available to orchestrator
    req.app.set('aiConfig', config.ai)

    res.json({ success: true, message: 'Project-q initialized. Ready for context generation.' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/init/generate-context — AI-powered context generation
router.post('/generate-context', async (req, res) => {
  const pqDir = req.app.get('pqDir')
  const projectDir = req.app.get('projectDir')
  const io = req.app.get('io')
  const { answers, aiConfig } = req.body

  const emit = (event, data) => io.emit(`init:${event}`, data)

  try {
    emit('progress', { step: 'scanning', message: 'Scanning project directory...' })

    // Scan project for context
    const scanResult = await scanProject(projectDir)

    const ai = new AIService(aiConfig || { provider: 'claude', model: 'claude-opus-4-6' })

    // Generate PRD
    emit('progress', { step: 'prd', message: 'Generating PRD...' })
    const prd = await ai.complete(buildPRDPrompt(answers, scanResult))
    await fs.writeFile(path.join(pqDir, 'context', 'PRD.md'), prd)

    // Generate Architecture Doc
    emit('progress', { step: 'architecture', message: 'Generating Architecture document...' })
    const arch = await ai.complete(buildArchPrompt(answers, scanResult, prd))
    await fs.writeFile(path.join(pqDir, 'context', 'ARCHITECTURE.md'), arch)

    // Generate Tech Stack
    emit('progress', { step: 'techstack', message: 'Generating Tech Stack manifest...' })
    const techStack = await ai.complete(buildTechStackPrompt(answers, scanResult))
    await fs.writeFile(path.join(pqDir, 'context', 'TECH_STACK.md'), techStack)

    // Generate Personas
    emit('progress', { step: 'personas', message: 'Generating Agent Personas...' })
    const personas = await ai.complete(buildPersonasPrompt(answers, scanResult, prd))
    await fs.writeFile(path.join(pqDir, 'context', 'PERSONAS.md'), personas)

    // Write CLAUDE.md so Claude CLI picks up context immediately
    await syncContextToCLAUDEMD(projectDir, pqDir)

    emit('complete', { message: 'Context generation complete!' })
    res.json({ success: true, files: ['PRD.md', 'ARCHITECTURE.md', 'TECH_STACK.md', 'PERSONAS.md'] })
  } catch (err) {
    emit('error', { message: err.message })
    res.status(500).json({ error: err.message })
  }
})

// POST /api/init/scan — deep scan codebase + AI generates all context files automatically
router.post('/scan', async (req, res) => {
  const pqDir = req.app.get('pqDir')
  const projectDir = req.app.get('projectDir')
  const io = req.app.get('io')
  const { aiConfig } = req.body

  const emit = (event, data) => io.emit(`init:${event}`, data)

  try {
    emit('progress', { step: 'scanning', message: '🔍 Scanning codebase...' })

    const scan = await deepScanProject(projectDir)

    emit('progress', { step: 'analysing', message: '🧠 Analysing project structure...' })

    const ai = new AIService(aiConfig || { provider: 'claude', model: 'claude-opus-4-6' })

    // Single AI pass to understand the project
    const analysisPrompt = `You are a senior engineering team analysing a codebase for the first time.

Here is a detailed scan of the project:

## Project Directory: ${projectDir}

### Top-level structure:
${scan.structure}

### package.json:
${scan.packageJson ? JSON.stringify(scan.packageJson, null, 2) : 'Not found'}

### README:
${scan.readme || 'Not found'}

### Key source files (sampled):
${scan.sourceFiles.map(f => `--- ${f.path} ---\n${f.content}`).join('\n\n')}

### Git log (last 20 commits):
${scan.gitLog || 'No git history'}

### Config files found:
${scan.configFiles.join(', ') || 'None'}

### Other docs found:
${scan.docs.map(d => `--- ${d.path} ---\n${d.content}`).join('\n\n') || 'None'}

---

Based on this codebase scan, generate ALL of the following documents in a single response. Separate each with the exact marker shown.

<PRD>
# Product Requirements Document
## Overview
[What this project does and why it exists]
## Problem Statement
[The problem this solves]
## Goals & Success Metrics
[What success looks like]
## Target Users
[Who uses this]
## Key Features
[The core features, numbered]
## Non-Goals
[What this doesn't do]
## Technical Constraints
[Known constraints]
## Current Status
[State of the codebase based on scan]
</PRD>

<ARCHITECTURE>
# Architecture Document
## System Overview
[High-level description]
## Architecture Diagram (ASCII)
[Draw the key components and their relationships]
## Components
[Each major component described]
## Data Flow
[How data moves through the system]
## Key Technical Decisions
[Why these choices were made — infer from the code]
## Scalability & Performance
[Current approach]
## Security Considerations
[Auth, data handling]
## Deployment
[How this is deployed based on config files]
</ARCHITECTURE>

<TECH_STACK>
# Tech Stack Manifest
## Languages
[All languages used]
## Frameworks & Libraries
[With versions from package.json]
## Development Tools
[Build tools, linters, formatters]
## Testing
[Test framework and approach]
## Infrastructure
[Deployment, hosting]
## Conventions & Standards
[Code style, naming, patterns observed in source]
## Key Dependencies
| Package | Version | Purpose |
|---------|---------|---------|
[Fill from package.json]
</TECH_STACK>

<PERSONAS>
# Agent Personas — MI6 Team

${buildPersonasBase()}

---

## Project-Specific Notes (Applied to All Agents)

[Add specific notes for this project's tech stack and domain for each agent]
</PERSONAS>

Be thorough and specific. Infer as much as possible from the actual code. Do not hallucinate features — only document what you observe.`

    emit('progress', { step: 'generating', message: '✍️  Generating PRD...' })
    const fullResponse = await ai.complete(analysisPrompt)

    // Parse out each section
    const extract = (tag) => {
      const match = fullResponse.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`))
      return match ? match[1].trim() : null
    }

    const prd = extract('PRD')
    const arch = extract('ARCHITECTURE')
    const techStack = extract('TECH_STACK')
    const personas = extract('PERSONAS')

    await fs.ensureDir(path.join(pqDir, 'context'))

    if (prd) {
      emit('progress', { step: 'prd', message: '📄 Saving PRD...' })
      await fs.writeFile(path.join(pqDir, 'context', 'PRD.md'), prd)
    }
    if (arch) {
      emit('progress', { step: 'architecture', message: '🏗️  Saving Architecture doc...' })
      await fs.writeFile(path.join(pqDir, 'context', 'ARCHITECTURE.md'), arch)
    }
    if (techStack) {
      emit('progress', { step: 'techstack', message: '🛠️  Saving Tech Stack...' })
      await fs.writeFile(path.join(pqDir, 'context', 'TECH_STACK.md'), techStack)
    }
    if (personas) {
      emit('progress', { step: 'personas', message: '🕵️  Saving Agent Personas...' })
      await fs.writeFile(path.join(pqDir, 'context', 'PERSONAS.md'), personas)
    }

    // Write CLAUDE.md so every Claude CLI invocation picks up this context
    await syncContextToCLAUDEMD(projectDir, pqDir)

    emit('complete', { message: 'Context generation complete! project-q knows your codebase.' })
    res.json({ success: true, files: ['PRD.md', 'ARCHITECTURE.md', 'TECH_STACK.md', 'PERSONAS.md'] })
  } catch (err) {
    emit('error', { message: err.message })
    res.status(500).json({ error: err.message })
  }
})

// POST /api/init/interview — run AI interview to gather project info
router.post('/interview', async (req, res) => {
  const { message, history, aiConfig } = req.body
  const pqDir = req.app.get('pqDir')
  const projectDir = req.app.get('projectDir')

  try {
    const scanResult = await scanProject(projectDir)
    const ai = new AIService(aiConfig || { provider: 'claude', model: 'claude-opus-4-6' })

    const systemPrompt = `You are project-q's onboarding assistant. Your job is to interview the developer to understand their project well enough to generate a PRD, Architecture doc, Tech Stack manifest, and Agent Personas.

Project directory scan:
${JSON.stringify(scanResult, null, 2)}

Ask focused, specific questions one at a time. Cover: project purpose, target users, key features, tech choices, constraints, and goals.
When you have enough information (after ~5-7 exchanges), respond with a JSON block like:
<ready>
{
  "projectName": "...",
  "description": "...",
  "purpose": "...",
  "targetUsers": "...",
  "keyFeatures": [...],
  "techStack": {...},
  "constraints": "...",
  "goals": "..."
}
</ready>

Be conversational. Keep questions short. One question at a time.`

    const messages = [...(history || []), { role: 'user', content: message }]
    const reply = await ai.chat(systemPrompt, messages)

    // Check if we have enough info
    const readyMatch = reply.match(/<ready>([\s\S]*?)<\/ready>/)
    if (readyMatch) {
      const answers = JSON.parse(readyMatch[1])
      res.json({ reply, ready: true, answers })
    } else {
      res.json({ reply, ready: false })
    }
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── Helpers ──────────────────────────────────────────────────────────────────

// Simple scan (used for interview context)
async function scanProject(projectDir) {
  const result = { files: [], packageJson: null, hasGit: false, readme: null }
  try {
    const pkgPath = path.join(projectDir, 'package.json')
    if (fs.existsSync(pkgPath)) result.packageJson = await fs.readJson(pkgPath)
    result.hasGit = fs.existsSync(path.join(projectDir, '.git'))
    const readmePath = path.join(projectDir, 'README.md')
    if (fs.existsSync(readmePath)) result.readme = (await fs.readFile(readmePath, 'utf8')).slice(0, 2000)
    const entries = await fs.readdir(projectDir)
    result.files = entries.filter(e => !e.startsWith('.') && e !== 'node_modules')
  } catch (e) { /* ignore */ }
  return result
}

// Deep scan — reads actual source files for AI analysis
async function deepScanProject(projectDir) {
  const { execSync } = require('child_process')
  const result = {
    structure: '',
    packageJson: null,
    readme: null,
    sourceFiles: [],
    configFiles: [],
    docs: [],
    gitLog: null
  }

  const IGNORE = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '.cache', 'vendor', '.project-q'])
  const SOURCE_EXTS = new Set(['.js', '.jsx', '.ts', '.tsx', '.go', '.rs', '.rb', '.java', '.cs', '.cpp', '.c', '.vue', '.svelte', '.swift', '.kt'])
  const CONFIG_NAMES = new Set(['vite.config.js', 'vite.config.ts', 'webpack.config.js', 'tsconfig.json', 'tailwind.config.js', 'next.config.js', '.eslintrc.json', 'jest.config.js', 'Makefile'])
  const DOC_EXTS = new Set(['.md', '.txt', '.rst'])

  // Build directory tree string (2 levels deep)
  async function buildStructure(dir, prefix = '', depth = 0) {
    if (depth > 2) return ''
    let out = ''
    try {
      const entries = (await fs.readdir(dir)).filter(e => !IGNORE.has(e) && !e.startsWith('.'))
      for (const entry of entries.slice(0, 40)) {
        const full = path.join(dir, entry)
        const stat = await fs.stat(full).catch(() => null)
        if (!stat) continue
        out += `${prefix}${stat.isDirectory() ? '📁' : '📄'} ${entry}\n`
        if (stat.isDirectory()) out += await buildStructure(full, prefix + '  ', depth + 1)
      }
    } catch (e) { /* ignore */ }
    return out
  }

  // Collect source files (up to N files, prioritising entry points)
  async function collectSourceFiles(dir, depth = 0, collected = []) {
    if (depth > 4 || collected.length >= 20) return
    try {
      const entries = await fs.readdir(dir)
      // Sort: index/main/app files first
      entries.sort((a, b) => {
        const priority = (n) => /^(index|main|app|server|client)\./i.test(n) ? 0 : 1
        return priority(a) - priority(b)
      })
      for (const entry of entries) {
        if (collected.length >= 20) break
        if (IGNORE.has(entry) || entry.startsWith('.')) continue
        const full = path.join(dir, entry)
        const stat = await fs.stat(full).catch(() => null)
        if (!stat) continue
        const ext = path.extname(entry)
        if (stat.isDirectory()) {
          await collectSourceFiles(full, depth + 1, collected)
        } else if (SOURCE_EXTS.has(ext)) {
          const content = (await fs.readFile(full, 'utf8').catch(() => '')).slice(0, 3000)
          collected.push({ path: path.relative(projectDir, full), content })
        }
      }
    } catch (e) { /* ignore */ }
  }

  try {
    // Structure
    result.structure = await buildStructure(projectDir)

    // package.json
    const pkgPath = path.join(projectDir, 'package.json')
    if (fs.existsSync(pkgPath)) result.packageJson = await fs.readJson(pkgPath)

    // README
    for (const name of ['README.md', 'readme.md', 'README.txt', 'README']) {
      const p = path.join(projectDir, name)
      if (fs.existsSync(p)) {
        result.readme = (await fs.readFile(p, 'utf8')).slice(0, 4000)
        break
      }
    }

    // Config files
    for (const name of CONFIG_NAMES) {
      if (fs.existsSync(path.join(projectDir, name))) result.configFiles.push(name)
    }

    // Source files
    await collectSourceFiles(projectDir, 0, result.sourceFiles)

    // Docs (other .md files)
    const topLevel = await fs.readdir(projectDir).catch(() => [])
    for (const entry of topLevel) {
      if (entry === 'README.md') continue
      const ext = path.extname(entry)
      if (DOC_EXTS.has(ext)) {
        const content = (await fs.readFile(path.join(projectDir, entry), 'utf8').catch(() => '')).slice(0, 2000)
        result.docs.push({ path: entry, content })
      }
    }

    // Git log
    try {
      result.gitLog = execSync('git log --oneline -20', { cwd: projectDir, timeout: 3000 }).toString().trim()
    } catch (e) { /* no git */ }

  } catch (e) { /* ignore */ }

  return result
}

function buildPersonasBase() {
  return `### Moneypenny — Business Analyst
**Personality:** Sharp, perceptive, relentless about clarity. Asks the questions others forget.
**Responsibilities:** Discovery, requirements gathering, edge case surfacing.

### Mallory — Product Manager
**Personality:** Strategic thinker, pragmatic about tradeoffs, obsessed with user value.
**Responsibilities:** PRD creation, user stories, acceptance criteria, scope management.

### Quartermaster — Software Architect
**Personality:** Inventive, principled, thorough. Has seen every architecture mistake.
**Responsibilities:** System design, ADRs, API design, technical risk assessment.

### James Bond — Senior Developer
**Personality:** Executes with precision. Writes clean, tested, production-quality code.
**Responsibilities:** Feature implementation, code review, refactoring.

### Tanner — QA Engineer
**Personality:** Adversarial thinker. Finds vulnerabilities before adversaries do.
**Responsibilities:** Test planning, bug investigation, acceptance validation.

### Felix — Scrum Master
**Personality:** Calm, dependable, mission-focused. Removes blockers before they become crises.
**Responsibilities:** Task breakdown, sprint planning, parallel execution grouping.`
}

function buildPRDPrompt(answers, scan) {
  return `You are a senior product manager. Generate a comprehensive Product Requirements Document (PRD) in Markdown format.

Project Information:
${JSON.stringify(answers, null, 2)}

Project scan:
- Files: ${scan.files?.join(', ')}
- Package.json name: ${scan.packageJson?.name || 'unknown'}
- Has README: ${!!scan.readme}
${scan.readme ? `- README excerpt: ${scan.readme.slice(0, 500)}` : ''}

Generate a professional PRD with these sections:
# Product Requirements Document
## Overview
## Problem Statement
## Goals & Success Metrics
## Target Users
## Key Features
## Non-Goals
## Technical Constraints
## Timeline Estimates

Be specific and actionable. Use the project information provided.`
}

function buildArchPrompt(answers, scan, prd) {
  return `You are a senior software architect. Generate a comprehensive Architecture Document in Markdown format.

Project Information:
${JSON.stringify(answers, null, 2)}

PRD Summary (first 1000 chars):
${prd.slice(0, 1000)}

Generate a professional Architecture doc with these sections:
# Architecture Document
## System Overview
## Architecture Diagram (ASCII)
## Components
## Data Flow
## Key Technical Decisions
## Scalability & Performance
## Security Considerations
## Deployment Strategy

Be specific about the tech stack and component relationships.`
}

function buildTechStackPrompt(answers, scan) {
  return `You are a senior engineer. Generate a Tech Stack Manifest in Markdown format.

Project Information:
${JSON.stringify(answers, null, 2)}

Package.json (if available):
${JSON.stringify(scan.packageJson, null, 2)}

Generate a comprehensive Tech Stack manifest with:
# Tech Stack Manifest
## Languages
## Frameworks & Libraries
## Development Tools
## Testing
## CI/CD
## Infrastructure
## Conventions & Standards
## Key Dependencies (table with purpose)

Be specific about versions and rationale for choices.`
}

function buildPersonasPrompt(answers, scan, prd) {
  // Hardcoded MI6-codename agent personas — project-specific details are appended by the AI
  const bmadBase = `
## Base Agent Personas — project-q MI6 Team

The following personas are your AI development team. Each will be activated in the appropriate workflow phase.

### Moneypenny — Business Analyst
**Personality:** Sharp, perceptive, and relentless about clarity. Asks the questions others forget to ask. Has an uncanny ability to extract what people mean, not just what they say.
**Responsibilities:** Discovery sessions, requirements gathering, stakeholder interview, edge case surfacing.
**Approach:** One question at a time. Challenges assumptions. Never lets ambiguity slide. Summarizes before advancing.
**Signature phrase:** "Let me make sure I understand correctly…"

### Mallory — Product Manager
**Personality:** Strategic thinker with cool authority. Pragmatic about tradeoffs, obsessed with user value and measurable outcomes. Ships products under pressure.
**Responsibilities:** PRD creation, user stories, acceptance criteria, scope management, prioritization.
**Approach:** Thinks in user stories. Writes acceptance criteria that leave zero ambiguity. Calls out scope creep firmly.
**Signature phrase:** "What does success look like, specifically?"

### Quartermaster — Software Architect
**Personality:** Inventive, principled, thorough. Has designed solutions to problems others haven't imagined yet, and has seen every architecture mistake.
**Responsibilities:** System design, architecture decisions, ADRs, API design, technical risk assessment.
**Approach:** Starts with constraints. Documents every major decision with rationale and alternatives considered.
**Signature phrase:** "Here's why we're NOT doing it the obvious way…"

### James Bond — Senior Developer
**Personality:** Executes with precision under pressure. Writes clean, tested, production-quality code. Always completes the mission. Leaves codebases better than found.
**Responsibilities:** Feature implementation, code review, refactoring, technical debt reduction.
**Approach:** Reads before writing. Matches existing patterns. Writes tests alongside implementation. Never truncates output.
**Signature phrase:** "Consider it done."

### Tanner — QA Engineer
**Personality:** Adversarial thinker. Intelligence analyst who finds the vulnerabilities before adversaries do. Relentlessly thorough.
**Responsibilities:** Test planning, bug investigation, acceptance validation, regression coverage.
**Approach:** Tests happy path, edge cases, and error states equally. Thinks like a malicious user.
**Signature phrase:** "What happens when this goes wrong?"

### Felix — Scrum Master
**Personality:** Calm, dependable, mission-focused. Keeps the team moving and the operation on track. Removes blockers before they become crises.
**Responsibilities:** Task breakdown, sprint planning, parallel/sequential execution grouping, blocker identification.
**Approach:** Breaks work into atomic tasks. Identifies what can run in parallel. Always writes "done when" criteria.
**Signature phrase:** "These three tasks can run in parallel — here's why."
`.trim()

  return `You are customizing AI agent personas for a specific software project. Start with the BMAD base personas below, then add project-specific specializations for each role.

${bmadBase}

---

Project Information:
${JSON.stringify(answers, null, 2)}

Tech Stack:
${JSON.stringify(scan.packageJson?.dependencies || {}, null, 2)}

PRD excerpt: ${prd.slice(0, 600)}

---

Now generate the final PERSONAS.md document. For each of the 6 agents above, add a "## Project-Specific Notes" subsection that includes:
- Which parts of this specific tech stack they specialize in
- Key architectural decisions from this project they should be aware of
- Domain-specific terminology they should use
- Any project-specific coding conventions or constraints

Output the complete document starting with:
# Agent Personas — [Project Name] MI6 Team

Keep the base persona descriptions intact. Only ADD the project-specific notes.`
}

module.exports = router
