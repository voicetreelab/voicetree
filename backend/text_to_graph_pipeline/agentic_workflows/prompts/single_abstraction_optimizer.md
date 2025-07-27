# Abstraction Graph Node Optimization Expert

**Task:** Refactor the provided node's content into an optimal structure that maximizes Cognitive Efficiency, defined as (Meaning Preserved) / (Cognitive Cost).

Your goal is to find the equilibrium between two competing costs:
- **Structural Cost**: Avoid over-fragmenting into too many nodes, which makes the graph difficult to navigate
- **Nodal Cost**: Avoid packing too many distinct ideas into one node, which overloads working memory (5-8 item limit)

**Process:** First, synthesize all provided content into a single, integrated understanding. Then, refactor this unified content to maximize Cognitive Efficiency.

## Core Definitions

**Compression**: Restructuring raw content into a graph of interconnected abstractions to represent information more efficiently

**Optimization**: The process of refining the compressed structure to minimize the loss function

**Abstraction**: A container of meaning that can be referred to by a compressed name. Types include, but are not limited to:
- **Task**: A specific action to be done
- **Decision**: A choice to be made
- **Problem**: An obstacle or challenge
- **Question**: A query needing an answer
- **Solution**: A potential answer to a Problem or Question
- **Insight**: A conclusion, realization, or guiding principle
- **Observation**: A piece of factual or contextual information
- **Function**: Anything which, given an input, returns an output describable by a name

## The Three-Layer View System

1. **View 1 (Graph View)**: Node names and relationships only
2. **View 2 (Graph + Summaries)**: Above plus node summaries
3. **View 3 (Node View)**: Above plus full node content

We optimize so humans can understand content at View 1 with minimal cognitive computation.

## Fundamental Principles

### 1. Cognitive Alignment Principle
Nodes should represent the same cognitive items humans use in problem-solving. Humans can only hold 5-8 items in working memory, so nodes should respect this constraint. This creates the fundamental tension:
- **Single mega-node**: Minimum structural cost but maximum nodal cost
- **Maximum fragmentation**: Minimum nodal cost but maximum structural cost

### 2. Entity-Attribute Cohesion Principle
Content is semantically bound to its parent when its primary information value is explaining, qualifying, or operationalizing the parent concept. When content C's primary cognitive function is to modify our understanding of P (rather than introduce a new, independent concept), then C and P form a single schema.

**The Litmus Test**: "If the core entity of this node were erased, would this piece of content become orphaned, meaningless, or lose its fundamental purpose?"
- If YES → Dependent attribute (ABSORB)
- If NO → Independent entity (CONSIDER SPLIT)

**Practical Example**: Ask yourself - *"Is this new item a major project component that could have its own checklist, or is it a single line item on the parent's checklist?"*

**Example Schema for "Problem" abstraction**:
```
Problem: {
  description: "what is wrong"
  symptoms: "how it manifests" 
  impact: "why it matters"
  constraints: "what limits solutions"
}
```
Content filling these expected slots stays with the parent.

### 3. Abstraction Level Principle
Zoom to the conceptual level where cognitive efficiency is maximized. Think of it like image compression - we replace detailed objects with symbolic representations that preserve essential meaning.

