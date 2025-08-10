# NoLiMa Benchmark Example Question

## Complete Example from Test ID: 0401, Test Case: T17_C02

### 1. Needle Template
```
"Actually, {CHAR} lives next to {1}."
```

### 2. Input Arguments for T17_C02
- `{1}`: "the Kiasma museum"
- `{2}`: "Helsinki" 
- `{3}`: "Uusimaa"

### 3. Character Selection
Random character selected from set: **Stuart**
(Character set: ["Yuki", "Stuart", "Katie", "Veronica", "Gary", "Megan", "Calvin", "Mandy", "Diana", "Caleb"])

### 4. Constructed Needle
```
"Actually, Stuart lives next to the Kiasma museum."
```

### 5. Question Templates
- **One-hop question**: "Which character has been to {2}?"
- **Two-hop question**: "Which character has been to {3}?"

### 6. Final Questions
- **One-hop**: "Which character has been to Helsinki?"
- **Two-hop**: "Which character has been to Uusimaa?"

### 7. Complete Test Scenario

#### Haystack Context (abbreviated example):
```
...walked through the old town square, remembering the stories her grandmother used to tell. The bells of the church tower rang out across the valley. Marcus had always loved this time of year, when the leaves turned golden and the air grew crisp. He thought about his upcoming trip to Barcelona, where he would finally see the Sagrada Familia.

Actually, Stuart lives next to the Kiasma museum.

The conference was scheduled for next Tuesday, and preparations were already underway. Sarah checked her notes one more time, making sure she had covered all the important points. The presentation needed to be perfect - this was her chance to impress the board...
```
*(Note: In the actual benchmark, the haystack would be much longer, potentially thousands of lines from shuffled book texts)*

#### Task Template Applied:
```
You will answer a question based on the following book snippet:

[LONG HAYSTACK TEXT WITH EMBEDDED NEEDLE]

Use the information provided in the book snippet to answer the question. Your answer should be short and based on either explicitly stated facts or strong, logical inferences.

Question: Which character has been to Helsinki?

Return only the final answer with no additional explanation or reasoning.
```

### 8. Expected Reasoning Process

**For One-hop question** ("Which character has been to Helsinki?"):
1. Find the needle: "Stuart lives next to the Kiasma museum"
2. Apply world knowledge: The Kiasma museum is located in Helsinki
3. Infer: Stuart likely has been to Helsinki (since he lives next to a museum there)
4. Answer: **Stuart**

**For Two-hop question** ("Which character has been to Uusimaa?"):
1. Find the needle: "Stuart lives next to the Kiasma museum"
2. Apply world knowledge: The Kiasma museum is in Helsinki
3. Apply more world knowledge: Helsinki is in the region of Uusimaa
4. Infer: Stuart likely has been to Uusimaa (since he lives in Helsinki, which is in Uusimaa)
5. Answer: **Stuart**

### 9. Why This Tests Non-Literal Matching

The key challenge is that:
- The needle mentions "Kiasma museum" but NOT "Helsinki" or "Uusimaa"
- The question asks about "Helsinki" or "Uusimaa" but NOT "Kiasma museum"
- The model must use world knowledge to connect:
  - Kiasma museum → Helsinki (one-hop)
  - Kiasma museum → Helsinki → Uusimaa (two-hop)

There is **no lexical overlap** between the needle and the question, preventing simple string matching. The model must:
1. Locate the relevant information in a large haystack
2. Apply world knowledge about geography
3. Make logical inferences to connect the dots

### 10. Evaluation Metrics

- **Correct answer**: "Stuart" (exact match required)
- **Performance measured across**:
  - Different context lengths (1K, 2K, 4K, 8K, 16K, 32K, 64K, 128K tokens)
  - Different needle depths (0%, 25%, 50%, 75%, 100% into the haystack)
  - Multiple needle placements per configuration

### 11. Benchmark Insights

This example demonstrates why NoLiMa is challenging:
- **No literal matching**: Questions and needles share no keywords
- **World knowledge required**: Must know museum locations and regional geography
- **Attention mechanism stress**: Must find tiny relevant snippet in massive irrelevant context
- **Inference chains**: Two-hop questions require multiple reasoning steps

Models that rely on lexical similarity or keyword matching will fail, as they cannot connect "Kiasma museum" to "Helsinki" or "Uusimaa" without understanding the semantic relationships and applying external knowledge.