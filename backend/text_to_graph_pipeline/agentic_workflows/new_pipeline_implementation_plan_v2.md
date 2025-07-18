# VoiceTree: New Agentic Pipeline Implementation Plan

**Version: 2.1 (Updated with Progress)**

## 1. High-Level Goal

To implement a new, two-step agentic pipeline that robustly converts raw text into an optimally structured knowledge tree. This plan replaces all previous versions and is the single source of truth for the work ahead.

**The Core Pipeline Logic:**

1.  **Placement:** A fast agent determines *where* new information belongs in the tree.
2.  **Optimization:** A slower, more thoughtful agent refactors the *structure* of the nodes that were just modified.

---

## 2. Guiding Principles for Implementation

1.  **ID-Based Operations ONLY:** All agent actions and tree modifications **MUST** use node IDs. Name-based lookups are forbidden in the agentic pipeline to ensure deterministic behavior.
2.  **Stateless Agents, Stateful Tree:** Agents are pure functions that propose actions. They do not hold state. The `DecisionTree` and `TreeActionApplier` are responsible for executing actions and managing state.
3.  **Clear, Unified Action Models:** The pipeline uses a strict set of action models (`AppendAction`, `CreateAction`, `UpdateAction`) that all inherit from a `BaseTreeAction`. No other action formats are permitted.
4.  **No Backwards Compatibility:** We are building a new system. All legacy code, models (`IntegrationDecision`), and methods (`get_node_id_from_name`) will be deleted to ensure clarity and prevent confusion.

---

## 3. Implementation Phases

We will follow a Test-Driven Development (TDD) approach. For each component, we will first write a behavioral test that defines the desired outcome, and then implement the code to make the test pass.

### **Phase 1: Pre-Flight Cleanup (Foundation) ✅ COMPLETED**

**Goal:** Create a clean, unambiguous foundation for the new agents by removing all legacy code.

1.  **✅ Simplify `TreeActionApplier`:**
    *   **File:** `backend/text_to_graph_pipeline/chunk_processing_pipeline/apply_tree_actions.py`
    *   **Action:** Made all public `apply` methods private except for one: `apply(actions: List[BaseTreeAction])`. This is now the single entry point for all tree modifications.
    *   **Status:** Complete - `apply_optimization_actions()` and `apply_mixed_actions()` are now private methods.

2.  **✅ Remove Name-Based Lookups:**
    *   **File:** `backend/text_to_graph_pipeline/tree_manager/decision_tree_ds.py`
    *   **Action:** Deleted the `get_node_id_from_name()` method entirely.
    *   **Status:** Complete - Method removed, preventing unreliable fuzzy matching.

3.  **✅ Define a Unified Action Model:**
    *   **File:** `backend/text_to_graph_pipeline/agentic_workflows/models.py`
    *   **Actions:**
        1.  ✅ `BaseTreeAction` class exists.
        2.  ✅ `CreateAction(BaseTreeAction)` with fields: `parent_node_id: Optional[int]`, `new_node_name: str`, `content: str`, `summary: str`, `relationship: str`.
        3.  ✅ `UpdateAction(BaseTreeAction)` with fields: `node_id: int`, `new_content: str`, `new_summary: str`.
        4.  ✅ `AppendAction(BaseTreeAction)` with fields: `target_node_id: int`, `content: str`.
        5.  ✅ Deleted the legacy `IntegrationDecision` model (added temporary placeholder for compatibility).
    *   **Additional:** Removed all name-based fallback logic in TreeActionApplier.

4.  **✅ Behavioral Tests:**
    *   **File:** `backend/tests/unit_tests/test_tree_actions_behavioral.py`
    *   **Status:** Created comprehensive behavioral tests that verify ID-only operations work correctly.
    *   **Result:** All 16 tests passing.

### **Phase 2: Agent Implementation (TDD)**

#### **Step 2.1: Implement `AppendToRelevantNodeAgent`**

**Goal:** An agent that takes raw text and produces a placement plan (list of `AppendAction` or `CreateAction`).

