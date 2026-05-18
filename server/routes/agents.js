/**
 * Agent Orchestration Routes
 *
 * POST   /api/agents/missions                    create mission from task
 * GET    /api/agents/missions                    list missions
 * GET    /api/agents/missions/:id               get mission detail
 * POST   /api/agents/missions/:id/approve        approve plan (full or steps)
 * POST   /api/agents/missions/:id/answer         answer pending question
 * DELETE /api/agents/missions/:id               cancel mission
 *
 * Socket events emitted:
 *   mission:created, mission:updated, mission:plan_ready,
 *   mission:info_needed, mission:step_start, mission:step_chunk,
 *   mission:step_complete, mission:file_changed, mission:complete, mission:error
 */

const express = require('express')
const router = express.Router()
const { planMission } = require('../services/agents/orchestrator')
const { executeStep } = require('../services/agents/executor')
const { ensureProjectContext } = require('../services/agents/context-guard')
const {
  listMissions, getMission, createMission, updateMission, appendLog, deleteMission
} = require('../services/agents/mission-store')
const fs = require('fs-extra')
const path = require('path')

// ── Helpers ───────────────────────────────────────────────────────────────────

function emit(io, event, data) {
  io.emit(`mission:${event}`, data)
}

async function loadTasks(pqDir) {
  const p = path.join(pqDir, 'tasks', 'tasks.json')
  if (!fs.existsSync(p)) return []
  return fs.readJson(p)
}

async function updateTaskStatus(pqDir, io, taskId, column) {
  const p = path.join(pqDir, 'tasks', 'tasks.json')
  if (!fs.existsSync(p)) return
  const tasks = await fs.readJson(p)
  const idx = tasks.findIndex(t => t.id === taskId)
  if (idx === -1) return
  tasks[idx] = { ...tasks[idx], column, updatedAt: new Date().toISOString() }
  await fs.writeJson(p, tasks, { spaces: 2 })
  io.to('tasks').emit('task:moved', { id: taskId, column })
}

// ── Auto-pickup: scan todo tasks and create missions ─────────────────────────

async function autoPickupTasks(pqDir, projectDir, io, aiConfig) {
  try {
    const tasks = await loadTasks(pqDir)
    const todoTasks = tasks.filter(t => t.column === 'todo' && !t.missionId)
    const missions = await listMissions(pqDir)
    const activeMissionTaskIds = new Set(
      missions.filter(m => !['complete', 'failed', 'cancelled'].includes(m.status))
               .map(m => m.taskId)
    )

    for (const task of todoTasks) {
      if (activeMissionTaskIds.has(task.id)) continue
      await startMission(pqDir, projectDir, io, task, aiConfig)
    }
  } catch (err) {
    console.error('[orchestrator] auto-pickup error:', err.message)
  }
}

async function startMission(pqDir, projectDir, io, task, aiConfig) {
  // Create mission record
  const mission = await createMission(pqDir, {
    taskId: task.id,
    taskTitle: task.title,
    taskDescription: task.description,
    approvalMode: 'all',
  })

  // Tag task with missionId
  const tasks = await loadTasks(pqDir)
  const idx = tasks.findIndex(t => t.id === task.id)
  if (idx !== -1) {
    tasks[idx].missionId = mission.id
    await fs.writeJson(path.join(pqDir, 'tasks', 'tasks.json'), tasks, { spaces: 2 })
  }

  emit(io, 'created', mission)
  await appendLog(pqDir, mission.id, { agent: 'Orchestrator', message: `Mission started for: ${task.title}`, type: 'info' })

  // Ensure project context exists before planning (auto-generate if missing)
  const contextResult = await ensureProjectContext(pqDir, projectDir, aiConfig, async (msg) => {
    await appendLog(pqDir, mission.id, { agent: 'Orchestrator', message: msg, type: 'info' })
    emit(io, 'updated', { id: mission.id, message: msg })
  }).catch(err => {
    console.error('[startMission] context guard error:', err.message)
    return { generated: false }
  })

  if (contextResult.generated) {
    await appendLog(pqDir, mission.id, {
      agent: 'Orchestrator',
      message: `Project context generated (${(contextResult.files || []).join(', ')}) — proceeding to planning`,
      type: 'success',
    })
  }

  // Plan in background
  setImmediate(() => runPlanning(pqDir, projectDir, io, mission.id, task, aiConfig))

  return mission
}

