import { describe, expect, it } from 'vitest'
import { parseSkill } from '../src/main/agent/skills'

describe('parseSkill', () => {
  it('reads frontmatter and strips it from the body', () => {
    const skill = parseSkill('---\nname: hmm-sketch\ndescription: "Draw it in text."\n---\n\n# Body\n', 'folder')
    expect(skill).toEqual({ name: 'hmm-sketch', description: 'Draw it in text.', body: '\n# Body\n' })
  })

  it('falls back to the folder name without frontmatter', () => {
    expect(parseSkill('# Only body', 'folder')).toMatchObject({ name: 'folder', description: '', body: '# Only body' })
  })
})

describe('built-in skills', () => {
  it('lists design-handoff first and includes its instructions', async () => {
    const { listSkills, skillInstructions } = await import('../src/main/agent/skills')
    const skills = await listSkills()
    expect(skills[0]).toMatchObject({ name: 'design-handoff', builtIn: true })
    expect(skills.filter((skill) => skill.name === 'design-handoff')).toHaveLength(1)
    expect(await skillInstructions(['design-handoff'])).toContain('<skill name="design-handoff">')
  })
})