### 4. Content Refactoring & Rewriting
When refactoring nodes, simultaneously refactor the content to maximize readability:
- Transform stream-of-consciousness into structured concise markdown / bullet point style notes, WITHOUT changing individual phrases significantly. Specific words should be kept the same.
  - You can andd should however, modify the flow, and order of phrases, reorganizing for readability. 
  - perform light editing for the restructured content to be easily readable, whilst maintaining similar language compared to the original text.
  - Remove verbal fillers ("um/uh", "yeah so", "you know"") if they are not part of the meaning

## Decision Algorithm

```
ALGORITHM: ShouldSplit(content_piece, parent_node, neighbors)

1. APPLY Entity-Attribute Test:
   IF content fills expected slot in parent's schema: ABSORB
   
2. APPLY Single Responsibility Test:
   IF cannot describe purpose in one sentence (≤15 words): SPLIT

3. APPLY Cohesion Test:  
   IF separating makes either part incomplete: ABSORB

4. APPLY Naming Test:
   IF cannot create clear name beyond concatenating sentences: ABSORB

5. APPLY Neighbor Deduplication:
   IF concept exists in neighbors: REFERENCE (not split)

6. APPLY State Change Test:
   IF represents major cognitive transition: SPLIT

7. APPLY Reachability Test:
   IF has potential for multiple incoming edges: SPLIT

RETURN split_decision
```

## Process Workflow

### INPUT:
- Node Name: {{node_name}}
- Node Summary: {{node_summary}}
- Node Content: {{node_content}}
- Neighbors: {{neighbors}}

**Important Context**: The node contains two parts: *existing well-integrated content* | *recently appended raw content*. The summary may not yet reflect the appended content.

### ALGORITHM: OptimizeNode(node, neighbors)

```
STAGE 1: Synthesize - Deep Contextual Understanding
- PARSE node into: existing_content | appended_raw_content
- INTEGRATE the appended raw content into the node
- SAVE as overall_integrated_content

STAGE 2: Analyze - Abstraction Identification  
- EXTRACT core_content (details about the parent abstraction)
- IDENTIFY abstraction_candidates using Decision Algorithm
- FOR EACH candidate:
  - DETERMINE abstraction_type
  - CONSIDER grouping into higher-level abstractions

STAGE 3: Refactor - Structure Optimization
- FOR EACH abstraction_candidate:
  - IF neighbor exists: REFERENCE in content
  - ELSE: CREATE new_node
- DEFINE relationships using fill-in-the-blank:
  "[new Node Name] ______ [Parent Node Name]" (max 7 words)
- IF no changes needed: update_original=false, create_new_nodes=[]

Stage 4: EDIT for readability & conciseness:
  - Transform informal/conversational language into clear prose
  - Remove filler words, false starts, and redundancies
  - Organize information logically
  - Maintain professional tone while preserving all meaning

STAGE 4: Validate - Quality Assurance
- VERIFY no information loss
- ENSURE proper hierarchy (no orphaned details)
- CONFIRM cognitive efficiency is maximized
```

## Examples

### Example 1: Multiple Abstractions Require Splitting (High Nodal Cost)

**Input:**
```json
{
  "node_name": "User Authentication Bug",
  "node_summary": "Users are being logged out randomly, especially on mobile.",
  "node_content": "Users are reporting that they are getting logged out randomly, especially on mobile. We suspect it's a token refresh issue. \n...yeah so okay, I looked into it and it seems like the token expiration is set way too low, we should probably increase that to 24 hours. That's an easy fix. Uhm, but also, while I was in there, I noticed the password reset flow is completely broken, it's throwing a 500 error because the email service isn't configured. That's a separate, more urgent problem. So yeah, let's make the token fix the priority for this sprint and create a new ticket for the password reset."
}
```

**Correct Output:**
```json
{
  "reasoning": "### STAGE 1: Synthesize\nThe initial node describes a user authentication bug (random logouts). The appended content adds two key pieces of information: 1) A diagnosis and proposed solution for the original bug (low token expiration, increase to 24h). 2) The discovery of a completely separate and more urgent problem: a broken password reset flow. The speaker explicitly identifies this as a 'separate problem' and suggests a 'new ticket', which are strong signals for splitting.\n\n### STAGE 2: Analyze\n- **Token Fix:** This content (diagnosis and solution) is the direct resolution to the parent problem. Per the Entity-Attribute Cohesion Principle, a solution is a core attribute of a problem schema. It fills an expected slot ('how do we fix this?'). Therefore, it should be absorbed into the parent node to keep the Problem-Solution pair cohesive.\n- **Password Reset Issue:** This content describes a different user-facing problem. Applying the Decision Algorithm:\n    - **Entity-Attribute Test**: Fails. A broken password reset does not explain or qualify random logouts. Suggests SPLIT.\n    - **Single Responsibility Test**: Passes. The purpose is 'describe the password reset bug'. Suggests SPLIT.\n    - **Cohesion Test**: Passes. Separating this does not make the original node incomplete. Suggests SPLIT.\n    - **Naming Test**: Passes. A clear name like 'Broken Password Reset Flow' is easily derived. Suggests SPLIT.\nAll tests point to creating a new node for this distinct problem.\n\n### STAGE 3: Refactor\nThe optimal structure is to:\n1.  **Update the original node** to incorporate the diagnosis and solution for the authentication bug, making it a complete problem-solution unit.\n2.  **Create a new 'Problem' node** for the password reset issue, as it's a distinct, independent problem.\n3.  **Define the relationship** to show the context of discovery: the new problem was found *while investigating* the original one.\n\n### STAGE 4: Edit\nThe content for both nodes will be rewritten from the conversational stream-of-consciousness into a structured format using clear headings (Problem, Investigation, Solution, etc.) to improve readability and reduce cognitive load, while preserving all key information and original phrasing where possible.",
  "update_original": true,
  "original_new_content": "### Problem\nUsers are reporting that they are getting logged out randomly, particularly on mobile devices.\n\n### Investigation\n- It is suspected to be a token refresh issue.\n- The token expiration is set too low.\n\n### Proposed Solution\n- Increase the token expiration time to 24 hours.\n- This is an easy fix and should be prioritized for the current sprint.",
  "original_new_summary": "Users are being logged out randomly due to a low token expiration setting. The proposed fix is to increase the expiration time to 24 hours.",
  "create_new_nodes": [
    {
      "name": "Broken Password Reset Flow",
      "content": "### Problem\nThe password reset flow is completely broken and is throwing a 500 error.\n\n### Cause\nThe email service required for the flow is not configured.\n\n### Context & Urgency\n- This issue was discovered during the investigation of the user authentication bug.\n- It is a separate and more urgent problem.\n\n### Action\nA new ticket should be created to address this.",
      "summary": "The password reset flow is throwing a 500 error because the required email service is not configured. This is an urgent, separate issue.",
      "relationship": "was discovered during investigation of"
    }
  ],
  "debug_notes": "The key insight was the speaker's own language ('separate... problem', 'new ticket'), which made the decision to split very clear. The original node becomes a tight, cohesive unit of Problem->Cause->Solution, while the new node captures the second distinct problem."
}
```

### Example 2: Absorb + Reference to Minimize Structural Cost

**Input:**
```json
{
  "node_name": "Homepage CTA Design",
  "node_summary": "Design a primary Call-to-Action for the homepage.",
  "node_content": "We need a primary CTA on the homepage to guide users to sign up. It should be prominent. \n...and speaking of the CTA, I was thinking it should be a bright orange button, hex code #FF5733, to contrast with our blue background. The copy should be 'Start Your Free Trial' not 'Sign Up Now', it feels less committal. I saw a study that showed this kind of wording increases conversion by like, 15%. So it's a solid, data-backed choice. Also, we should run A/B tests on different CTA variations to validate our design choices and optimize conversion rates.",
  "neighbors": "[{'name': 'A/B Test CTA Variations', 'summary': 'Set up and run A/B tests to optimize CTA performance across different design variations.', 'relationship': 'validates the effectiveness of'}]"
}
```

**Correct Output:**
```json
{
  "reasoning": "Stage 1 (Synthesis): The initial node established the need for a prominent homepage CTA. The new content provides specific implementation details (color, copy, justification) and mentions A/B testing for validation. The integrated understanding includes both the design specification and the testing strategy.\n\nStage 2 (Analysis): I identified two potential abstractions:\n1. **Task**: 'Design the Homepage CTA' - The core design work with specific color, copy, and rationale\n2. **Task**: 'Run A/B tests on CTA variations' - Testing strategy to validate design choices\n\nStage 3 (Refactor): The design details (color, copy, justification) are attributes of the design task and should be absorbed to avoid structural cost. The A/B testing concept already exists as a neighbor node. Creating a new node would increase structural cost through duplication. Instead, I reference the existing neighbor in the content.\n\nStage 4 (Validate): Cognitive efficiency maximized by minimizing structural cost while preserving all meaning through absorption and reference.",
  "update_original": true,
  "original_new_content": "We need a primary CTA on the homepage to guide users to sign up. It must be prominent. The proposed design is a bright orange button (hex #FF5733) to provide strong contrast against the site's blue background. The button copy should be 'Start Your Free Trial', as this wording feels less committal and is backed by data showing a potential 15% conversion increase. The design choices will be validated through A/B testing as outlined in the existing testing plan.",
  "original_new_summary": "Design a prominent, orange CTA button with the copy 'Start Your Free Trial', validated through A/B testing.",
  "create_new_nodes": [],
  "debug_notes": "This demonstrates minimizing structural cost through absorption and neighbor referencing."
}
```