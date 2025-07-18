- [ ] get abstraction optimizer prompt to use fill in the blank relationship type:

"""
    4.  ACTION: Determine the relationship between the current sub-chunk and the chosen item. To create a good relationship description:
        - Think of it as filling in the blank: "[current chunk name] _______ [relevant node/chunk name]"
        - The relationship should form a coherent sentence when read this way
        - Examples: 
          - "Database Choice" **selects technology for** "Database Architecture"
          - "Bug Fix #123" **resolves issue described in** "Error Report"
        - Focus on the directional nature of the relationship from the current chunk TO the relevant item
        - Keep it concise (up to 7 words max, preferablly less)
"""