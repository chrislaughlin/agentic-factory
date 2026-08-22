import { useCallback, useEffect, useState } from 'react'
import {
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import './App.css'

type RouteNodeData = {
  label: string
  detail: string
  kind?: 'gate' | 'terminal' | 'specialist' | 'human'
}

type CopyState = 'idle' | 'copied' | 'error'

const INSTALL_COMMAND = './scripts/install.sh --harness all'
const SHAPE_COMMAND =
  '$shape-work <rough idea, customer problem, research, PRD, or opportunity>'
const DO_COMMAND =
  '$do-work <ticket, PRD, spec, URL, PR/MR, or task description>'

function FactoryMark({ size = 28 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      className="factory-mark"
      height={size}
      viewBox="0 0 32 32"
      width={size}
    >
      <path d="M4 4h10v10H4zM18 4h10v10H18zM4 18h10v10H4z" />
      <path d="M18 18h10M18 23h10M18 28h10" />
    </svg>
  )
}

function CopyIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <rect height="11" rx="1" width="11" x="8" y="8" />
      <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />
    </svg>
  )
}

function ArrowIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M5 12h14M14 7l5 5-5 5" />
    </svg>
  )
}

function RouteNode({ data }: NodeProps) {
  const node = data as RouteNodeData
  return (
    <div className={`route-node route-node--${node.kind ?? 'default'}`}>
      <Handle position={Position.Left} type="target" />
      <div>
        <strong>{node.label}</strong>
        <span>{node.detail}</span>
      </div>
      <Handle position={Position.Right} type="source" />
    </div>
  )
}

const nodeTypes: NodeTypes = { route: RouteNode }

const edge = (
  id: string,
  source: string,
  target: string,
  label?: string,
  loop = false,
): Edge => ({
  id,
  source,
  target,
  label,
  type: loop ? 'smoothstep' : 'default',
  className: loop ? 'route-edge route-edge--loop' : 'route-edge',
  markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
  labelBgPadding: [6, 4],
  labelBgBorderRadius: 2,
})

const shapeNodes: Node[] = [
  {
    id: 'input',
    type: 'route',
    position: { x: 0, y: 210 },
    data: { label: 'Idea / evidence / PRD', detail: 'Any maturity of product input' },
  },
  {
    id: 'shape',
    type: 'route',
    position: { x: 220, y: 260 },
    data: {
      label: 'shape-work',
      detail: 'Discover, frame, and slice',
      kind: 'specialist',
    },
  },
  {
    id: 'research',
    type: 'route',
    position: { x: 440, y: 80 },
    data: { label: 'research-product', detail: 'Bounded evidence with provenance', kind: 'specialist' },
  },
  {
    id: 'challenge',
    type: 'route',
    position: { x: 440, y: 440 },
    data: { label: 'challenge-product', detail: 'Independent assumptions and risk challenge', kind: 'specialist' },
  },
  {
    id: 'frame',
    type: 'route',
    position: { x: 660, y: 260 },
    data: { label: 'Frame and rank', detail: 'Outcome, assumptions, unknowns, and options' },
  },
  {
    id: 'investment',
    type: 'route',
    position: { x: 880, y: 260 },
    data: { label: 'Investment gate', detail: 'Human chooses one disposition', kind: 'gate' },
  },
  {
    id: 'learning',
    type: 'route',
    position: { x: 1100, y: 0 },
    data: { label: 'Experiment', detail: 'Cheapest valid test with thresholds' },
  },
  {
    id: 'reframe',
    type: 'route',
    position: { x: 1100, y: 140 },
    data: { label: 'Reframe', detail: 'Change the problem or opportunity' },
  },
  {
    id: 'park',
    type: 'route',
    position: { x: 1100, y: 280 },
    data: { label: 'Park', detail: 'Stop investment deliberately' },
  },
  {
    id: 'decision',
    type: 'route',
    position: { x: 1320, y: 280 },
    data: { label: 'Decision record', detail: 'Preserve why work stopped', kind: 'terminal' },
  },
  {
    id: 'advance',
    type: 'route',
    position: { x: 1100, y: 420 },
    data: { label: 'Advance', detail: 'Create the smallest valuable slice' },
  },
  {
    id: 'slice',
    type: 'route',
    position: { x: 1320, y: 420 },
    data: { label: 'Slice and sequence', detail: 'Dependencies, stop conditions, delivery mode' },
  },
  {
    id: 'review',
    type: 'route',
    position: { x: 1540, y: 420 },
    data: { label: 'review-work-items', detail: 'Independent readiness review', kind: 'specialist' },
  },
  {
    id: 'backlog',
    type: 'route',
    position: { x: 1760, y: 420 },
    data: { label: 'Approved ready backlog', detail: 'Human selects one item for do-work', kind: 'terminal' },
  },
]

