const { tool } = require('ai')
const { z } = require('zod')
const fs = require('fs-extra')
const path = require('path')
const { execSync } = require('child_process')
const { rankedSearch } = require('../retrieval/lexical')

const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.project-q'])

function buildTools(projectDir, onToolCall) {
  const notify = (name, input) => onToolCall?.({ name, input })

  return {
    read_file: tool({
      description: 'Read a file from the project directory',
      parameters: z.object({
        path: z.string().describe('Relative path from project root'),
      }),
      execute: async ({ path: filePath }) => {
        notify('read_file', { path: filePath })
        const abs = path.resolve(projectDir, filePath)
        if (!abs.startsWith(projectDir)) return 'Error: path outside project'
        try {
          const content = await fs.readFile(abs, 'utf8')
          return content.slice(0, 20000)
        } catch (e) {
          return `Error reading file: ${e.message}`
        }
      },
    }),

    write_file: tool({
      description: 'Write or overwrite a file in the project directory',
      parameters: z.object({
        path: z.string().describe('Relative path from project root'),
        content: z.string().describe('Full file content to write'),
      }),
      execute: async ({ path: filePath, content }) => {
        notify('write_file', { path: filePath })
        const abs = path.resolve(projectDir, filePath)
        if (!abs.startsWith(projectDir)) return 'Error: path outside project'
        await fs.outputFile(abs, content)
        return `Written: ${filePath}`
      },
    }),

    list_files: tool({
      description: 'List files and directories at a given path',
      parameters: z.object({
        path: z.string().describe('Relative path to list. Use "." for project root').default('.'),
      }),
      execute: async ({ path: dirPath }) => {
        notify('list_files', { path: dirPath })
        const abs = path.resolve(projectDir, dirPath)
        if (!abs.startsWith(projectDir)) return 'Error: path outside project'
        try {
          const entries = await fs.readdir(abs, { withFileTypes: true })
          return entries
            .filter(e => !IGNORE_DIRS.has(e.name))
            .map(e => `${e.isDirectory() ? '[dir]' : '[file]'} ${e.name}`)
            .join('\n')
        } catch (e) {
          return `Error: ${e.message}`
        }
      },
    }),

    search_code: tool({
      description: 'Keyword/regex search across project files, ranked by match count (ripgrep). Use when you know the exact identifier, string, or pattern.',
      parameters: z.object({
        pattern: z.string().describe('Text or regex pattern to search for'),
        glob: z.string().describe('File glob to limit search, e.g. "**/*.ts"').optional(),
      }),
      execute: async ({ pattern, glob }) => {
        notify('search_code', { pattern, glob })
        try {
          const ranked = rankedSearch(pattern, projectDir, { glob })
          if (!ranked.length) return 'No matches found'
          return ranked.slice(0, 10).map(r =>
            `### ${r.file}  (${r.count} match${r.count !== 1 ? 'es' : ''})\n` +
            r.hits.map(h => `  ${h.line}: ${h.text}`).join('\n')
          ).join('\n\n')
        } catch (e) {
          return `Search error: ${e.message}`
        }
      },
    }),

    run_command: tool({
      description: 'Run a shell command in the project directory (lint, test, typecheck, etc.)',
      parameters: z.object({
        command: z.string().describe('Shell command to run'),
        timeout: z.number().describe('Timeout in seconds (default 30)').optional(),
      }),
      execute: async ({ command, timeout = 30 }) => {
        notify('run_command', { command })
        try {
          const output = execSync(command, {
            cwd: projectDir,
            encoding: 'utf8',
            timeout: timeout * 1000,
            stdio: ['ignore', 'pipe', 'pipe'],
          })
          return output.slice(0, 5000) || '(no output)'
        } catch (e) {
          const out = ((e.stdout || '') + (e.stderr || '')).slice(0, 3000)
          return `Exit ${e.status}:\n${out}`
        }
      },
    }),

    task_complete: tool({
      description: 'Signal that the task is complete. Call this when all work is done.',
      parameters: z.object({
        summary: z.string().describe('Brief description of what was done and which files changed'),
      }),
      execute: async ({ summary }) => {
        notify('task_complete', { summary })
        return `DONE: ${summary}`
      },
    }),
  }
}

module.exports = { buildTools }