async function runPlanning(pqDir, projectDir, io, missionId, task, aiConfig) {
  try {
    emit(io, 'updated', { id: missionId, status: 'planning', message: 'Orchestrator is planning...' })
    await appendLog(pqDir, missionId, { agent: 'Orchestrator', message: 'Analysing task and codebase...', type: 'info' })

    const plan = await planMission(task, pqDir, projectDir, aiConfig)
    const hasMissingInfo = plan.missingInfo && plan.missingInfo.length > 0

    const updated = await updateMission(pqDir, missionId, {
      plan,
      steps: plan.steps,
      pendingQuestions: plan.missingInfo || [],
      status: hasMissingInfo ? 'awaiting_info' : 'awaiting_approval',
    })

    if (hasMissingInfo) {
      await appendLog(pqDir, missionId, {
        agent: 'Orchestrator',
        message: `${plan.missingInfo.length} question(s) need answering before work can begin`,
        type: 'warn'
      })
      emit(io, 'info_needed', { id: missionId, questions: plan.missingInfo, taskTitle: task.title })
    } else {
      await appendLog(pqDir, missionId, {
        agent: 'Orchestrator',
        message: `Plan ready — ${plan.steps.length} step(s). Awaiting approval.`,
        type: 'success'
      })
    }

    emit(io, 'plan_ready', updated)
  } catch (err) {
    await updateMission(pqDir, missionId, { status: 'failed' })
    await appendLog(pqDir, missionId, { agent: 'Orchestrator', message: `Planning failed: ${err.message}`, type: 'error' })
    emit(io, 'error', { id: missionId, error: err.message })
  }
}

