import { create } from 'zustand'

export const useStore = create((set, get) => ({
  // ── Project ──────────────────────────────────────────────────────────────
  project: null,
  config: null,
  context: {},
  initialized: false,

  setProject: (project) => set({ project }),
  setConfig: (config) => set({ config }),
  setContext: (context) => set({ context }),
  markReady: () => set({ initialized: true }),
  updateContextFile: (filename, content) =>
    set(s => ({ context: { ...s.context, [filename]: content } })),

  // ── Tasks ─────────────────────────────────────────────────────────────────
  tasks: [],
  selectedTask: null,

  setTasks: (tasks) => set({ tasks }),
  addTask: (task) => set(s => ({ tasks: [...s.tasks, task] })),
  addTasks: (newTasks) => set(s => ({ tasks: [...s.tasks, ...newTasks] })),
  updateTask: (id, updates) =>
    set(s => ({
      tasks: s.tasks.map(t => t.id === id ? { ...t, ...updates } : t),
      selectedTask: s.selectedTask?.id === id ? { ...s.selectedTask, ...updates } : s.selectedTask
    })),
  removeTask: (id) =>
    set(s => ({
      tasks: s.tasks.filter(t => t.id !== id),
      selectedTask: s.selectedTask?.id === id ? null : s.selectedTask
    })),
  setSelectedTask: (task) => set({ selectedTask: task }),

  getBoardTasks: () => {
    const { tasks } = get()
    const columns = ['backlog', 'todo', 'in_progress', 'review', 'done']
    return columns.reduce((acc, col) => {
      acc[col] = tasks.filter(t => t.column === col).sort((a, b) => (a.order || 0) - (b.order || 0))
      return acc
    }, {})
  },

  // ── Workflows ─────────────────────────────────────────────────────────────
  workflows: [],
  activeWorkflow: null,
  workflowState: {},     // { [workflowId]: { step, history, ... } }

  setWorkflows: (workflows) => set({ workflows }),
  setActiveWorkflow: (workflow) => set({ activeWorkflow: workflow }),
  setWorkflowState: (id, state) =>
    set(s => ({ workflowState: { ...s.workflowState, [id]: state } })),
  updateWorkflowState: (id, updates) =>
    set(s => ({
      workflowState: {
        ...s.workflowState,
        [id]: { ...(s.workflowState[id] || {}), ...updates }
      }
    })),

  // ── AI ────────────────────────────────────────────────────────────────────
  aiProviders: [],
  currentAI: { provider: 'claude', model: 'claude-opus-4-6' },

  setAIProviders: (providers) => set({ aiProviders: providers }),
  setCurrentAI: (ai) => set({ currentAI: ai }),

  // ── Execution ─────────────────────────────────────────────────────────────
  executions: {},   // { [executionId]: { logs, status, ... } }

  addExecutionLog: (executionId, log) =>
    set(s => ({
      executions: {
        ...s.executions,
        [executionId]: {
          ...(s.executions[executionId] || { logs: [], status: 'running' }),
          logs: [...(s.executions[executionId]?.logs || []), log]
        }
      }
    })),
  setExecutionStatus: (executionId, status) =>
    set(s => ({
      executions: {
        ...s.executions,
        [executionId]: { ...(s.executions[executionId] || { logs: [] }), status }
      }
    })),

  // ── Missions ──────────────────────────────────────────────────────────────
  activeMissionCount: 0,
  setActiveMissionCount: (n) => set({ activeMissionCount: n }),

  // ── UI ─────────────────────────────────────────────────────────────────────
  sidebarOpen: true,
  activeTab: 'dashboard',
  notifications: [],

  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setActiveTab: (tab) => set({ activeTab: tab }),
  addNotification: (notification) =>
    set(s => ({
      notifications: [
        ...s.notifications.slice(-9),
        { id: Date.now(), ...notification, timestamp: new Date().toISOString() }
      ]
    })),
  removeNotification: (id) =>
    set(s => ({ notifications: s.notifications.filter(n => n.id !== id) })),
}))
