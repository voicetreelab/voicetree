---
node_id: 22
title: GPT-SoVITS Update Log 20240806 (22)
---
### Details GPT-SoVITS changes from 2024-08-06, including `bs-roformer` support, Chinese text frontend improvements, automatic file path filling, GPU numbering logic, GPT-SoVITS-v2 support, optimized timing logic, and removed redundant `my_utils`.

This update log details changes made on August 6, 2024:

- Added support for the `bs-roformer` voice and accompaniment separation model, including `fp16` inference. (Refs: #1306, #1356)
- Improved Chinese text frontend, optimizing polyphone logic (exclusive to version 2). (Refs: #987, #1351, #1404, #488)
- Implemented automatic file path filling for subsequent steps. (Ref: #1356)
- Added logic to handle incorrect GPU numbering input by users, ensuring normal operation. (Refs: #bce451a, #4c8b761)
- Added support for GPT-SoVITS-v2.
- Optimized timing logic.
- Removed redundant `my_utils`.


-----------------
_Links:_