async function runExecution(pqDir, projectDir, io, missionId, aiConfig) {
  const mission = await getMission(pqDir, missionId)
  if (!mission) return

  await updateMission(pqDir, missionId, { status: 'executing', startedAt: new Date().toISOString() })
  emit(io, 'updated', { id: missionId, status: 'executing' })
  await appendLog(pqDir, missionId, { agent: 'Orchestrator', message: 'Execution started', type: 'info' })

  const allFileChanges = []
  let failed = false

  for (const step of mission.steps) {
    if (step.status === 'complete') continue

    try {
      // Mark step in_progress
      const steps = mission.steps.map(s => s.id === step.id ? { ...s, status: 'in_progress' } : s)
      await updateMission(pqDir, missionId, { steps })
      emit(io, 'step_start', { missionId, step: { ...step, status: 'in_progress' } })
      await appendLog(pqDir, missionId, { agent: step.agentName, message: `Starting: ${step.subTask}`, type: 'info' })

      // Fetch fresh mission (may have been updated with answers)
      const freshMission = await getMission(pqDir, missionId)

      // Execute
      const result = await executeStep(
        step,
        freshMission,
        pqDir,
        projectDir,
        aiConfig,
        (chunk) => emit(io, 'step_chunk', { missionId, stepId: step.id, chunk })
      )

      if (result.status === 'needs_info') {
        // Agent needs more info — pause
        const newQuestions = result.needsInfo.map(q => ({ ...q, id: `q-${Date.now()}`, answer: null, answeredAt: null }))
        const updatedMission = await updateMission(pqDir, missionId, {
          status: 'awaiting_info',
          pendingQuestions: [...(freshMission.pendingQuestions || []), ...newQuestions],
        })
        emit(io, 'info_needed', { id: missionId, questions: newQuestions, taskTitle: mission.taskTitle })
        await appendLog(pqDir, missionId, { agent: step.agentName, message: 'Paused — needs more information from user', type: 'warn' })
        return // pause execution
      }

      // Mark step complete
      const updatedSteps = (await getMission(pqDir, missionId)).steps.map(s =>
        s.id === step.id ? { ...s, status: 'complete', result: result.summary, fileChanges: result.appliedChanges } : s
      )
      allFileChanges.push(...(result.appliedChanges || []))

      await updateMission(pqDir, missionId, {
        steps: updatedSteps,
        fileChanges: [...((await getMission(pqDir, missionId)).fileChanges || []), ...(result.appliedChanges || [])],
      })

      // Emit each file change
      for (const fc of result.appliedChanges || []) {
        emit(io, 'file_changed', { missionId, change: fc })
      }

      emit(io, 'step_complete', { missionId, stepId: step.id, result })
      await appendLog(pqDir, missionId, {
        agent: step.agentName,
        message: result.summary || 'Step complete',
        type: 'success'
      })

      if (result.warnings?.length > 0) {
        for (const w of result.warnings) {
          await appendLog(pqDir, missionId, { agent: step.agentName, message: `Warning: ${w}`, type: 'warn' })
        }
      }
    } catch (err) {
      const steps = (await getMission(pqDir, missionId)).steps.map(s =>
        s.id === step.id ? { ...s, status: 'failed' } : s
      )
      await updateMission(pqDir, missionId, { steps })
      await appendLog(pqDir, missionId, { agent: step.agentName, message: `Failed: ${err.message}`, type: 'error' })
      emit(io, 'error', { missionId, stepId: step.id, error: err.message })
      failed = true
      break
    }
  }

  const finalStatus = failed ? 'failed' : 'complete'
  const updated = await updateMission(pqDir, missionId, {
    status: finalStatus,
    completedAt: new Date().toISOString(),
  })

  // Move Kanban task to done/review on success
  if (!failed && mission.taskId) {
    await updateTaskStatus(pqDir, io, mission.taskId, 'review')
  }

  await appendLog(pqDir, missionId, {
    agent: 'Orchestrator',
    message: failed ? 'Mission failed' : `Mission complete — ${allFileChanges.length} file(s) changed`,
    type: failed ? 'error' : 'success'
  })
  emit(io, 'complete', updated)
}

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /api/agents/missions
router.get('/missions', async (req, res) => {
  const pqDir = req.app.get('pqDir')
  try {
    const missions = await listMissions(pqDir)
    res.json({ missions })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/agents/missions/:id
router.get('/missions/:id', async (req, res) => {
  const pqDir = req.app.get('pqDir')
  try {
    const mission = await getMission(pqDir, req.params.id)
    if (!mission) return res.status(404).json({ error: 'Mission not found' })
    res.json({ mission })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/agents/missions — manually create from task
router.post('/missions', async (req, res) => {
  const pqDir = req.app.get('pqDir')
  const projectDir = req.app.get('projectDir')
  const io = req.app.get('io')
  const aiConfig = req.app.get('aiConfig')
  const { taskId, approvalMode } = req.body

  try {
    const tasks = await loadTasks(pqDir)
    const task = tasks.find(t => t.id === taskId)
    if (!task) return res.status(404).json({ error: 'Task not found' })

    const mission = await startMission(pqDir, projectDir, io, task, aiConfig)
    if (approvalMode) await updateMission(pqDir, mission.id, { approvalMode })

    res.status(201).json({ mission })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/agents/missions/:id/approve
router.post('/missions/:id/approve', async (req, res) => {
  const pqDir = req.app.get('pqDir')
  const projectDir = req.app.get('projectDir')
  const io = req.app.get('io')
  const aiConfig = req.app.get('aiConfig')
  const { approvalMode, approvedStepIds } = req.body  // approvalMode: 'all'|'individual'

  try {
    const mission = await getMission(pqDir, req.params.id)
    if (!mission) return res.status(404).json({ error: 'Mission not found' })

    // If individual mode, mark only approved steps as approved
    if (approvalMode === 'individual' && approvedStepIds?.length > 0) {
      const steps = mission.steps.map(s => ({
        ...s,
        approved: approvedStepIds.includes(s.id)
      }))
      await updateMission(pqDir, req.params.id, { steps, approvalMode: 'individual' })
    }

    await appendLog(pqDir, req.params.id, {
      agent: 'User',
      message: approvalMode === 'individual'
        ? `Approved ${approvedStepIds?.length || 0} step(s) individually`
        : 'Full plan approved',
      type: 'success'
    })

    res.json({ success: true })

    // Execute in background
    setImmediate(() => runExecution(pqDir, projectDir, io, req.params.id, aiConfig))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/agents/missions/:id/answer — answer a pending question
router.post('/missions/:id/answer', async (req, res) => {
  const pqDir = req.app.get('pqDir')
  const projectDir = req.app.get('projectDir')
  const io = req.app.get('io')
  const aiConfig = req.app.get('aiConfig')
  const { questionId, answer } = req.body

  try {
    const mission = await getMission(pqDir, req.params.id)
    if (!mission) return res.status(404).json({ error: 'Mission not found' })

    const questions = mission.pendingQuestions.map(q =>
      q.id === questionId ? { ...q, answer, answeredAt: new Date().toISOString() } : q
    )
    const allAnswered = questions.every(q => q.answer)

    await updateMission(pqDir, req.params.id, {
      pendingQuestions: questions,
      status: allAnswered ? 'awaiting_approval' : 'awaiting_info',
    })
    await appendLog(pqDir, req.params.id, {
      agent: 'User',
      message: `Answered: "${answer.slice(0, 80)}${answer.length > 80 ? '…' : ''}"`,
      type: 'info'
    })

    const updated = await getMission(pqDir, req.params.id)
    emit(io, 'updated', updated)

    if (allAnswered && mission.plan) {
      // Re-plan if this was from planning phase, or resume execution if mid-step
      if (['awaiting_info'].includes(mission.status) && !mission.startedAt) {
        setImmediate(() => runPlanning(pqDir, projectDir, io, req.params.id,
          { id: mission.taskId, title: mission.taskTitle, description: mission.taskDescription },
          aiConfig
        ))
      } else if (mission.startedAt) {
        setImmediate(() => runExecution(pqDir, projectDir, io, req.params.id, aiConfig))
      }
    }

    res.json({ success: true, allAnswered })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// DELETE /api/agents/missions/:id — cancel
router.delete('/missions/:id', async (req, res) => {
  const pqDir = req.app.get('pqDir')
  const io = req.app.get('io')
  try {
    const mission = await getMission(pqDir, req.params.id)
    if (!mission) return res.status(404).json({ error: 'Mission not found' })
    await updateMission(pqDir, req.params.id, { status: 'cancelled' })
    await appendLog(pqDir, req.params.id, { agent: 'User', message: 'Mission cancelled', type: 'warn' })
    emit(io, 'updated', { id: req.params.id, status: 'cancelled' })
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/agents/pickup — manually trigger auto-pickup
router.post('/pickup', async (req, res) => {
  const pqDir = req.app.get('pqDir')
  const projectDir = req.app.get('projectDir')
  const io = req.app.get('io')
  const aiConfig = req.app.get('aiConfig')
  try {
    await autoPickupTasks(pqDir, projectDir, io, aiConfig)
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = { router, autoPickupTasks }
