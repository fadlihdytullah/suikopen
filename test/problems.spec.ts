import { describe, expect, it } from 'vitest'
import { parseDocument } from '../src/shared/schema/document'
import { sceneItems } from '../src/renderer/canvas/scene-index'
import { contrastRatio, findProblems } from '../src/renderer/mcp/problems'
import { GUIDES, GUIDE_TOPICS } from '../src/main/agent/guides'
import { DESIGNER_PROMPT, MCP_INSTRUCTIONS } from '../src/main/agent/prompt'

function problemsOf(children: unknown[], rootId = 'screen') {
  const document = parseDocument({
    version: 1,
    children: [{ id: 'screen', type: 'frame', name: 'Screen', x: 0, y: 0, width: 300, height: 200, fill: '#ffffff', children }],
  })
  return findProblems(sceneItems(document), rootId)
}

describe('findProblems', () => {
  it('passes a clean screen', () => {
    expect(problemsOf([{ id: 't', type: 'text', x: 10, y: 10, width: 100, height: 20, content: 'Hi', fill: '#111111' }])).toEqual([])
  })

  it('flags a child sticking out of its frame', () => {
    const [problem] = problemsOf([{ id: 'r', type: 'rectangle', name: 'Card', x: 250, y: 10, width: 100, height: 40 }])
    expect(problem).toMatchObject({ id: 'r', name: 'Card' })
    expect(problem?.issue).toContain('by 50px')
  })

  it('flags a collapsed node', () => {
    const [problem] = problemsOf([{ id: 'f', type: 'frame', x: 0, y: 0, width: 'fit_content', height: 40, children: [] }])
    expect(problem?.issue).toContain('collapsed')
  })

  it('flags low text contrast against the nearest solid background', () => {
    const [problem] = problemsOf([{ id: 't', type: 'text', x: 10, y: 10, width: 100, height: 20, content: 'Hi', fill: '#cccccc' }])
    expect(problem?.issue).toContain('contrast')
  })

  it('flags overlapping text in a frame without layout', () => {
    const problems = problemsOf([
      { id: 'a', type: 'text', x: 10, y: 10, width: 100, height: 20, content: 'A', fill: '#111111' },
      { id: 'b', type: 'text', x: 20, y: 15, width: 100, height: 20, content: 'B', fill: '#111111' },
    ])
    expect(problems.map((problem) => problem.issue).join()).toContain('overlaps')
  })

  it('skips hidden nodes', () => {
    expect(problemsOf([{ id: 'r', type: 'rectangle', visible: false, x: 250, y: 10, width: 100, height: 40 }])).toEqual([])
  })

  it('computes WCAG contrast', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21)
  })
})

describe('guides', () => {
  it('has text for every topic and points agents at get_guide', () => {
    for (const topic of GUIDE_TOPICS) {
      expect(GUIDES[topic].length).toBeGreaterThan(200)
    }
    expect(MCP_INSTRUCTIONS).toContain('get_guide')
    expect(DESIGNER_PROMPT).toContain('Node schema')
  })
})
