"""
Tests common input patterns, problems, and invariants

First, some deterministic inpputs, and deterministic + fuzzy output checking:

- correctly handles WI1, WI2, WI1 case:

End up with two decisions, APPEND WI2 to existing WI2,
WI1 new node attached to WI2. (todo: specify input)


- correctly handles WI1, WI2, WI3 case
- end up with CREATE WI2 to Wi1, APPEND WI1 to existing node 1, append WI 3 to existing node 3. 

These tests will also implicitly also test the following qualities:
- Correctly favours append / create for input where one subchunk is obviously a create, one subchunk is obviously an append 
- Can correctly identify which node to append/create to in obvious case (9 nodes irrelevant, 1 node relevant)
- Actual output has atleast 10% of the words from the input.



Subjective
for the fuzzy requirements, of output being "Good" (node actions represent well), we should use an LLM judge to decide whether the test is red or green. 

- ouutput is generally correct (is a good summarry for the content)
- Title is a good summary of node content
- Summary is a good summary given input transcript 
- Node content is a good content given input transcript 
- Handles overlap correctly (overlap cases)
"""