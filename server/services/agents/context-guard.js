/**
 * context-guard.js
 *
 * Checks whether project context (PRD.md, ARCHITECTURE.md, TECH_STACK.md)
 * exists in .project-q/context/ before any mission runs.
 *
 * If context is missing it auto-generates it by:
 *   1. Scanning the project directory structure, package.json, README, git log
 *   2. Calling the AI once to produce all three documents in a single pass
 *   3. Writing the files and syncing CLAUDE.md
 *
 * Call ensureProjectContext() at the top of every startMission() and
 * executeStep() invocation.
 */

const fs       = require('fs-extra')
const path     = require('path')
const { execSync } = require('child_process')
const AIService    = require('../ai')
const { syncContextToCLAUDEMD } = require('../context-sync')

const REQUIRED = ['PRD.md', 'ARCHITECTURE.md', 'TECH_STACK.md']
const IGNORE   = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '.cache', 'vendor', '.project-q', '__pycache__'])

// ── Public entry point ────────────────────────────────────────────────────────

/**
 * Ensures all required context files exist.
 * If any are missing, scans the project and generates them with AI.
 *
 * @param {string}   pqDir      – path to .project-q dir
 * @param {string}   projectDir – path to the target project
 * @param {object}   aiConfig   – AI config (passed through from mission)
 * @param {function} onProgress – optional callback(message) for status updates
 * @returns {{ generated: boolean, files?: string[] }}
 */
