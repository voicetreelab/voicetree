### **1. Core Objective of the System**

The primary function of our system is to generate a tree structure that optimally represents the meaning and organization of a conversation in near real-time (allowing for a ~15-second lag). The goal is to provide the user with a compressed, structural representation of their work, thereby enhancing their ability to reason about it.

### **2. The Core Pipeline Function**

Our development pipeline must solve the following core task: given an existing tree and 1-5 new sentences of content, it must produce the best possible updated tree that incorporates and represents the new meaning.

f(existing_tree, new_content) => best_possible_updated_tree

The central challenge is defining and implementing the "best possible update." This requires breaking down specific examples of updates, generalizing them, and translating those generalizations into code. Our framework for this is a "work-item-tree," where we either append new content to an existing work item or create a new one.

### **3. The "Work Item" Framework**

A "work item" is the fundamental unit of our tree. It is an abstraction that can represent any of the following:

- Task
    
- Decision
    
- Problem
    
- Question
    
- Solution (or potential solution)
    
- Counter-example
    
- Answer
    
- Description of a function or concept
    

Think of a work item as anything that could be a ticket or sub-task in a system like Jira. Each work item contains its own state, context, and details.

This concept is based on the observation that when manually creating voice notes, nearly every node corresponds to one of these items. For conversational elements that don't fit neatly (e.g., chit-chat at the start of a meeting), we can create "ghost" work-item nodes by inferring the underlying intent, such as "building rapport."

### **4. The Central Question: Granularity**

This leads to the most important question for our system: **When is a piece of information worthy of becoming its own work item?** In other words, at what granularity should we extract work items from a given chunk of text?

The answer to this question gets to the very root of why this system is useful.

### **5. Key Insight: The System as a Compression Algorithm**

The task of our system is fundamentally about **compression**. Given a stream of text, how can we best break it down into a set of abstractions with relationships, such that the high-level meaning is presented with maximum compression?

This framing reveals that our core challenge is an **optimization problem**.

### **6. Formulating the Optimization Problem**

We want to find a tree structure that minimizes a combination of competing factors.

**Initial Formulation:** Minimize (Structure Length + Meaning Loss)

These two variables are in direct opposition:

- **A single mega-node:** This yields a minimum structure length but causes a high loss of structural meaning.
    
- **Maximum fragmentation (e.g., one node per noun):** This results in a very high structure length. While it might seem to have no meaning loss, it actually introduces **understandability loss**—a graph of every noun is less comprehensible to a human than the original sentence.
    

**Refined Formulation:** Minimize (Structure Length + Meaning Loss + Understandability Loss)

We can simplify this by recognizing that "Meaning Loss" and "Understandability Loss" are deeply related. Let's call their combination **"Cognitive Fidelity Loss"**.

Furthermore, the reason we want a short structure length is to increase the speed and ease of understanding. Therefore, all factors can be unified into a single objective:

**Unified Objective:** Minimize the human computation required to understand the original meaning at the necessary level of abstraction.

### **7. Clarification on "Meaning Loss"**

It is critical to note that some loss of detail at the high-level, structural view is not only acceptable but **desirable**. This is abstraction, not omission. The user can always click on a specific node to access all the detailed text associated with it. The optimization, therefore, seeks the ideal middle ground between a completely flat structure and an overly fragmented one.

### **8. The Guiding Principle: Aligning with Human Cognition**

The ultimate goal is to create an abstracted view that operates at the user's **currently required working level of abstraction.**

A human engaged in problem-solving can only hold a few items (perhaps 5-8) in their working memory at once. They reason about how these "items" relate to each other. **The nodes in our tree should represent these same cognitive items.**

This is the level we must optimize for. Our system should aim to recreate the abstractions being used in the problem-solving and decision-making centers of the brain. Even more powerfully, since a human brain often doesn't use the most optimal abstractions, **our system has the opportunity to provide a better, clearer set of abstractions, thereby actively improving the user's problem-solving process.**

 However this  raises a critical dichotomy:

- **Mirroring:** Replicating the abstractions the user's brain is currently using.
    
- **Optimizing:** Providing the abstractions that are objectively optimal for solving the problem.

a choice about the system's fundamental role. Is it a perfect scribe or an expert cognitive coach?

Answer: we are more mostly mirroring the abstractions the user has expressed in their spoken content, however we will make minor adjustments if they greatly improve the compression.

The system's goal is to maintain a state of low "Structural Tension." (or entropy) It defaults to mirroring the user's mind, but gently nudges them toward a more organized cognitive state whenever it detects that the mental model is becoming costly or inefficient. It helps the user not only to solve the problem at hand, but to become a clearer thinker.