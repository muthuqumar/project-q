const express = require('express')
const router = express.Router()
const fs = require('fs-extra')
const path = require('path')

// GET /api/files/tree — get project file tree (limited depth)
router.get('/tree', async (req, res) => {
  const projectDir = req.app.get('projectDir')
  const maxDepth = parseInt(req.query.depth) || 3

  try {
    const tree = await buildTree(projectDir, maxDepth, 0)
    res.json({ tree })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/files/read — read a file
router.get('/read', async (req, res) => {
  const projectDir = req.app.get('projectDir')
  const { filePath } = req.query

  try {
    const fullPath = path.resolve(projectDir, filePath)
    // Security: ensure path is within project
    if (!fullPath.startsWith(projectDir)) {
      return res.status(403).json({ error: 'Access denied' })
    }
    if (!fs.existsSync(fullPath)) return res.status(404).json({ error: 'File not found' })

    const content = await fs.readFile(fullPath, 'utf8')
    res.json({ content, filePath })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/files/write — write/create a file
router.post('/write', async (req, res) => {
  const projectDir = req.app.get('projectDir')
  const io = req.app.get('io')
  const { filePath, content } = req.body

  try {
    const fullPath = path.resolve(projectDir, filePath)
    if (!fullPath.startsWith(projectDir)) {
      return res.status(403).json({ error: 'Access denied' })
    }
    await fs.ensureDir(path.dirname(fullPath))
    await fs.writeFile(fullPath, content, 'utf8')
    io.emit('file:written', { filePath })
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

async function buildTree(dirPath, maxDepth, currentDepth) {
  const ignored = ['node_modules', '.git', '.next', 'dist', 'build', '__pycache__', '.DS_Store']
  const name = path.basename(dirPath)

  if (currentDepth > maxDepth) return { name, type: 'directory', children: [] }

  const stat = await fs.stat(dirPath).catch(() => null)
  if (!stat) return null
  if (stat.isFile()) return { name, type: 'file', path: dirPath }

  const entries = await fs.readdir(dirPath).catch(() => [])
  const filtered = entries.filter(e => !ignored.includes(e) && !e.startsWith('.'))

  const children = (await Promise.all(
    filtered.map(e => buildTree(path.join(dirPath, e), maxDepth, currentDepth + 1))
  )).filter(Boolean)

  return { name, type: 'directory', children, path: dirPath }
}

module.exports = router