async function ensureProjectContext(pqDir, projectDir, aiConfig, onProgress) {
  const contextDir = path.join(pqDir, 'context')
  await fs.ensureDir(contextDir)

  const missing = REQUIRED.filter(f => !fs.existsSync(path.join(contextDir, f)))

  if (missing.length === 0) {
    // Context files exist — make sure CLAUDE.md is also present
    const claudeMdPath = path.join(projectDir, 'CLAUDE.md')
    if (!fs.existsSync(claudeMdPath)) {
      onProgress?.('[context-guard] CLAUDE.md missing — regenerating...')
      await syncContextToCLAUDEMD(projectDir, pqDir)
    }
    return { generated: false }
  }

  onProgress?.(`[context-guard] Missing: ${missing.join(', ')} — scanning codebase to auto-generate context…`)

  // 1. Scan project
  const scan = await quickScan(projectDir)

  // 2. Generate context with AI (single pass, analytical — no cwd needed)
  const ai = new AIService({ ...(aiConfig || {}), projectDir: null })
  const prompt = buildPrompt(projectDir, scan)

  onProgress?.('[context-guard] AI is analysing project structure…')
  const response = await ai.complete(prompt)

  // 3. Parse sections
  const extract = (tag) => {
    const m = response.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`))
    return m ? m[1].trim() : null
  }

  const generated = []
  const sections = {
    'PRD.md':          extract('PRD'),
    'ARCHITECTURE.md': extract('ARCHITECTURE'),
    'TECH_STACK.md':   extract('TECH_STACK'),
  }

  for (const [file, content] of Object.entries(sections)) {
    if (content) {
      await fs.writeFile(path.join(contextDir, file), content, 'utf8')
      generated.push(file)
      onProgress?.(`[context-guard] Generated ${file}`)
    }
  }

  // 4. Write CLAUDE.md so every subsequent claude CLI invocation picks it up
  await syncContextToCLAUDEMD(projectDir, pqDir)
  onProgress?.('[context-guard] CLAUDE.md synced — context ready')

  return { generated: true, files: generated }
}

// ── Project scanner ───────────────────────────────────────────────────────────

async function quickScan(projectDir) {
  const result = {
    structure:   '',
    packageJson: null,
    readme:      null,
    gitLog:      null,
    configFiles: [],
  }

  try {
    result.structure = await buildTree(projectDir)

    const pkgPath = path.join(projectDir, 'package.json')
    if (fs.existsSync(pkgPath)) result.packageJson = await fs.readJson(pkgPath)

    for (const name of ['README.md', 'readme.md', 'README.txt', 'README']) {
      const p = path.join(projectDir, name)
      if (fs.existsSync(p)) {
        result.readme = (await fs.readFile(p, 'utf8')).slice(0, 3000)
        break
      }
    }

    for (const name of ['tsconfig.json', 'vite.config.js', 'vite.config.ts', 'next.config.js',
      'webpack.config.js', 'docker-compose.yml', 'Dockerfile', 'Makefile', 'pyproject.toml',
      '.eslintrc.json', 'jest.config.js', 'go.mod', 'Cargo.toml']) {
      if (fs.existsSync(path.join(projectDir, name))) result.configFiles.push(name)
    }

    try {
      result.gitLog = execSync('git log --oneline -15', {
        cwd: projectDir, timeout: 3000, encoding: 'utf8',
      }).trim()
    } catch {}
  } catch {}

  return result
}

async function buildTree(dir, prefix = '', depth = 0) {
  if (depth > 2) return ''
  let out = ''
  try {
    const entries = (await fs.readdir(dir)).filter(e => !IGNORE.has(e) && !e.startsWith('.'))
    for (const entry of entries.slice(0, 35)) {
      const full = path.join(dir, entry)
      const stat = await fs.stat(full).catch(() => null)
      if (!stat) continue
      out += `${prefix}${stat.isDirectory() ? '📁' : '📄'} ${entry}\n`
      if (stat.isDirectory()) out += await buildTree(full, prefix + '  ', depth + 1)
    }
  } catch {}
  return out
}

// ── AI prompt ─────────────────────────────────────────────────────────────────

function buildPrompt(projectDir, scan) {
  const projectName = path.basename(projectDir)
  const pkg = scan.packageJson

  return `You are a senior engineering team analysing a codebase for the first time.

Project: ${projectName}
Directory: ${projectDir}

## Directory structure
${scan.structure || '(could not read)'}

## package.json
${pkg ? JSON.stringify({ name: pkg.name, version: pkg.version, description: pkg.description, scripts: pkg.scripts, dependencies: pkg.dependencies, devDependencies: pkg.devDependencies }, null, 2).slice(0, 2500) : 'Not found'}

## README
${scan.readme || 'Not found'}

## Config files found
${scan.configFiles.join(', ') || 'None'}

## Git history (recent commits)
${scan.gitLog || 'No git history available'}

---

Based on this scan, generate the following three context documents. Infer from evidence only — do not hallucinate features. Wrap each in the exact XML tags shown.

<PRD>
# Product Requirements Document — ${projectName}

## Overview
[What this project does and why it exists — infer from code, README, package name]

## Problem Statement
[What problem this solves]

## Goals & Success Metrics
[What success looks like]

## Target Users
[Who uses this]

## Key Features
[The core features, numbered — only what you can observe]

## Non-Goals
[What this doesn't do]

## Technical Constraints
[Known constraints from the tech stack]

## Current Status
[State of the codebase based on this scan]
</PRD>

<ARCHITECTURE>
# Architecture Document — ${projectName}

## System Overview
[High-level description]

## Architecture Diagram (ASCII)
[Draw the key components and their relationships]

## Components
[Each major component with its responsibility]

## Data Flow
[How data moves through the system]

## Key Technical Decisions
[Infer from config files, dependencies, project structure]

## Entry Points
[Main files — server entry, client entry, CLI entry, etc.]

## Deployment
[Inferred from Dockerfile, docker-compose, config files]
</ARCHITECTURE>

<TECH_STACK>
# Tech Stack — ${projectName}

## Languages
[All languages detected]

## Frameworks & Libraries
[With versions from package.json]

## Development Tools
[Build tools, linters, formatters]

## Testing
[Test framework and approach]

## Infrastructure
[Deployment, hosting — inferred from config]

## Code Conventions
[Naming, structure, patterns observed]

## Key Dependencies
| Package | Version | Purpose |
|---------|---------|---------|
[Fill from package.json — only list packages with clear purpose]
</TECH_STACK>

Be thorough and factual. Only document what you can observe from the scan above.`
}

module.exports = { ensureProjectContext }
