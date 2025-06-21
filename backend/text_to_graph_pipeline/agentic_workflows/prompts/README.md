# VoiceTree Prompt Templates - JSON Parsing Guide

## Overview

This directory contains prompt templates for the VoiceTree agentic workflow system. These prompts use Python's `str.format()` method for variable substitution, which requires careful handling of JSON examples and braces.

## ⚠️ Critical Issue: Brace Escaping in Prompts

### The Problem

Python's `str.format()` method treats `{` and `}` as special characters for variable substitution. When prompts contain JSON examples or any literal braces, they must be properly escaped or the system will crash with `KeyError` exceptions.

**Common Error Pattern:**
```
KeyError: '"name"'
KeyError: ' "chunks"'
```

### The Solution: Escape Rules

#### 1. Template Variables (DO NOT ESCAPE)
Variables that receive actual data should remain unescaped:
```
✅ CORRECT:
{transcript_text}
{existing_nodes}
{analyzed_sub_chunks}

❌ WRONG:
{{transcript_text}}  # This won't substitute!
```

#### 2. JSON Examples in Prompts (MUST ESCAPE)
Any JSON examples shown to the LLM must have braces doubled:
```
✅ CORRECT:
{{"name": "Example", "text": "Sample text"}}

❌ WRONG:
{"name": "Example", "text": "Sample text"}  # Will cause KeyError!
```

#### 3. Complete Example
```
**Input Data:**
{input_data}  # ← Template variable (no escaping)

**Expected Output:**
```json
{{
  "chunks": [
    {{"name": "Task 1", "text": "Do something"}},
    {{"name": "Task 2", "text": "Do something else"}}
  ]
}}
```  # ← JSON example (braces escaped)
```

## 🔧 Long-term Solutions

### Option 1: Template Engine Migration (Recommended)

Replace `str.format()` with Jinja2 templates for better separation of concerns:

```python
from jinja2 import Template

# Current problematic approach:
prompt = template.format(transcript_text=text)

# Better approach with Jinja2:
template = Template(prompt_content)
prompt = template.render(transcript_text=text)
```

**Benefits:**
- No brace escaping needed
- Better error messages
- More powerful templating features
- Industry standard

### Option 2: JSON Schema Validation

Implement structured output validation to catch format issues early:

```python
def validate_prompt_output(response: str, schema_class: BaseModel):
    try:
        return schema_class.model_validate_json(response)
    except ValidationError as e:
        # Log specific validation errors
        # Attempt JSON extraction/repair
        return extract_and_repair_json(response, schema_class)
```

### Option 3: Prompt Format Standardization

Create a standard prompt format that minimizes JSON examples:

```
INSTRUCTIONS: [Clear instructions without JSON]
SCHEMA: [Reference to external schema file]
INPUT: {template_variables}
OUTPUT: [Minimal format description]
```

## 📋 Checklist for New Prompts

Before adding a new prompt template:

- [ ] All template variables use single braces: `{variable_name}`
- [ ] All JSON examples use double braces: `{{"key": "value"}}`
- [ ] Test prompt formatting with sample data
- [ ] Verify LLM output matches expected schema
- [ ] Add validation for the response format

## 🐛 Debugging Prompt Issues

### 1. Test Prompt Formatting
```python
# Create a simple test script:
with open('prompt.txt', 'r') as f:
    template = f.read()

try:
    formatted = template.format(variable_name="test_value")
    print("✅ Formatting successful")
except KeyError as e:
    print(f"❌ Unescaped brace found: {e}")
```

### 2. Common Error Patterns
- `KeyError: '"name"'` → JSON example needs brace escaping
- `KeyError: ' "chunks"'` → JSON with leading space needs escaping
- `KeyError: 'field_name'` → Missing template variable or typo

### 3. Quick Fix Commands
```bash
# Find unescaped JSON patterns:
grep -n '{"' *.txt
grep -n '"}' *.txt

# Find template variables:
grep -n '{[^{]' *.txt
```

## 📁 Current Prompt Files

| File | Purpose | Status | Schema |
|------|---------|--------|--------|
| `segmentation.txt` | Split transcripts into chunks | ✅ Fixed | `SegmentationResponse` |
| `relationship_analysis.txt` | Find chunk relationships | ✅ Fixed | `RelationshipResponse` |
| `integration_decision.txt` | Decide CREATE vs APPEND | ✅ Fixed | `IntegrationResponse` |

## 🚀 Implementation Roadmap

### Phase 1: Immediate Fixes (Completed)
- [x] Fix all brace escaping issues
- [x] Update schema formats to match prompts
- [x] Add comprehensive testing

### Phase 2: Template Engine Migration
- [x] Implement custom template engine (`../prompt_engine.py`)
- [ ] Convert all prompts to {{variable}} format
- [ ] Update LLM integration to use new templates
- [ ] Add template validation

### Phase 3: Advanced Features
- [ ] Dynamic schema generation
- [ ] Prompt versioning system
- [ ] A/B testing framework for prompts
- [ ] Automated prompt optimization

## 💡 Best Practices

1. **Always test prompts** with real data before deployment
2. **Use consistent naming** for template variables across prompts
3. **Document expected inputs/outputs** for each prompt
4. **Version control prompts** separately from code when possible
5. **Monitor LLM response quality** and adjust prompts accordingly

## 🔗 Related Files

- `../llm_integration.py` - Handles prompt formatting and LLM calls
- `../schema_models.py` - Defines expected response schemas
- `../nodes.py` - JSON extraction and validation utilities
- `../prompt_engine.py` - **NEW**: Custom template engine to replace str.format()
- `../../tests/integration_tests/test_reproduction_issues.py` - Tests for prompt issues

## 🎯 Quick Start with New Template Engine

To avoid brace escaping issues entirely, use the new template engine:

```python
from prompt_engine import PromptLoader

# Load and render a template
loader = PromptLoader()
prompt = loader.render_template('segmentation', transcript_text="Hello world")

# Or use directly
from prompt_engine import PromptTemplate
template = PromptTemplate.from_file('prompts/segmentation.txt')
prompt = template.render(transcript_text="Hello world")
```

**Benefits:**
- No more brace escaping needed
- JSON examples work naturally
- Clear error messages
- Backward compatible 