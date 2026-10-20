import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentRuntime } from '../src/backend/agents/runtime.ts'
import { defaultIdentity } from '../src/shared/agent.ts'

test('new identity stays blank until its preset is explicitly saved, then persists across restarts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'granite-identity-setup-'))
  let runtime = await AgentRuntime.open(directory)

  try {
    const agent = await runtime.createAgent('Nova')
    assert.equal(await runtime.read(agent.id, '/identity.md'), '')

    runtime.close()
    runtime = await AgentRuntime.open(directory)
    assert.equal(await runtime.read(agent.id, '/identity.md'), '')

    const preset = defaultIdentity(agent.name)
    assert.equal(await runtime.saveIdentity(agent.id, preset, ''), preset)
    assert.equal(await runtime.read(agent.id, '/identity.md'), preset)
    await assert.rejects(runtime.saveIdentity(agent.id, 'Overwrite', ''), /changed/)
    await assert.rejects(runtime.saveIdentity(agent.id, '', preset), /Identity must contain/)

    runtime.close()
    runtime = await AgentRuntime.open(directory)
    assert.equal(await runtime.read(agent.id, '/identity.md'), preset)

    const custom = '# Nova\nUse a warm, direct style.\n'
    await runtime.saveIdentity(agent.id, custom, preset)
    runtime.close()
    runtime = await AgentRuntime.open(directory)
    assert.equal(await runtime.read(agent.id, '/identity.md'), custom)
  } finally {
    runtime.close()
    await rm(directory, { recursive: true, force: true })
  }
})
