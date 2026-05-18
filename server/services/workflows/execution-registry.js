/**
 * Tracks active workflow executions so they can be stopped mid-run.
 * Simple in-memory registry — lives for the duration of the server process.
 */

const registry = new Map()  // executionId → { stopped: bool, stoppedAt: ISO }

function register(executionId) {
  registry.set(executionId, { stopped: false, stoppedAt: null })
}

function stop(executionId) {
  if (registry.has(executionId)) {
    registry.set(executionId, { stopped: true, stoppedAt: new Date().toISOString() })
    return true
  }
  return false
}

function isStopped(executionId) {
  return registry.get(executionId)?.stopped === true
}

function unregister(executionId) {
  registry.delete(executionId)
}

function list() {
  return [...registry.entries()].map(([id, state]) => ({ id, ...state }))
}

module.exports = { register, stop, isStopped, unregister, list }
