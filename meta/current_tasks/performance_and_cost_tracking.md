# Task: Implement Performance and Cost Tracking for Agentic Workflow

**Status:** To Do

**Created:** `eval: new Date().toISOString()`

## 1. Problem Statement

The VoiceTree agentic workflow has a robust quality benchmarking system, but it lacks visibility into performance (latency) and operational cost (LLM token usage). The current 4-stage pipeline is presumed to be slow and expensive, making it difficult to assess its viability for a production environment. To guide optimization efforts and make informed decisions about model usage and pipeline architecture, we need to systematically measure and track these metrics.

## 2. The Plan (Revised & Vetted)

The solution is to use LangGraph's native callback system to instrument the agentic workflow. This approach is more robust, maintainable, and less intrusive than the previously considered decorator/patching method.

### Step 1: Define Telemetry Models and Callback Handler

- **Action:** Create a new file `backend/agentic_workflows/telemetry.py`.
- **Details:** This file will contain the full infrastructure for tracking performance.
    1.  **Pydantic Models:** Define clear, typed models for the metrics (`LLMCallMetrics`, `StageMetrics`, `PipelineMetrics`) to ensure data consistency.
    2.  **`PerformanceCallbackHandler`:** Create a class that inherits from `langchain_core.callbacks.BaseCallbackHandler`.
        - It will use `on_chain_start` and `on_chain_end` to measure the latency of each LangGraph node (which corresponds to a pipeline stage).
        - It will use `on_llm_end` to capture token usage (`input_tokens`, `output_tokens`) and model name from the `LLMResult` object passed to the handler.
        - It will calculate the cost for each LLM call and aggregate all metrics into the `PipelineMetrics` Pydantic model.

### Step 2: Integrate the Callback Handler into the Benchmarker

- **Action:** Modify `backend/benchmarker/unified_voicetree_benchmarker.py`.
- **Details:** This is the ideal place to manage the instrumentation, as it's the entry point for the test runs.
    1.  **Instantiate Handler:** In the main benchmark running function (e.g., `run_tada_troa_test`), create an instance of our new `PerformanceCallbackHandler`.
    2.  **Pass Handler at Runtime:** When invoking the LangGraph application (e.g., `app.invoke` or `app.stream`), pass the handler in the `config` dictionary: `config={"callbacks": [performance_handler]}`. This ensures the handler is used for the entire execution and all sub-runs.
    3.  **Retrieve Metrics:** After the workflow execution is complete, the `performance_handler.metrics` attribute will contain the fully populated `PipelineMetrics` object.

### Step 3: Enhance the Benchmarker Report

- **Action:** Further modify `backend/benchmarker/unified_voicetree_benchmarker.py`.
- **Details:** Use the structured `PipelineMetrics` object to generate the new report section.
    1.  **Create a new private method** `_write_performance_section` that takes the `PipelineMetrics` object as an argument.
    2.  This method will iterate through the `pipeline_metrics.stages` dictionary to create a Markdown table with columns: `Stage`, `Latency (s)`, `LLM Calls`, `Input Tokens`, `Output Tokens`, and `Est. Cost ($)`.
    3.  It will also calculate and display totals.
    4.  Call this new method from `_generate_markdown_report` for each test run that produces metrics.

## 3. Critical Evaluation & Justification

- **Architectural Soundness:** This plan uses the officially documented, intended mechanism for instrumenting LangChain/LangGraph applications. It avoids brittle techniques like monkey-patching.
- **Maintainability:** All performance tracking logic is encapsulated in `telemetry.py`. The pipeline nodes themselves remain clean and unaware of the instrumentation.
- **Robustness:** The callback system is part of the core framework and is designed to be thread-safe and handle `async` operations correctly.
- **Data Flow:** The data flow is explicit and clean. The benchmarker owns the `PerformanceCallbackHandler` instance, passes it to the runner, and retrieves the results directly from the instance. There is no need to modify the `VoiceTreeState` or pass metrics through application state, which correctly separates application data from telemetry data. 