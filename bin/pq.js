#!/usr/bin/env node
/**
 * project-q CLI
 *
 * Usage (from any project directory):
 *   pq start          — start the server & open UI for the current directory
 *   pq start [path]   — start for a specific project path
 *   pq init           — scaffold .project-q/ in current directory
 *   pq help           — show this help
 */

const { spawn, execSync } = require('child_process')
const path = require('path')
const fs = require('fs')

const ROOT = path.join(__dirname, '..')
const args = process.argv.slice(2)
const command = args[0] || 'start'

const c = {
  reset:  '\x1b[0m',
  cyan:   '\x1b[36m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  red:    '\x1b[31m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
}

function banner() {
  console.log(`
${c.cyan}${c.bold}  ╔═══════════════════════════════════════╗
  ║          p r o j e c t - q            ║
  ║   AI-powered dev workflow agent       ║
  ╚═══════════════════════════════════════╝${c.reset}
`)
}

function checkDeps() {
  const serverModules = path.join(ROOT, 'server', 'node_modules')
  if (!fs.existsSync(serverModules)) {
    console.log(`${c.yellow}⚠  Dependencies not installed yet.${c.reset}`)
    console.log(`${c.cyan}   Running: npm install --prefix ${path.join(ROOT, 'server')}${c.reset}\n`)
    try {
      execSync(`npm install`, { cwd: path.join(ROOT, 'server'), stdio: 'inherit' })
      console.log(`\n${c.green}✓  Dependencies installed.${c.reset}\n`)
    } catch (e) {
      console.error(`${c.red}✗  npm install failed. Please run manually:${c.reset}`)
      console.error(`   cd ${path.join(ROOT, 'server')} && npm install`)
      process.exit(1)
    }
  }
}

switch (command) {

  case 'start': {
    banner()
    checkDeps()

    // Accept an optional path argument: pq start /path/to/project
    const projectDir = args[1]
      ? path.resolve(args[1])
      : process.cwd()

    // Don't start inside the project-q repo itself (unless explicitly passed)
    if (!args[1] && projectDir === ROOT) {
      console.log(`${c.yellow}⚠  You're inside the project-q directory.${c.reset}`)
      console.log(`   Run ${c.cyan}pq start${c.reset} from your target project, or pass a path:`)
      console.log(`   ${c.cyan}pq start ~/code/my-app${c.reset}\n`)
    }

    if (!fs.existsSync(projectDir)) {
      console.error(`${c.red}✗  Project directory not found: ${projectDir}${c.reset}`)
      process.exit(1)
    }

    const PORT = process.env.PORT || 3141
    const url = `http://localhost:${PORT}`

    console.log(`${c.cyan}▶ Project:${c.reset} ${projectDir}`)
    console.log(`${c.cyan}▶ UI:${c.reset}      ${url}`)
    console.log(`${c.dim}  Press Ctrl+C to stop${c.reset}\n`)

    const server = spawn('node', ['index.js'], {
      cwd: path.join(ROOT, 'server'),
      stdio: 'inherit',
      env: {
        ...process.env,
        PROJECT_DIR: projectDir,
        PORT: String(PORT),
      }
    })

    // Try to open browser after a short delay
    server.on('spawn', () => {
      setTimeout(() => {
        try {
          const open = process.platform === 'darwin' ? 'open'
            : process.platform === 'win32' ? 'start'
            : 'xdg-open'
          execSync(`${open} ${url}`, { stdio: 'ignore' })
        } catch {}
      }, 1200)
    })

    server.on('error', (err) => {
      console.error(`${c.red}✗ Failed to start server:${c.reset}`, err.message)
    })

    process.on('SIGINT', () => {
      console.log(`\n${c.dim}  Stopping project-q...${c.reset}`)
      server.kill()
      process.exit(0)
    })
    break
  }

  case 'init': {
    banner()
    const targetDir = args[1] ? path.resolve(args[1]) : process.cwd()
    const pqDir = path.join(targetDir, '.project-q')

    if (fs.existsSync(pqDir)) {
      console.log(`${c.yellow}⚠  .project-q already exists in:${c.reset}`)
      console.log(`   ${targetDir}`)
      console.log(`   Run ${c.cyan}pq start${c.reset} to open the UI.\n`)
    } else {
      ;['context', 'tasks', 'workflows'].forEach(d =>
        fs.mkdirSync(path.join(pqDir, d), { recursive: true })
      )
      const config = {
        version: '1.0.0',
        projectDir: targetDir,
        initialized: new Date().toISOString(),
        ai: { provider: 'auto' },
        workflows: ['dev-now', 'feature-dev', 'greenfield', 'brownfield-feature', 'bug-fix']
      }
      fs.writeFileSync(path.join(pqDir, 'config.json'), JSON.stringify(config, null, 2))
      console.log(`${c.green}✓  Initialized .project-q in:${c.reset}`)
      console.log(`   ${targetDir}\n`)
      console.log(`${c.cyan}▶  Run 'pq start' to launch the UI and complete setup.${c.reset}\n`)
    }
    break
  }

  case 'help':
  default: {
    banner()
    console.log(`${c.bold}Usage:${c.reset}`)
    console.log(`  ${c.cyan}pq start${c.reset}              Start for the current directory`)
    console.log(`  ${c.cyan}pq start [path]${c.reset}       Start for a specific project path`)
    console.log(`  ${c.cyan}pq init${c.reset}               Scaffold .project-q/ in current directory`)
    console.log(`  ${c.cyan}pq init [path]${c.reset}        Scaffold for a specific path`)
    console.log(`  ${c.cyan}pq help${c.reset}               Show this help`)
    console.log()
    console.log(`${c.bold}Examples:${c.reset}`)
    console.log(`  ${c.dim}cd ~/code/my-app && pq start${c.reset}`)
    console.log(`  ${c.dim}pq start ~/code/my-react-app${c.reset}`)
    console.log(`  ${c.dim}pq start ~/code/my-django-api${c.reset}`)
    console.log()
    console.log(`${c.bold}First time?${c.reset}`)
    console.log(`  Run ${c.cyan}bash install.sh${c.reset} from the project-q directory.`)
    console.log()
    break
  }
}
