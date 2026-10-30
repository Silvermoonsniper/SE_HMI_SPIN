export interface QueueStep {
  step_number: number
  module: string
  command: 'write_target' | ['prepare', 'go']
  arguments: unknown
  dwell_time_min: number
  timeout_s?: number
}

export function parseAutomatorQueue(value: unknown): QueueStep[] {
  if (value == null || value === '') return []
  const queue = typeof value === 'string' ? JSON.parse(value) : value
  if (!queue || queue.schema_version !== 2 || !Array.isArray(queue.steps) || !queue.steps.length) {
    throw new Error('Expected a version 2 queue with a nonempty steps array (module, command, arguments).')
  }
  if (queue.steps.some((step: unknown) => !step || typeof step !== 'object' || Array.isArray(step))) {
    throw new Error('Each queue step must be an object.')
  }
  const steps: QueueStep[] = [...queue.steps].sort((a, b) => a.step_number - b.step_number)
  steps.forEach((step, index) => {
    const sequence = Array.isArray(step.command) && step.command.length === 2
      && step.command[0] === 'prepare' && step.command[1] === 'go'
    if (step.step_number !== index + 1 || typeof step.module !== 'string'
      || !/^[A-Za-z][A-Za-z0-9_]*$/.test(step.module)
      || (step.command !== 'write_target' && !sequence)
      || !Object.prototype.hasOwnProperty.call(step, 'arguments')
      || (sequence ? step.arguments !== null : step.arguments == null)
      || !Number.isFinite(step.dwell_time_min) || step.dwell_time_min < 0
      || !Number.isFinite(step.dwell_time_min * 60)
      || (step.timeout_s !== undefined && (!Number.isFinite(step.timeout_s) || step.timeout_s < 1 || step.timeout_s > 86400))) {
      throw new Error('Invalid queue step. Check its consecutive number, module, command, arguments, dwell time, and optional timeout_s.')
    }
  })
  return steps
}

export function automatorState(value: unknown): string {
  const states = ['idle', 'executing', 'dwelling', 'completed', 'stopped', 'error']
  if (typeof value === 'number') return states[value] ?? 'unknown'
  return String(value ?? 'unknown').toLowerCase()
}

export function queueStepState(number: number, current: number, state: string): string {
  if (state === 'completed' || (current > 0 && number < current)) return 'completed'
  if (number === current) return state
  return 'pending'
}
