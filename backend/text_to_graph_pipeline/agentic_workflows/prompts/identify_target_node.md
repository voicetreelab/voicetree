You are an expert at comprehending complex texts of all forms, and identifying relationships between text and concepts.

Task: Your responsibility is to analyze incoming text segments and determine the most related existing concept in a **Concept Graph**.
This target will be used by a later system to either append the text to an existing concept or create a new one. 
Your job is only to identify targets and relationships, not to decide whether a segment is worth of a new node.

--- CONTEXT HIERARCHY ---
You must weigh context clues to find the best destination, in this order of importance:
    - Sequential Context: The strongest clue. A segment that directly elaborates on the previous often belongs in the same place.
    - Immediate Historical Context (Overall Text): Use this to understand the user's overarching intent for the entire utterance.
    - Global Context (existing_nodes): Your map of potential homes for the segment's topic.

1.  Global understanding: First, review all context. Try to explore what the overall text is actually trying to say as a whole. You will use `glboal_understanding` to scribble down your chain of thought for this.

2.  Process each segment in the `Segments to Analyze` list sequentially, For each segment:

    2.1. Understand what the segment really means, both with respect to your global (with respect to the text as a whole) understanding of the text, & locally (with respect to previous segments). The meaning of the segment individually may be quite different to the meaning of the text within  context. Write this down under the `reasoning` field, under "STEP 1, global understanding:". Ensure you understand both the *semantic*, and *pragmatic* meaning of the segment with respect to the greater text.

   2.2 For each segment, we now compare it to every single provided node, to identify the best target node.

   To understand the "best" option, your process must follow two criteria in order: Correctness, and Significance.

   2.2.1. Correctness: First, understand the meaning of the full text, and the segment within its full context. Identify all existing nodes for which a relationship could be stated. A relationship is a phrase R that completes the **proposition = R(S,N): Segment S has relationship R to Node N**. 
   These relationships can be any short phrase which would fill-in-the-blank in:"[segment] ______ [Node Name]"

   You should think like a detective in trying to find these connections, as they can be quite implicit from the text.

   These relationships do not have to be direct, or specific at this stage. If you found any correct relationship in this stage, you are not allowed to propose a new topic. Even if the relationship is weak, that is okay.
    If truly no related node exists, the segment is an orphan, completely separated from our existing graph.

   Try narrow down to a shortlist of up to 3 possibly related nodes, which can form correct proposition R(S,N). What would the relationship phrase (R) be for each of these nodes? Document these options in the reasoning output field.

   2.2.2. Significance: From the list of correct nodes, select the single best target. The best target is the one that captures the most amount of information in its compressed R(S,N) form. i.e. The most significant proposition has the least amount of information loss compared to the meaning of the original text. Significance is maximized by choosing the node and relationship that are the most semantically specific.

      a. The Specificity of the Node (Hyponymy):
      A node N is more specific than a node N' if N is a hyponym ("is-a-type-of" or "is-a-part-of") of N'.  
        Identifying  a more specific (whilst still correct) node preserves more detail.

      High Specificity: N = "Date Picker Component"
      Low Specificity: N = "Frontend UI Development"

      b. The Specificity of the Relationship:
      High Specificity: R = "Is a proposed solution for"
      Low Specificity: R = "Is related to"

   The node with the predicate with the highest combined specificity is the most significant.

   For each segment, state your final decision and the reasoning that led to it, referencing the correctness and significance criteria.

2.3. Handling orphans:
Proposing a new topic is a last resort, used only if there is absolutely no correct relationship to an existing node.

You must also not create an orphan if The 'Anti-Orphan Chain Rule' 3 activating conditions are all true: 
            1. The current segment is a direct continuation of the previous segment's thought.
            2. The previous segment was successfully routed to an EXISTING node (i.e., it was NOT an orphan).
            3. The current segment, if evaluated on its own, would be proposed as a new "synthetic parent" (i.e., it would become an orphan).
        If all three conditions are met, you **MUST** override the orphan proposal and assign the segment to the **exact same target node as the previous segment**.

        This rule ensures that a pattern like `[Targeted Node] | [Orphan]` is not possible for a continuous thought. If a segment has a better, more specific existing node to go to, this rule does NOT apply.

