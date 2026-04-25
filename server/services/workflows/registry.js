/**
 * Built-in workflow registry
 * Inspired by the BMAD Method (bmad-code-org/BMAD-METHOD) — enhanced for project-q.
 *
 * Workflows:
 *   dev-now           — Quick implement for small/medium changes (James goes direct)
 *   feature-dev       — Full feature: requirements → spec → tasks → approval → execute
 *   greenfield        — New project: discovery → PRD → architecture → stories → sprint
 *   brownfield-feature — Feature on existing codebase: careful integration-aware flow
 *   bug-fix           — Investigation-first bug resolution with Quinn + James
 */

// ── dev-now ────────────────────────────────────────────────────────────────────

const DEV_NOW = {
  id: 'dev-now',
  name: 'dev-now',
  description: 'Quick implementation — understand, clarify, build. Best for small–medium changes where requirements are clear.',
  icon: 'Zap',
  agent: 'James Bond (Developer)',
  steps: [
    {
      id: 'understand',
      name: 'Understand',
      description: 'Analyze the request and estimate scope',
      agent: 'Orchestrator',
      type: 'analysis'
    },
    {
      id: 'clarify',
      name: 'Clarify',
      description: 'Mary asks targeted questions to resolve ambiguities',
      agent: 'Moneypenny (Analyst)',
      type: 'conversation'
    },
    {
      id: 'implement',
      name: 'Implement',
      description: 'James writes the code and applies all file changes',
      agent: 'James Bond (Developer)',
      type: 'execution'
    }
  ],
  config: {
    maxClarifyingQuestions: 3,
    requireApproval: false,
    autoImplement: true
  }
}

// ── feature-dev ────────────────────────────────────────────────────────────────

const FEATURE_DEV = {
  id: 'feature-dev',
  name: 'feature-dev',
  description: 'Full feature development — deep requirements, tech spec, Kanban tasks, staged execution with approval.',
  icon: 'GitBranch',
  agent: 'Full team (MI6)',
  steps: [
    {
      id: 'requirements',
      name: 'Requirements',
      description: 'Mary conducts thorough requirements gathering',
      agent: 'Moneypenny (Analyst)',
      type: 'conversation'
    },
    {
      id: 'spec',
      name: 'Tech Spec',
      description: 'Winston generates a detailed technical specification',
      agent: 'Quartermaster (Architect)',
      type: 'generation'
    },
    {
      id: 'tasks',
      name: 'Task Planning',
      description: 'Bob breaks spec into Kanban tasks with execution order',
      agent: 'Felix (Scrum Master)',
      type: 'planning'
    },
    {
      id: 'approval',
      name: 'Approval',
      description: 'Review and approve the task plan before execution',
      agent: 'You',
      type: 'approval'
    },
    {
      id: 'execute',
      name: 'Execute',
      description: 'James executes tasks sequentially or in parallel',
      agent: 'James Bond (Developer)',
      type: 'execution'
    }
  ],
  config: {
    maxClarifyingQuestions: 10,
    requireApproval: true,
    generateTechSpec: true,
    generateTasks: true
  }
}

// ── greenfield ─────────────────────────────────────────────────────────────────