**Important Clarification:** The agent outputs `TargetNodeIdentification` objects from the LLM prompt. A deterministic translation layer in the agent's Python code converts these to actions:
- `target_node_id` exists → `AppendAction`
- `target_node_id` is null → `CreateAction`

1.  **Write the Test First:**
    *   **File:** `backend/tests/integration_tests/agentic_workflows/AppendToRelevantNodeAgent/testAppendtoRelevantNodeAgent.py`
    *   **Action:** Implement the behavioral tests. The test will call the agent with mock text and a mock tree state and assert that the output is the correct list of `AppendAction` or `CreateAction` objects. **This test will fail initially.**

2.  **Implement the Agent:**
    *   **File:** `backend/text_to_graph_pipeline/agentic_workflows/agents/append_to_relevant_node_agent.py`
    *   **Action:** Implement the agent's `.run()` method. It will have a simple dataflow:
        1.  Call the `segmentation.md` prompt.
        2.  Call the `identify_target_node.md` prompt (which now outputs `TargetNodeIdentification` with IDs).
        3.  **Translation Layer (deterministic):** Loop through the `TargetNodeResponse`:
            ```python
            for decision in target_node_response.target_nodes:
                if decision.target_node_id is not None:
                    actions.append(AppendAction(
                        action="APPEND",
                        target_node_id=decision.target_node_id,
                        content=decision.text
                    ))
                else:
                    actions.append(CreateAction(
                        action="CREATE",
                        parent_node_id=None,  # Or determine from context
                        new_node_name=decision.new_node_name,
                        content=decision.text,
                        summary=f"Summary for {decision.new_node_name}",
                        relationship="subtopic of"
                    ))
            ```
        4.  Return the final list of actions.

#### **Step 2.2: Implement `SingleAbstractionOptimizerAgent`**

**Goal:** An agent that takes a `node_id` and produces a refactoring plan (`UpdateAction` or `CreateAction`).

1.  **Write the Test First:**
    *   **File:** `backend/tests/integration_tests/agentic_workflows/SingleAbstractionOptimizerAgent/testSingleAbstractionOptimizerAgent.py`
    *   **Action:** Implement the behavioral tests from the outline. The test will call the agent with a specific `node_id` and mock tree state, then assert that the output is the correct list of refactoring actions (e.g., a split operation). **This test will fail initially.**

2.  **Implement the Agent:**
    *   **File:** `backend/text_to_graph_pipeline/agentic_workflows/agents/single_abstraction_optimizer_agent.py`
    *   **Action:** Implement the agent's `.run()` method with this simple dataflow:
        1.  Take `node_id` as input.
        2.  Use the `node_id` to get the node's content and neighbors from the `DecisionTree`.
        3.  Call the `single_abstraction_optimizer.md` prompt with this context.
        4.  Return the resulting `OptimizationResponse` which contains the list of actions.

#### **Step 2.3: Implement `TreeActionDeciderAgent` (The Wrapper)**

**Goal:** A coordinator agent that orchestrates the full placement and optimization flow.

1.  **Write the Test First:**
    *   **File:** `backend/tests/integration_tests/agentic_workflows/tree_action_decider/test_tree_action_decider.py`
    *   **Action:** Implement the end-to-end behavioral tests from the outline. This is the most critical test. It will mock the `DecisionTree` and `TreeActionApplier` to verify the logic of the `TreeActionDeciderAgent` in isolation.

2.  **Implement the Agent:**
    *   **File:** `backend/text_to_graph_pipeline/agentic_workflows/agents/tree_action_decider_agent.py`
    *   **Action:** Implement the agent's `.run()` method to follow this precise algorithm:
        1.  **INPUT:** The agent receives `raw_text` and the `DecisionTree` instance.
        2.  **STEP 1: GET PLACEMENT PLAN.** Run `AppendToRelevantNodeAgent` to get a list of initial actions (`placement_actions`).
        3.  **STEP 2: EXECUTE PLACEMENT.** Instantiate `TreeActionApplier(decision_tree)` and call `applier.apply(placement_actions)`. Capture the returned `modified_node_ids`.
        4.  **STEP 3: GET OPTIMIZATION PLAN.** Initialize an empty list: `final_refactoring_actions = []`. Loop through each `node_id` in `modified_node_ids`:
            *   Run `SingleAbstractionOptimizerAgent` with the `node_id`.
            *   Extend `final_refactoring_actions` with the actions returned by the optimizer.
        5.  **OUTPUT:** Return the `final_refactoring_actions` list.