const shapeEdges: Edge[] = [
  edge('s1', 'input', 'shape'),
  edge('s2', 'shape', 'research'),
  edge('s3', 'shape', 'challenge'),
  edge('s4', 'research', 'frame'),
  edge('s5', 'challenge', 'frame'),
  edge('s6', 'frame', 'investment'),
  edge('s7', 'investment', 'learning', 'experiment'),
  edge('s8', 'learning', 'shape', 'new evidence', true),
  edge('s9', 'investment', 'reframe', 'reframe'),
  edge('s10', 'reframe', 'shape', 'reshape', true),
  edge('s11', 'investment', 'park', 'park'),
  edge('s12', 'park', 'decision'),
  edge('s13', 'investment', 'advance', 'advance'),
  edge('s14', 'advance', 'slice'),
  edge('s15', 'slice', 'review'),
  edge('s16', 'review', 'backlog', 'human approval'),
]

const positionNodes = (
  nodes: Node[],
  positions: Record<string, { x: number; y: number }>,
) => nodes.map((node) => ({ ...node, position: positions[node.id] ?? node.position }))

const shapeMobileNodes = positionNodes(shapeNodes, {
  input: { x: 120, y: 0 },
  shape: { x: 120, y: 130 },
  research: { x: 0, y: 260 },
  challenge: { x: 240, y: 260 },
  frame: { x: 120, y: 390 },
  investment: { x: 120, y: 520 },
  learning: { x: 0, y: 650 },
  reframe: { x: 240, y: 650 },
  park: { x: 0, y: 800 },
  advance: { x: 240, y: 800 },
  decision: { x: 0, y: 950 },
  slice: { x: 240, y: 950 },
  review: { x: 240, y: 1080 },
  backlog: { x: 240, y: 1210 },
})

