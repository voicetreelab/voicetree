# Rough Capture Fixture

This node intentionally omits frontmatter so the filesystem authoring flow can add
`agent_name`, `color`, and `isContextNode` during its auto-fix pass.

## Recovery Shape

The heading and body are already valid, so frontmatter insertion should be the only fix.
