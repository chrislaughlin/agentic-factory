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
import loomDesktop from './assets/vertical-loom-desktop.webp'
import loomMobile from './assets/vertical-loom-mobile.webp'
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

function CordMark({ size = 28 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      className="cord-mark"
      height={size}
      viewBox="0 0 32 32"
      width={size}
    >
      <path d="M5 7l22 18M27 7L5 25M8 4l20 16M24 4L4 20" />
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="26" cy="6" r="2.5" />
      <circle cx="6" cy="26" r="2.5" />
      <circle cx="26" cy="26" r="2.5" />
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
      <span className="route-node__eyelet" aria-hidden="true" />
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
    position: { x: 240, y: 210 },
    data: {
      label: 'shape-work',
      detail: 'Discover, frame, and slice',
      kind: 'specialist',
    },
  },
  {
    id: 'investment',
    type: 'route',
    position: { x: 480, y: 210 },
    data: { label: 'Investment gate', detail: 'Human decision', kind: 'gate' },
  },
  {
    id: 'learning',
    type: 'route',
    position: { x: 740, y: 0 },
    data: { label: 'Learning item', detail: 'Evidence returns to shaping' },
  },
  {
    id: 'reframe',
    type: 'route',
    position: { x: 740, y: 140 },
    data: { label: 'Reframe', detail: 'Change the problem or opportunity' },
  },
  {
    id: 'park',
    type: 'route',
    position: { x: 740, y: 280 },
    data: { label: 'Park', detail: 'Stop investment deliberately' },
  },
  {
    id: 'decision',
    type: 'route',
    position: { x: 1000, y: 280 },
    data: { label: 'Decision record', detail: 'Preserve why work stopped', kind: 'terminal' },
  },
  {
    id: 'advance',
    type: 'route',
    position: { x: 740, y: 420 },
    data: { label: 'Advance', detail: 'Move grounded work forward' },
  },
  {
    id: 'review',
    type: 'route',
    position: { x: 1000, y: 420 },
    data: { label: 'Review and approve', detail: 'Human work-item gate', kind: 'human' },
  },
  {
    id: 'backlog',
    type: 'route',
    position: { x: 1260, y: 420 },
    data: { label: 'Ready work items / backlog', detail: 'Human selects when delivery begins', kind: 'terminal' },
  },
]

const shapeEdges: Edge[] = [
  edge('s1', 'input', 'shape'),
  edge('s2', 'shape', 'investment'),
  edge('s3', 'investment', 'learning', 'experiment'),
  edge('s5', 'learning', 'shape', 'new evidence', true),
  edge('s6', 'investment', 'reframe', 'reframe'),
  edge('s7', 'reframe', 'shape', 'reshape', true),
  edge('s8', 'investment', 'park', 'park'),
  edge('s9', 'park', 'decision'),
  edge('s10', 'investment', 'advance', 'advance'),
  edge('s11', 'advance', 'review'),
  edge('s12', 'review', 'backlog'),
]

const positionNodes = (
  nodes: Node[],
  positions: Record<string, { x: number; y: number }>,
) => nodes.map((node) => ({ ...node, position: positions[node.id] ?? node.position }))

const shapeMobileNodes = positionNodes(shapeNodes, {
  input: { x: 120, y: 0 },
  shape: { x: 120, y: 130 },
  investment: { x: 120, y: 260 },
  learning: { x: 0, y: 420 },
  reframe: { x: 240, y: 420 },
  park: { x: 0, y: 570 },
  advance: { x: 240, y: 570 },
  decision: { x: 0, y: 720 },
  review: { x: 240, y: 720 },
  backlog: { x: 240, y: 870 },
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
    position: { x: 220, y: 250 },
    data: { label: 'do-work', detail: 'Inspect, grill, and plan', kind: 'specialist' },
  },
  {
    id: 'approval',
    type: 'route',
    position: { x: 440, y: 250 },
    data: { label: 'Explicit plan approval', detail: 'No code changes before this gate', kind: 'gate' },
  },
  {
    id: 'construct',
    type: 'route',
    position: { x: 660, y: 250 },
    data: { label: 'construct-work', detail: 'Single production-code writer', kind: 'specialist' },
  },
  {
    id: 'security',
    type: 'route',
    position: { x: 900, y: 80 },
    data: { label: 'review-security', detail: 'Read-only review at pinned SHA', kind: 'specialist' },
  },
  {
    id: 'tests',
    type: 'route',
    position: { x: 900, y: 420 },
    data: { label: 'author-tests', detail: 'Tests and fixtures only', kind: 'specialist' },
  },
  {
    id: 'qa',
    type: 'route',
    position: { x: 1130, y: 250 },
    data: { label: 'verify-qa', detail: 'Runtime acceptance evidence', kind: 'specialist' },
  },
  {
    id: 'quality',
    type: 'route',
    position: { x: 1360, y: 250 },
    data: { label: 'review-code-quality', detail: 'Strict structural and specification gate', kind: 'specialist' },
  },
  {
    id: 'pr',
    type: 'route',
    position: { x: 1360, y: 520 },
    data: { label: 'Ready PR / MR', detail: 'Created only after every local gate passes', kind: 'terminal' },
  },
  {
    id: 'watch',
    type: 'route',
    position: { x: 1590, y: 520 },
    data: { label: 'watch-change', detail: 'Monitor CI and review feedback', kind: 'specialist' },
  },
  {
    id: 'human-review',
    type: 'route',
    position: { x: 1820, y: 520 },
    data: { label: 'Human review gate', detail: 'Green and settled', kind: 'human' },
  },
  {
    id: 'merge',
    type: 'route',
    position: { x: 2050, y: 520 },
    data: { label: 'Human merges and deploys', detail: 'Agent Factory stops here', kind: 'terminal' },
  },
]

