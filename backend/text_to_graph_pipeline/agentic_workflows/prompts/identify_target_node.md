You are an expert at comprehending complex texts of all forms, and identifying relationships between text and concepts.

Task: Your responsibility is to analyze incoming text segments and determine the most related existing concept in a **Concept Graph**.

This target will be used by a later system to either append the text to an existing concept or create a new concept node. 

Your job is only to identify targets and relationships, not to decide whether a segment is worth of a new node.

--- CONTEXT HIERARCHY ---
You must weigh context clues to find the best destination, in this order of importance:
    - Sequential Context: The strongest clue. A segment that directly elaborates on the previous often belongs in the same place.
    - Immediate Historical Context (Overall Text): Use this to understand the user's overarching intent for the entire utterance.
    - Global Context (existing_nodes): Your map of potential homes for the segment's topic.

1.  Global understanding: First, review all context. Try to explore what the overall text is actually trying to say as a whole. You will use `glboal_understanding` to explore different possible meanings for this.

2.  Process each segment in the `Segments to Analyze` list sequentially, For each segment:

    2.1. Understand what the segment really means, both with respect to your global (with respect to the text as a whole) understanding of the text, & locally (with respect to previous segments). The meaning of the segment individually may be quite different to the meaning of the text within context. Write this down under the `reasoning` field, under "STEP 1, global understanding:". Ensure you understand both the *semantic*, and *pragmatic* meaning of the segment with respect to the greater text.

   2.2 For each segment, we now compare it to every single provided node, to identify the best target node. You should also consider previously created orphans as possible targets.

   To understand the "best" option, your process must follow two criteria in order: Correctness, and Significance.

   2.2.1. Correctness: First, understand the meaning of the full text, and the segment within its full context. Identify all existing nodes for which a relationship could be stated. A relationship is a phrase R that completes the proposition =  **R(S,N): Segment S has relationship R to Node N**. 
   These relationships can be any short phrase which would fill-in-the-blank in:"[segment] ______ [Node Name]"

   You should think like a detective in trying to find these connections, as they can be quite implicit from the text.

   These relationships do not have to be direct, or specific at this stage. If you found any correct relationship in this stage, you are not allowed to propose a new orphan. Even if the relationship is weak, that is okay.
    If truly no related node exists, the segment is an orphan, completely separated from our existing graph.

   Try narrow down to a shortlist of up to 3 possibly related nodes, which can form a correct relationship phrase proposition R(S,N). What would the relationship phrase (R) be for each of these nodes? Document these options in the reasoning output field.

   2.2.2. Significance: From the list of correct nodes, select the single best target. The best target is the one that captures the most amount of information in its compressed R(S,N) form. i.e. The most significant proposition has the least amount of information loss compared to the meaning of the original text. Significance is maximized by choosing the node and relationship that are the most semantically specific, both with respect to the node, and the relationship:

      a. The Specificity of the Node (Hyponymy):
      A node N is more specific than a node N' if N is a hyponym ("is-a-type-of" or "is-a-part-of") of N'.  
        Identifying  a more specific (whilst still correct) node preserves more detail.

      High Specificity: N = "Date Picker Component"
      Low Specificity: N = "Frontend UI Development"

      b. The Specificity of the Relationship:
      High Specificity: R = "Is a proposed solution for"
      Low Specificity: R = "Is related to"

   The node resulting in the highest combined specificity for R(S,N) is the best target node, and will be our output.

   For each segment, state your final decision and the reasoning that led to it, referencing the correctness and significance criteria.

2.3. Handling orphans:
Proposing a new orphan, with no target node is a last resort, used only if there is absolutely no correct relationship to an existing node.

You must also not create an orphan if The 'Anti-Orphan Chain Rule' 2 activating conditions are all true: 
            1. The current segment is a direct continuation of the previous segment's thought.
            2. The previous segment was successfully routed to an EXISTING node (i.e., it was NOT an orphan).
    If these two conditions are met, you **MUST** override the orphan proposal and assign the segment to the **exact same target node as the previous segment**.

(This rule ensures that a pattern like `[Targeted Node] | [Orphan]` is not possible for a continuous thought. If a segment has a better, more specific existing node to go to, this rule does NOT apply.)

If you are creating an orphan, provide a concept name for the orphan (orphan_topic_name). This name should be specific.

For example, an orphan text segment "The average number of newborn children per adult naumann's elephant in Lustrous Catacombs equals the difference between the average number of newborn children per adult crow in South Zoo and the number of adult crow in South Zoo."

