import Store from 'electron-store'
import { promises as fs } from 'fs'
import path from 'path'
import { getSettings } from './config'
import type { SkillDefinition } from './types'

interface SkillSchema { skills: SkillDefinition[] }
const store = new Store<SkillSchema>({ name: 'skills', defaults: { skills: [] } })

export function listSkills(): SkillDefinition[] { return store.get('skills', []) }
export function skillCatalog(): string {
  const skills = listSkills()
  if (!skills.length) return 'No installed custom skills.'
  return skills.map((skill) => `- ${skill.name}: ${skill.description}`).join('\n')
}
export function getSkill(name: string): SkillDefinition | undefined {
  const key = name.trim().toLowerCase()
  return listSkills().find((skill) => skill.name.toLowerCase() === key || skill.id === name)
}
export async function installSkillFromFile(inputPath: string): Promise<SkillDefinition> {
  const root = path.resolve(getSettings().workspaceRoot)
  const target = path.resolve(inputPath)
  const rel = path.relative(root, target)
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Skill file must be inside the configured workspace.')
  const raw = await fs.readFile(target, 'utf8')
  const parsed = JSON.parse(raw) as Partial<SkillDefinition>
  const name = String(parsed.name || '').trim()
  const description = String(parsed.description || '').trim()
  const instructions = String(parsed.instructions || '').trim()
  if (!name || !description || !instructions) throw new Error('Skill JSON requires name, description, and instructions.')
  const skill: SkillDefinition = {
    id: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}`,
    name: name.slice(0, 100), description: description.slice(0, 600), instructions: instructions.slice(0, 20_000), createdAt: new Date().toISOString()
  }
  const skills = listSkills().filter((item) => item.name.toLowerCase() !== skill.name.toLowerCase())
  store.set('skills', [skill, ...skills].slice(0, 100))
  return skill
}
export function removeSkill(idOrName: string): boolean {
  const before = listSkills(); const key = idOrName.toLowerCase()
  const after = before.filter((skill) => skill.id !== idOrName && skill.name.toLowerCase() !== key)
  store.set('skills', after)
  return after.length !== before.length
}
