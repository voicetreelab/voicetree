# VoiceTree Architecture Facts

## Non-Obvious Implementation Details

**Quality Analysis Hub**: `debug_workflow.py` contains the `WorkflowQualityScorer` class that scores all 4 pipeline stages. This isn't documented anywhere and you'd have to dig through the code to find it.

**Orchestration Split**: `unified_voicetree_benchmarker.py` imports and uses the scorer from `debug_workflow.py` - the analysis logic and test orchestration are separated across these two files.

**Stage Weights**: Overall workflow score uses hardcoded weights: segmentation 20%, relationship 25%, integration 35%, extraction 20%. Integration Decision stage is weighted highest (35%) but this isn't obvious from the pipeline flow. 