---
position:
  x: 231.81492706539493
  y: -336.82467133121105
isContextNode: false
---
---
title: (Sam) Proposed Fix: Expose VoiceTreeGraphView (55)
---

# Bad YAML Frontmatter Test

This file contains frontmatter with special characters that cause YAML parsing errors.
The title value starts with a parenthesis which confuses the YAML parser.

This should still load successfully by falling back to the heading or filename.

Related: [[1_VoiceTree_Website_Development_and_Node_Display_Bug]]

[[1_VoiceTree_Website_Development_and_Node_Display_Bug.md]]