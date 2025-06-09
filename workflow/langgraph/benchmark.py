#!/usr/bin/env python3
"""
Benchmarker to compare LangGraph multi-stage pipeline vs single-LLM approach
Similar to quality_LLM_benchmarker.py but comparing two approaches
"""

import asyncio
import json
import time
import os
import sys
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Any, Tuple

# Add parent directory to path for imports
sys.path.append(str(Path(__file__).parent.parent.parent))

# Import LangGraph pipeline
from main import run_voicetree_pipeline

# Import existing single-LLM approach
try:
    from backend.tree_manager.LLM_engine.LLM_engine import LLMEngine
    from backend.tree_manager.decision_tree_ds import DecisionTree
    from backend.tree_manager.text_to_tree_manager import ContextualTreeManager
    SINGLE_LLM_AVAILABLE = True
except ImportError:
    print("⚠️ Could not import single-LLM components - will use mock")
    SINGLE_LLM_AVAILABLE = False

# Import Gemini for quality evaluation
try:
    import google.generativeai as genai
    from google.generativeai import GenerativeModel
    GEMINI_AVAILABLE = True
except ImportError:
    print("⚠️ Google Generative AI not available for quality evaluation")
    GEMINI_AVAILABLE = False

# Try to load settings for API key
try:
    from backend import settings
    if GEMINI_AVAILABLE and hasattr(settings, 'GOOGLE_API_KEY'):
        genai.configure(api_key=settings.GOOGLE_API_KEY)
except ImportError:
    pass


