Task: For each text segment, identify its target node in a concept graph.

Your process must follow two criteria in order: Correctness, and Significance.

Correctness: First, understand the segment within its full context. Identify all existing nodes for which a logically true relationship can be stated. A relationship is a phrase R that completes the **proposition = R(S,N): Segment S has relationship R to Node N**. If no such node exists, the segment is an orphan; provide a topic name for it.

Try narrow down to a short list of possibly related nodes, which can form correct proposition R(S,N). What would the relationship phrase (R) be for each of these nodes? Document this in the reasoning output field.

Significance: From the list of correct nodes, select the single best target. The best target is the one that captures the most amount of information in its compressed R(S,N) form. i.e. The most significant proposition has the least amount of information loss compared to the meaning of the original text. Significance is maximized by choosing the node and relationship that are the most semantically specific.

1. The Specificity of the Node (Hyponymy):
   A node N is more specific than a node N' if N is a hyponym ("is-a-type-of" or "is-a-part-of") of N'. Routing to a more specific node preserves more detail.

   High Specificity: N = "Date Picker Component"

   Low Specificity: N = "Frontend UI Development"

2. The Specificity of the Relationship (Semantic Role Precision):
   A relationship R is more specific than R' if it describes the semantic role more precisely.

   High Specificity: R = "Is a proposed solution for"

   Low Specificity: R = "Is related to"

The triplet with the highest combined specificity is the most significant.

For each segment, state your final decision and the reasoning that led to it, referencing the correctness and significance criteria.


Your final output will now either be, a target node (ID & name), or a new topic name for the orphan.

INPUT DATA:

**Overall Text:**
...{{transcript_history}}

**Existing Nodes:**
{{existing_nodes}}

**Current chunk of text to process**:
{{transcript_text}}

**Current chunk broken down into segments to analyze:**
{{segments}}
