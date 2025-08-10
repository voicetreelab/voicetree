# NoLiMa Two-Hop Question Example

## Test Configuration
- **Needle ID**: 0408
- **Test Case**: T04_C02  
- **Reasoning Type**: World Knowledge
- **Question Type**: Two-hop reasoning

---

## Step 1: Needle Construction

### Template
```
"In 2013, after waiting in line for hours, {CHAR} finally saw the original {1} painting up close."
```

### Input Arguments
- `{1}`: 'Garden of Earthly Delights'
- `{2}`: the Museo del Prado
- `{3}`: Madrid
- `{4}`: Spain

### Selected Character
**Megan** (randomly selected from character set)

### Final Needle
```
"In 2013, after waiting in line for hours, Megan finally saw the original 'Garden of Earthly Delights' painting up close."
```

---

## Step 2: Question Construction

### Two-Hop Question Template
```
"Which character has been to {4}?"
```

### Final Question
```
"Which character has been to Spain?"
```

---

## Step 3: Complete Test Prompt

```
You will answer a question based on the following book snippet:

The morning sun cast long shadows across the cobblestone streets as vendors began setting up their stalls in the market square. Fresh bread, local cheese, and seasonal fruits filled the air with enticing aromas. Children ran between the stands, their laughter echoing off the old stone buildings that had stood for centuries.

Margaret's diary entry from last summer mentioned her fascination with Renaissance architecture. She had spent weeks studying the intricate details of cathedral facades, sketching the gargoyles and flying buttresses in her notebook. Her professor had encouraged her to visit Europe to see these masterpieces firsthand.

The train journey from Paris to Amsterdam took longer than expected due to delays at the border. Passengers grew restless, some pacing the narrow corridors while others dozed in their seats. The countryside rolled by in a blur of green fields and occasional windmills.

In 2013, after waiting in line for hours, Megan finally saw the original 'Garden of Earthly Delights' painting up close.

The conference on sustainable urban development attracted experts from around the globe. Presentations covered topics ranging from green roof initiatives to public transportation innovations. During the lunch break, attendees networked in the convention center's atrium, exchanging business cards and discussing potential collaborations.

Thomas had always been afraid of heights, which made his job as a window cleaner particularly challenging. Each morning, he would take deep breaths before ascending the scaffolding, reminding himself of the generous pay that made it all worthwhile. His colleagues often joked about the irony, but Thomas took it in stride.

The local library's rare books collection included first editions dating back to the 17th century. Scholars needed special permission to access these treasures, and handling procedures were strictly enforced. White gloves were mandatory, and no photography was allowed without prior authorization.

[... haystack continues for thousands more lines ...]

Use the information provided in the book snippet to answer the question. Your answer should be short and based on either explicitly stated facts or strong, logical inferences.

Question: Which character has been to Spain?

Return only the final answer with no additional explanation or reasoning.
```

---

## Step 4: Required Reasoning Chain

### Two-Hop Inference Process:

**Hop 1: Painting → Museum**
- Given: "Megan finally saw the original 'Garden of Earthly Delights' painting up close"
- World Knowledge: The original 'Garden of Earthly Delights' by Hieronymus Bosch is housed in the Museo del Prado
- Inference: Megan was at the Museo del Prado

**Hop 2: Museum → Country**
- Given: Megan was at the Museo del Prado (from Hop 1)
- World Knowledge: The Museo del Prado is located in Madrid, Spain
- Inference: Megan has been to Spain

### Answer: **Megan**

---

## Step 5: Why This Is Challenging

### No Lexical Overlap
- **Needle contains**: "Garden of Earthly Delights" (painting name)
- **Question asks about**: "Spain" (country)
- **Zero shared words** between the critical information and the question

### Required Knowledge Chain
1. Must know that 'Garden of Earthly Delights' is a specific painting
2. Must know this painting is in the Museo del Prado
3. Must know the Museo del Prado is in Madrid
4. Must know Madrid is in Spain

### Context Challenges
- Needle is embedded in thousands of lines of irrelevant text
- Multiple other characters and locations mentioned throughout
- Distracting information about other museums, art, and travel

---

## Step 6: Evaluation Criteria

### Correct Answer
- **Expected**: "Megan"
- **Evaluation**: Exact match required
- **Case sensitivity**: Typically case-insensitive

### Performance Factors Tested
1. **Needle Finding**: Can the model locate the relevant sentence in a large haystack?
2. **Knowledge Application**: Does the model know the painting's location?
3. **Multi-hop Reasoning**: Can the model chain inferences (painting → museum → city → country)?
4. **Attention Span**: Does performance degrade as context length increases?

### Context Length Variations
This same test would be run with haystacks of:
- 1K tokens (~250 words)
- 2K tokens (~500 words)
- 4K tokens (~1,000 words)
- 8K tokens (~2,000 words)
- 16K tokens (~4,000 words)
- 32K tokens (~8,000 words)
- 64K tokens (~16,000 words)
- 128K tokens (~32,000 words)

---

## Summary

This two-hop question exemplifies NoLiMa's core challenge: finding a needle that shares no keywords with the question, then applying world knowledge through multiple inference steps to arrive at the correct answer. The model must:

1. Find "Megan" and "'Garden of Earthly Delights'" in the haystack
2. Know this painting is in the Museo del Prado
3. Know the Museo del Prado is in Spain
4. Connect these facts to answer "Which character has been to Spain?"

Without the ability to perform non-literal matching and multi-hop reasoning, models will fail this seemingly simple question.