class VoiceTreeBenchmarker:
    """Benchmarker for comparing VoiceTree approaches"""
    
    def __init__(self, output_dir: str = "benchmark_results"):
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(exist_ok=True)
        self.results_file = self.output_dir / f"benchmark_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        
    async def run_single_llm_approach(self, transcript: str, existing_nodes: List[str]) -> Tuple[Dict[str, Any], float]:
        """Run the existing single-LLM approach"""
        start_time = time.time()
        
        if not SINGLE_LLM_AVAILABLE:
            # Mock response for testing
            await asyncio.sleep(0.5)  # Simulate processing time
            result = {
                "new_nodes": ["Mock Node 1", "Mock Node 2"],
                "relationships": [("Mock Node 1", "relates to", existing_nodes[0])],
                "approach": "single-llm-mock"
            }
        else:
            # Run actual single-LLM approach
            decision_tree = DecisionTree()
            tree_manager = ContextualTreeManager(decision_tree)
            
            # Process the transcript
            result = await tree_manager.process_text(transcript)
            
            # Extract results in comparable format
            result = {
                "new_nodes": [node.name for node in result.get("new_nodes", [])],
                "relationships": result.get("relationships", []),
                "approach": "single-llm"
            }
        
        elapsed_time = time.time() - start_time
        return result, elapsed_time
    
    def run_langgraph_approach(self, transcript: str, existing_nodes: List[str]) -> Tuple[Dict[str, Any], float]:
        """Run the LangGraph multi-stage approach"""
        start_time = time.time()
        
        try:
            # Run the LangGraph pipeline
            result = run_voicetree_pipeline(transcript, existing_nodes)
            
            # Extract comparable results
            if result.get("current_stage") == "complete":
                processed_result = {
                    "new_nodes": result.get("new_nodes", []),
                    "chunks": result.get("chunks", []),
                    "analyzed_chunks": result.get("analyzed_chunks", []),
                    "integration_decisions": result.get("integration_decisions", []),
                    "approach": "langgraph-multi-stage"
                }
            else:
                processed_result = {
                    "error": result.get("error_message", "Unknown error"),
                    "approach": "langgraph-multi-stage"
                }
        except Exception as e:
            processed_result = {
                "error": str(e),
                "approach": "langgraph-multi-stage"
            }
        
        elapsed_time = time.time() - start_time
        return processed_result, elapsed_time
    
    def evaluate_quality(self, transcript: str, result: Dict[str, Any], approach_name: str) -> Dict[str, Any]:
        """Evaluate the quality of results using Gemini"""
        if not GEMINI_AVAILABLE:
            return {
                "overall_score": "N/A",
                "evaluation": "Gemini API not available for quality evaluation"
            }
        
        prompt = f"""
        You are an expert at evaluating the quality of knowledge graph extraction from transcripts.
        
        Evaluate the following results from the {approach_name} approach:
        
        **Original Transcript:**
        {transcript}
        
        **Extracted Results:**
        {json.dumps(result, indent=2)}
        
        Please evaluate based on these criteria:
        1. **Accuracy**: How well does it capture the key ideas from the transcript?
        2. **Completeness**: Are all important concepts extracted?
        3. **Granularity**: Are ideas appropriately segmented (not too broad, not too fragmented)?
        4. **Relationships**: Are meaningful connections identified between concepts?
        5. **Clarity**: Are the extracted nodes clear and well-named?
        
        Provide:
        - A score for each criterion (1-5, where 5 is excellent)
        - An overall score (1-5)
        - Brief comments on strengths and weaknesses
        - Specific examples from the results
        
        Format your response as JSON with this structure:
        {{
            "accuracy": <score>,
            "completeness": <score>,
            "granularity": <score>,
            "relationships": <score>,
            "clarity": <score>,
            "overall_score": <score>,
            "strengths": ["strength1", "strength2"],
            "weaknesses": ["weakness1", "weakness2"],
            "comments": "detailed evaluation comments"
        }}
        """
        
        try:
            model = GenerativeModel('gemini-1.5-flash')
            response = model.generate_content(prompt)
            
            # Try to parse JSON from response
            import re
            json_match = re.search(r'\{.*\}', response.text, re.DOTALL)
            if json_match:
                return json.loads(json_match.group())
            else:
                return {
                    "overall_score": "Parse Error",
                    "evaluation": response.text
                }
        except Exception as e:
            return {
                "overall_score": "Error",
                "evaluation": f"Error during evaluation: {str(e)}"
            }
    
    async def benchmark_transcript(self, transcript: str, existing_nodes: List[str], test_name: str = "Test") -> Dict[str, Any]:
        """Run benchmark on a single transcript"""
        print(f"\n🧪 Running benchmark: {test_name}")
        print("=" * 60)
        
        results = {
            "test_name": test_name,
            "timestamp": datetime.now().isoformat(),
            "transcript_length": len(transcript),
            "existing_nodes_count": len(existing_nodes),
            "approaches": {}
        }
        
        # Run single-LLM approach
        print("📊 Testing single-LLM approach...")
        single_result, single_time = await self.run_single_llm_approach(transcript, existing_nodes)
        single_quality = self.evaluate_quality(transcript, single_result, "single-LLM")
        
        results["approaches"]["single-llm"] = {
            "result": single_result,
            "execution_time": single_time,
            "quality_evaluation": single_quality
        }
        
        # Run LangGraph approach
        print("📊 Testing LangGraph multi-stage approach...")
        langgraph_result, langgraph_time = self.run_langgraph_approach(transcript, existing_nodes)
        langgraph_quality = self.evaluate_quality(transcript, langgraph_result, "LangGraph multi-stage")
        
        results["approaches"]["langgraph"] = {
            "result": langgraph_result,
            "execution_time": langgraph_time,
            "quality_evaluation": langgraph_quality
        }
        
        # Compare results
        print("\n📈 Results Comparison:")
        print(f"   Single-LLM time: {single_time:.2f}s")
        print(f"   LangGraph time: {langgraph_time:.2f}s")
        print(f"   Speed difference: {abs(single_time - langgraph_time):.2f}s")
        
        if isinstance(single_quality.get("overall_score"), (int, float)) and isinstance(langgraph_quality.get("overall_score"), (int, float)):
            print(f"   Single-LLM quality: {single_quality['overall_score']}/5")
            print(f"   LangGraph quality: {langgraph_quality['overall_score']}/5")
        
        return results
    
    async def run_benchmark_suite(self):
        """Run a suite of benchmark tests"""
        test_cases = [
            {
                "name": "Simple Project Planning",
                "transcript": """
                Today I want to work on my new project. 
                I need to set up the development environment first.
                Then I'll implement the core features.
                Finally, I'll add tests and documentation.
                """,
                "existing_nodes": ["Project Management", "Development", "Testing"]
            },
            {
                "name": "Complex Technical Discussion",
                "transcript": """
                We need to redesign our system architecture to handle increased load.
                The current monolithic approach is causing bottlenecks.
                I propose moving to a microservices architecture with separate services for user management, 
                data processing, and API gateway.
                Each service should have its own database to ensure loose coupling.
                We'll use Kubernetes for orchestration and implement circuit breakers for resilience.
                This relates to our previous discussions about scalability and performance optimization.
                """,
                "existing_nodes": ["System Architecture", "Performance", "Scalability", "Database Design", "DevOps"]
            },
            {
                "name": "Meeting Notes with Action Items",
                "transcript": """
                In today's meeting we discussed three main topics.
                First, the Q4 revenue projections look promising with a 15% increase expected.
                Second, we need to hire two more engineers for the mobile team by end of month.
                John will handle the recruitment process.
                Third, the customer feedback on the new feature has been mixed.
                Sarah will analyze the feedback and present findings next week.
                We'll reconvene next Tuesday to review progress.
                """,
                "existing_nodes": ["Revenue", "Hiring", "Customer Feedback", "Team Meetings", "Mobile Development"]
            }
        ]
        
        all_results = []
        
        for test_case in test_cases:
            result = await self.benchmark_transcript(
                test_case["transcript"],
                test_case["existing_nodes"],
                test_case["name"]
            )
            all_results.append(result)
            
            # Rate limit to avoid API limits
            await asyncio.sleep(2)
        
        # Save all results
        with open(self.results_file, 'w') as f:
            json.dump(all_results, f, indent=2)
        
        print(f"\n✅ Benchmark complete! Results saved to: {self.results_file}")
        
        # Generate summary report
        self.generate_summary_report(all_results)
    
    def generate_summary_report(self, results: List[Dict[str, Any]]):
        """Generate a summary report of benchmark results"""
        report_file = self.output_dir / "benchmark_summary.md"
        
        with open(report_file, 'w') as f:
            f.write("# VoiceTree Benchmark Summary\n\n")
            f.write(f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n\n")
            
            # Overall statistics
            total_tests = len(results)
            avg_single_time = sum(r["approaches"]["single-llm"]["execution_time"] for r in results) / total_tests
            avg_langgraph_time = sum(r["approaches"]["langgraph"]["execution_time"] for r in results) / total_tests
            
            f.write("## Overall Performance\n\n")
            f.write(f"- Total tests run: {total_tests}\n")
            f.write(f"- Average single-LLM time: {avg_single_time:.2f}s\n")
            f.write(f"- Average LangGraph time: {avg_langgraph_time:.2f}s\n")
            f.write(f"- LangGraph is {'faster' if avg_langgraph_time < avg_single_time else 'slower'} by {abs(avg_single_time - avg_langgraph_time):.2f}s on average\n\n")
            
            # Individual test results
            f.write("## Test Results\n\n")
            for result in results:
                f.write(f"### {result['test_name']}\n\n")
                f.write(f"- Transcript length: {result['transcript_length']} chars\n")
                f.write(f"- Single-LLM time: {result['approaches']['single-llm']['execution_time']:.2f}s\n")
                f.write(f"- LangGraph time: {result['approaches']['langgraph']['execution_time']:.2f}s\n")
                
                # Quality scores if available
                single_quality = result['approaches']['single-llm']['quality_evaluation']
                langgraph_quality = result['approaches']['langgraph']['quality_evaluation']
                
                if isinstance(single_quality.get('overall_score'), (int, float)):
                    f.write(f"- Single-LLM quality: {single_quality['overall_score']}/5\n")
                if isinstance(langgraph_quality.get('overall_score'), (int, float)):
                    f.write(f"- LangGraph quality: {langgraph_quality['overall_score']}/5\n")
                
                f.write("\n")
        
        print(f"📄 Summary report saved to: {report_file}")


async def main():
    """Run the benchmark suite"""
    benchmarker = VoiceTreeBenchmarker()
    await benchmarker.run_benchmark_suite()


if __name__ == "__main__":
    asyncio.run(main())
