import { describe, expect, it } from 'vitest'
import { ProjectRootRegistry } from './project-root-registry'

const project = {
  name: 'Quarterly deck',
  path: '/projects/quarterly-deck',
  lastOpenedAt: '2026-08-29T09:00:00.000Z',
}

describe('ProjectRootRegistry', () => {
  it('grants an opaque reusable handle for a canonical project', () => {
    const registry = new ProjectRootRegistry()
    const first = registry.grant(project)
    const second = registry.grant({
      ...project,
      lastOpenedAt: '2026-08-29T10:00:00.000Z',
    })

    expect(first.handle).toBeTruthy()
    expect(second.handle).toBe(first.handle)
    expect(registry.resolve(first.handle)).toBe(project.path)
  })

  it('rejects malformed and unknown handles', () => {
    const registry = new ProjectRootRegistry()

    expect(() => registry.resolve('')).toThrow('项目授权无效')
    expect(() => registry.resolve('unknown-handle')).toThrow(
      '项目授权已失效，请重新打开项目',
    )
    expect(() => registry.resolve(`valid\0hidden`)).toThrow('项目授权无效')
  })
})
