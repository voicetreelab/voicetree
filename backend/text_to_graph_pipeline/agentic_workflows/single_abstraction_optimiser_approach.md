Techniques the 

	1. classification of components of a node into different types/abstractions such as:
(In other words, identify the abstractions present)

    - Task, Decision, Problem, Question, Solution (or possible solution), counter example, answer, description of a function or abstraction, insight, observation 
(list may not be exhaustive)

	2. Fill in the blank to identify relationship type between abstractions here.

	3. Awareness of the optimisation problem we are trying to solve (actually include this in the prompt), essentially give it [[VoiceTree_Math.md]] and tell it just solve the optimisation problem.

    4. Include tools to solve the optimisation problem:
        - The abstraction test, compressability, entropy test, common patterns:


#### **Technique A: The Abstraction Test (Compressibility)**

This is the most fundamental technique, directly from our earlier discussions.

- **Concept:** A good node structure represents a successful compression of information. A good node title is the "key" to that compression.
    
- **Implementation:** After proposing a new structure (e.g., splitting one node into a parent and two children), prompt the integrator: **"For each new parent node you created, provide a short, descriptive title (3-7 words) that accurately encapsulates all of its children. If you cannot create a concise and accurate title, the abstraction is likely incorrect"**
    

#### **Technique B: Structural Pattern Matching**

Human thought and projects follow recurring patterns. The integrator can be trained to recognize and enforce these patterns.

- **Concept:** Many nodes are not just random collections of thoughts; they follow logical narrative structures.
    
- **Implementation:** Prompt the integrator to identify common patterns in the combined node + inbox content.
    
    - **Problem/Solution Pattern:** "Does this content describe a Problem and a corresponding Solution or Task? If so, structure it with the Problem as the parent and the Solution/Task as the child."
        
    - **Goal/Steps Pattern:** "Does this content describe a high-level Goal and a sequence of Tasks to achieve it? If so, structure it that way."
        
    - **Claim/Evidence Pattern:** "Does this content make a Claim or Insight and then provide several Observations as evidence? If so, group the Observations under the Insight."
        
- **Example:** An inbox with "The login is slow" (Problem) and "We need to add a DB index" (Task) should be automatically structured into a parent-child relationship.
    

#### **Technique C: Semantic Entropy Reduction**

This is a more advanced way of thinking about the "junk drawer" problem.

- **Concept:** "Entropy" here means the degree of topical disorder within a node. A node with 5 different unrelated topics has high entropy. The integrator's job is to create a new structure that minimizes the entropy of each resulting node, and the entropy of the stucture of the abstracted tree view: nodes and their relationships between them.
    
- **Implementation:** Prompt the integrator: **"Analyze all the text fragments within this node. Identify the core semantic themes. Is there one theme or multiple? If there are multiple distinct themes, propose a split that groups all fragments related to Theme A into one node and all fragments for Theme B into another."**
    
- **Example:** A node Notes from Meeting contains text about UI redesign, database performance, and Q4 hiring. This has high entropy. The integrator should propose splitting it into three separate, low-entropy nodes, each focused on one topic.


The cool thing about entropy approach is that it can create synthetic nodes just for groupings that weren't explicit, but can be implicitly inferred, and if so decrease the entropy / improve the understandability a lot. 
    

#### **Technique D: The "Why" Prompt (Metacognition)**

For debugging and improving the system, force the integrator to explain its reasoning.

- **Concept:** Making the LLM's reasoning explicit allows you to understand its "thought process" and refine the prompt.
    
- **Implementation:** For every structural change it proposes (a split or merge), require it to output a justification field.



APPROACH

Input:
Node content,

For enhanced understanding of context the node fits into:
- neighbouring nodes, their summaries, and relationship to input node.
- (LATER) Perhaps the n=5 stick of parents of the node, i.e. parent(parent(parent(node)))...

 
Output:
Udated content of the node
Updated summary of the node
(tree UPDATE actions)
New nodes & their relationship to existing nodes. (tree CREATE actions)
