import { useEffect, useState } from 'react'

export default function SkillsEditor({
  agentId,
  busy,
  onDirty
}: {
  agentId: string
  busy: boolean
  onDirty: (dirty: boolean) => void
}) {
  const [skills, setSkills] = useState<{ name: string; content: string }[]>([])
  const [skillName, setSkillName] = useState('')
  const [skillContent, setSkillContent] = useState('')
  const [skillSaved, setSkillSaved] = useState({ name: '', content: '' })
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const skillDirty = skillName !== skillSaved.name || skillContent !== skillSaved.content
  const disabled = busy || working || loading

  useEffect(() => {
    let mounted = true
    void window.granite.harness
      .skills(agentId)
      .then(result => {
        if (!mounted) {
          return
        }

        if (result.ok) {
          setSkills(result.value)
        } else {
          setError(result.error)
        }
      })
      .catch(() => {
        if (mounted) {
          setError('Could not load skills.')
        }
      })
      .finally(() => {
        if (mounted) {
          setLoading(false)
        }
      })

    return () => {
      mounted = false
    }
  }, [agentId])

  useEffect(() => {
    onDirty(skillDirty)

    return () => onDirty(false)
  }, [skillDirty, onDirty])

  async function saveSkill() {
    setWorking(true)
    setError('')

    try {
      const result = await window.granite.harness.saveSkill(agentId, skillName, skillContent)

      if (!result.ok) {
        setError(result.error)

        return
      }

      const skill = { name: skillName, content: skillContent }
      setSkills(current => [...current.filter(item => item.name !== skillName), skill])
      setSkillSaved(skill)
      setNotice('Skill saved. Your agent can load it on the next message.')
    } catch {
      setError('Could not save the skill.')
    } finally {
      setWorking(false)
    }
  }

  return (
    <section className="skills-editor">
      <h2>
        Skills
      </h2>

      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}

      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}

      <p className="agent-description">
        A skill is a set of instructions your agent can load when relevant. Skills do not grant additional permissions.
      </p>

      <fieldset disabled={disabled}>
        <label>
          Choose a skill

          <select
            disabled={skillDirty}
            value={skillSaved.name}
            onChange={event => {
              const skill = skills.find(item => item.name === event.target.value) ?? {
                name: '',
                content: ''
              }
              setSkillName(skill.name)
              setSkillContent(skill.content)
              setSkillSaved(skill)
            }}
          >
            <option value="">
              New skill
            </option>

            {skills.map(skill => (
              <option key={skill.name} value={skill.name}>
                {skill.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          Skill name

          <input
            value={skillName}
            maxLength={64}
            disabled={Boolean(skillSaved.name)}
            onChange={event => setSkillName(event.target.value)}
            placeholder="research-notes"
          />
        </label>

        <label>
          Skill instructions

          <textarea
            className="identity-editor"
            value={skillContent}
            maxLength={32_000}
            onChange={event => setSkillContent(event.target.value)}
          />
        </label>

        <div className="connect-actions">
          <button
            type="button"
            disabled={!skillDirty || !skillName.trim() || !skillContent.trim()}
            onClick={() => void saveSkill()}
          >
            Save skill
          </button>

          {skillDirty && (
            <button
              type="button"
              className="quiet-button"
              onClick={() => {
                setSkillName(skillSaved.name)
                setSkillContent(skillSaved.content)
              }}
            >
              Discard skill changes
            </button>
          )}
        </div>
      </fieldset>
    </section>
  )
}
