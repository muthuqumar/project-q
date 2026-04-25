const express = require('express')
const router = express.Router()
const fs = require('fs-extra')
const path = require('path')

// GET /api/context — list all context files
router.get('/', async (req, res) => {
  const pqDir = req.app.get('pqDir')
  const contextDir = path.join(pqDir, 'context')
  const workflowsDir = path.join(pqDir, 'workflows')

  try {
    const contextFiles = await fs.readdir(contextDir).catch(() => [])
    const workflowFiles = await fs.readdir(workflowsDir).catch(() => [])

    const context = {}
    for (const file of contextFiles) {
      if (file.endsWith('.md') || file.endsWith('.json')) {
        const content = await fs.readFile(path.join(contextDir, file), 'utf8')
        context[file] = content
      }
    }

    res.json({ context, workflowFiles })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/context/:filename — get a specific context file
router.get('/:filename', async (req, res) => {
  const pqDir = req.app.get('pqDir')
  const filePath = path.join(pqDir, 'context', req.params.filename)

  try {
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' })
    }
    const content = await fs.readFile(filePath, 'utf8')
    res.json({ filename: req.params.filename, content })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// PUT /api/context/:filename — update a context file
router.put('/:filename', async (req, res) => {
  const pqDir = req.app.get('pqDir')
  const filePath = path.join(pqDir, 'context', req.params.filename)
  const { content } = req.body

  try {
    await fs.writeFile(filePath, content, 'utf8')
    req.app.get('io').emit('context:updated', { filename: req.params.filename })
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/context/config/get — get project config
router.get('/config/get', async (req, res) => {
  const pqDir = req.app.get('pqDir')
  const configPath = path.join(pqDir, 'config.json')

  try {
    if (!fs.existsSync(configPath)) {
      return res.json({ config: null })
    }
    const config = await fs.readJson(configPath)
    res.json({ config })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// PUT /api/context/config/update — update project config
router.put('/config/update', async (req, res) => {
  const pqDir = req.app.get('pqDir')
  const configPath = path.join(pqDir, 'config.json')
  const { config } = req.body

  try {
    let existing = {}
    if (fs.existsSync(configPath)) {
      existing = await fs.readJson(configPath)
    }
    const updated = { ...existing, ...config, updatedAt: new Date().toISOString() }
    await fs.writeJson(configPath, updated, { spaces: 2 })
    res.json({ success: true, config: updated })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
