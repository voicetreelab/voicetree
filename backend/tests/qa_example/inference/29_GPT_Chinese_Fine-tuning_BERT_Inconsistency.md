---
node_id: 29
title: GPT Chinese Fine-tuning BERT Inconsistency (29)
---
### Addresses a critical BERT reading inconsistency during GPT Chinese fine-tuning, advising model re-tuning for quality with large datasets.

Fixed an issue where GPT Chinese fine-tuning did not read BERT, leading to inconsistency with inference. This issue may cause the effect to worsen if too much data is fine-tuned. It is recommended to re-tune the model for quality optimization if a large amount of data has been fine-tuned (ref: #99f09c8).


-----------------
_Links:_
