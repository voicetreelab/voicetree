---
node_id: 13
title: GPT-SoVITS-V2 Features (13)
---
### Details GPT-SoVITS-V2's enhancements, including expanded language support (Korean, Cantonese, Chinese, Japanese, English), increased GPT and SoVITS training set durations, doubled inference speed, improved sound quality from low-quality audio, better zero-shot performance, and enhanced text front-end.

GPT-SoVITS-V2 introduces significant enhancements over V1, focusing on improved performance, broader language support, and higher audio quality. Key features include:
- **Expanded Language Support**: Now includes Korean and Cantonese, in addition to Chinese, Japanese, and English, enabling cross-language synthesis across five languages. The text front-end logic for Chinese, Japanese, and English has been enhanced, with V2 Chinese and English versions including optimizations for polyphonic characters.
- **Increased Training Set Durations**:
  - **GPT Training Set**: Increased from 2,000 hours (V1) to 2,500 hours.
  - **SoVITS Training Set**: V2 uses a VQ encoder with 2,000 hours, with the rest at 5,000 hours, compared to V1's 2,000 hours. The base membrane training set has been increased to 5,000 hours.
- **Improved Audio Quality & Performance**:
  - Better sound quality for synthesized audio, even from low-quality reference audio.
  - Enhanced zero-shot performance and more realistic timbre.
  - Less dataset required for training due to the increased base membrane training set.
- **Inference Speed**: Doubled in V2.
- **Parameter Amount**: Unchanged at 200M.


-----------------
_Links:_
Parent:
- introduces_new_features_and_improvements_in [[1_GPT-SoVITS_Software.md]]
