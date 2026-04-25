const express = require('express')
const router = express.Router()
const fs = require('fs-extra')
const path = require('path')
const { v4: uuidv4 } = require('uuid')
const WorkflowEngine = require('../services/workflows/engine')
const builtinWorkflows = require('../services/workflows/registry')

// GET /api/workflows — list all workflows (built-in + custom)
router.get('/', async (req, res) => {
  const pqDir = req.app.get('pqDir')
  const workflowsDir = path.join(pqDir, 'workflows')

  try {
    // Load custom workflows
    const customFiles = await fs.readdir(workflowsDir).catch(() => [])
    const custom = []
    for (const f of customFiles.filter(f => f.endsWith('.json'))) {
      const wf = await fs.readJson(path.join(workflowsDir, f))
      custom.push(wf)
    }

    const workflows = [
      ...Object.values(builtinWorkflows).map(w => ({ ...w, type: 'builtin' })),
      ...custom.map(w => ({ ...w, type: 'custom' }))
    ]

    res.json({ workflows })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/workflows/:id — get workflow definition
router.get('/:id', async (req, res) => {
  const pqDir = req.app.get('pqDir')
  const { id } = req.params

  try {
    // Check built-in first
    if (builtinWorkflows[id]) {
      return res.json({ workflow: { ...builtinWorkflows[id], type: 'builtin' } })
    }

    // Check custom
    const customPath = path.join(pqDir, 'workflows', `${id}.json`)
    if (fs.existsSync(customPath)) {
      const wf = await fs.readJson(customPath)
      return res.json({ workflow: { ...wf, type: 'custom' } })
    }

    res.status(404).json({ error: 'Workflow not found' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/workflows/custom — create custom workflow
router.post('/custom', async (req, res) => {
  const pqDir = req.app.get('pqDir')
  const io = req.app.get('io')

  try {
    const workflow = {
      id: req.body.id || uuidv4(),
      name: req.body.name,
      description: req.body.description || '',
      icon: req.body.icon || '⚡',
      steps: req.body.steps || [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }

    const wfPath = path.join(pqDir, 'workflows', `${workflow.id}.json`)
    await fs.writeJson(wfPath, workflow, { spaces: 2 })
    io.emit('workflow:created', workflow)
    res.status(201).json({ workflow })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// PUT /api/workflows/custom/:id — update custom workflow
router.put('/custom/:id', async (req, res) => {
  const pqDir = req.app.get('pqDir')
  const io = req.app.get('io')
  const wfPath = path.join(pqDir, 'workflows', `${req.params.id}.json`)

  try {
    if (!fs.existsSync(wfPath)) return res.status(404).json({ error: 'Workflow not found' })
    const existing = await fs.readJson(wfPath)
    const updated = { ...existing, ...req.body, updatedAt: new Date().toISOString() }
    await fs.writeJson(wfPath, updated, { spaces: 2 })
    io.emit('workflow:updated', updated)
    res.json({ workflow: updated })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// DELETE /api/workflows/custom/:id
router.delete('/custom/:id', async (req, res) => {
  const pqDir = req.app.get('pqDir')
  const io = req.app.get('io')
  const wfPath = path.join(pqDir, 'workflows', `${req.params.id}.json`)

  try {
    await fs.remove(wfPath)
    io.emit('workflow:deleted', { id: req.params.id })
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/workflows/:id/run — execute a workflow
router.post('/:id/run', async (req, res) => {
  const pqDir = req.app.get('pqDir')
  const projectDir = req.app.get('projectDir')
  const io = req.app.get('io')
  const { id } = req.params
  const { input, aiConfig, executionPlan } = req.body

  try {
    // Get workflow definition
    let workflowDef = builtinWorkflows[id]
    if (!workflowDef) {
      const customPath = path.join(pqDir, 'workflows', `${id}.json`)
      if (fs.existsSync(customPath)) {
        workflowDef = await fs.readJson(customPath)
      }
    }
    if (!workflowDef) return res.status(404).json({ error: 'Workflow not found' })

    // Get project context
    const configPath = path.join(pqDir, 'config.json')
    const config = fs.existsSync(configPath) ? await fs.readJson(configPath) : {}
    const aiConf = aiConfig || config.ai || { provider: 'claude', model: 'claude-opus-4-6' }

    const context = await loadProjectContext(pqDir)

    const engine = new WorkflowEngine({
      workflowDef,
      pqDir,
      projectDir,
      io,
      aiConfig: aiConf,
      context,
      input,
      executionPlan
    })

    const executionId = uuidv4()
    res.json({ executionId, status: 'started' })

    // Run async
    engine.run(executionId).catch(err => {
      io.emit(`execution:${executionId}:error`, { message: err.message })
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/workflows/:id/step — run a single workflow step (chat-based)
router.post('/:id/step', async (req, res) => {
  const pqDir = req.app.get('pqDir')
  const { id } = req.params
  const { step, message, history, aiConfig } = req.body

  try {
    const configPath = path.join(pqDir, 'config.json')
    const config = fs.existsSync(configPath) ? await fs.readJson(configPath) : {}
    const aiConf = aiConfig || config.ai || { provider: 'claude', model: 'claude-opus-4-6' }
    const context = await loadProjectContext(pqDir)

    const engine = new WorkflowEngine({ pqDir, aiConfig: aiConf, context })
    const result = await engine.runStep(id, step, message, history)
    res.json(result)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

async function loadProjectContext(pqDir) {
  const contextDir = path.join(pqDir, 'context')
  const context = {}
  const files = await fs.readdir(contextDir).catch(() => [])
  for (const f of files) {
    if (f.endsWith('.md')) {
      context[f.replace('.md', '')] = await fs.readFile(path.join(contextDir, f), 'utf8')
    }
  }
  return context
}

module.exports = router
