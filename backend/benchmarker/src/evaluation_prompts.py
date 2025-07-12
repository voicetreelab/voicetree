"""Evaluation prompts for quality assessment."""

EVALUATION_CRITERIA = """
You are an expert at evaluating the quality of decision trees created from spoken transcripts. 

Here are the criteria for evaluating tree quality:

* **Accuracy & Completeness:**  The tree should accurately represent the key information, points, and decisions from the transcript. It should include all essential information without significant omissions.
* **Coherence:** The tree should be structured logically, with clear parent-child relationships between nodes. The connections between nodes should be meaningful and easy to follow.
* **Conciseness:**  The tree should be free of redundancy. Each node should contain unique information and avoid repeating points already covered in other nodes.
* **Relevance:**  The tree should prioritize the most important information from the transcript, focusing on key decisions and outcomes.
* **relationship between nodes:** The tree should establish clear relationships between nodes, ensuring that parent-child connections make sense and reflect the logical flow of the conversation.
* **Node Structure:** The tree should effectively separate distinct ideas into individual nodes.  There should be a balance between the number of nodes and their size.  Avoid creating too few large, unfocused nodes or too many small, fragmented nodes.  

## Scoring:

Rate each dimension on a scale of 1 to 5, where:

* 1: Unusable
* 2: Poor 
* 3: Acceptable
* 4: Good
* 5: Excellent

Now, evaluate the following decision tree created from a spoken transcript:

Provide a detailed evaluation of the tree's quality, addressing each of the criteria listed above.
 Outline a positive and a negative for each category. 
 Use specific examples from the tree to support your points.  
 Be sure to include a score for each dimension.
 Spend some time brainstorming, and allowing yourself time to think, 
 then work out the best answer in a step-by-step way to be sure we have the right answer. 
"""

SPECIAL_ATTENTION = """
Pay special attention to:
- Node fragmentation (e.g., '50,000' split into '50' and '000' nodes)
- Circular or illogical parent-child relationships
- Whether technical concepts are properly grouped together
- If the tree captures the main narrative flow of the conversation
"""

FINAL_INSTRUCTION = """
Evaluate the tree. 

IMPORTANT: Start your response with these two lines:
Overall Score: X/5 (Rating) this should be decimal average of all the dimensions.
Summary: [One sentence summary of the biggest areas for improvement]

Then provide your detailed evaluation addressing each criterion.
"""


def build_evaluation_prompt(transcript_content, packaged_output, prompts_content=""):
    """Build the complete evaluation prompt."""
    prompt = (
        f"I have a system which converts in real-time, spoken voice into a content tree (similar to a mind-map).\n"
    )
    
    if prompts_content:
        prompt += (
            "This system uses an agentic workflow with several prompts to achieve its goal. "
            "For your reference, here are the prompts used in the workflow:\n\n"
            f"```\n{prompts_content}```\n\n"
        )
    
    prompt += (
        "Now, please evaluate the quality of the output (Markdown files) generated from the following transcript"
    )
    
    if prompts_content:
        prompt += ", keeping in mind the prompts that were used to generate it"
    
    prompt += (
        ".\n\n"
        "Here is the original transcript:\n"
        f"```{transcript_content}```\n\n"
        f"And here is the system's output that you need to assess:\n"
        "Markdown Output:\n\n"
        f"```{packaged_output}```\n\n"
        f"{EVALUATION_CRITERIA}\n"
        f"{FINAL_INSTRUCTION}\n\n"
        f"{SPECIAL_ATTENTION}"
    )
    
    return prompt