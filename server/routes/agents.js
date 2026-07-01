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
const { ensureProjectContext, regenerateProjectContext } = require('../services/agents/context-guard')
const {
  listMissions, getMission, createMission, updateMission, appendLog, deleteMission
} = require('../services/agents/mission-store')
const fs = require('fs-extra')
const path = require('path')

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Derive a short display title from a free-form description. */
function deriveTitle(description = '') {
  // Use the first sentence or first 60 characters, whichever is shorter
  const firstLine = description.split('\n')[0].trim()
  const firstSentence = firstLine.split(/[.!?]/)[0].trim()
  const base = firstSentence || firstLine
  return base.length > 60 ? base.slice(0, 57).trimEnd() + '…' : base
}

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

async function runPlanning(pqDir, projectDir, io, missionId, task, aiConfig, answeredQuestions = []) {
  // Persist 'planning' status to DB immediately so refresh shows correct state
  await updateMission(pqDir, missionId, { status: 'planning' })
  try {
    emit(io, 'updated', { id: missionId, status: 'planning', message: 'Orchestrator is planning...' })
    await appendLog(pqDir, missionId, { agent: 'Orchestrator', message: answeredQuestions.length > 0 ? `Re-planning with ${answeredQuestions.length} clarification(s)…` : 'Analysing task and codebase...', type: 'info' })

    const plan = await planMission(task, pqDir, projectDir, aiConfig, answeredQuestions)
    const hasMissingInfo = plan.missingInfo && plan.missingInfo.length > 0

    const updated = await updateMission(pqDir, missionId, {
      plan,
      steps: plan.steps,
      // Preserve already-answered questions alongside any new ones
      pendingQuestions: [
        ...answeredQuestions,
        ...(plan.missingInfo || []),
      ],
      status: hasMissingInfo ? 'awaiting_info' : 'awaiting_approval',
    })

    if (hasMissingInfo) {
      const newQCount = plan.missingInfo.length
      const prevQCount = answeredQuestions.length
      const contextNote = prevQCount > 0 ? ` (${prevQCount} already answered)` : ''
      await appendLog(pqDir, missionId, {
        agent: 'Orchestrator',
        message: `${newQCount} question(s) need answering before work can begin${contextNote}`,
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
    // If we had answered questions, stay in awaiting_info so user can retry — don't permanently fail
    const recoveryStatus = answeredQuestions.length > 0 ? 'awaiting_info' : 'failed'
    await updateMission(pqDir, missionId, { status: recoveryStatus })
    await appendLog(pqDir, missionId, {
      agent: 'Orchestrator',
      message: `Planning failed: ${err.message}${recoveryStatus === 'awaiting_info' ? ' — your answers were saved, you can retry' : ''}`,
      type: 'error',
    })
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

    // Check pause request
    const currentState = await getMission(pqDir, missionId)
    if (currentState?.pauseRequested) {
      await updateMission(pqDir, missionId, { status: 'paused', pauseRequested: false })
      await appendLog(pqDir, missionId, { agent: 'Orchestrator', message: 'Execution paused', type: 'warn' })
      emit(io, 'updated', { id: missionId, status: 'paused' })
      return
    }
    // Check skip request
    if (currentState?.skipCurrentStep) {
      await updateMission(pqDir, missionId, { skipCurrentStep: false })
      const skippedSteps = (await getMission(pqDir, missionId)).steps.map(s =>
        s.id === step.id ? { ...s, status: 'skipped' } : s
      )
      await updateMission(pqDir, missionId, { steps: skippedSteps })
      await appendLog(pqDir, missionId, { agent: 'User', message: `Skipped: ${step.subTask}`, type: 'warn' })
      emit(io, 'step_complete', { missionId, stepId: step.id, result: { status: 'skipped', summary: 'Skipped by user' } })
      continue
    }

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
        (chunk) => emit(io, 'step_chunk', { missionId, stepId: step.id, chunk }),
        async (toolEvent) => {
          const icons = { read_file: '📖', write_file: '✏️', list_files: '📂', search_code: '🔍', run_command: '🔧', task_complete: '✅' }
          const icon = icons[toolEvent.name] || '⚙️'
          const label = toolEvent.input?.path || toolEvent.input?.command || toolEvent.input?.pattern || toolEvent.input?.summary || ''
          const entry = await appendLog(pqDir, missionId, {
            agent: step.agentName,
            message: `${icon} ${toolEvent.name}${label ? `: ${label}` : ''}`,
            type: 'tool',
          })
          emit(io, 'updated', { id: missionId, newLogEntry: entry })
          emit(io, 'step_tool', { missionId, stepId: step.id, tool: toolEvent })
        }
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
        s.id === step.id ? {
          ...s,
          status: 'complete',
          result: {
            summary: result.summary,
            modelName: result.modelName,
            deliverable: result.deliverable || null,
            verificationResults: result.verificationResults || [],
          },
          fileChanges: result.appliedChanges,
        } : s
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

      // Surface verification failures as warnings
      if (result.verificationResults?.length > 0) {
        const failed = result.verificationResults.filter(r => !r.passed)
        if (failed.length > 0) {
          for (const r of failed) {
            await appendLog(pqDir, missionId, {
              agent: step.agentName,
              message: `⚠️ Verification failed: ${r.script}\n${r.output.slice(0, 300)}`,
              type: 'warn',
            })
          }
          emit(io, 'updated', { id: missionId, message: `${failed.length} verification check(s) failed` })
        } else {
          await appendLog(pqDir, missionId, {
            agent: step.agentName,
            message: `✅ All verification checks passed (${result.verificationResults.map(r => r.script).join(', ')})`,
            type: 'success',
          })
        }
      }

      if (result.warnings?.length > 0) {
        for (const w of result.warnings) {
          await appendLog(pqDir, missionId, { agent: step.agentName, message: `Warning: ${w}`, type: 'warn' })
        }
      }
    } catch (err) {
      const failedMission = await getMission(pqDir, missionId)
      const steps = (failedMission?.steps || []).map(s =>
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

// POST /api/agents/missions — manually create from task or direct description
router.post('/missions', async (req, res) => {
  const pqDir = req.app.get('pqDir')
  const projectDir = req.app.get('projectDir')
  const io = req.app.get('io')
  const aiConfig = req.app.get('aiConfig')
  const { taskId, approvalMode, taskTitle, taskDescription, stepApproval } = req.body

  try {
    let task
    if (taskId) {
      const tasks = await loadTasks(pqDir)
      task = tasks.find(t => t.id === taskId)
      if (!task) return res.status(404).json({ error: 'Task not found' })
    } else if (taskTitle || taskDescription) {
      // Direct creation from MissionBoardPage — derive title from description if not provided
      const desc = taskDescription || taskTitle
      const derivedTitle = taskTitle || deriveTitle(desc)
      task = { id: null, title: derivedTitle, description: desc }
    } else {
      return res.status(400).json({ error: 'taskId, taskTitle, or taskDescription required' })
    }

    const mission = await startMission(pqDir, projectDir, io, task, aiConfig)
    if (approvalMode) await updateMission(pqDir, mission.id, { approvalMode })
    if (stepApproval !== undefined) await updateMission(pqDir, mission.id, { stepApproval: !!stepApproval })

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
  const { approvalMode, approvedStepIds, stepIds } = req.body  // approvalMode: 'all'|'individual'
  const selectedStepIds = stepIds || approvedStepIds  // support both param names

  try {
    const mission = await getMission(pqDir, req.params.id)
    if (!mission) return res.status(404).json({ error: 'Mission not found' })

    // If individual mode, mark only approved steps as approved
    if (selectedStepIds?.length > 0) {
      const steps = mission.steps.map(s => ({
        ...s,
        approved: selectedStepIds.includes(s.id)
      }))
      await updateMission(pqDir, req.params.id, { steps, approvalMode: 'individual' })
    }

    await appendLog(pqDir, req.params.id, {
      agent: 'User',
      message: selectedStepIds?.length > 0
        ? `Approved ${selectedStepIds.length} step(s) individually`
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
  const { questionId, answer, answers } = req.body  // support single or array format

  try {
    const mission = await getMission(pqDir, req.params.id)
    if (!mission) return res.status(404).json({ error: 'Mission not found' })

    // Build answer map: support { questionId, answer } or { answers: [{id, answer}] }
    const answerMap = {}
    if (answers && Array.isArray(answers)) {
      for (const { id, answer: a } of answers) answerMap[id] = a
    } else if (questionId && answer !== undefined) {
      answerMap[questionId] = answer
    }

    const questions = mission.pendingQuestions.map(q =>
      answerMap[q.id] !== undefined ? { ...q, answer: answerMap[q.id], answeredAt: new Date().toISOString() } : q
    )
    const allAnswered = questions.every(q => q.answer)

    // If all answered AND we will re-plan, set status to 'planning' immediately so the UI
    // shows the right state even if the client refreshes during re-planning.
    const willRePlan = allAnswered && mission.plan && mission.status === 'awaiting_info' && !mission.startedAt
    const willResumeExecution = allAnswered && mission.startedAt
    const newStatus = willRePlan ? 'planning' : allAnswered && !willResumeExecution ? 'awaiting_approval' : 'awaiting_info'

    await updateMission(pqDir, req.params.id, {
      pendingQuestions: questions,
      status: newStatus,
    })
    // Build a readable log message from whichever answer format was used
    const logAnswer = answer != null
      ? String(answer)
      : Object.values(answerMap).join('; ')
    await appendLog(pqDir, req.params.id, {
      agent: 'User',
      message: `Answered: "${logAnswer.slice(0, 80)}${logAnswer.length > 80 ? '…' : ''}"`,
      type: 'info'
    })

    const updated = await getMission(pqDir, req.params.id)
    emit(io, 'updated', updated)

    if (allAnswered && mission.plan) {
      // Re-plan if this was from planning phase, or resume execution if mid-step
      if (['awaiting_info'].includes(mission.status) && !mission.startedAt) {
        const allAnsweredQuestions = questions.filter(q => q.answer)
        await appendLog(pqDir, req.params.id, {
          agent: 'Orchestrator',
          message: `All ${allAnsweredQuestions.length} question(s) answered — re-planning now…`,
          type: 'info',
        })
        setImmediate(() => runPlanning(pqDir, projectDir, io, req.params.id,
          { id: mission.taskId, title: mission.taskTitle, description: mission.taskDescription },
          aiConfig,
          allAnsweredQuestions
        ))
      } else if (mission.startedAt) {
        await appendLog(pqDir, req.params.id, {
          agent: 'Orchestrator',
          message: 'All questions answered — resuming execution…',
          type: 'info',
        })
        setImmediate(() => runExecution(pqDir, projectDir, io, req.params.id, aiConfig))
      }
    }

    res.json({ success: true, allAnswered })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/agents/missions/:id/retry — retry a failed mission
router.post('/missions/:id/retry', async (req, res) => {
  const pqDir = req.app.get('pqDir')
  const projectDir = req.app.get('projectDir')
  const io = req.app.get('io')
  const aiConfig = req.app.get('aiConfig')
  try {
    const mission = await getMission(pqDir, req.params.id)
    if (!mission) return res.status(404).json({ error: 'Mission not found' })
    if (mission.status !== 'failed') return res.status(400).json({ error: 'Only failed missions can be retried' })

    const planningFailed = !mission.steps || mission.steps.length === 0 ||
      mission.steps.every(s => s.status === 'pending')

    if (planningFailed) {
      // Planning never completed — re-run planning from scratch
      const task = { title: mission.taskTitle, description: mission.taskDescription, priority: mission.taskPriority }
      await updateMission(pqDir, mission.id, { status: 'planning', plan: null, steps: [] })
      await appendLog(pqDir, mission.id, { agent: 'Orchestrator', message: 'Retrying planning...', type: 'info' })
      emit(io, 'updated', { id: mission.id, status: 'planning' })
      setImmediate(() => runPlanning(pqDir, projectDir, io, mission.id, task, aiConfig))
    } else {
      // Execution failed — reset failed steps to pending and re-execute
      const resetSteps = mission.steps.map(s =>
        s.status === 'failed' ? { ...s, status: 'pending', result: null, fileChanges: [] } : s
      )
      await updateMission(pqDir, mission.id, { status: 'awaiting_approval', steps: resetSteps, completedAt: null })
      await appendLog(pqDir, mission.id, { agent: 'Orchestrator', message: 'Retrying from failed steps — awaiting approval', type: 'info' })
      emit(io, 'updated', { id: mission.id, status: 'awaiting_approval', steps: resetSteps })
    }

    const updated = await getMission(pqDir, mission.id)
    res.json({ mission: updated })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Pause
router.post('/missions/:id/pause', async (req, res) => {
  const pqDir = req.app.get('pqDir')
  const io = req.app.get('io')
  try {
    const mission = await getMission(pqDir, req.params.id)
    if (!mission) return res.status(404).json({ error: 'Mission not found' })
    if (mission.status !== 'executing') return res.status(400).json({ error: 'Mission is not executing' })
    await updateMission(pqDir, mission.id, { pauseRequested: true })
    await appendLog(pqDir, mission.id, { agent: 'User', message: 'Pause requested — will stop after current step', type: 'warn' })
    emit(io, 'updated', { id: mission.id, pauseRequested: true })
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// Resume
router.post('/missions/:id/resume', async (req, res) => {
  const pqDir = req.app.get('pqDir')
  const projectDir = req.app.get('projectDir')
  const io = req.app.get('io')
  const aiConfig = req.app.get('aiConfig')
  try {
    const mission = await getMission(pqDir, req.params.id)
    if (!mission) return res.status(404).json({ error: 'Mission not found' })
    if (mission.status !== 'paused') return res.status(400).json({ error: 'Mission is not paused' })
    await updateMission(pqDir, mission.id, { status: 'executing', pauseRequested: false })
    await appendLog(pqDir, mission.id, { agent: 'User', message: 'Execution resumed', type: 'info' })
    emit(io, 'updated', { id: mission.id, status: 'executing' })
    setImmediate(() => runExecution(pqDir, projectDir, io, mission.id, aiConfig))
    const updated = await getMission(pqDir, mission.id)
    res.json({ mission: updated })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// Skip step
router.post('/missions/:id/skip-step', async (req, res) => {
  const pqDir = req.app.get('pqDir')
  const io = req.app.get('io')
  try {
    const mission = await getMission(pqDir, req.params.id)
    if (!mission) return res.status(404).json({ error: 'Mission not found' })
    await updateMission(pqDir, mission.id, { skipCurrentStep: true })
    await appendLog(pqDir, mission.id, { agent: 'User', message: 'Skip requested for current step', type: 'warn' })
    emit(io, 'updated', { id: mission.id, skipCurrentStep: true })
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// Rollback
router.post('/missions/:id/rollback', async (req, res) => {
  const pqDir = req.app.get('pqDir')
  const projectDir = req.app.get('projectDir')
  const io = req.app.get('io')
  try {
    const mission = await getMission(pqDir, req.params.id)
    if (!mission) return res.status(404).json({ error: 'Mission not found' })
    if (!['complete','failed','cancelled','paused'].includes(mission.status)) {
      return res.status(400).json({ error: 'Can only rollback completed, failed, paused, or cancelled missions' })
    }
    const allChanges = mission.fileChanges || []
    if (allChanges.length === 0) return res.json({ ok: true, message: 'No file changes to rollback' })

    const { execSync } = require('child_process')
    const rolledBack = []
    const failed = []

    for (const change of allChanges) {
      try {
        if (change.action === 'delete') {
          failed.push(`${change.path} (was deleted — restore from git manually)`)
        } else {
          try {
            execSync(`git checkout HEAD -- "${change.path}"`, { cwd: projectDir, encoding: 'utf8' })
          } catch {
            const abs = require('path').join(projectDir, change.path)
            if (require('fs-extra').existsSync(abs)) require('fs-extra').removeSync(abs)
          }
          rolledBack.push(change.path)
        }
      } catch (e) {
        failed.push(`${change.path}: ${e.message}`)
      }
    }

    await updateMission(pqDir, mission.id, { status: 'cancelled', rolledBack: true })
    await appendLog(pqDir, mission.id, {
      agent: 'User',
      message: `Rolled back ${rolledBack.length} file(s)${failed.length ? `. Skipped: ${failed.join(', ')}` : ''}`,
      type: 'warn',
    })
    emit(io, 'updated', { id: mission.id, status: 'cancelled', rolledBack: true })
    res.json({ ok: true, rolledBack, failed })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// PATCH /api/agents/missions/:id/plan — edit plan summary + steps before execution
router.patch('/missions/:id/plan', async (req, res) => {
  const pqDir = req.app.get('pqDir')
  const io = req.app.get('io')
  const { summary, steps } = req.body
  try {
    const mission = await getMission(pqDir, req.params.id)
    if (!mission) return res.status(404).json({ error: 'Mission not found' })
    if (!['awaiting_approval', 'awaiting_info'].includes(mission.status)) {
      return res.status(400).json({ error: 'Plan can only be edited before execution starts' })
    }
    const updatedPlan = {
      ...(mission.plan || {}),
      ...(summary !== undefined ? { summary } : {}),
      ...(steps ? { steps } : {}),
    }
    // Merge step edits — preserve runtime fields (status, result, fileChanges) from original
    const mergedSteps = steps
      ? steps.map(editedStep => {
          const original = (mission.steps || []).find(s => s.id === editedStep.id) || {}
          return { ...original, ...editedStep, status: original.status || 'pending' }
        })
      : mission.steps
    const updated = await updateMission(pqDir, req.params.id, {
      plan: updatedPlan,
      steps: mergedSteps,
    })
    await appendLog(pqDir, req.params.id, { agent: 'User', message: 'Tech spec edited', type: 'info' })
    emit(io, 'updated', updated)
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Toggle step-by-step approval
router.patch('/missions/:id/step-approval', async (req, res) => {
  const pqDir = req.app.get('pqDir')
  const io = req.app.get('io')
  try {
    const { stepApproval } = req.body
    const mission = await getMission(pqDir, req.params.id)
    if (!mission) return res.status(404).json({ error: 'Mission not found' })
    await updateMission(pqDir, mission.id, { stepApproval: !!stepApproval })
    emit(io, 'updated', { id: mission.id, stepApproval: !!stepApproval })
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// POST /api/agents/missions/:id/cancel — cancel via POST (used by frontend)
router.post('/missions/:id/cancel', async (req, res) => {
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

// GET /api/agents/context — return context metadata (what project, when generated)
router.get('/context', async (req, res) => {
  const pqDir = req.app.get('pqDir')
  const projectDir = req.app.get('projectDir')
  const path = require('path')
  const fs = require('fs-extra')
  try {
    const contextDir = path.join(pqDir, 'context')
    const metaPath = path.join(contextDir, '.meta.json')
    let meta = {}
    try { meta = await fs.readJson(metaPath) } catch {}
    const files = ['PRD.md', 'ARCHITECTURE.md', 'TECH_STACK.md'].map(f => ({
      name: f,
      exists: fs.existsSync(path.join(contextDir, f)),
    }))
    const stale = meta.projectDir && meta.projectDir !== projectDir
    res.json({ projectDir, meta, files, stale })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/agents/context/regenerate — force-regenerate all context files
router.post('/context/regenerate', async (req, res) => {
  const pqDir = req.app.get('pqDir')
  const projectDir = req.app.get('projectDir')
  const io = req.app.get('io')
  const aiConfig = req.app.get('aiConfig')
  try {
    // Emit progress via socket so the UI can show real-time status
    const onProgress = (msg) => {
      io.emit('context:progress', { message: msg })
    }
    onProgress('🔍 Scanning project structure…')
    const result = await regenerateProjectContext(pqDir, projectDir, aiConfig, onProgress)
    io.emit('context:ready', { projectDir, files: result.files })
    res.json({ success: true, files: result.files })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET deliverable content for a step
router.get('/missions/:id/deliverable/:agentId', async (req, res) => {
  const { id, agentId } = req.params
  const pqDir = req.app.get('pqDir')
  const deliverableMap = {
    'mallory':       'scope.md',
    'quartermaster': 'design.md',
    'james-bond':    'implementation-summary.md',
    'moneypenny':    'test-plan.md',
    'tanner':        'test-plan.md',
  }
  const filename = deliverableMap[agentId]
  if (!filename) return res.status(400).json({ error: 'No deliverable for this agent' })
  const filePath = path.join(pqDir, 'missions', id, filename)
  try {
    const content = await fs.readFile(filePath, 'utf8')
    res.json({ content, filename })
  } catch {
    res.status(404).json({ error: 'Deliverable not found' })
  }
})

module.exports = { router, autoPickupTasks }
