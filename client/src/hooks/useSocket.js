import { useEffect, useRef } from 'react'
import { io } from 'socket.io-client'
import { useStore } from '../store'

let socket = null

export function useSocket() {
  const {
    updateTask, addTask, addTasks, removeTask, addNotification,
    addExecutionLog, setExecutionStatus, updateWorkflowState,
    setActiveMissionCount
  } = useStore()

  useEffect(() => {
    if (socket) return

    socket = io(window.location.origin, { transports: ['websocket', 'polling'] })

    socket.on('connect', () => {
      console.log('[socket] connected')
      socket.emit('subscribe:tasks')
    })

    socket.on('disconnect', () => {
      console.log('[socket] disconnected')
    })

    // ── Task events ──────────────────────────────────────────────────────────
    socket.on('task:created', (task) => {
      addTask(task)
    })

    socket.on('tasks:bulk-created', ({ tasks }) => {
      // Only add tasks that aren't already in the store (handleApprove does an immediate
      // optimistic update, so the socket event is a no-op for those tasks).
      const existingIds = new Set(useStore.getState().tasks.map(t => t.id))
      const newTasks = tasks.filter(t => !existingIds.has(t.id))
      if (newTasks.length) addTasks(newTasks)
    })

    socket.on('task:updated', (task) => {
      updateTask(task.id, task)
    })

    socket.on('task:moved', ({ id, column, order }) => {
      updateTask(id, { column, order })
    })

    socket.on('task:deleted', ({ id }) => {
      removeTask(id)
    })

    socket.on('task:log', ({ id, log }) => {
      updateTask(id, { logs: undefined }) // trigger re-fetch if needed
    })

    // ── Execution events ─────────────────────────────────────────────────────
    socket.on('execution:log', (entry) => {
      // handled by executionId-specific listeners
    })

    socket.on('execution:error', ({ executionId, message }) => {
      setExecutionStatus(executionId, 'error')
      addNotification({ type: 'error', message: `Execution failed: ${message}` })
    })

    // ── Context events ───────────────────────────────────────────────────────
    socket.on('context:updated', ({ filename }) => {
      addNotification({ type: 'info', message: `Context updated: ${filename}` })
    })

    // ── File events ──────────────────────────────────────────────────────────
    socket.on('file:written', ({ path }) => {
      // Could show a subtle notification
    })

    // ── Mission events ───────────────────────────────────────────────────────
    const refreshMissionCount = async () => {
      try {
        const res = await fetch('/api/agents/missions')
        const data = await res.json()
        const active = (data.missions || []).filter(m =>
          !['complete', 'failed', 'cancelled'].includes(m.status)
        ).length
        setActiveMissionCount(active)
      } catch {}
    }
    socket.on('mission:created',  refreshMissionCount)
    socket.on('mission:updated',  refreshMissionCount)
    socket.on('mission:complete', refreshMissionCount)
    socket.on('mission:error',    refreshMissionCount)

    socket.on('mission:file_changed', ({ change }) => {
      addNotification({ type: 'success', message: `File changed: ${change?.path}` })
    })
    socket.on('mission:info_needed', ({ id, questions, taskTitle }) => {
      const count = questions?.length || 1
      const title = taskTitle ? `"${taskTitle}"` : 'a task'
      addNotification({
        type: 'warn',
        message: `${title} needs your input (${count} question${count !== 1 ? 's' : ''}) — go to Missions to answer`
      })
    })

    return () => {
      socket?.disconnect()
      socket = null
    }
  }, [])

  function subscribeToExecution(executionId, handlers) {
    if (!socket) return () => {}

    socket.join?.(`execution:${executionId}`)

    const onLog = (entry) => handlers.onLog?.(entry)
    const onStream = ({ chunk }) => handlers.onStream?.(chunk)
    const onStep = (data) => handlers.onStep?.(data)
    const onComplete = (data) => { handlers.onComplete?.(data); setExecutionStatus(executionId, 'complete') }
    const onError = ({ message }) => { handlers.onError?.(message); setExecutionStatus(executionId, 'error') }
    const onStopped = (data) => { handlers.onStopped?.(data); setExecutionStatus(executionId, 'stopped') }
    const onPlan = (data) => handlers.onPlan?.(data)
    const onTaskStream = (data) => handlers.onTaskStream?.(data)

    socket.on(`execution:${executionId}:log`, onLog)
    socket.on(`execution:${executionId}:stream`, onStream)
    socket.on(`execution:${executionId}:step`, onStep)
    socket.on(`execution:${executionId}:complete`, onComplete)
    socket.on(`execution:${executionId}:error`, onError)
    socket.on(`execution:${executionId}:stopped`, onStopped)
    socket.on(`execution:${executionId}:plan`, onPlan)
    socket.on(`execution:${executionId}:task_stream`, onTaskStream)

    return () => {
      socket.off(`execution:${executionId}:log`, onLog)
      socket.off(`execution:${executionId}:stream`, onStream)
      socket.off(`execution:${executionId}:step`, onStep)
      socket.off(`execution:${executionId}:complete`, onComplete)
      socket.off(`execution:${executionId}:error`, onError)
      socket.off(`execution:${executionId}:stopped`, onStopped)
      socket.off(`execution:${executionId}:plan`, onPlan)
      socket.off(`execution:${executionId}:task_stream`, onTaskStream)
    }
  }

  function subscribeToStepStream(streamId, handlers) {
    if (!socket) return () => {}
    const onChunk = ({ chunk }) => handlers.onChunk?.(chunk)
    const onDone  = (result)   => handlers.onDone?.(result)
    const onError = ({ error }) => handlers.onError?.(error)

    socket.on(`step:chunk:${streamId}`, onChunk)
    socket.on(`step:done:${streamId}`,  onDone)
    socket.on(`step:error:${streamId}`, onError)

    return () => {
      socket.off(`step:chunk:${streamId}`, onChunk)
      socket.off(`step:done:${streamId}`,  onDone)
      socket.off(`step:error:${streamId}`, onError)
    }
  }

  function subscribeToInit(handlers) {
    if (!socket) return () => {}

    socket.on('init:progress', handlers.onProgress || (() => {}))
    socket.on('init:complete', handlers.onComplete || (() => {}))
    socket.on('init:error', handlers.onError || (() => {}))

    return () => {
      socket.off('init:progress')
      socket.off('init:complete')
      socket.off('init:error')
    }
  }

  return { socket, subscribeToExecution, subscribeToStepStream, subscribeToInit }
}
