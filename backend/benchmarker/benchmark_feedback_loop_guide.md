# VoiceTree Benchmarker Guide

## Testing Tools

### 1. Full System Benchmarker (Recommended)
```bash
python -m backend.benchmarker.quality_tests.quality_LLM_benchmarker
```
**Outputs:**
- Markdown files: `oldVaults/VoiceTreePOC/QualityTest/`
- Debug logs: `backend/agentic_workflows/debug_logs/`

### 2. Debug Workflow Analysis
After running benchmarker:
1. **Check final output quality** - Read all generated .md files
2. **Identify problems** - Missing content, poor tree structure, repetition
3. **Trace backwards** through debug logs to find root cause

## Systematic Debug Analysis

### Debug Files & What to Check

#### `segmentation_debug.txt`
- ❓ Are all transcript concepts present in chunks?
- ❓ Are chunks complete thoughts (not fragments)?
- ❓ Do breaks happen at concept boundaries?
- 🚩 Over/under-segmentation, lost content, broken technical concepts

#### `relationship_analysis_debug.txt`
- ❓ Is existing_nodes context rich and accurate?
- ❓ Are meaningful relationships identified?
- ❓ Are relationships strong ("implements") vs weak ("relates to")?
- 🚩 All chunks showing "no strong relationships"

#### `integration_decision_debug.txt`
- ❓ Is CREATE/APPEND ratio ~50/50?
- ❓ Are content fields bullet points (not raw transcript)?
- ❓ Do decisions match relationships?
- 🚩 Too many CREATEs, raw transcript copying
## Output Quality Checklist

### Before Analysis
Map the original transcript:
- Major topics (3-5 themes)
- Technical details mentioned
- Action items/decisions
- Conversation flow

### Quality Red Flags
- **Repetitive bullets** within same node
- **Vague titles** ("Different things", "Multiple tasks")
- **Raw transcript** instead of summaries
- **Missing major topics** from transcript
- **Fragmented concepts** split illogically

### Good vs Bad Examples

❌ **Bad Output:**
```markdown
### 2_Different_things_to_do.md
• Multiple tasks related to voice tree work
• Several aspects to consider
```

✅ **Good Output:**
```markdown
### Streaming_Audio_Engineering_Problem.md
• Current app expects continuous voice input
• System requires atomic (complete) audio files
• Need to decide: send files after completion vs continual processing
• Affects overall architecture of voice tree system
```

## Common Problems & Solutions

### Problem: Raw Transcript in Output
**Look in:** `integration_decision_debug.txt` - check `content` field
**Fix:** Update integration decision prompt

### Problem: Over-fragmentation
**Look in:** CREATE/APPEND ratio in integration decisions
**Fix:** Improve relationship detection strength

### Problem: Missing Content
**Trace:** Start at segmentation → Check each stage until content disappears
**Fix:** Usually in segmentation boundaries or integration decisions


## Tracing Workflow

Example: "Missing Streaming Audio Discussion"
```bash
# Work backwards through stages
grep -i "stream" backend/agentic_workflows/debug_logs/integration_decision_debug.txt
grep -i "stream" backend/agentic_workflows/debug_logs/relationship_analysis_debug.txt
grep -i "stream" backend/agentic_workflows/debug_logs/segmentation_debug.txt
```
Find the FIRST stage where content goes missing.

## Quality Scoring Framework

### Per-Stage Scoring (0-100)

**Segmentation:**
- Content completeness (40pts)
- Chunk coherence (30pts)
- Boundary logic (20pts)
- Size appropriateness (10pts)

**Relationship Analysis:**
- Context quality (25pts)
- Relationship detection (35pts)
- Relationship strength (25pts)
- Conversation flow (15pts)

**Integration Decision:**
- CREATE/APPEND balance (20pts)
- Content quality (40pts)
- Decision logic (25pts)
- Content synthesis (15pts)

**Node Extraction:**
- Name quality (40pts)
- Name uniqueness (20pts)
- Concept accuracy (25pts)
- Hierarchy awareness (15pts)

### Overall Score
Weighted average:
- Segmentation: 20%
- Relationship: 25%
- Integration: 35%
- Extraction: 20%

Regression alert if stage drops >10 points from baseline.

## Quick Debug Process

1. Run full benchmarker
2. Read generated markdown files
3. Identify specific problems
4. Trace through debug logs stage-by-stage
5. Fix at root cause stage
6. Re-run and verify improvement

## Key Tips

- **Start with output** - Work backwards from bad markdown to find root cause
- **Check CREATE/APPEND ratio** - Should be ~50/50 for good content
- **Verify bullet points** - Content should be summaries, not raw transcript
- **Test systematically** - Change one thing at a time
- **Focus on Integration stage** - Has highest impact (35%) on quality

Remember: The goal is coherent knowledge structures, not just processed text.