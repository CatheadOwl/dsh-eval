/**
 * The eval multi-turn driver, loaded as a Cordis plugin through the eval
 * overlay when a case declares `followups`. It REPLACES the one-shot
 * `headless-runner` row (the overlay disables that row and inserts this one):
 * the headless runner exits at the main agent's first idle, which aborts every
 * in-process background subagent at process teardown (measured: a turn-close
 * fixer child dies between publication and its first model call). Keeping the
 * process alive across turns is what makes fire-and-forget children observable
 * at all — the survival window is the driver's lifetime.
 *
 * Plan (env `DSH_EVAL_DRIVER_PLAN`, a JSON file written by the runner):
 * `{ followups: string[], settleTimeoutMs?: number }`. The FIRST turn's task
 * still arrives as the CLI positional; each followup is one additional user
 * message. Before each followup the driver waits for background subagent
 * children to settle (tracked via the global `session/event` feed: a session
 * whose header marks it a subagent is pending from its `turn/start` until its
 * `turn/end`), so a case can assert "the fixer child finished, THEN the next
 * turn re-scanned".
 *
 * Output contract mirrors the headless runner's stdout/exit semantics: last
 * non-empty assistant text of the main session on stdout, exit 0 iff the LAST
 * turn ended `completed`.
 */

import { readFileSync } from 'node:fs'
import { createUserMessage } from '@deepseek-ai/dsh-llm'

/** Environment variable pointing at this run's driver plan JSON. */
const PLAN_ENV = 'DSH_EVAL_DRIVER_PLAN'

/** Default bound on waiting for background children to settle. */
const DEFAULT_SETTLE_TIMEOUT_MS = 60_000

/**
 * Quiescence grace after the pending set drains: a turn-close dispatch races
 * the driver's poll loop, so an empty set is only trusted after this many ms
 * pass without a new subagent `turn/start`.
 */
const SETTLE_GRACE_MS = 250

/** Poll interval while waiting on pending children. */
const SETTLE_POLL_MS = 25

/** One user-role followup message. */
function followupMessage(text) {
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  })
}

/** Whether a session (from the event feed) is a subagent child log. */
function isSubagentSession(session) {
  const header = session?.header
  if (header === null || typeof header !== 'object') return false
  return header.origin === 'subagent' || header.parentSession !== undefined
}

/** Aggregate the last assistant text and turn outcome over the whole log. */
function summarize(agent) {
  let text = ''
  let reason
  for (const event of agent.session.events) {
    if (event.type === 'assistant/message') {
      const joined = event.data.message.content
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('')
      if (joined !== '') text = joined
    }
    if (event.type === 'turn/end') reason = event.data.reason
  }
  return { text, reason }
}

/**
 * Run the plan: task turn, then per followup — wait for background subagent
 * children to settle, submit the followup, wait for idle.
 */
async function run(ctx, plan, io) {
  // Pending background children: subagent sessions between their turn/start
  // and turn/end. Registered BEFORE awaiting the loader so a plugin that
  // dispatches during mount cannot slip a turn/start past the counter; the
  // listener is global — child sessions publish their own events on the same
  // feed the persistence layer listens on.
  const pending = new Set()
  ctx.on('session/event', (session, event) => {
    if (!isSubagentSession(session)) return
    if (event.type === 'turn/start') pending.add(session.header.id)
    if (event.type === 'turn/end') pending.delete(session.header.id)
  })
  await ctx.get('loader')?.await()
  const agents = ctx.get('agents')
  const defaultModel = ctx.get('agentDefaultModel')
  const sessions = ctx.get('sessions')
  if (agents === undefined || defaultModel === undefined || sessions === undefined) {
    throw new Error('eval-multi-turn-driver: agents/sessions services are unavailable')
  }
  const settleTimeoutMs = plan.settleTimeoutMs ?? DEFAULT_SETTLE_TIMEOUT_MS
  const waitForSettle = async () => {
    const deadline = Date.now() + settleTimeoutMs
    for (;;) {
      if (pending.size === 0) {
        await new Promise(resolve => setTimeout(resolve, SETTLE_GRACE_MS))
        if (pending.size === 0) return
      }
      if (Date.now() > deadline) {
        throw new Error(`eval-multi-turn-driver: background subagents did not settle within ${settleTimeoutMs}ms (${[...pending].join(', ')})`)
      }
      await new Promise(resolve => setTimeout(resolve, SETTLE_POLL_MS))
    }
  }

  const selection = defaultModel.currentSelection()
  const { agent } = await agents.create({
    sessionId: `session-${crypto.randomUUID()}`,
    meta: { cwd: process.cwd() },
    agentOptions: { provider: selection.provider, model: selection.model },
  })
  await agent.whenIdle()
  const stop = plan.task ?? ''
  if (stop === '') throw new Error('eval-multi-turn-driver: plan.task must be the case task text')
  agent.followup(followupMessage(stop))
  await agent.whenIdle()
  for (const followup of plan.followups) {
    await waitForSettle()
    agent.followup(followupMessage(followup))
    await agent.whenIdle()
  }
  // The LAST turn's close also dispatches (a defer fixer fires on every
  // failed stop): wait once more so close-dispatched children are not
  // silently aborted at exit — "dispatched ⇒ observable outcome" holds for
  // every turn, not just the ones a followup follows.
  await waitForSettle()
  await sessions.flush(agent.session)
  const outcome = summarize(agent)
  io.stdout.write(outcome.text + '\n')
  io.exit(outcome.reason?.kind === 'completed' ? 0 : 1)
}

export const name = 'eval-multi-turn-driver'

export const inject = ['agentDefaultModel', 'agents', 'sessions']

/** Mount the multi-turn driver from the run plan. */
export function apply(ctx) {
  // Read through the global service store: appExit is an optional launcher
  // host value, never an injected dependency.
  const exit = ctx.get('appExit')
  if (exit === undefined) {
    throw new Error('eval-multi-turn-driver: the launcher must provide ctx.appExit before the tree mounts')
  }
  const planPath = process.env[PLAN_ENV]
  if (planPath === undefined) {
    throw new Error(`eval-multi-turn-driver: ${PLAN_ENV} must point at the run's driver plan JSON`)
  }
  const plan = JSON.parse(readFileSync(planPath, 'utf8'))
  const io = { stdout: process.stdout, stderr: process.stderr, exit }
  void run(ctx, plan, io).catch(error => {
    io.stderr.write(`dsh: ${error instanceof Error ? error.message : String(error)}\n`)
    exit(1)
  })
}