const GREENFIELD = {
  id: 'greenfield',
  name: 'greenfield',
  description: 'Build a new project from scratch — discovery, PRD, architecture, sprint planning, then full execution. The complete BMAD pipeline.',
  icon: 'Layers',
  agent: 'Full MI6 team',
  steps: [
    {
      id: 'discovery',
      name: 'Discovery',
      description: 'Mary uncovers project goals, users, constraints, and v1 scope',
      agent: 'Moneypenny (Analyst)',
      type: 'conversation'
    },
    {
      id: 'prd',
      name: 'PRD',
      description: 'John writes a full Product Requirements Document',
      agent: 'Mallory (PM)',
      type: 'generation'
    },
    {
      id: 'architecture',
      name: 'Architecture',
      description: 'Winston designs the system architecture with ADRs',
      agent: 'Quartermaster (Architect)',
      type: 'generation'
    },
    {
      id: 'stories',
      name: 'Sprint Planning',
      description: 'Bob organizes stories into sprint slices with clear "done" criteria',
      agent: 'Felix (Scrum Master)',
      type: 'planning'
    },
    {
      id: 'tasks',
      name: 'Task Breakdown',
      description: 'Bob generates executable Kanban tasks with parallel/sequential groupings',
      agent: 'Felix (Scrum Master)',
      type: 'planning'
    },
    {
      id: 'approval',
      name: 'Approval',
      description: 'Review full plan before James starts building',
      agent: 'You',
      type: 'approval'
    },
    {
      id: 'execute',
      name: 'Build',
      description: 'James builds the project sprint by sprint',
      agent: 'James Bond (Developer)',
      type: 'execution'
    }
  ],
  config: {
    maxClarifyingQuestions: 15,
    requireApproval: true,
    generatePRD: true,
    generateArchitecture: true,
    generateTechSpec: false,
    generateTasks: true
  }
}

// ── brownfield-feature ──────────────────────────────────────────────────────────

const BROWNFIELD_FEATURE = {
  id: 'brownfield-feature',
  name: 'brownfield-feature',
  description: 'Add a feature to an existing codebase — integration-aware requirements, careful architecture, risk-conscious implementation.',
  icon: 'GitMerge',
  agent: 'Full MI6 team (brownfield mode)',
  steps: [
    {
      id: 'requirements',
      name: 'Requirements',
      description: 'Mary gathers requirements with focus on integration and backwards compatibility',
      agent: 'Moneypenny (Analyst)',
      type: 'conversation'
    },
    {
      id: 'spec',
      name: 'Integration Spec',
      description: 'Winston writes a spec focusing on existing code touchpoints and migration',
      agent: 'Quartermaster (Architect)',
      type: 'generation'
    },
    {
      id: 'tasks',
      name: 'Task Planning',
      description: 'Bob creates tasks with explicit integration checkpoints and regression tests',
      agent: 'Felix (Scrum Master)',
      type: 'planning'
    },
    {
      id: 'approval',
      name: 'Approval',
      description: 'Review the integration plan — pay special attention to risk areas',
      agent: 'You',
      type: 'approval'
    },
    {
      id: 'execute',
      name: 'Execute',
      description: 'James implements carefully — reading before writing, never breaking existing code',
      agent: 'James Bond (Developer)',
      type: 'execution'
    }
  ],
  config: {
    maxClarifyingQuestions: 10,
    requireApproval: true,
    generateTechSpec: true,
    generateTasks: true,
    brownfield: true
  }
}

// ── bug-fix ─────────────────────────────────────────────────────────────────────

const BUG_FIX = {
  id: 'bug-fix',
  name: 'bug-fix',
  description: 'Investigate and fix a bug — Quinn investigates root cause, James applies the minimal correct fix.',
  icon: 'Bug',
  agent: 'Tanner + James Bond',
  steps: [
    {
      id: 'investigate',
      name: 'Investigate',
      description: 'Quinn builds a hypothesis tree and finds the root cause',
      agent: 'Tanner (QA)',
      type: 'conversation'
    },
    {
      id: 'fix',
      name: 'Fix',
      description: 'James applies the minimal correct fix and adds regression tests',
      agent: 'James Bond (Developer)',
      type: 'execution'
    }
  ],
  config: {
    maxClarifyingQuestions: 5,
    requireApproval: false,
    autoImplement: true
  }
}

// ── Exports ────────────────────────────────────────────────────────────────────

module.exports = {
  'dev-now':            DEV_NOW,
  'feature-dev':        FEATURE_DEV,
  'greenfield':         GREENFIELD,
  'brownfield-feature': BROWNFIELD_FEATURE,
  'bug-fix':            BUG_FIX,
}
