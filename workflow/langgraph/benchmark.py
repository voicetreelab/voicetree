#!/usr/bin/env python3
"""
Benchmarker for LangGraph multi-stage pipeline
Evaluates quality and iterates until achieving 5/5 scores
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
    """Benchmarker for LangGraph VoiceTree approach"""
    
    def __init__(self, output_dir: str = "benchmark_results"):
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(exist_ok=True)
        self.results_file = self.output_dir / f"benchmark_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    
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
    
    def evaluate_quality(self, transcript: str, result: Dict[str, Any]) -> Dict[str, Any]:
        """Evaluate the quality of results using Gemini"""
        if not GEMINI_AVAILABLE:
            return {
                "overall_score": "N/A",
                "evaluation": "Gemini API not available for quality evaluation"
            }
        
        prompt = f"""
        You are an expert at evaluating the quality of knowledge graph extraction from transcripts.
        
        Evaluate the following results from the LangGraph multi-stage approach:
        
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
            model = GenerativeModel('gemini-2.5-flash-preview-05-20')
            response = model.generate_content(prompt)
            
            # Try to parse JSON from response
            import re
            # Clean up any control characters that might cause parsing issues
            cleaned_text = response.text.replace('\n', ' ').replace('\r', ' ').replace('\t', ' ')
            json_match = re.search(r'\{.*\}', cleaned_text, re.DOTALL)
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
        
        # Run LangGraph approach
        print("📊 Testing LangGraph multi-stage approach...")
        langgraph_result, langgraph_time = self.run_langgraph_approach(transcript, existing_nodes)
        langgraph_quality = self.evaluate_quality(transcript, langgraph_result)
        
        results = {
            "test_name": test_name,
            "timestamp": datetime.now().isoformat(),
            "transcript_length": len(transcript),
            "existing_nodes_count": len(existing_nodes),
            "execution_time": langgraph_time,
            "result": langgraph_result,
            "quality_evaluation": langgraph_quality
        }
        
        # Display results
        print(f"\n📈 Results:")
        print(f"   Execution time: {langgraph_time:.2f}s")
        
        if isinstance(langgraph_quality.get("overall_score"), (int, float)):
            print(f"   Quality score: {langgraph_quality['overall_score']}/5")
            print(f"   - Accuracy: {langgraph_quality.get('accuracy', 'N/A')}/5")
            print(f"   - Completeness: {langgraph_quality.get('completeness', 'N/A')}/5")
            print(f"   - Granularity: {langgraph_quality.get('granularity', 'N/A')}/5")
            print(f"   - Relationships: {langgraph_quality.get('relationships', 'N/A')}/5")
            print(f"   - Clarity: {langgraph_quality.get('clarity', 'N/A')}/5")
        
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
        
        return all_results
    
    def generate_summary_report(self, results: List[Dict[str, Any]]):
        """Generate a summary report of benchmark results"""
        report_file = self.output_dir / "benchmark_summary.md"
        
        with open(report_file, 'w') as f:
            f.write("# VoiceTree LangGraph Benchmark Summary\n\n")
            f.write(f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n\n")
            
            # Overall statistics
            total_tests = len(results)
            avg_time = sum(r["execution_time"] for r in results) / total_tests
            
            # Calculate average scores
            total_scores = {"overall": 0, "accuracy": 0, "completeness": 0, "granularity": 0, "relationships": 0, "clarity": 0}
            valid_tests = 0
            
            for result in results:
                quality = result["quality_evaluation"]
                if isinstance(quality.get("overall_score"), (int, float)):
                    valid_tests += 1
                    total_scores["overall"] += quality["overall_score"]
                    total_scores["accuracy"] += quality.get("accuracy", 0)
                    total_scores["completeness"] += quality.get("completeness", 0)
                    total_scores["granularity"] += quality.get("granularity", 0)
                    total_scores["relationships"] += quality.get("relationships", 0)
                    total_scores["clarity"] += quality.get("clarity", 0)
            
            if valid_tests > 0:
                avg_scores = {k: v / valid_tests for k, v in total_scores.items()}
            else:
                avg_scores = {k: 0 for k in total_scores.keys()}
            
            f.write("## Overall Performance\n\n")
            f.write(f"- Total tests run: {total_tests}\n")
            f.write(f"- Average execution time: {avg_time:.2f}s\n")
            f.write(f"- Average overall score: {avg_scores['overall']:.2f}/5\n")
            f.write(f"- Average accuracy: {avg_scores['accuracy']:.2f}/5\n")
            f.write(f"- Average completeness: {avg_scores['completeness']:.2f}/5\n")
            f.write(f"- Average granularity: {avg_scores['granularity']:.2f}/5\n")
            f.write(f"- Average relationships: {avg_scores['relationships']:.2f}/5\n")
            f.write(f"- Average clarity: {avg_scores['clarity']:.2f}/5\n\n")
            
            # Individual test results
            f.write("## Test Results\n\n")
            for result in results:
                f.write(f"### {result['test_name']}\n\n")
                f.write(f"- Transcript length: {result['transcript_length']} chars\n")
                f.write(f"- Execution time: {result['execution_time']:.2f}s\n")
                
                quality = result["quality_evaluation"]
                if isinstance(quality.get('overall_score'), (int, float)):
                    f.write(f"- Overall score: {quality['overall_score']}/5\n")
                    f.write(f"- Accuracy: {quality.get('accuracy', 'N/A')}/5\n")
                    f.write(f"- Completeness: {quality.get('completeness', 'N/A')}/5\n")
                    f.write(f"- Granularity: {quality.get('granularity', 'N/A')}/5\n")
                    f.write(f"- Relationships: {quality.get('relationships', 'N/A')}/5\n")
                    f.write(f"- Clarity: {quality.get('clarity', 'N/A')}/5\n")
                    
                    if quality.get('weaknesses'):
                        f.write("\n**Weaknesses:**\n")
                        for weakness in quality['weaknesses']:
                            f.write(f"- {weakness}\n")
                
                f.write("\n")
        
        print(f"📄 Summary report saved to: {report_file}")


async def main():
    """Run the benchmark suite"""
    benchmarker = VoiceTreeBenchmarker()
    results = await benchmarker.run_benchmark_suite()
    
    # Check if all tests achieved 5/5
    all_perfect = all(
        isinstance(r["quality_evaluation"].get("overall_score"), (int, float)) and 
        r["quality_evaluation"]["overall_score"] == 5 
        for r in results
    )
    
    if all_perfect:
        print("\n🎉 All tests achieved perfect 5/5 scores!")
    else:
        print("\n📊 Some tests need improvement to reach 5/5")


if __name__ == "__main__":
    asyncio.run(main())
