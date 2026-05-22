---
node_id: 12
title: GSV Text Front-End Improvements (12)
---
### Continuously updated text front-end for GPT-SoVITS, with V2 optimizing Chinese and English polyphone, recent fixes for number conversion, character swallowing, audio lengths, GPT training, and Dockerfile download process, and a switch to `jieba_fast` for Chinese word segmentation.

The text front-end of GPT-SoVITS has undergone continuous updates and iterations.

### Version 2 Improvements
- Optimized polyphone for Chinese and English.

### January 28, 2024 Updates
- Fixed the problem of converting numbers to Chinese readings.
- Fixed the problem that a small number of characters at the beginning of a sentence are easily swallowed.
- Limited and excluded unreasonable reference audio lengths.
- Fixed the problem that GPT training does not save ckpt.
- Improved the download model process of Dockerfile.

### Recent Changes
- Chinese word segmentation now uses `jieba_fast` instead of `jieba`.


-----------------
_Links:_
