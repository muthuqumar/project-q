/**
 * context-sync.js
 *
 * Writes project context into CLAUDE.md at the target project root.
 *
 * Why: Claude Code CLI automatically reads CLAUDE.md when run in a directory.
 * By writing all context (PRD, architecture, tech stack, personas) there, every
 * `claude --print` invocation picks it up natively — no manual prompt injection needed.
 *
 * Call syncContextToCLAUDEMD() whenever context files change.
 */

const fs = require('fs-extra')
const path = require('path')

// Ordered list of standard context files and their section headings
const CONTEXT_FILES = [
  { file: 'PRD.md',          heading: '## Product Requirements' },
  { file: 'ARCHITECTURE.md', heading: '## Architecture' },
  { file: 'TECH_STACK.md',   heading: '## Tech Stack' },
  { file: 'PERSONAS.md',     heading: '## Team Personas' },
]

async function syncContextToCLAUDEMD(projectDir, pqDir) {
  if (!projectDir || !pqDir) return

  const contextDir = path.join(pqDir, 'context')
  const claudeMdPath = path.join(projectDir, 'CLAUDE.md')

  const sections = []

  // ── Standard context files (in priority order) ────────────────────────────
  const standardFiles = new Set(CONTEXT_FILES.map(c => c.file))
  for (const { file, heading } of CONTEXT_FILES) {
    const filePath = path.join(contextDir, file)
    const content = await fs.readFile(filePath, 'utf8').catch(() => '')
    if (content.trim()) {
      sections.push(`${heading}\n\n${content.trim()}`)
    }
  }

  // ── Any additional context files not in the standard list ─────────────────
  const allFiles = await fs.readdir(contextDir).catch(() => [])
  for (const file of allFiles.sort()) {
    if (!file.endsWith('.md') && !file.endsWith('.txt')) continue
    if (standardFiles.has(file)) continue
    const content = await fs.readFile(path.join(contextDir, file), 'utf8').catch(() => '')
    if (content.trim()) {
      const name = path.basename(file, path.extname(file)).replace(/[-_]/g, ' ')
      sections.push(`## ${name}\n\n${content.trim()}`)
    }
  }

  if (sections.length === 0) return

  // ── project-q agentic instructions ────────────────────────────────────────
  // These tell Claude Code how to behave when invoked as part of a project-q mission.
  // Claude writes files directly using its tools — no XML blocks needed.
  const pqInstructions = `## project-q Agentic Instructions

You are running as part of an agentic development team (project-q). When given a task:

### Before writing anything
1. Use \`Glob\` and \`Read\` to understand the project structure
2. Find and read every file directly relevant to your task
3. Identify patterns and conventions already in use — match them exactly

### While implementing
- Write complete, working code — never partial snippets or "// ... rest unchanged"
- Handle all error cases explicitly — never silently swallow exceptions
- Write or update tests alongside any new implementation
- Run \`Bash\` to lint/typecheck/test if tooling is available (e.g. \`npm run typecheck\`, \`npm test -- --bail\`)

### After implementing
- End your response with a brief summary wrapped in \`<summary>...</summary>\` tags
- State what files you changed, why, and any assumptions you made

### Important
- All file paths are relative to this project root
- You have full filesystem access — use Read/Write/Edit/Bash/Glob/Grep freely
- Do NOT output XML \`<file_change>\` blocks — write files directly with your Edit/Write tools`

  sections.push(pqInstructions)

  const projectName = path.basename(projectDir)
  const header = `# ${projectName}\n\n> Context maintained by [project-q](https://github.com/muthuqumar/project-q).  \n> Edit source files in \`.project-q/context/\` — this file is auto-regenerated.  \n> Last synced: ${new Date().toISOString()}`

  const claudeMd = [header, ...sections].join('\n\n---\n\n')

  await fs.writeFile(claudeMdPath, claudeMd, 'utf8')
  console.log(`[context-sync] CLAUDE.md written → ${claudeMdPath}`)
}

module.exports = { syncContextToCLAUDEMD }
