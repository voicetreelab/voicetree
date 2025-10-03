import { loadMarkdownTree } from './MarkdownParser';
import { FileLoader } from './FileLoader';
import type { MarkdownTree } from '@/graph-core/types';

export class ExampleLoader {
  /**
   * Load example files from the test directory
   * Note: This is a development utility and would need to be adapted for production
   * where files would likely be loaded via API calls instead of direct file system access
   */
  static async loadExampleSmall(): Promise<MarkdownTree> {
    // In a real application, these would be loaded via fetch() or API calls
    // For now, we'll simulate the example data based on the files we examined
    const exampleFiles = new Map<string, string>();

    exampleFiles.set('1_VoiceTree_Website_Development_and_Node_Display_Bug.md', `---
node_id: 1
title: VoiceTree Website Development and Node Display Bug (1)
---
### Ongoing development for the VoiceTree website.

We're working on the website right now for VoiceTree.


-----------------
_Links:_
`);

    exampleFiles.set('2_VoiceTree_Node_ID_Duplication_Bug.md', `---
node_id: 2
title: VoiceTree Node ID Duplication Bug (2)
---
### A bug where VoiceTree nodes display duplicated names or IDs needs to be fixed during website development.

Nodes show their name or number, their ID being duplicated, if I recall correctly. So it'd be nice to just quickly fix it up while we're working on the website in parallel.


-----------------
_Links:_
Parent:
- is_a_bug_identified_during [[1_VoiceTree_Website_Development_and_Node_Display_Bug.md]]
`);

    exampleFiles.set('3_Speaker_s_Immediate_Action_Testing.md', `---
node_id: 3
title: Speaker's Immediate Action/Testing (3)
---
### Speaker performs immediate audio tests, repeating phrases like "testing one, two, three" and "hello."

Alright, cool. So I want to test something right now. All right, testing one, two, three, testing.three. All right, testing, one, two, three. cool so Yeah, cool. So hello, hello, hello, hello.


-----------------
_Links:_
`);

    exampleFiles.set('4_Test_Outcome_No_Output.md', `---
node_id: 4
title: 'Test Outcome: No Output (4)'
---
### Multiple tests, including specific instances, are yielding no visible output.

We're testing multiple things (one, two, three, four, five, seven, eight) and realizing it doesn't even show up; it just doesn't seem to be working, yielding no visible output. Specifically, when testing one thing, there is no output at all, which is unfortunate.


-----------------
_Links:_
Parent:
- is_the_immediate_outcome_of [[3_Speaker_s_Immediate_Action_Testing.md]]
`);

    exampleFiles.set('5_Immediate_Test_Observation_No_Output.md', `---
node_id: 5
title: 'Immediate Test Observation: No Output (5)'
---
### Speaker observes no output despite repeated speech input during an immediate test.

All right, so I'm testing 'one, two, three'. I don't see anything. All right, so I'm taking something about talking and...nothing is showing up. All right, so I'm talking, I'm talking, I'm talking, and nothing's coming up. Strange.


-----------------
_Links:_
Parent:
- is_an_immediate_observation_during [[4_Test_Outcome_No_Output.md]]
`);

    exampleFiles.set('6_Personal_Logistics_and_Requests.md', `---
node_id: 6
title: Personal Logistics and Requests (6)
---
### You want me to drive you soon, Dan? Can we drive you soon? Okay, give me five minutes

You want me to drive you soon, Dan? Can we drive you soon? Okay, give me five minutes.


-----------------
_Links:_
`);

    return loadMarkdownTree(exampleFiles);
  }

  /**
   * Load files from user's computer using file picker
   * Cross-browser compatible approach
   */
  static async loadFromUserFiles(): Promise<MarkdownTree | null> {
    return FileLoader.pickMultipleFiles();
  }

  /**
   * Load a single file from user's computer using file picker
   */
  static async loadSingleFile(): Promise<MarkdownTree | null> {
    return FileLoader.pickSingleFile();
  }

  /**
   * Load directory from user's computer using directory picker
   */
  static async loadFromDirectory(): Promise<MarkdownTree | null> {
    return FileLoader.pickDirectory();
  }

  /**
   * Create a drag & drop zone for file loading
   */
  static createFileDropZone(onFilesLoaded: (tree: MarkdownTree) => void): HTMLDivElement {
    return FileLoader.createDropZone(onFilesLoaded);
  }

  /**
   * Setup paste handler for file loading (Ctrl+V)
   */
  static setupFilePasteHandler(onFilesLoaded: (tree: MarkdownTree) => void): void {
    FileLoader.setupPasteHandler(onFilesLoaded);
  }
}