If a segment cannot be linked to any existing node, your task is not to name the segment itself, but to name its hypothetical parent node. Think of this as a 'ghost' or 'synthetic parent'—the general category this segment would belong to if that category existed.

If subsequent segments also cannot be routed to an existing node AND they are about the same new topic, you must re-use the exact same proposed topic name. This groups related, un-routable segments together under the same temporary label for the downstream system.

Chain rule for orphans:    
If a segment is directly related to the previous segment, you are NOT ALLOWED to make this an orphan, instead it must
be targetting the same node as the previous segment, even if the topics are different.

If you propose a new topic, you MUST explain in your reasoning field why NO existing nodes were a suitable match.
Specifically write "There is not a single possibly related node", in your reasoning, if this is the case. 

Your final output will now either be, a target node (ID & name), or a new topic name for the orphan.

**EXAMPLE**

**Overall text:** "...so that's the project status. Now for today's goals."
**Existing Nodes:** `[{"id": 1, "name": "Project Setup Tasks"}]`
**Current chunk of text to process**: "First, let's spec out the new user authentication flow. Uhm, well, It needs to support both Google and magic link sign-in. Separately, I need to send out the invite for the kickoff meeting."
**Segments to Analyze:**
`[{"text": "First, let's spec out the new user authentication flow."}, {"text": "It needs to support both Google and magic link sign-in."}, {"text": "Separately, I need to send out the invite for the kickoff meeting."}]`
INPUT
```
Overall Text:
"Welcome back to the Smart Home Hub project sync. We've made significant progress on laying down the foundational architecture, ensuring a robust and scalable system. Our primary focus remains on creating a seamless and secure environment for users to manage their smart devices. This involves careful consideration of how various smart devices, regardless of their manufacturer, will communicate and interact with our central hub, a complex challenge given the diverse ecosystems out there. The user experience is paramount, so the design of the user interface, both for mobile applications and potential dedicated wall-mounted displays, is a high-priority workstream. We're also implementing top-tier data security measures and privacy protocols right from the start, a non-negotiable aspect given the sensitive nature of home data. Today, I wanted to discuss optimizing for real-time responsiveness; for instance, the delay between a voice command and a light actually turning on needs to be virtually zero, that's crucial for user satisfaction. Separately, I've also been looking into external funding opportunities. There's this 'Sustainable Technology Innovation' grant that just opened up, focusing on energy-efficient IoT solutions. It aligns perfectly with our hub's power-saving features, and I believe we have a strong case for it. I'm drafting a section for the proposal that details our innovative energy management algorithms. On a different note, we still need to nail down the specifics of how new firmware updates will be pushed to connected devices without interrupting service, ensuring smooth transitions. Finally, thinking ahead, we should explore strategic partnerships with major smart appliance manufacturers to ensure broader compatibility from day one."

Existing Nodes:
`===== Available Nodes =====
Node ID: 1
Title: Core Hub System Architecture
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
"Today, I wanted to discuss optimizing for real-time responsiveness; for instance, the delay between a voice command and a light actually turning on needs to be virtually zero, that's crucial for user satisfaction. Separately, I've also been looking into external funding opportunities. There's this 'Sustainable Technology Innovation' grant that just opened up, focusing on energy-efficient IoT solutions. It aligns perfectly with our hub's power-saving features, and I believe we have a strong case for it. I'm drafting a section for the proposal that details our innovative energy management algorithms."

