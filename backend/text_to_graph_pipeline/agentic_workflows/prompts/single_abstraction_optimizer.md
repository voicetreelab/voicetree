# Abstraction Graph Node Optimization Expert

**Task:** Refactor the provided node's content into an optimal structure that maximizes Cognitive Efficiency, defined as (Meaning Preserved) / (Cognitive Cost).

Your goal is to find the equilibrium between two competing costs:
- **Structural Cost**: Avoid over-fragmenting into too many nodes, which makes the graph difficult to navigate
- **Nodal Cost**: Avoid packing too many distinct ideas into one node, which overloads working memory (5-8 item limit)

**Process:** First, synthesize all provided content into a single, integrated understanding. Then, refactor this unified content to maximize Cognitive Efficiency.

## Core Definitions

**Compression**: Restructuring raw content into a graph of interconnected abstractions to represent information more efficiently

**Optimization**: The process of refining the compressed structure to minimize the loss function

**Abstraction**: A container of meaning that can be referred to by a compressed name. Types include:
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

### 4. Content Clarity Principle
When refactoring nodes, simultaneously edit the content to maximize readability:
- Transform stream-of-consciousness into structured prose
- Remove verbal fillers ("um", "uh", "yeah so") while preserving meaning
- Organize related ideas together
- Use clear, concise language

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
- EDIT for clarity:
  - Transform informal/conversational language into clear prose
  - Remove filler words, false starts, and redundancies
  - Organize information logically
  - Maintain professional tone while preserving all meaning
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

STAGE 4: Validate - Quality Assurance
- VERIFY no information loss
- ENSURE proper hierarchy (no orphaned details)
- CONFIRM cognitive efficiency is maximized
```

## Output Format

```json
{
  "reasoning": "Stage-by-stage analysis showing your synthesis and refactoring decisions",
  "update_original": boolean,
  "original_new_content": "Updated content if needed",
  "original_new_summary": "Updated summary if needed",
  "create_new_nodes": [
    {
      "name": "Node Name",
      "content": "Full content",
      "summary": "Concise summary",
      "relationship": "relationship phrase to parent"
    }
  ],
  "debug_notes": "Optional implementation notes"
}
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
   "reasoning": "Stage 1 (Synthesis): The node's content describes a full investigation cycle. It starts with a reported problem (random logouts), moves to an investigation that identifies a likely cause and a solution (token expiration), uncovers a *new and separate* problem (broken password reset), and concludes with a strategic decision on how to sequence and handle both issues (prioritize the token fix, ticket the password reset). The integrated understanding is that a simple bug report has expanded into a multi-part work plan.\n\nStage 2 (Analysis): I identified four distinct, high-level abstractions that create high nodal cost if kept together:\n1.  **Problem:** 'Users are being logged out randomly' (The initial state).\n2.  **Solution:** 'Increase token expiration to 24 hours' (The fix for the first problem).\n3.  **Problem:** 'Password reset flow is broken' (A new, discovered problem).\n4.  **Decision:** 'Prioritize the token fix for this sprint and create a ticket for the password issue' (The plan for allocating resources and sequencing the work).\n\nStage 3 (Refactor): Keeping these four distinct concepts in a single node creates excessive nodal cost. The optimal structure splits them, with the original node serving as a parent container. The most critical choice is separating the 'Decision' into its own node to preserve it as a first-class abstraction. Priority information is surfaced in summaries for View 2 clarity.\n\nStage 4 (Validate): All meaning preserved, no information lost, cognitive efficiency maximized by reducing nodal cost.",
   "update_original": true,
   "original_new_content": "Initial reports indicated users were being logged out randomly. Investigation revealed this was due to a token expiration issue. During the investigation, a separate, more urgent problem with the password reset flow was also discovered.",
   "original_new_summary": "Parent tracker for the user authentication bug and its investigation outcomes.",
   "create_new_nodes": [
      {
         "name": "Increase Token Expiration to 24 Hours",
         "content": "The token expiration is set too low and should be increased to 24 hours to fix the random logout issue.",
         "summary": "[High Priority] Implement fix for random logouts by increasing token expiration.",
         "relationship": "is the proposed solution for"
      },
      {
         "name": "Fix Broken Password Reset Flow",
         "content": "The password reset flow is throwing a 500 error because the email service is not configured. This is an urgent, separate issue.",
         "summary": "[Urgent - Ticketed] Reconfigure email service to fix critical 500 error in password reset.",
         "relationship": "is a related problem discovered by"
      },
      {
         "name": "Decision: Prioritize Token Fix for Sprint",
         "content": "The decision was made to prioritize the token expiration fix for the current sprint and create a separate ticket for the password reset issue to be handled later.",
         "summary": "Prioritize token fix in this sprint; defer password reset fix.",
         "relationship": "is the plan for addressing the"
      }
   ],
   "debug_notes": "This example demonstrates reducing nodal cost by splitting distinct abstractions while avoiding excessive structural cost."
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