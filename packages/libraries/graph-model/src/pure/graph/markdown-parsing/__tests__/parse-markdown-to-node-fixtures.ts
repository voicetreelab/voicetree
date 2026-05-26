// Inlined fixture content for parse-markdown-to-node.test.ts (previously
// loose .md files; `.gitignore:**/*.md` excludes them globally so they
// never reached CI). Lives under `__tests__/` so `import-graph.ts`
// excludes it from production source discovery.

export const appendAgentExtractionAnalysisContent: string = `---
color: orange
position:
  x: -9.184850993605149e-14
  y: -500
isContextNode: false
node_id: 141
agent_name: Victor
---
part of [[27_Two_Streams_of_Work]]

** Summary**
Analyzed the AppendToRelevantNodeAgent for Cloud Run Function extraction. The agent is **already stateless and well-architected** for serverless deployment - no refactoring required, only packaging needed.

** Technical Details**

** Files Analyzed**
- **Workflow File**: \`backend/text_to_graph_pipeline/chunk_processing_pipeline/tree_action_decider_workflow.py:198\`

-----------------
_Links:_
Parent:
- is_progress_of [[2025-09-30/14_Assign_Agent_to_Identify_Boundaries.md]]
[[27_Two_Streams_of_Work.md]]`

export const immediateTestObservationContent: string = `---
position:
  x: 3.061616997868383e-14
  y: 500
isContextNode: false
node_id: 5
---
### Speaker observes no output despite repeated speech input during an immediate test.

All right, so I'm testing 'one, two, three'. I don't see anything.

-----------------
_Links:_
Parent:
- is_an_immediate_observation_during [[4_Test_Outcome_No_Output.md]]

[[ctx-nodes/5_Immediate_Test_Observation_No_Output.md_context_1764570013191.md]]`