Current chunk broken down into segments to analyze:
[{"text": "Today, I wanted to discuss optimizing for real-time responsiveness; for instance, the delay between a voice command and a light actually turning on needs to be virtually zero, that's crucial for user satisfaction."}, {"text": "Separately, I've also been looking into external funding opportunities. There's this 'Sustainable Technology Innovation' grant that just opened up, focusing on energy-efficient IoT solutions. It aligns perfectly with our hub's power-saving features, and I believe we have a strong case for it."}, {"text": "I'm drafting a section for the proposal that details our innovative energy management algorithms."}]
```

**Expected Output:**
```json
{
  "target_nodes": [
    {
      "text": "Today, I wanted to discuss optimizing for real-time responsiveness; for instance, the delay between a voice command and a light actually turning on needs to be virtually zero, that's crucial for user satisfaction.",
      "reasoning": "STEP 1, global understanding: The user is discussing core performance requirements for the Smart Home Hub. This segment specifically addresses the need for minimal latency in device response, which is a fundamental system-level performance goal crucial for user satisfaction. STEP 2.1, correctness: While 'user satisfaction' might suggest 'UI/UX Design' (Node 3), the core of this segment is about 'optimizing for real-time responsiveness' and 'delay between command and action'. This is an implicit pragmatic requirement directly related to the underlying performance of the 'Core Hub System Architecture' (Node 1), which includes 'general performance optimization'. A correct relationship exists: 'is a performance goal for' Node 1. The prompt strictly states that if *any* correct relationship can be found, an orphan is not allowed, even if the relationship is weak. STEP 2.2, significance: Node 1 is the most appropriate existing node because real-time responsiveness is a core system-level concern, not purely a UI design aspect. The relationship 'is a performance goal for' is sufficiently specific.",
      "is_orphan": false,
      "target_node_id": 1,
      "target_node_name": "Core Hub System Architecture",
      "orphan_topic_name": null,
      "relationship_to_target": "is a performance goal for"
    },
    {
      "text": "Separately, I've also been looking into external funding opportunities. There's this 'Sustainable Technology Innovation' grant that just opened up, focusing on energy-efficient IoT solutions. It aligns perfectly with our hub's power-saving features, and I believe we have a strong case for it.",
      "reasoning": "STEP 1, global understanding: The word 'Separately' signals a clear topic shift from technical development to external project management and funding. This segment introduces the idea of pursuing a 'Sustainable Technology Innovation grant' for funding. STEP 2.1, correctness: None of the existing nodes (Core Hub System Architecture, Cross-Device Communication & Protocols, UI/UX Design, Data Security & Privacy Protocols, Firmware Update Mechanism) relate to external funding, grants, or financial aspects of the project. This is a genuinely new, distinct workstream. STEP 2.2, significance: Since no existing node has a correct relationship, this segment must be designated as an orphan. STEP 2.3, handling orphans: No existing node is suitable. The proposed orphan topic name 'Sustainable Tech Innovation Grant Application' accurately captures the new subject. The relationship 'is a new initiative about' clearly defines its nature.",
      "is_orphan": true,
      "target_node_id": -1,
      "target_node_name": null,
      "orphan_topic_name": "Sustainable Tech Innovation Grant Application",
      "relationship_to_target": "is a new initiative about"
    },
    {
      "text": "I'm drafting a section for the proposal that details our innovative energy management algorithms.",
      "reasoning": "STEP 1, global understanding: This segment directly elaborates on the previous segment's new topic: the 'Sustainable Technology Innovation grant'. It details an action (drafting a section) related to the 'proposal' for that grant. STEP 2.1, correctness: Based on sequential context, this segment is a direct follow-up and component of the 'Sustainable Tech Innovation Grant Application' which was established as an orphan topic by the immediately preceding segment. There is no other existing node that this segment correctly relates to. STEP 2.2, significance: This segment is highly significant to the previously established orphan topic. STEP 2.3, handling orphans: This segment builds upon the previously created orphan. It should be routed to the *same* orphan topic, demonstrating the chaining of related segments.",
      "is_orphan": true,
      "target_node_id": -1,
      "target_node_name": null,
      "orphan_topic_name": "Sustainable Tech Innovation Grant Application",
      "relationship_to_target": "is an action taken for"
    }
  ],
  "global_reasoning": "The overall text outlines the Smart Home Hub project, covering architectural foundations, device communication, UI/UX, security, and firmware updates. The current chunk introduces a key performance optimization goal for the core system, followed by a new, distinct topic about an external funding grant. The first segment, despite its general nature, relates to the core system's performance, preventing an orphan. The subsequent two segments introduce and elaborate on a completely new topic (grant application), which has no existing node, leading to a chained orphan topic."
}
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