Please critically analyze this plan to start using prompt_engine.py
Is this the right thing to do? Any logical bugs?

## Implementation Plan for prompt_engine.py

### Phase 1: Integration
1. Update `nodes.py` to use `PromptLoader` instead of direct file reading
2. Update the `format_prompt()` function to use `PromptTemplate.render()`
3. Test with existing prompts (no changes needed to prompt files initially)

### Phase 2: Migration
1. Update all prompt files to use `{{variable}}` syntax
2. Remove double-brace escaping from JSON examples
3. Run the migration helper on existing prompts
4. Validate all prompts still work correctly

### Benefits of Using prompt_engine.py
- **Developer Experience**: No more escaping JSON in prompts
- **Readability**: Prompts become much cleaner and easier to understand
- **Maintainability**: Less error-prone when editing prompts
- **Performance**: Built-in template caching

### Example Before/After

**Before (current system)**:
```
Process this data: {input_data}

Expected format:
```json
{{
  "chunks": [
    {{
      "content": "example",
      "id": 1
    }}
  ]
}}
```

**After (with prompt_engine)**:
```
Process this data: {{input_data}}

Expected format:
```json
{
  "chunks": [
    {
      "content": "example",
      "id": 1
    }
  ]
}
```

## Conclusion

The `prompt_engine.py` file should be integrated as it solves a real problem and improves developer experience. The other two files can be considered for future improvements but are not necessary for the current system's functionality.