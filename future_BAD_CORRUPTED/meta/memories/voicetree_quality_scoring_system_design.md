# VoiceTree Scoring System Facts

## Hardcoded Point Allocations (Non-Obvious)

**Segmentation Metrics**: Content Completeness gets 40pts, Chunk Coherence 30pts, Boundary Logic 20pts, Size Appropriateness only 10pts. You'd have to read the WorkflowQualityScorer code to discover these weights.

**Relationship Analysis Priority**: Relationship Detection is weighted highest at 35pts, not Context Quality (25pts) as you might expect. Conversation Flow gets lowest priority at 15pts.

**Integration Decision Emphasis**: Content Quality dominates with 40pts, while Content Synthesis only gets 15pts. Decision Logic (25pts) > Decision Balance (20pts).

**Node Extraction Hierarchy**: Name Quality is prioritized at 40pts, Concept Accuracy only 25pts, Name Uniqueness just 20pts, Hierarchy Awareness lowest at 15pts. 