const deliveryNodes: Node[] = [
  {
    id: 'select',
    type: 'route',
    position: { x: 0, y: 250 },
    data: { label: 'Human selects ready work', detail: 'Ticket, PRD, spec, URL, PR/MR, or task', kind: 'human' },
  },
  {
    id: 'do-work',
    type: 'route',
    position: { x: 220, y: 300 },
    data: { label: 'do-work', detail: 'Inspect, grill, and plan', kind: 'specialist' },
  },
  {
    id: 'discovery',
    type: 'route',
    position: { x: 440, y: 300 },
    data: { label: 'Repository discovery', detail: 'Facts, commands, risks, and forge rules' },
  },
  {
    id: 'map',
    type: 'route',
    position: { x: 660, y: 300 },
    data: { label: 'map-codebase', detail: 'Evidence-led repository map', kind: 'specialist' },
  },
  {
    id: 'design',
    type: 'route',
    position: { x: 880, y: 300 },
    data: { label: 'design-solution', detail: 'Versioned technical blueprint', kind: 'specialist' },
  },
  {
    id: 'plan-review',
    type: 'route',
    position: { x: 1100, y: 80 },
    data: { label: 'review-technical-plan', detail: 'Risk-triggered independent review', kind: 'specialist' },
  },
  {
    id: 'reconcile',
    type: 'route',
    position: { x: 1100, y: 300 },
    data: { label: 'Reconcile and re-question', detail: 'Resolve findings and decisions', kind: 'gate' },
  },
  {
    id: 'artifact',
    type: 'route',
    position: { x: 1320, y: 300 },
    data: { label: 'Exact artifact review', detail: 'Hash, revision, and completeness gate', kind: 'gate' },
  },
  {
    id: 'approval',
    type: 'route',
    position: { x: 1540, y: 300 },
    data: { label: 'Explicit plan approval', detail: 'No code changes before this gate', kind: 'human' },
  },
  {
    id: 'worktree',
    type: 'route',
    position: { x: 1760, y: 300 },
    data: { label: 'Task worktree', detail: 'Isolated branch and environment preflight' },
  },
  {
    id: 'construct',
    type: 'route',
    position: { x: 1980, y: 300 },
    data: { label: 'construct-work', detail: 'Single production-code writer', kind: 'specialist' },
  },
  {
    id: 'security',
    type: 'route',
    position: { x: 2200, y: 80 },
    data: { label: 'review-security', detail: 'Read-only review at pinned SHA', kind: 'specialist' },
  },
  {
    id: 'tests',
    type: 'route',
    position: { x: 2200, y: 520 },
    data: { label: 'author-tests', detail: 'Tests, fixtures, and deterministic evals', kind: 'specialist' },
  },
  {
    id: 'qa',
    type: 'route',
    position: { x: 2420, y: 300 },
    data: { label: 'verify-qa', detail: 'Runtime acceptance evidence', kind: 'specialist' },
  },
  {
    id: 'quality',
    type: 'route',
    position: { x: 2640, y: 300 },
    data: { label: 'review-code-quality', detail: 'Strict structural and specification gate', kind: 'specialist' },
  },
  {
    id: 'pr',
    type: 'route',
    position: { x: 2860, y: 300 },
    data: { label: 'Ready PR / MR', detail: 'Created only after every local gate passes', kind: 'terminal' },
  },
  {
    id: 'watch',
    type: 'route',
    position: { x: 3080, y: 300 },
    data: { label: 'watch-change', detail: 'Monitor CI and review feedback', kind: 'specialist' },
  },
  {
    id: 'human-review',
    type: 'route',
    position: { x: 3300, y: 300 },
    data: { label: 'Human review gate', detail: 'Green and settled', kind: 'human' },
  },
  {
    id: 'merge',
    type: 'route',
    position: { x: 3520, y: 300 },
    data: { label: 'Human merges and deploys', detail: 'Agent Factory stops here', kind: 'terminal' },
  },
]

const deliveryEdges: Edge[] = [
  edge('d1', 'select', 'do-work'),
  edge('d2', 'do-work', 'discovery'),
  edge('d3', 'discovery', 'map'),
  edge('d4', 'map', 'design'),
  edge('d5', 'design', 'plan-review', 'risk warrants review'),
  edge('d6', 'design', 'reconcile', 'no review needed'),
  edge('d7', 'plan-review', 'reconcile', 'findings'),
  edge('d8', 'reconcile', 'artifact'),
  edge('d9', 'artifact', 'approval', 'exact final plan'),
  edge('d10', 'approval', 'worktree'),
  edge('d11', 'worktree', 'construct'),
  edge('d12', 'construct', 'security'),
  edge('d13', 'construct', 'tests'),
  edge('d14', 'security', 'qa'),
  edge('d15', 'tests', 'qa'),
  edge('d16', 'qa', 'quality'),
  edge('d17', 'quality', 'construct', 'validated finding', true),
  edge('d18', 'quality', 'pr', 'all local gates pass'),
  edge('d19', 'pr', 'watch'),
  edge('d20', 'watch', 'construct', 'CI failure / changes / conflict', true),
  edge('d21', 'watch', 'human-review', 'green and settled'),
  edge('d22', 'human-review', 'merge'),
]