const deliveryEdges: Edge[] = [
  edge('d1', 'select', 'do-work'),
  edge('d2', 'do-work', 'approval', 'explicit approval'),
  edge('d3', 'approval', 'construct'),
  edge('d4', 'construct', 'security'),
  edge('d5', 'construct', 'tests'),
  edge('d6', 'security', 'qa'),
  edge('d7', 'tests', 'qa'),
  edge('d8', 'qa', 'quality'),
  edge('d9', 'quality', 'construct', 'validated finding', true),
  edge('d10', 'quality', 'pr', 'all local gates pass'),
  edge('d11', 'pr', 'watch'),
  edge('d12', 'watch', 'construct', 'CI failure / requested changes', true),
  edge('d13', 'watch', 'human-review', 'green and settled'),
  edge('d14', 'human-review', 'merge'),
]

const deliveryMobileNodes = positionNodes(deliveryNodes, {
  select: { x: 120, y: 0 },
  'do-work': { x: 120, y: 130 },
  approval: { x: 120, y: 260 },
  construct: { x: 120, y: 390 },
  security: { x: 0, y: 550 },
  tests: { x: 240, y: 550 },
  qa: { x: 120, y: 720 },
  quality: { x: 120, y: 850 },
  pr: { x: 120, y: 980 },
  watch: { x: 120, y: 1110 },
  'human-review': { x: 120, y: 1240 },
  merge: { x: 120, y: 1370 },
})

const shapeTranscript = [
  'Start with an idea, evidence, research, or a PRD.',
  'shape-work discovers, frames, and slices the opportunity.',
  'At the investment gate, a human chooses experiment, reframe, park, or advance.',
  'Experiment creates a learning item that returns evidence to shape-work.',
  'Reframe returns the changed problem to shape-work.',
  'Park ends in a durable decision record.',
  'Advance moves to human review and approval of the work items.',
  'Approved items enter the ready backlog and wait for deliberate human selection.',
]

const deliveryTranscript = [
  'A human selects one ready work reference.',
  'do-work inspects the repository, grills the task, and produces a decision-complete plan.',
  'Production changes wait for explicit human plan approval.',
  'construct-work is the single production-code writer.',
  'Security reviews the pinned construction SHA while tests and fixtures are authored in parallel.',
  'verify-qa joins both paths and requires runtime acceptance evidence.',
  'review-code-quality runs the final strict local gate.',
  'Validated findings return to construct-work for remediation.',
  'When every local gate passes, Agent Factory creates a ready PR or MR.',
  'watch-change monitors CI and requested review changes.',
  'CI failures or legitimate requested changes return to construct-work.',
  'When the change is green and settled, it reaches the human review gate.',
  'Only a human merges and deploys; Agent Factory stops at that boundary.',
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
        <span className="command-eyelet" aria-hidden="true" />
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
          <CordMark />
          <span>Agent Factory</span>
        </a>
        <nav aria-label="Primary navigation">
          <a href="#system">System</a>
          <a href="#flows">Flows</a>
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
            <CordMark size={34} />
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
            <picture className="loom-material" aria-hidden="true">
              <source media="(max-width: 700px)" srcSet={loomMobile} />
              <img alt="" src={loomDesktop} />
            </picture>
            <div className="loom-hosts" aria-label="Supported hosts">
              {['Codex', 'Claude Code', 'OpenCode'].map((host) => (
                <div className="host-pocket" key={host}>
                  <span>{host}</span>
                  <i aria-hidden="true" />
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
                  <span className="stage-eyelet" aria-hidden="true" />
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
              remain read-only. Every material finding blocks publication.
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
                <span className="role-eyelet" aria-hidden="true" />
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
          <CordMark size={38} />
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
