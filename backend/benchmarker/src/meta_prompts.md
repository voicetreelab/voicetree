First run the benchmarker, `python backend/benchmarker/src/quality_LLM_benchmarker.py` and look at the quality report afterwards, backend/benchmarker/logs/latest_quality_log.txt

Then perform your own analysis, inspect the output in backend/benchmarker/output

and look at the LLM debug logs (inputs + outputs) to map the problems in the output, to specific behaviours the LLM did. 

Use zen tools (thinkdeep, challenge,  consensus) to propose the most important improvements that should be made to the  prompts for VoiceTree pipeline, which are stored in backend/text_to_graph_pipeline/agentic_workf
  lows/prompts/