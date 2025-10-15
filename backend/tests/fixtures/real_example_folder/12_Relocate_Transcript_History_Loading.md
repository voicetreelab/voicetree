---
node_id: 12
title: Relocate Transcript History Loading (12)
---
### Relocate transcript history loading to `chunk_processor.py` to remove unnecessary indirection in the `py` layer.

We'll probably want to relocate transcript history loading to the `chunk_processor.py` file, as the current `py` layer possibly creates an unnecessary layer of indirection.


-----------------
_Links:_
Parent:
- is_a_proposed_implementation_for [[7_Load_Transcript_History.md]]
