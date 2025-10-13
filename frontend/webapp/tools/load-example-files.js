// Script to load example files into the webapp
// Paste this into the browser console when the app is running

async function loadExampleFiles() {
  // Read the actual example files
  const files = [
    {
      path: '1_VoiceTree_Website_Development_and_Node_Display_Bug.md',
      content: `---
node_id: 1
title: VoiceTree Website Development and Node Display Bug
---

### VoiceTree Website Development and Node Display Bug

VoiceTree website with markdown rendering of ideas.

-----------------
_Links:_
Children:
- is_a_bug_identified_during [[2_VoiceTree_Node_ID_Duplication_Bug.md]]`
    },
    {
      path: '2_VoiceTree_Node_ID_Duplication_Bug.md',
      content: `---
node_id: 2
title: VoiceTree Node ID Duplication Bug
---

### VoiceTree Node ID Duplication Bug

When testing the website, multiple nodes are identified with the same ID, causing a bug.

-----------------
_Links:_
Parent:
- is_a_bug_identified_during [[1_VoiceTree_Website_Development_and_Node_Display_Bug.md]]
Children:
- is_the_immediate_outcome_of [[3_Speaker_s_Immediate_Action_Testing.md]]`
    },
    {
      path: '3_Speaker_s_Immediate_Action_Testing.md',
      content: `---
node_id: 3
title: Speaker's Immediate Action Testing
---

### Speaker's Immediate Action Testing

The speaker decides to immediately test the issue.

-----------------
_Links:_
Parent:
- is_the_immediate_outcome_of [[2_VoiceTree_Node_ID_Duplication_Bug.md]]
Children:
- is_an_immediate_observation_during [[4_Test_Outcome_No_Output.md]]
- is_an_immediate_observation_during [[5_Immediate_Test_Observation_No_Output.md]]`
    },
    {
      path: '4_Test_Outcome_No_Output.md',
      content: `---
node_id: 4
title: Test Outcome No Output
---

### Test Outcome No Output

The test produces no output, indicating a potential issue with the code execution or data retrieval.

-----------------
_Links:_
Parent:
- is_an_immediate_observation_during [[3_Speaker_s_Immediate_Action_Testing.md]]`
    },
    {
      path: '5_Immediate_Test_Observation_No_Output.md',
      content: `---
node_id: 5
title: Immediate Test Observation No Output
---

### Immediate Test Observation No Output

The speaker observes that nothing is being produced as output.

-----------------
_Links:_
Parent:
- is_an_immediate_observation_during [[3_Speaker_s_Immediate_Action_Testing.md]]`
    },
    {
      path: '6_Personal_Logistics_and_Requests.md',
      content: `---
node_id: 6
title: Personal Logistics and Requests
---

### Personal Logistics and Requests

Speaker mentions dropping off wife, requesting text upon arrival, and checking if coffee preparation is needed.`
    }
  ];

  console.log('Loading example files...');

  // Dispatch file-added events for each file
  for (const file of files) {
    console.log(`Adding file: ${file.path}`);
    window.dispatchEvent(new CustomEvent('file-added', {
      detail: {
        path: file.path,
        content: file.content
      }
    }));

    // Small delay between files to simulate realistic loading
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  console.log('✅ All example files loaded!');
  console.log('The graph should now show 6 nodes with connections.');
  console.log('Try clicking on a node to open the floating markdown editor!');
}

// Run the function
loadExampleFiles();