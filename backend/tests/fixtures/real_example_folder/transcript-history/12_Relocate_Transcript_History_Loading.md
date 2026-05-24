---
node_id: 12
title: Relocate Transcript History Loading (12)
---
### Relocate transcript history loading to `chunk_processor.py` to remove unnecessary indirection in the `py` layer.

We'll probably want to relocate transcript history loading to the `chunk_processor.py` file, as the current `py` layer possibly creates an unnecessary layer of indirection.


-----------------
_Links:_
Children:
- is_a_more_important_task_for_the [[15_Inject_Existing_History_into_Chunk_Processor.md]]- is_a_related_architectural_consideration_for [[13_Evaluate_Workflow_Merging.md]]
