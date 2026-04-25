const express = require('express')
const router = express.Router()
const fs = require('fs-extra')
const path = require('path')
const { v4: uuidv4 } = require('uuid')

const KANBAN_COLUMNS = ['backlog', 'todo', 'in_progress', 'review', 'done']

function getTasksPath(pqDir) {
  return path.join(pqDir, 'tasks', 'tasks.json')
}

async function loadTasks(pqDir) {
  const tasksPath = getTasksPath(pqDir)
  if (!fs.existsSync(tasksPath)) return []
  return fs.readJson(tasksPath)
}

async function saveTasks(pqDir, tasks) {
  const tasksPath = getTasksPath(pqDir)
  await fs.writeJson(tasksPath, tasks, { spaces: 2 })
}

// GET /api/tasks — get all tasks
router.get('/', async (req, res) => {
  const pqDir = req.app.get('pqDir')
  try {
    const tasks = await loadTasks(pqDir)
    const { workflowId, column } = req.query
    let filtered = tasks
    if (workflowId) filtered = filtered.filter(t => t.workflowId === workflowId)
    if (column) filtered = filtered.filter(t => t.column === column)
    res.json({ tasks: filtered })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/tasks/board — get tasks organized by column
router.get('/board', async (req, res) => {
  const pqDir = req.app.get('pqDir')
  try {
    const tasks = await loadTasks(pqDir)
    const { workflowId } = req.query
    const filtered = workflowId ? tasks.filter(t => t.workflowId === workflowId) : tasks

    const board = KANBAN_COLUMNS.reduce((acc, col) => {
      acc[col] = filtered
        .filter(t => t.column === col)
        .sort((a, b) => (a.order || 0) - (b.order || 0))
      return acc
    }, {})

    res.json({ board, columns: KANBAN_COLUMNS })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/tasks/:id — get single task
router.get('/:id', async (req, res) => {
  const pqDir = req.app.get('pqDir')
  try {
    const tasks = await loadTasks(pqDir)
    const task = tasks.find(t => t.id === req.params.id)
    if (!task) return res.status(404).json({ error: 'Task not found' })
    res.json({ task })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/tasks — create task
router.post('/', async (req, res) => {
  const pqDir = req.app.get('pqDir')
  const io = req.app.get('io')
  try {
    const tasks = await loadTasks(pqDir)
    const task = {
      id: uuidv4(),
      title: req.body.title || 'Untitled Task',
      description: req.body.description || '',
      column: req.body.column || 'backlog',
      priority: req.body.priority || 'medium',
      workflowId: req.body.workflowId || null,
      executionOrder: req.body.executionOrder || null,
      executionType: req.body.executionType || 'sequential', // sequential | parallel
      dependencies: req.body.dependencies || [],
      assignedTo: req.body.assignedTo || 'claude', // claude | openai | gemini | ollama
      tags: req.body.tags || [],
      techSpec: req.body.techSpec || null,
      logs: [],
      order: tasks.length,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
    tasks.push(task)
    await saveTasks(pqDir, tasks)
    io.to('tasks').emit('task:created', task)
    res.status(201).json({ task })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/tasks/bulk — create multiple tasks
router.post('/bulk', async (req, res) => {
  const pqDir = req.app.get('pqDir')
  const io = req.app.get('io')
  try {
    const tasks = await loadTasks(pqDir)
    const newTasks = req.body.tasks.map((t, i) => ({
      id: uuidv4(),
      title: t.title || 'Untitled Task',
      description: t.description || '',
      column: t.column || 'backlog',
      priority: t.priority || 'medium',
      workflowId: t.workflowId || null,
      executionOrder: t.executionOrder ?? i,
      executionType: t.executionType || 'sequential',
      dependencies: t.dependencies || [],
      assignedTo: t.assignedTo || 'claude',
      tags: t.tags || [],
      techSpec: t.techSpec || null,
      logs: [],
      order: tasks.length + i,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }))
    tasks.push(...newTasks)
    await saveTasks(pqDir, tasks)
    io.to('tasks').emit('tasks:bulk-created', { tasks: newTasks })
    res.status(201).json({ tasks: newTasks })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// PATCH /api/tasks/:id — update task
router.patch('/:id', async (req, res) => {
  const pqDir = req.app.get('pqDir')
  const io = req.app.get('io')
  try {
    const tasks = await loadTasks(pqDir)
    const idx = tasks.findIndex(t => t.id === req.params.id)
    if (idx === -1) return res.status(404).json({ error: 'Task not found' })

    const updated = { ...tasks[idx], ...req.body, updatedAt: new Date().toISOString() }
    tasks[idx] = updated
    await saveTasks(pqDir, tasks)
    io.to('tasks').emit('task:updated', updated)
    res.json({ task: updated })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// PATCH /api/tasks/:id/move — move task to column
router.patch('/:id/move', async (req, res) => {
  const pqDir = req.app.get('pqDir')
  const io = req.app.get('io')
  const { column, order } = req.body

  try {
    const tasks = await loadTasks(pqDir)
    const idx = tasks.findIndex(t => t.id === req.params.id)
    if (idx === -1) return res.status(404).json({ error: 'Task not found' })

    tasks[idx] = { ...tasks[idx], column, order: order ?? tasks[idx].order, updatedAt: new Date().toISOString() }
    await saveTasks(pqDir, tasks)
    io.to('tasks').emit('task:moved', { id: req.params.id, column, order })
    res.json({ task: tasks[idx] })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/tasks/:id/log — append execution log
router.post('/:id/log', async (req, res) => {
  const pqDir = req.app.get('pqDir')
  const io = req.app.get('io')
  const { message, type } = req.body

  try {
    const tasks = await loadTasks(pqDir)
    const idx = tasks.findIndex(t => t.id === req.params.id)
    if (idx === -1) return res.status(404).json({ error: 'Task not found' })

    const logEntry = { timestamp: new Date().toISOString(), message, type: type || 'info' }
    tasks[idx].logs = [...(tasks[idx].logs || []), logEntry]
    tasks[idx].updatedAt = new Date().toISOString()
    await saveTasks(pqDir, tasks)
    io.to('tasks').emit('task:log', { id: req.params.id, log: logEntry })
    res.json({ log: logEntry })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// DELETE /api/tasks/:id
router.delete('/:id', async (req, res) => {
  const pqDir = req.app.get('pqDir')
  const io = req.app.get('io')
  try {
    let tasks = await loadTasks(pqDir)
    tasks = tasks.filter(t => t.id !== req.params.id)
    await saveTasks(pqDir, tasks)
    io.to('tasks').emit('task:deleted', { id: req.params.id })
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// DELETE /api/tasks/workflow/:workflowId — delete all tasks for a workflow
router.delete('/workflow/:workflowId', async (req, res) => {
  const pqDir = req.app.get('pqDir')
  const io = req.app.get('io')
  try {
    let tasks = await loadTasks(pqDir)
    tasks = tasks.filter(t => t.workflowId !== req.params.workflowId)
    await saveTasks(pqDir, tasks)
    io.to('tasks').emit('tasks:workflow-cleared', { workflowId: req.params.workflowId })
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
