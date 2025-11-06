│  > What would be a good way to map files to the tests that could potentially be dependent on them?  │
╰─────────────────────────────────────────────────────────────────────────────────────────────────────╯

✦ That's an excellent question. Mapping files to their dependent tests is key for efficient development, as it allows you to run only the
relevant tests after a code change.

Here are two good approaches, ranging from using a dedicated tool to writing a custom script:

Approach 1: Use a Dependency Analysis Tool (Recommended)

The most robust method is to use a dedicated tool like dependency-cruiser. It statically analyzes your codebase to build a dependency
graph, which you can then query. It's powerful, configurable, and can output results in machine-readable formats like JSON.

Plan:
1. Install: Add dependency-cruiser to your project's dev dependencies.
2. Configure & Run: Execute it with parameters to focus on test files and their dependencies.
3. Process Output: The JSON output will provide the mapping you need.

Approach 2: Write a Custom Script

You could write a script that performs a simpler, more direct analysis.

Plan:
1. Find Test Files: Use a glob pattern to find all test files (e.g., tests/**/*.spec.ts, src/**/*.test.tsx).
2. Parse Imports: For each test file, read its content and use a regular expression to extract all import paths.
3. Resolve Paths: Resolve the imported paths to absolute file paths. This can be tricky due to aliases (@/components) defined in
   tsconfig.json.
4. Build the Map: Create a data structure that maps each source file to the list of test files that import it.

The first approach is generally better as it leverages a tool built for this exact purpose and handles complexities like absolutePath aliases
automatically. The second approach offers more control but requires more effort to implement correctly.

Which approach sounds better to you? I can proceed with installing dependency-cruiser and running a scan to generate the map.

╭───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╮
│  > dependencycruiser at a glance seems like it migiht be more for actual module dependencies. Is this true or false?  │
╰───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯

✦ That's a sharp observation. You are correct that dependency-cruiser is designed to map module dependencies—that is, how files import or
require each other.

However, this is exactly what makes it the right tool for this task. A test file is "dependent" on a source file precisely because it
imports it.

For example, a test file like tests/component/MarkdownEditor.test.tsx will contain a line like:

1 import { MarkdownEditor } from '../../src/components/MarkdownEditor';

dependency-cruiser will read this and report that MarkdownEditor.test.tsx depends on MarkdownEditor.tsx.

While the tool's primary output shows test file -> source file, we can easily process this data to create the inverse map you want: source
file -> [list of test files].

So, to answer your question directly: False. It's not just for "actual" module dependencies in the sense of source-to-source; it's for any
module dependency, which perfectly includes the relationship between tests and the code they test. It's the ideal tool for this.

Shall I proceed with installing it and running a scan?