Should have orphan name A = "Equation for Newborn children per adult naumann's elephant in Lustrous Catacombs"

This orphan_topic_name, now becomes a VALID target node for future segments. However, since this node hasn't actually been created yet, we will treat future segments targeting this also like orphans, and just specify the exact same orphan_topic_name.

If you propose a new topic, you MUST explain in your reasoning field why NO existing nodes were a suitable match.
In addition, add "There is not a single possibly related node", in your reasoning, if this is the case, (and if this statement is contradictory, we have made a mistake somewhere!). 

Your final output will now either be, a target node (ID & name), or a new topic name for the orphan.



**EXAMPLE**

INPUT
```
Overall Text:
"Welcome back to the Smart Home Hub project sync. We've made significant progress on laying down the foundational architecture, ensuring a robust and scalable system. Our primary focus remains on creating a seamless and secure environment for users to manage their smart devices. This involves careful consideration of how various smart devices, regardless of their manufacturer, will communicate and interact with our central hub, a complex challenge given the diverse ecosystems out there. The user experience is paramount, so the design of the user interface, both for mobile applications and potential dedicated wall-mounted displays, is a high-priority workstream. We're also implementing top-tier data security measures and privacy protocols right from the start, a non-negotiable aspect given the sensitive nature of home data. Today, I wanted to discuss optimizing for real-time responsiveness; for instance, the delay between a voice command and a light actually turning on needs to be virtually zero, that's crucial for user satisfaction. Separately, I've also been looking into external funding opportunities. There's this 'Sustainable Technology Innovation' grant that just opened up, focusing on energy-efficient IoT solutions. It aligns perfectly with our hub's power-saving features, and I believe we have a strong case for it. I'm drafting a section for the proposal that details our innovative energy management algorithms. On a personal note, I have a final-round interview for a Product Manager role at another company next Tuesday. I need to spend the weekend preparing a presentation on a case study they gave me about market entry strategy."

Existing Nodes:
`===== Available Nodes =====
Node ID: 1
Title: Core Hub System Project
Summary: Development of the foundational, robust, and scalable architecture for the Smart Home Hub, including general performance optimization and underlying system logic.
Node ID: 2
Title: Cross-Device Communication & Protocols
Summary: Addressing how various smart devices from different manufacturers will communicate and interact with the central hub, including standards and compatibility.
Node ID: 3
Title: User Interface (UI/UX) Design
Summary: Design and development of the user-facing interfaces for the hub, including mobile applications, display integrations, and user experience flows.
Node ID: 4
Title: Data Security & Privacy Protocols
Summary: Implementation of top-tier security measures and privacy protocols for sensitive user and home data within the Smart Home Hub.
Node ID: 5
Title: Firmware Update Mechanism
Summary: Developing and implementing the process for pushing new firmware updates to connected devices without service interruption.

==========================`

Current chunk of text to process:
"Today, I wanted to discuss optimizing for real-time responsiveness; for instance, the delay between a voice command and a light actually turning on needs to be virtually zero, that's crucial for user satisfaction. Separately, I've also been looking into external funding opportunities. There's this 'Sustainable Technology Innovation' grant that just opened up, focusing on energy-efficient IoT solutions. It aligns perfectly with our hub's power-saving features, and I believe we have a strong case for it. I'm drafting a section for the proposal that details our innovative energy management algorithms. On a personal note, I have a final-round interview for a Product Manager role at another company next Tuesday. I need to spend the weekend preparing a presentation on a case study they gave me about market entry strategy."

Current chunk broken down into segments to analyze:
[{"text": "Today, I wanted to discuss optimizing for real-time responsiveness; for instance, the delay between a voice command and a light actually turning on needs to be virtually zero, that's crucial for user satisfaction."}, {"text": "Separately, I've also been looking into external funding opportunities. There's this 'Sustainable Technology Innovation' grant that just opened up, focusing on energy-efficient IoT solutions. It aligns perfectly with our hub's power-saving features, and I believe we have a strong case for it."}, {"text": "I'm drafting a section for the proposal that details our innovative energy management algorithms."}, {"text": "On a personal note, I have a final-round interview for a Product Manager role at another company next Tuesday."}, {"text": "I need to spend the weekend preparing a presentation on a case study they gave me about market entry strategy."}]
```