const deliveryMobileNodes = positionNodes(deliveryNodes, {
  select: { x: 120, y: 0 },
  'do-work': { x: 120, y: 130 },
  discovery: { x: 120, y: 260 },
  map: { x: 120, y: 390 },
  design: { x: 120, y: 520 },
  'plan-review': { x: 0, y: 650 },
  reconcile: { x: 240, y: 650 },
  artifact: { x: 120, y: 780 },
  approval: { x: 120, y: 910 },
  worktree: { x: 120, y: 1040 },
  construct: { x: 120, y: 1170 },
  security: { x: 0, y: 1300 },
  tests: { x: 240, y: 1300 },
  qa: { x: 120, y: 1430 },
  quality: { x: 120, y: 1560 },
  pr: { x: 120, y: 1690 },
  watch: { x: 120, y: 1820 },
  'human-review': { x: 120, y: 1950 },
  merge: { x: 120, y: 2080 },
})

const shapeTranscript = [
  'Start with an idea, evidence, research, or a PRD.',
  'shape-work classifies input maturity, preserves provenance, and discovers available context.',
  'research-product gathers bounded evidence while challenge-product independently tests assumptions and risks.',
  'shape-work synthesizes outcomes, constraints, metrics, unknowns, and an opportunity/assumption map.',
  'At the investment gate, a human chooses advance, experiment, reframe, park, or phase-gate.',
  'Experiment creates a learning item with thresholds and a decision it unlocks; evidence returns to shape-work.',
  'Reframe returns the changed problem to shape-work.',
  'Park ends in a durable decision record.',
  'Advance creates the smallest valuable slice, makes dependencies and stop conditions explicit, and selects a delivery mode.',
  'review-work-items independently checks the complete draft set before human approval.',
  'Approved items enter the ready backlog and wait for deliberate human selection; shaping never invokes do-work automatically.',
]

const deliveryTranscript = [
  'A human selects one ready work reference.',
  'do-work interrogates the task, discovers repository facts, and asks one material decision at a time.',
  'map-codebase and design-solution produce evidence-backed planning artifacts.',
  'review-technical-plan activates for multi-layer changes, material risk, broad-impact bug fixes, or unknown classifications.',
  'Findings are reconciled, the exact final artifact is checked for revision and hash integrity, and a human approves the plan.',
  'The parent prepares an isolated task worktree and preflights identity, access, and environment parity.',
  'construct-work is the single production-code writer.',
  'review-security checks the pinned construction SHA while author-tests owns tests, fixtures, and deterministic evaluations in parallel.',
  'verify-qa joins both paths and requires runtime acceptance evidence.',
  'review-code-quality runs the final strict local gate.',
  'Any validated finding, test failure, CI failure, requested change, or merge conflict returns to construct-work for remediation.',
  'When every local gate passes, Agent Factory creates a ready PR or MR.',
  'watch-change monitors CI and requested review changes.',
  'CI failures or legitimate requested changes return to construct-work.',
  'When the change is green and settled, it reaches the human review gate.',
  'Only a human merges and deploys; Agent Factory stops at that boundary.',
]

const gateGroups = [
  {
    number: '01',
    title: 'Plan before code',
    summary: 'Material ambiguity is resolved with the human before construction starts.',
    items: [
      'Repository discovery records architecture, commands, runtime paths, forge rules, and environment prerequisites.',
      'map-codebase and design-solution produce versioned, hashable planning artifacts with evidence and traceability.',
      'review-technical-plan activates for multi-layer changes, auth, migrations, material risk, broad-impact bug fixes, or unknown classifications.',
      'The exact final artifact is reviewed, decision-complete, and explicitly approved by a human.',
    ],
  },
  {
    number: '02',
    title: 'Verify the change',
    summary: 'Every stage leaves evidence that the next stage can independently check.',
    items: [
      'Each work item gets an isolated task branch and dedicated worktree; the invoking checkout stays untouched.',
      'construct-work owns production code. author-tests owns tests and fixtures. Checkpoint commits are independently attested.',
      'review-security checks the immutable construction SHA while tests run in parallel; verify-qa requires runtime evidence.',
      'The deterministic evaluator requires 100% required-assertion recall and zero forbidden matches; malformed input blocks the gate.',
    ],
  },
  {
    number: '03',
    title: 'Publish, then hand off',
    summary: 'A PR is an earned state, and the final decision remains human-owned.',
    items: [
      'review-code-quality must be green before publication; every validated security or quality finding blocks the PR.',
      'CI failures, review requests, and merge conflicts return through remediation and the full verification sequence.',
      'Each distinct feedback batch has up to three remediation cycles; exhaustion stops with evidence and options.',
      'watch-change waits for green, settled feedback. Only the human merges and deploys.',
    ],
  },
]