---

### **Phase 3: Final System Integration**

**Goal:** Connect the fully-functional `TreeActionDeciderAgent` to the application's main processing loop.

1.  **Update `ChunkProcessor`:**
    *   **File:** `backend/text_to_graph_pipeline/chunk_processing_pipeline/chunk_processor.py`
    *   **Action:** Modify the `ChunkProcessor` to call the new `TreeActionDeciderAgent`. It will receive two lists of actions (placement and optimization) or a single final list, depending on the `TreeActionDecider`'s final design. It will use the `TreeActionApplier` to execute these plans against the tree and then trigger the markdown update.

2.  **Update and Run Full E2E Test:**
    *   **File:** `backend/tests/integration_tests/chunk_processing_pipeline/test_pipeline_e2e_with_di.py`
    *   **Action:** Update the `MockVoiceTreeAgent` to simulate the new two-step behavior. It should first produce placement actions, and then, based on which nodes were "modified," produce refactoring actions. This test validates the entire system, from text input to final file output.

---

## 4. Implementation Progress Summary

### **Phase 1: ✅ COMPLETED (2024-01-XX)**
- Removed all legacy code and name-based operations
- Created unified action model with `AppendAction`, `CreateAction`, `UpdateAction`
- Simplified TreeActionApplier to single `apply()` method
- Created comprehensive behavioral tests
- **Key Achievement:** System now operates purely on node IDs, ensuring deterministic behavior

### **Phase 2: 🔄 IN PROGRESS (2025-07-18)**

#### **Completed:**
- ✅ Created state schemas for new agents (`AppendToRelevantNodeAgentState`, `SingleAbstractionOptimizerAgentState`)
- ✅ Implemented `AppendToRelevantNodeAgent` class with two-prompt workflow
- ✅ Created comprehensive test suite for `AppendToRelevantNodeAgent`
- ✅ Updated LLM integration to support dynamic schema mapping
- ✅ Created detailed TDD implementation plan (`phase2_tdd_implementation_plan.md`)

#### **Current Challenges:**
1. **LLM Response Parsing:** The segmentation stage is not producing chunks, resulting in empty segments for target identification
2. **State Flow:** Need to debug the transform function between segmentation and identify_target stages
3. **Schema Registration:** Had to update `llm_integration.py` to support new stage types dynamically

#### **Next Steps:**
1. Debug why segmentation is returning no chunks (investigate prompt rendering)
2. Fix the data flow between workflow stages
3. Complete testing of `AppendToRelevantNodeAgent` with real LLM calls
4. Implement `SingleAbstractionOptimizerAgent` following TDD
5. Implement `TreeActionDeciderAgent` orchestrator

### **Phase 3: 📋 PENDING**
- System integration and E2E testing
- Update `ChunkProcessor` to use new agent
- Update E2E tests for two-step behavior

### **Key Architectural Decisions:**
1. **Three Clean Action Types:** `AppendAction` (add to existing), `CreateAction` (new node), `UpdateAction` (modify)
2. **Translation Layer:** Deterministic Python code converts LLM output (`TargetNodeIdentification`) to final actions (`AppendAction` or `CreateAction`)
3. **ID-Only Operations:** No fuzzy name matching, all operations use exact node IDs
4. **Single Interface:** TreeActionApplier exposes only `apply(actions: List[BaseTreeAction])`

**Note:** `TargetNodeIdentification` is an intermediate data structure output by the LLM. It is NOT a final action type. The agent's Python code translates it to `AppendAction` or `CreateAction`.