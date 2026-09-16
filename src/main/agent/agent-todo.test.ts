import { describe, expect, it } from 'vitest'
import {
  normalizeAgentTodos,
  todosFromSessionEntries,
  todosFromToolResult,
} from './agent-todo'

const tasks = [
  { id: 1, subject: '梳理材料', status: 'completed' },
  {
    id: 2,
    subject: '建立叙事',
    activeForm: '正在建立叙事',
    status: 'in_progress',
  },
  { id: 3, subject: '制作页面', status: 'pending' },
  { id: 4, subject: '废弃步骤', status: 'deleted' },
]

describe('normalizeAgentTodos', () => {
  it('keeps displayable fields and hides deleted tasks', () => {
    expect(normalizeAgentTodos(tasks)).toEqual([
      { id: 1, subject: '梳理材料', status: 'completed' },
      {
        id: 2,
        subject: '建立叙事',
        activeForm: '正在建立叙事',
        status: 'in_progress',
      },
      { id: 3, subject: '制作页面', status: 'pending' },
    ])
  })

  it('rejects malformed snapshots instead of partially exposing them', () => {
    expect(
      normalizeAgentTodos([{ id: 1, subject: '', status: 'pending' }]),
    ).toBeNull()
    expect(
      normalizeAgentTodos([
        { id: 1, subject: 'A', status: 'pending' },
        { id: 1, subject: 'B', status: 'completed' },
      ]),
    ).toBeNull()
    expect(
      normalizeAgentTodos([{ id: 1, subject: 'A', status: 'unknown' }]),
    ).toBeNull()
  })
})

describe('todo snapshot extraction', () => {
  it('extracts a live rpiv-todo tool result', () => {
    expect(todosFromToolResult({ details: { tasks, nextId: 5 } })).toEqual(
      normalizeAgentTodos(tasks),
    )
  })

  it('replays the last valid rpiv-todo snapshot from a session branch', () => {
    expect(
      todosFromSessionEntries([
        {
          type: 'message',
          message: {
            role: 'toolResult',
            toolName: 'todo',
            details: {
              tasks: [tasks[0]],
              nextId: 2,
            },
          },
        },
        {
          type: 'message',
          message: { role: 'toolResult', toolName: 'read', details: {} },
        },
        {
          type: 'message',
          message: {
            role: 'toolResult',
            toolName: 'todo',
            details: {
              tasks,
              nextId: 5,
            },
          },
        },
      ]),
    ).toEqual(normalizeAgentTodos(tasks))
  })
})
