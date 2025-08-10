You need to answer a question using information from VoiceTree nodes.

First, run this Python code to get the nodes:

```python
import sys
import json
sys.path.append('/Users/bobbobby/repos/VoiceTree')
from gsm_system.get_voicetree_nodes import get_voicetree_nodes

nodes = get_voicetree_nodes('backend/benchmarker/output/nolima_twohop_spain')
for node in nodes:
    if 'Garden of Earthly' in node['full_content'] or 'Megan' in node['full_content']:
        print(f"Found relevant node: {node['title']}")
        print(f"Content: {node['full_content']}")
        print()
```

Then answer this question: **Which character has been to Spain?**

Hint: The 'Garden of Earthly Delights' painting is located in the Museo del Prado in Madrid, Spain.