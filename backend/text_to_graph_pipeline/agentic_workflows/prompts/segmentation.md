You are an expert at segmenting voice transcripts into atomic ideas (complete thoughts) for a knowledge graph. 
The voice transcript may also contain unfinished content, so you should also identify unfnished sentences.

INPUT VARIABLES:
- transcript_history: Recent transcript history (the last ~250 chars before transcript_text), use this to understand the following transcript_text within the speakers's context
- transcript_text: The voice transcript to segment

OUTPUT FORMAT:
```json
{
  "chunks": [
    {"reasoning": "Analysis of why this is segmented as a distinct chunk and completeness assessment", "name": "Brief 1-5 word label", "text": "The actual text...", "is_complete": true/false}
  ]
}
```

SEGMENTATION PROCESS:
For each potential chunk, FIRST use the `reasoning` field as brainstorming section to analyze:
- Try understand the actual meaning of the content within the context
- Where are the natural boundaries between distinct ideas or work-items (problems, solutions, questions)?
- What parts are likely be unfinished?

THEN apply these segmentation rules based on your reasoning:

1. **One idea per chunk** - Each chunk must be a complete, self-contained thought that can stand alone as a knowledge node.

2. **Split on topic shifts** - New chunk when:
   - New topic, task, or requirement
   - Different example or anecdote  
   - Question or answer
   - Clear transition words ("also", "next", "another thing")

3. **Keep together** - Don't split:
   - Dependent clauses that explain the main idea
   - Context needed to understand the point
   - Short filler words with their content ("Um, I need to..." stays together)
   - It is fine to only return a single chunk in your final output.

4. **Completeness check** - For EVERY chunk:
   - `is_complete: false` if it ends mid-sentence or doesn't yet make sense within the context (e.g., "So, that's going to be something that", "And then we will build")
   - `is_complete: true` if it's a complete thought
   - When unsure, mark incomplete - better to wait for more context

5. **Light editing** - Our voice to text may have mistakes such as mis-hearing the wrong word, hallucinating grammar, etc.
Fix obvious transcription errors but preserve original wording.

EXAMPLES:

transcript_text: "So, today I'm starting work on voice tree. Right now, there's a few different things I want to look into. The first thing is I want to make a proof of concept of voice tree. So, the bare"

Output:
```json
{
  "chunks": [
    {"reasoning": "This introduces the main topic (voice tree project) and sets up context about exploring different aspects. It's a complete thought that stands alone.", "name": "Starting Voice Tree", "text": "So, today I'm starting work on voice tree. Right now, there's a few different things I want to look into.", "is_complete": true},
    {"reasoning": "This shifts to a specific task - creating a proof of concept. It's a distinct action item separate from the general introduction, forming its own complete thought.", "name": "Proof of Concept", "text": "The first thing is I want to make a proof of concept of voice tree.", "is_complete": true},
    {"reasoning": "This segment cuts off mid-sentence after 'bare', clearly incomplete. Waiting for more context to understand what aspect of the proof of concept is being discussed.", "name": "Incomplete Thought", "text": "So, the bare", "is_complete": false}
  ]
}
```

transcript_text: "I need to look into visualization libraries. Uh, converting text into a data format. But that's later."

Output:
```json
{
  "chunks": [
    {"reasoning": "This is a distinct task about researching visualization libraries. It's a complete, self-contained thought.", "name": "Visualization Libraries", "text": "I need to look into visualization libraries.", "is_complete": true},
    {"reasoning": "this could be introducing a separate task about data format conversion. It's grammatically informal but arguably conceptually complete. Since it is borderline, let's default to waiting for more input later to see if it gets completed", "name": "Text Conversion", "text": "Uh, converting text into a data format.", "is_complete": false},
    {"reasoning": "This seems to be referring back to the same task about researching visualization libraries. It's a complete thought.", "name": "Mermaid Visualization", "text": "Oh yea, Myles mentioned Mermaid as a good visualization option", "is_complete": true},
  ]
}
```
────────────────────────────────────────
RECENT CONTEXT (if available):
────────────────────────────────────────
{{transcript_history}}

────────────────────────────────────────
TRANSCRIPT TO SEGMENT:
────────────────────────────────────────
{{transcript_text}}