**Expected Output:**
```json

[
  {
    "text": "Today, I wanted to discuss optimizing for real-time responsiveness; for instance, the delay between a voice command and a light actually turning on needs to be virtually zero, that's crucial for user satisfaction.",
    "reasoning": "STEP 1, global understanding: This segment introduces a specific performance requirement for the Smart Home Hub project. Within the context of a project sync, this is a technical work item or consideration that affects the fundamental operation of the system.\n\nSTEP 2, Correctness & Significance Analysis:\n\nPossible Node Relationships:\n1.  Node 1 (Core Hub System Project): The relationship is R(S,N) = 'is a performance requirement for'. The node's summary explicitly mentions 'general performance optimization'. Real-time responsiveness is a specific, crucial type of performance optimization for the core system. This is a highly specific and correct relationship.\n2.  Node 3 (User Interface (UI/UX) Design): The relationship could be R(S,N) = 'is a critical factor for'. Low latency is vital for good user experience. However, the implementation of responsiveness is a core system/architectural issue, not just a UI design one, making this link less specific to the problem's solution.\n\nFinal Decision: Node 1 is the most significant target. The segment is fundamentally about a system-wide performance characteristic ('real-time responsiveness'), which is a perfect fit for the node covering 'foundational... architecture' and 'performance optimization'. The relationship 'is a performance requirement for' is the most specific and significant.",
    "target_node_id": 1,
    "target_node_name": "Core Hub System Project",
    "is_orphan": false,
    "orphan_topic_name": null,
    "relationship_to_target": "is a performance requirement for"
  },
  {
    "text": "Separately, I've also been looking into external funding opportunities. There's this 'Sustainable Technology Innovation' grant that just opened up, focusing on energy-efficient IoT solutions. It aligns perfectly with our hub's power-saving features, and I believe we have a strong case for it.",
    "reasoning": "STEP 1, global understanding: The word 'Separately' signals a complete topic shift. This segment is not about the technical development of the hub, but about the business/financial aspect of securing a grant. The project's features are mentioned as justification, but the core subject is the funding opportunity itself.\n\nSTEP 2, Correctness & Significance Analysis:\n\nPossible Node Relationships: I have analyzed all existing nodes (1-5). These nodes cover the technical workstreams of the project. None of them relate to business development, financing, or grant applications. The segment's topic is entirely orthogonal to the existing node structure.\n\nThere is not a single possibly related node.\n\nFinal Decision: An orphan must be created as no existing node provides a correct conceptual home for 'seeking external funding'. The proposed topic name 'External Funding & Grant Applications' accurately summarizes this new, distinct workstream.",
    "target_node_id": -1,
    "target_node_name": null,
    "is_orphan": true,
    "orphan_topic_name": "External Funding & Grant Applications",
    "relationship_to_target": "introduces the topic of"
  },
  {
    "text": "I'm drafting a section for the proposal that details our innovative energy management algorithms.",
    "reasoning": "STEP 1, global understanding: This segment is a direct continuation of the previous one. It describes a specific task ('drafting a section') being performed in service of the goal introduced immediately prior (applying for the grant proposal).\n\nSTEP 2, Correctness & Significance Analysis:\n\nPossible Node Relationships: The pool of potential targets now includes the original nodes AND the newly created topic 'External Funding & Grant Applications'.\n1.  Node 1 (Core Hub System Project): A relationship is correct: R(S,N) = 'describes a feature of'. The 'energy management algorithms' are part of the core system.\n2.  New Topic ('External Funding & Grant Applications'): A relationship is also correct: R(S,N) = 'is a task for'. The drafting is for the grant proposal.\n\nSignificance: While linking to Node 1 is technically correct, it misses the pragmatic context. The segment's purpose is not to discuss the algorithms themselves, but the act of preparing the grant proposal. The relationship 'is a task for' the 'External Funding & Grant Applications' topic is far more significant as it captures the purpose of the action.\n\nFinal Decision: The new topic 'External Funding & Grant Applications' is the most significant target. The output reflects this by reusing the topic name, effectively grouping these related thoughts.",
    "target_node_id": -1,
    "target_node_name": null,
    "is_orphan": true,
    "orphan_topic_name": "External Funding & Grant Applications",
    "relationship_to_target": "is a task for"
  },
  {
    "text": "On a personal note, I have a final-round interview for a Product Manager role at another company next Tuesday.",
    "reasoning": "STEP 1, global understanding: The phrase 'On a personal note' signals a complete context switch to a topic that is unambiguously unrelated to the Smart Home Hub project. This is about a personal activity.\n\nSTEP 2, Correctness & Significance Analysis:\n\nPossible Node Relationships: I have analyzed all available targets. The pool consists of the original nodes (1-5) and the newly created topic ('External Funding & Grant Applications'). This segment, concerning a personal job interview, has no thematic or practical connection to the 'Smart Home Hub' project workstreams or the 'External Funding' topic.\n\nThere is not a single possibly related node.\n\nFinal Decision: This is an orphan. It is unrelated to any existing or newly-formed concept. A new topic, 'Job Interview Preparation', is required to house this completely distinct, personal item.",
    "target_node_id": -1,
    "target_node_name": null,
    "is_orphan": true,
    "orphan_topic_name": "Job Interview Preparation",
    "relationship_to_target": "introduces the topic of"
  },
  {
    "text": "I need to spend the weekend preparing a presentation on a case study they gave me about market entry strategy.",
    "reasoning": "STEP 1, global understanding: This segment is a direct and immediate continuation of the previous one. It details a specific preparation task for the 'final-round interview' mentioned right before it.\n\nSTEP 2, Correctness & Significance Analysis:\n\nPossible Node Relationships: The pool of potential targets is now {Nodes 1-5, 'External Funding & Grant Applications', 'Job Interview Preparation'}.\n1.  Nodes 1-5 and 'External Funding & Grant Applications': No correct relationship exists. This segment is not about the smart home project or its funding.\n2.  New Topic ('Job Interview Preparation'): A relationship is correct and highly specific: R(S,N) = 'is a preparation task for'.\n\nSignificance: The connection to the 'Job Interview Preparation' topic is overwhelmingly the most correct and significant target. It directly describes an action being taken in service of that topic.\n\nFinal Decision: This segment must be grouped with the previous one. Reusing the 'Job Interview Preparation' topic name achieves this with the highest significance.",
    "target_node_id": -1,
    "target_node_name": null,
    "is_orphan": true,
    "orphan_topic_name": "Job Interview Preparation",
    "relationship_to_target": "is a preparation task for"
  }
]


```

