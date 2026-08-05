# Product shaping lifecycle

## Control loop

```mermaid
flowchart LR
  A[Input of any maturity] --> B[Normalize and classify]
  B --> C[Frame outcome and users]
  C --> D[Research and independent challenge]
  D --> E[Map opportunities and assumptions]
  E --> F{Investment gate}
  F -->|experiment| G[Learning item]
  G --> D
  F -->|reframe| C
  F -->|park| Z[Decision record]
  F -->|advance| H[Slice outcomes]
  F -->|phase gate| P[Approval or traceability artifact]
  P --> F
  H --> I[Independent readiness review]
  I --> J{Human approves items?}
  J -->|revise| H
  J -->|yes| K[Copy-ready items or authorized issue creation]
  K --> L[One item at a time to do-work]
```

## Agent topology

The parent owns context, synthesis, methodology choice, gates, and user interaction. `research-product` gathers evidence; `challenge-product` seeks disconfirming evidence and alternatives; `review-work-items` checks the final set. Specialists are read-only, cannot spawn agents, and return advice rather than decisions.

Run research and challenge in parallel only when their questions are independent. Never parallelize competing conversations with the human. The human owns product intent, investment decisions, external research approval, item publication, and the choice to begin delivery.

## Evidence rules

Use this hierarchy without confusing authority with relevance:

1. observed user behavior and direct research;
2. product analytics, support data, and operational evidence;
3. experiments with predefined thresholds;
4. domain and market sources;
5. stakeholder statements;
6. agent inference.

For every material claim record `source`, `date`, `population/context`, `confidence`, and `implication`. Mark absence of evidence. Separate facts, interpretations, assumptions, and decisions. A polished PRD can still contain unvalidated assumptions; a rough idea can sometimes rest on strong evidence.

## Exit criteria

Shaping is complete only when the human has approved a disposition and, for `advance`, every selected item passes the work-item contract. Completion means ready for deeper repository-specific grilling by `do-work`, not implementation approval.
