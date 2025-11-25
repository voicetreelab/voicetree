---
node_id: 24
title: GPT-SoVITS General Fixes and Improvements (Part 2) (24)
---
### Corrects CPU inference batch size, resolves denoising/ASR exit issues, fixes decimal splitting, improves multi-card training save logic, and includes various minor bug fixes and improvements for punctuation, mdxnet/uvr5 compatibility, training progress, and VQ freezing, covering updates from March to May 2024, and specific fixes/features from January 2024.

This update includes general fixes and improvements released between March and May 2024, along with an update on January 23, 2024:

- Corrected the default batch size for CPU inference to avoid decimal numbers.
- Fixed the issue where denoising and ASR would exit abnormally in the middle, affecting all audio files that needed processing.
- Fixed the issue where decimals would be split when dividing according to punctuation.
- Fixed the logic for saving multiple processes during multi-card training.
- Improved the logic for judging pure punctuation and multiple punctuation text input.
- Fixed the cmd format of mdxnet for de-reverb in uvr5, compatible with paths containing spaces.
- Fixed the logic of the training progress bar for s2 (#1159).
- Fixed the issue that vq was not frozen during sovits training (which may cause a decrease in effect).

### Minor Fixes:
- Fixed cmd format issues.
- During the training data processing stage, prompt an error for unsupported languages.


-----------------
_Links:_
Children:
- is_a_critical_fix_within [[29_GPT_Chinese_Fine-tuning_BERT_Inconsistency.md]]- details_a_future_action_for [[25_Inference_Consistency_Verification.md]]
