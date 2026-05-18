/**
 * Mission Store — persists missions to .project-q/missions/
 *
 * Mission schema:
 * {
 *   id, taskId, taskTitle, taskDescription,
 *   status: 'planning'|'awaiting_info'|'awaiting_approval'|'executing'|'complete'|'failed'|'cancelled',
 *   approvalMode: 'all'|'individual',
 *   plan: { summary, agents, steps[], missingInfo[] },
 *   steps: [{ id, agent, agentId, subTask, rationale, evidence, filesAffected,
 *              confidence, assumptions, status, result, fileChanges[] }],
 *   pendingQuestions: [{ id, question, context, answer, answeredAt }],
 *   log: [{ timestamp, agent, message, type }],
 *   fileChanges: [{ path, action, rationale, appliedAt }],
 *   createdAt, startedAt, completedAt, updatedAt
 * }
 */

const fs = require('fs-extra')
const path = require('path')
const { v4: uuidv4 } = require('uuid')

function missionsDir(pqDir) {
  return path.join(pqDir, 'missions')
}

function missionPath(pqDir, id) {
  return path.join(missionsDir(pqDir), `${id}.json`)
}

async function ensureDir(pqDir) {
  await fs.ensureDir(missionsDir(pqDir))
}

async function listMissions(pqDir) {
  await ensureDir(pqDir)
  const files = await fs.readdir(missionsDir(pqDir)).catch(() => [])
  const missions = []
  for (const f of files) {
    if (!f.endsWith('.json')) continue
    try {
      const m = await fs.readJson(path.join(missionsDir(pqDir), f))
      missions.push(m)
    } catch {}
  }
  return missions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
}

async function getMission(pqDir, id) {
  await ensureDir(pqDir)
  const p = missionPath(pqDir, id)
  if (!fs.existsSync(p)) return null
  return fs.readJson(p)
}

async function createMission(pqDir, { taskId, taskTitle, taskDescription, approvalMode = 'all' }) {
  await ensureDir(pqDir)
  const mission = {
    id: uuidv4(),
    taskId,
    taskTitle,
    taskDescription: taskDescription || '',
    status: 'planning',
    approvalMode,
    plan: null,
    steps: [],
    pendingQuestions: [],
    log: [],
    fileChanges: [],
    createdAt: new Date().toISOString(),
    startedAt: null,
    completedAt: null,
    updatedAt: new Date().toISOString(),
  }
  await fs.writeJson(missionPath(pqDir, mission.id), mission, { spaces: 2 })
  return mission
}

async function updateMission(pqDir, id, updates) {
  const mission = await getMission(pqDir, id)
  if (!mission) throw new Error(`Mission ${id} not found`)
  const updated = { ...mission, ...updates, updatedAt: new Date().toISOString() }
  await fs.writeJson(missionPath(pqDir, id), updated, { spaces: 2 })
  return updated
}

async function appendLog(pqDir, id, { agent, message, type = 'info' }) {
  const mission = await getMission(pqDir, id)
  if (!mission) return
  const entry = { id: uuidv4(), timestamp: new Date().toISOString(), agent, message, type }
  mission.log = [...(mission.log || []), entry]
  mission.updatedAt = new Date().toISOString()
  await fs.writeJson(missionPath(pqDir, id), mission, { spaces: 2 })
  return entry
}

async function deleteMission(pqDir, id) {
  const p = missionPath(pqDir, id)
  if (fs.existsSync(p)) await fs.remove(p)
}

module.exports = {
  listMissions, getMission, createMission, updateMission, appendLog, deleteMission
}