EXAMPLE 2

This example demonstrates the Anti-Orphan Chain Rule.

INPUTS:

```
Overall text: "Okay team, let's get started. Did you already give the system an introduction to who you are? No? Okay, let's introduce you:"

Existing Nodes: [{"id": 1, "name": "User Introduction", "summary": "The user introduces themselves, their background, and their role."}]

Current chunk of text to process: "I work on humanitarian aid operations in Afghanistan. We are a donor, and I want to use this voice tree to help me decide on funding allocations."

Segments to Analyze:
[{"text": "I work on humanitarian aid operations in Afghanistan."}, {"text": "We are a donor, and I want to use this voice tree to help me decide on funding allocations."}]
```

Expected Output:
{
"target_nodes": [
{
"text": "I work on humanitarian aid operations in Afghanistan.",
"reasoning": "STEP 1, global understanding: The overall text explicitly sets up the context for a user introduction. This segment begins that introduction by stating the user's professional background. STEP 2.1, correctness: This segment's content directly matches the purpose of the 'User Introduction' node (ID 1). The relationship is 'is a detail of'.",
"is_orphan": false,
"target_node_id": 1,
"target_node_name": "User Introduction",
"orphan_topic_name": null,
"relationship_to_target": "is a detail of"
},
{
"text": "We are a donor, and I want to use this voice tree to help me decide on funding allocations.",
"reasoning": "STEP 2.0 Anti-Orphan Chain Rule: This is the highest priority check. The rule's conditions are evaluated: 1. Is this a continuation of the previous thought? Yes, it's the next sentence in the introduction. 2. Did the previous segment target an existing node? Yes, Node 1. 3. Would this segment become an orphan on its own? Yes, its topic of 'funding allocations' has no matching existing node. Because all three conditions are met, the rule activates. The orphan proposal is overridden, and this segment MUST be routed to the same target as the previous one (Node 1). This correctly groups the entire conversational act of 'the user's introduction' together.",
"is_orphan": false,
"target_node_id": 1,
"target_node_name": "User Introduction",
"orphan_topic_name": null,
"relationship_to_target": "is a motivation provided during"
}
]
}


INPUT DATA:
```
Overall Text:
"...{{transcript_history}}"

Existing Nodes:
`{{existing_nodes}}`

Current chunk of text to process:
"{{transcript_text}}"

Current chunk broken down into segments to analyze:
`{{segments}}`
```