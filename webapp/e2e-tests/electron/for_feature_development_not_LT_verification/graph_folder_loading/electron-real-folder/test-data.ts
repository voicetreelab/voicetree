export const NEW_CONCEPT_CONTENT = `# New Concept

This is a dynamically added concept that links to [[10_Setting_up_Agent_in_Feedback_Loop]] and [[14_Assign_Agent_to_Identify_Boundaries]].

It demonstrates that the file watcher detects new files in real-time.`;

export const COMPLEX_LINKS_CONTENT = `# Complex Links Test

## Different Link Formats
- Basic: [[10_Setting_up_Agent_in_Feedback_Loop]]
- Another: [[14_Assign_Agent_to_Identify_Boundaries]]
- Non-existent: [[ghost-file]]
- Self-reference: [[complex-links]]

## Multiple Links in One Line
Check out [[17_Create_G_Cloud_Configuration]], [[16_Resolve_G_Cloud_CLI_MFA_Block]], and [[14_1_Victor_Append_Agent_Extraction_Analysis_Complete]] for more info.

## Links in Lists
1. First point about [[20_Create_Cloud_Functions_Directory]]
2. Second point referencing [[19_Bare_Minimum_Conversion_Requirements_for_Quick_Test]]
3. Third point linking to [[18_Observation_Plan_Complexity_for_Agent_Conversion]]`;

export const INCREMENTAL_TEST_FILES = [
  {
    name: 'incremental-test-1.md',
    content: '# Incremental Test 1\n\nFirst incrementally added node. Links to [[introduction]].'
  },
  {
    name: 'incremental-test-2.md',
    content: '# Incremental Test 2\n\nSecond incremental node. References [[architecture]] and [[incremental-test-1]].'
  },
  {
    name: 'incremental-test-3.md',
    content: '# Incremental Test 3\n\nThird incremental node. Connects to [[core-principles]].'
  }
];