function CommandBlock({
  command,
  id,
  label,
  onCopy,
  state,
}: {
  command: string
  id: string
  label: string
  onCopy: (id: string, command: string) => void
  state: CopyState
}) {
  const status =
    state === 'copied' ? 'Copied' : state === 'error' ? 'Copy failed — select the command' : 'Copy'
  return (
    <div className="command-wrap">
      <span className="command-label">{label}</span>
      <div className="command-block">
        <code>{command}</code>
        <button
          className="copy-button"
          onClick={() => onCopy(id, command)}
          type="button"
        >
          <CopyIcon />
          <span>{status}</span>
        </button>
      </div>
      <span aria-live="polite" className="sr-only">
        {state === 'copied' ? `${label} copied to clipboard.` : ''}
      </span>
    </div>
  )
}

function FlowDiagram({
  edges,
  label,
  mobileNodes,
  nodes,
  transcript,
}: {
  edges: Edge[]
  label: string
  mobileNodes: Node[]
  nodes: Node[]
  transcript: string[]
}) {
  const [isCompact, setIsCompact] = useState(() => window.matchMedia('(max-width: 700px)').matches)

  useEffect(() => {
    const media = window.matchMedia('(max-width: 700px)')
    const onChange = (event: MediaQueryListEvent) => setIsCompact(event.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  return (
    <div className="flow-shell">
      <div className="flow-canvas" role="region" aria-label={`${label} interactive lifecycle diagram`}>
        <ReactFlow
          colorMode="dark"
          edges={edges}
          edgesFocusable
          fitView
          fitViewOptions={{ padding: isCompact ? 0.06 : 0.08, minZoom: 0.38, maxZoom: 1 }}
          key={`${label}-${isCompact ? 'compact' : 'wide'}`}
          maxZoom={1.35}
          minZoom={0.28}
          nodeTypes={nodeTypes}
          nodes={isCompact ? mobileNodes : nodes}
          nodesConnectable={false}
          nodesDraggable={false}
          panOnScroll={!isCompact}
          proOptions={{ hideAttribution: true }}
          zoomOnDoubleClick={false}
          zoomOnScroll={false}
        >
          <Controls position="bottom-right" showInteractive={false} />
        </ReactFlow>
      </div>
      <details className="flow-transcript" open>
        <summary>Read every step in order</summary>
        <ol>
          {transcript.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </details>
    </div>
  )
}

function App() {
  const [copyStates, setCopyStates] = useState<Record<string, CopyState>>({})

  const onCopy = useCallback(async (id: string, command: string) => {
    try {
      await navigator.clipboard.writeText(command)
      setCopyStates((current) => ({ ...current, [id]: 'copied' }))
      window.setTimeout(
        () => setCopyStates((current) => ({ ...current, [id]: 'idle' })),
        2200,
      )
    } catch {
      setCopyStates((current) => ({ ...current, [id]: 'error' }))
    }
  }, [])

  const loomStages = [
    {
      id: 'specialists',
      label: 'Specialist agents',
      detail: 'Research, challenge, construct, test, review',
      href: '#roles',
    },
    {
      id: 'approval',
      label: 'Human approval',
      detail: 'Investment, plan, review, merge, and deploy gates',
      href: '#flows',
    },
    {
      id: 'verification',
      label: 'Verification loops',
      detail: 'Security, runtime QA, code quality, CI, and feedback',
      href: '#delivery-flow',
    },
  ]

  return (
    <div className="site-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>

      <header className="site-header">
        <a className="brand" href="#top" aria-label="Agent Factory home">
          <FactoryMark />
          <span>Agent Factory</span>
        </a>
        <nav aria-label="Primary navigation">
          <a href="#system">System</a>
          <a href="#flows">Flows</a>
          <a href="#gates">Gates</a>
          <a href="#roles">Agents</a>
          <a href="#start">Start</a>
        </nav>
        <a className="header-install" href="#install">
          Install
          <ArrowIcon />
        </a>
      </header>

      <main id="main-content">
        <section className="hero" id="top">
          <div className="hero-copy">
            <FactoryMark size={34} />
            <h1>From work item to ready change.</h1>
            <p>
              A portable delivery workflow of specialist agents, explicit human
              gates, and evidence-backed verification—running inside the tools
              your team already uses.
            </p>
            <div id="install">
              <CommandBlock
                command={INSTALL_COMMAND}
                id="install"
                label="Install first"
                onCopy={onCopy}
                state={copyStates.install ?? 'idle'}
              />
            </div>
            <p className="install-note">
              Installs the skills and native agent adapters for Codex, Claude
              Code, and OpenCode.
            </p>
          </div>

          <div className="loom" id="system" aria-label="Agent Factory orchestration system">
            <div className="loom-hosts" aria-label="Supported hosts">
              {['Codex', 'Claude Code', 'OpenCode'].map((host) => (
                <div className="host-pocket" key={host}>
                  <span>{host}</span>
                </div>
              ))}
            </div>

            <div className="loom-stages">
              {loomStages.map((stage) => (
                <a
                  className="loom-stage"
                  href={stage.href}
                  key={stage.id}
                >
                  <span>
                    <strong>{stage.label}</strong>
                    <small>{stage.detail}</small>
                  </span>
                  <ArrowIcon />
                </a>
              ))}
            </div>

            <div className="ready-pocket">
              <span className="ready-seal" aria-hidden="true">
                <svg viewBox="0 0 48 48">
                  <circle cx="24" cy="24" r="20" />
                  <path d="m15 25 6 6 12-14" />
                </svg>
              </span>
              <span>
                <strong>Ready change</strong>
                <small>Reviewed, verified, human-controlled</small>
              </span>
            </div>
          </div>
        </section>

        <section className="flow-intro" id="flows">
          <div>
            <h2>Two lifecycles. One deliberate handoff.</h2>
            <p>
              Shaping decides what deserves investment. Delivery starts only
              when a human selects one ready item. Nothing crosses that boundary
              automatically.
            </p>
          </div>
          <div className="flow-key" aria-label="Diagram key">
            <span><i className="key-standard" /> Workflow step</span>
            <span><i className="key-human" /> Human gate</span>
            <span><i className="key-loop" /> Return loop</span>
          </div>
        </section>

        <section className="gatebook" id="gates" aria-labelledby="gatebook-title">
          <div className="gatebook-heading">
            <span className="section-kicker">The operating contract</span>
            <h2 id="gatebook-title">Gates are evidence, not ceremony.</h2>
            <p>
              The current workflow is designed to make bad assumptions, unsafe
              changes, and incomplete verification visible before they become
              someone else’s incident.
            </p>
          </div>
          <div className="gate-grid">
            {gateGroups.map((group) => (
              <article className="gate-card" key={group.number}>
                <span className="gate-number">{group.number}</span>
                <h3>{group.title}</h3>
                <p>{group.summary}</p>
                <ul>
                  {group.items.map((item) => <li key={item}>{item}</li>)}
                </ul>
              </article>
            ))}
          </div>
          <div className="gate-callout">
            <strong>When a bug has a wider blast radius</strong>
            <span>
              A fix that crosses shared abstractions, state, contracts, or
              multiple consumers is treated as broad-impact work. It triggers
              the technical-plan review and expands acceptance evidence before
              construction—not after the regression ships.
            </span>
          </div>
        </section>

        <section className="lifecycle lifecycle--shape" id="shape-flow" aria-labelledby="shape-title">
          <div className="lifecycle-heading">
            <div>
              <h2 id="shape-title">Shape work</h2>
              <p>
                Turn rough inputs into evidence-labelled, dependency-ordered
                work items. Every investment outcome remains explicit.
              </p>
            </div>
            <CommandBlock
              command={SHAPE_COMMAND}
              id="shape"
              label="Start with an opportunity"
              onCopy={onCopy}
              state={copyStates.shape ?? 'idle'}
            />
          </div>
          <FlowDiagram
            edges={shapeEdges}
            label="Shape work"
            mobileNodes={shapeMobileNodes}
            nodes={shapeNodes}
            transcript={shapeTranscript}
          />
        </section>

        <section className="lifecycle lifecycle--delivery" id="delivery-flow" aria-labelledby="delivery-title">
          <div className="lifecycle-heading">
            <div>
              <h2 id="delivery-title">Do work</h2>
              <p>
                Move one approved item through construction, independent review,
                publication, and remote feedback—stopping at the human merge and
                deploy gate.
              </p>
            </div>
            <CommandBlock
              command={DO_COMMAND}
              id="do"
              label="Start with ready work"
              onCopy={onCopy}
              state={copyStates.do ?? 'idle'}
            />
          </div>
          <FlowDiagram
            edges={deliveryEdges}
            label="Do work"
            mobileNodes={deliveryMobileNodes}
            nodes={deliveryNodes}
            transcript={deliveryTranscript}
          />
        </section>

        <section className="roles" id="roles">
          <div className="roles-copy">
            <h2>Boundaries are part of the product.</h2>
            <p>
              Agent Factory makes responsibility visible. Production code has
              one writer. Test authors stay inside tests and fixtures. Reviewers
              are constrained by their harness role and cannot waive a failed
              gate. Every material finding blocks publication.
            </p>
          </div>
          <div className="role-channels">
            {[
              ['Shape', 'research-product · challenge-product · review-work-items'],
              ['Construct', 'construct-work · single production-code writer'],
              ['Verify', 'author-tests · review-security · verify-qa'],
              ['Finish', 'review-code-quality · watch-change · human review'],
            ].map(([label, detail]) => (
              <div className="role-channel" key={label}>
                <strong>{label}</strong>
                <span>{detail}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="host-band" aria-labelledby="portable-title">
          <div>
            <h2 id="portable-title">One workflow. Three native hosts.</h2>
            <p>
              No orchestration service, database, daemon, or task-running CLI.
              Your host supplies the agents and tools; Agent Factory supplies
              the disciplined lifecycle.
            </p>
          </div>
          <ul>
            <li><span>Codex</span><small>Skills + native agents</small></li>
            <li><span>Claude Code</span><small>Skills + native agents</small></li>
            <li><span>OpenCode</span><small>Skills + native agents</small></li>
          </ul>
        </section>

        <section className="start" id="start">
          <FactoryMark size={38} />
          <h2>Install once. Keep every gate human.</h2>
          <p>
            Begin with all three host adapters, then choose the command that
            matches the maturity of your work.
          </p>
          <CommandBlock
            command={INSTALL_COMMAND}
            id="install-footer"
            label="Install Agent Factory"
            onCopy={onCopy}
            state={copyStates['install-footer'] ?? 'idle'}
          />
          <a className="back-link" href="#top">
            Back to the system
            <ArrowIcon />
          </a>
        </section>
      </main>

      <footer>
        <span>Agent Factory</span>
        <span>Human-gated from idea to handoff.</span>
      </footer>
    </div>
  )
}

export default App
