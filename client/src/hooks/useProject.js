import { useEffect } from 'react'
import { useStore } from '../store'

const API = '/api'

export function useProject() {
  const {
    setConfig, setContext, setTasks, setWorkflows, setAIProviders, setCurrentAI, markReady
  } = useStore()

  async function loadProject() {
    try {
      // Load init status
      const initRes = await fetch(`${API}/init/status`)
      const initData = await initRes.json()

      if (initData.initialized) {
        setConfig(initData.config)
      }

      // Load context files
      const contextRes = await fetch(`${API}/context`)
      const contextData = await contextRes.json()
      setContext(contextData.context || {})

      // Load tasks
      const tasksRes = await fetch(`${API}/tasks`)
      const tasksData = await tasksRes.json()
      setTasks(tasksData.tasks || [])

      // Load workflows
      const wfRes = await fetch(`${API}/workflows`)
      const wfData = await wfRes.json()
      setWorkflows(wfData.workflows || [])

      // Load AI providers
      const aiRes = await fetch(`${API}/ai/providers`)
      const aiData = await aiRes.json()
      setAIProviders(aiData.providers || [])

      // Use saved config AI, or fall back to auto-detected best
      if (initData.config?.ai) {
        setCurrentAI(initData.config.ai)
      } else {
        // Detect best available CLI and use that
        try {
          const aiRes2 = await fetch(`${API}/ai/detect`)
          const aiDetect = await aiRes2.json()
          if (aiDetect.best) setCurrentAI(aiDetect.best)
        } catch {}
      }
    } catch (err) {
      console.error('Failed to load project:', err)
    } finally {
      // Always mark ready so the UI exits the loading state,
      // even when the project has no config.json yet (first run)
      markReady()
    }
  }

  async function saveAIConfig(config, apiKey) {
    await fetch(`${API}/ai/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...config, apiKey })
    })
    setCurrentAI(config)
  }

  async function moveTask(taskId, column, order) {
    await fetch(`${API}/tasks/${taskId}/move`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ column, order })
    })
  }

  async function deleteTask(taskId) {
    await fetch(`${API}/tasks/${taskId}`, { method: 'DELETE' })
  }

  async function updateTask(taskId, updates) {
    await fetch(`${API}/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates)
    })
  }

  async function createTask(task) {
    const res = await fetch(`${API}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(task)
    })
    return res.json()
  }

  async function runWorkflowStep(workflowId, step, message, history) {
    const res = await fetch(`${API}/workflows/${workflowId}/step`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ step, message, history })
    })
    return res.json()
  }

  async function runWorkflow(workflowId, input) {
    const res = await fetch(`${API}/workflows/${workflowId}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input)
    })
    return res.json()
  }

  async function createBulkTasks(tasks) {
    const res = await fetch(`${API}/tasks/bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tasks })
    })
    return res.json()
  }

  async function deleteWorkflowTasks(workflowId) {
    await fetch(`${API}/tasks/workflow/${workflowId}`, { method: 'DELETE' })
  }

  async function createCustomWorkflow(workflow) {
    const res = await fetch(`${API}/workflows/custom`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(workflow)
    })
    return res.json()
  }

  async function updateContextFile(filename, content) {
    await fetch(`${API}/context/${filename}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content })
    })
  }

  async function interviewStep(message, history, aiConfig) {
    const res = await fetch(`${API}/init/interview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, history, aiConfig })
    })
    return res.json()
  }

  async function generateContext(answers, aiConfig) {
    const res = await fetch(`${API}/init/generate-context`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers, aiConfig })
    })
    return res.json()
  }

  async function testAI(provider, model, apiKey) {
    const res = await fetch(`${API}/ai/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: provider || 'auto', model, apiKey })
    })
    return res.json()
  }

  async function detectProviders() {
    const res = await fetch(`${API}/ai/detect`)
    return res.json()
  }

  return {
    loadProject,
    detectProviders,
    saveAIConfig,
    moveTask,
    deleteTask,
    updateTask,
    createTask,
    runWorkflowStep,
    runWorkflow,
    createBulkTasks,
    deleteWorkflowTasks,
    createCustomWorkflow,
    updateContextFile,
    interviewStep,
    generateContext,
    testAI
  }
}
