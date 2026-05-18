const express = require('express')
const router = express.Router()
const fs = require('fs-extra')
const path = require('path')
const multer = require('multer')
const { syncContextToCLAUDEMD } = require('../services/context-sync')

const ALLOWED_EXTENSIONS = new Set(['.md', '.txt', '.json', '.yaml', '.yml'])

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase()
    if (ALLOWED_EXTENSIONS.has(ext)) {
      cb(null, true)
    } else {
      cb(Object.assign(new Error(`File type not allowed: ${ext}`), { status: 400 }))
    }
  }
})

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
  const projectDir = req.app.get('projectDir')
  const filePath = path.join(pqDir, 'context', req.params.filename)
  const { content } = req.body

  try {
    await fs.writeFile(filePath, content, 'utf8')
    req.app.get('io').emit('context:updated', { filename: req.params.filename })
    // Regenerate CLAUDE.md so Claude CLI picks up the change immediately
    syncContextToCLAUDEMD(projectDir, pqDir).catch(e => console.error('[context-sync]', e.message))
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

// POST /api/context/upload — upload one or more context files
router.post('/upload', (req, res) => {
  upload.array('files', 10)(req, res, async (err) => {
    if (err) {
      return res.status(err.status || 400).json({ error: err.message })
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' })
    }

    const pqDir = req.app.get('pqDir')
    const io = req.app.get('io')

    try {
      const uploaded = []
      for (const file of req.files) {
        const destPath = path.join(pqDir, 'context', file.originalname)
        await fs.outputFile(destPath, file.buffer)
        io.emit('context:updated', { filename: file.originalname })
        uploaded.push({ filename: file.originalname, size: file.size })
      }
      // Regenerate CLAUDE.md with new files included
      const projectDir = req.app.get('projectDir')
      syncContextToCLAUDEMD(projectDir, pqDir).catch(e => console.error('[context-sync]', e.message))
      res.json({ uploaded })
    } catch (writeErr) {
      res.status(500).json({ error: writeErr.message })
    }
  })
})

module.exports = router
