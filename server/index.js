const express = require('express')
const http = require('http')
const { Server } = require('socket.io')
const cors = require('cors')
const path = require('path')
const fs = require('fs-extra')
require('dotenv').config({ path: path.join(__dirname, '..', '.env') })

const app = express()
const server = http.createServer(app)
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] }
})

// ── Config ─────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3141
const PROJECT_DIR = process.env.PROJECT_DIR || process.cwd()
const PQ_DIR = path.join(PROJECT_DIR, '.project-q')

// Make io & dirs available to routes
app.set('io', io)
app.set('pqDir', PQ_DIR)
app.set('projectDir', PROJECT_DIR)

// Ensure .project-q structure
;['context', 'tasks', 'workflows'].forEach(d =>
  fs.ensureDirSync(path.join(PQ_DIR, d))
)

// ── Middleware ───────────────────────────────────────────────────────────────
app.use(cors())
app.use(express.json({ limit: '10mb' }))
app.use(express.static(path.join(__dirname, 'public')))

// ── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/init',      require('./routes/init'))
app.use('/api/context',   require('./routes/context'))
app.use('/api/tasks',     require('./routes/tasks'))
app.use('/api/workflows', require('./routes/workflows'))
app.use('/api/ai',        require('./routes/ai'))
app.use('/api/files',     require('./routes/files'))

// SPA fallback
app.get('*', (req, res) => {
  const indexPath = path.join(__dirname, 'public', 'index.html')
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath)
  } else {
    res.json({
      status: 'running',
      message: 'project-q server is running. Build the client with: npm run build --workspace=client',
      ui: `http://localhost:5174 (dev mode)`,
      api: `http://localhost:${PORT}/api`
    })
  }
})

// ── Socket.io ────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[socket] client connected: ${socket.id}`)

  socket.on('subscribe:tasks', () => socket.join('tasks'))
  socket.on('subscribe:workflow', (id) => socket.join(`workflow:${id}`)  )
  socket.on('subscribe:execution', (id) => socket.join(`execution:${id}`))

  socket.on('disconnect', () => {
    console.log(`[socket] client disconnected: ${socket.id}`)
  })
})

// ── Start ─────────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`\n  ╔═══════════════════════════════════════╗`)
  console.log(`  ║   project-q server running             ║`)
  console.log(`  ║   http://localhost:${PORT}              ║`)
  console.log(`  ║   project: ${PROJECT_DIR.slice(-30).padEnd(30)} ║`)
  console.log(`  ╚═══════════════════════════════════════╝\n`)
})

module.exports = { app, io }
