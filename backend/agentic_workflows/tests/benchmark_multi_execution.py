#!/usr/bin/env python3
"""
Multi-execution benchmarker for LangGraph pipeline
Tests the system's ability to maintain state across multiple executions
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
from main import VoiceTreePipeline

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


class MultiExecutionBenchmarker:
    """Benchmarker for testing multiple sequential executions"""
    
    def __init__(self, output_dir: str = "benchmark_results"):
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(exist_ok=True)
        self.results_file = self.output_dir / f"multi_exec_benchmark_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    
    def evaluate_multi_execution_quality(self, conversation_history: List[Dict[str, Any]], final_state: Dict[str, Any]) -> Dict[str, Any]:
        """Evaluate the quality of multi-execution results"""
        if not GEMINI_AVAILABLE:
            return {
                "overall_score": "N/A",
                "evaluation": "Gemini API not available for quality evaluation"
            }
        
        # Build conversation summary
        conv_summary = []
        for i, exec_data in enumerate(conversation_history):
            conv_summary.append(f"Execution {i+1}:")
            conv_summary.append(f"  Transcript: {exec_data['transcript'][:100]}...")
            conv_summary.append(f"  New nodes created: {exec_data.get('new_nodes', [])}")
            conv_summary.append(f"  Total nodes after: {exec_data.get('total_nodes_after', 0)}")
            conv_summary.append("")
        
        prompt = f"""
        You are an expert at evaluating knowledge graph construction from conversational transcripts.
        
        Evaluate how well the system handled multiple sequential executions:
        
        **Conversation History:**
        {chr(10).join(conv_summary)}
        
        **Final State Statistics:**
        {json.dumps(final_state, indent=2)}
        
        Please evaluate based on these criteria:
        1. **State Persistence**: Does the system properly maintain state between executions?
        2. **Context Awareness**: Does it recognize and build upon previous concepts?
        3. **Relationship Building**: Are meaningful connections made between concepts across executions?
        4. **Avoiding Duplicates**: Does it avoid creating duplicate nodes for existing concepts?
        5. **Progressive Enhancement**: Does the knowledge graph grow meaningfully over time?
        6. **Chunk Boundary Handling**: Does it properly handle incomplete sentences that span across executions?
        
        Provide:
        - A score for each criterion (1-5, where 5 is excellent)
        - An overall score (1-5)
        - Specific examples of good and bad behavior
        - Suggestions for improvement
        
        Format your response as JSON with this structure:
        {{
            "state_persistence": <score>,
            "context_awareness": <score>,
            "relationship_building": <score>,
            "avoiding_duplicates": <score>,
            "progressive_enhancement": <score>,
            "chunk_boundary_handling": <score>,
            "overall_score": <score>,
            "strengths": ["strength1", "strength2"],
            "weaknesses": ["weakness1", "weakness2"],
            "examples": {{
                "good": ["example1", "example2"],
                "bad": ["example1", "example2"]
            }},
            "suggestions": ["suggestion1", "suggestion2"]
        }}
        """
        
        try:
            model = GenerativeModel('gemini-2.0-flash')
            response = model.generate_content(prompt)
            
            # Try to parse JSON from response
            import re
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
    
    async def run_conversation_sequence(self, conversation: List[Dict[str, str]], test_name: str) -> Dict[str, Any]:
        """Run a sequence of related transcripts simulating a conversation"""
        print(f"\n🧪 Running multi-execution benchmark: {test_name}")
        print("=" * 60)
        
        # Create a pipeline with persistent state
        state_file = self.output_dir / f"{test_name.replace(' ', '_')}_state.json"
        pipeline = VoiceTreePipeline(str(state_file))
        
        # Clear any existing state
        pipeline.clear_state()
        
        execution_history = []
        total_time = 0
        
        for i, turn in enumerate(conversation):
            print(f"\n📝 Execution {i+1}/{len(conversation)}")
            print(f"   Transcript: {turn['transcript'][:80]}...")
            
            start_time = time.time()
            result = pipeline.run(turn['transcript'])
            exec_time = time.time() - start_time
            total_time += exec_time
            
            # Get current statistics
            stats = pipeline.get_statistics()
            
            execution_history.append({
                "execution_number": i + 1,
                "transcript": turn['transcript'],
                "expected_behavior": turn.get('expected', ''),
                "new_nodes": result.get('new_nodes', []),
                "total_nodes_after": stats.get('total_nodes', 0),
                "execution_time": exec_time,
                "error": result.get('error_message')
            })
            
            print(f"   New nodes: {result.get('new_nodes', [])}")
            print(f"   Total nodes: {stats.get('total_nodes', 0)}")
            print(f"   Execution time: {exec_time:.2f}s")
            
            # Small delay between executions
            await asyncio.sleep(1)
        
        # Evaluate the overall quality
        final_stats = pipeline.get_statistics()
        quality_eval = self.evaluate_multi_execution_quality(execution_history, final_stats)
        
        results = {
            "test_name": test_name,
            "timestamp": datetime.now().isoformat(),
            "total_executions": len(conversation),
            "total_time": total_time,
            "average_time_per_execution": total_time / len(conversation),
            "execution_history": execution_history,
            "final_statistics": final_stats,
            "quality_evaluation": quality_eval
        }
        
        # Display evaluation results
        if isinstance(quality_eval.get("overall_score"), (int, float)):
            print(f"\n📊 Multi-execution Quality Evaluation:")
            print(f"   Overall score: {quality_eval['overall_score']}/5")
            print(f"   - State persistence: {quality_eval.get('state_persistence', 'N/A')}/5")
            print(f"   - Context awareness: {quality_eval.get('context_awareness', 'N/A')}/5")
            print(f"   - Relationship building: {quality_eval.get('relationship_building', 'N/A')}/5")
            print(f"   - Avoiding duplicates: {quality_eval.get('avoiding_duplicates', 'N/A')}/5")
            print(f"   - Progressive enhancement: {quality_eval.get('progressive_enhancement', 'N/A')}/5")
        
        return results
    
    async def run_benchmark_suite(self):
        """Run a suite of multi-execution benchmark tests"""
        test_conversations = [
            {
                "name": "Project Evolution",
                "conversation": [
                    {
                        "transcript": "I'm starting a new AI project focused on natural language processing. The goal is to build a chatbot.",
                        "expected": "Should create nodes for AI project, NLP, and chatbot"
                    },
                    {
                        "transcript": "For the chatbot project, I need to implement intent recognition and entity extraction features.",
                        "expected": "Should recognize 'chatbot' as existing and add intent recognition and entity extraction as related concepts"
                    },
                    {
                        "transcript": "The NLP system should also support multiple languages. I'll start with English and Spanish.",
                        "expected": "Should connect language support to existing NLP node"
                    },
                    {
                        "transcript": "I've decided to use transformer models for the chatbot. BERT seems like a good choice for intent classification.",
                        "expected": "Should add transformer models and BERT under the existing project structure"
                    }
                ]
            },
            {
                "name": "Meeting Series",
                "conversation": [
                    {
                        "transcript": "Team meeting today: We discussed the Q1 roadmap and identified three key initiatives.",
                        "expected": "Should create nodes for team meeting, Q1 roadmap, and initiatives"
                    },
                    {
                        "transcript": "Following up on yesterday's meeting, the first initiative is improving customer onboarding.",
                        "expected": "Should recognize the meeting context and add customer onboarding as an initiative"
                    },
                    {
                        "transcript": "Second initiative from our roadmap discussion: implementing automated testing across all services.",
                        "expected": "Should add automated testing as another initiative under the roadmap"
                    },
                    {
                        "transcript": "The customer onboarding project will require UX research and new documentation. Sarah will lead this.",
                        "expected": "Should add UX research and documentation under customer onboarding"
                    }
                ]
            },
            {
                "name": "Learning Journey",
                "conversation": [
                    {
                        "transcript": "Started learning about machine learning today. Focusing on supervised learning algorithms.",
                        "expected": "Should create nodes for machine learning and supervised learning"
                    },
                    {
                        "transcript": "Within supervised learning, I'm studying classification and regression techniques.",
                        "expected": "Should add classification and regression under supervised learning"
                    },
                    {
                        "transcript": "For classification, I learned about decision trees and random forests. These are tree-based methods.",
                        "expected": "Should add decision trees and random forests under classification"
                    },
                    {
                        "transcript": "Also exploring neural networks for both classification and regression tasks. Deep learning is fascinating.",
                        "expected": "Should recognize both classification and regression, add neural networks appropriately"
                    },
                    {
                        "transcript": "Random forests are actually an ensemble method that uses multiple decision trees. This improves accuracy.",
                        "expected": "Should recognize existing nodes and add relationship/enhancement information"
                    }
                ]
            },
            {
                "name": "Chunk Boundary Handling",
                "conversation": [
                    {
                        "transcript": "Working on a data science project that involves machine learning. The first step is to collect and prepa",
                        "expected": "Should handle incomplete sentence at the end"
                    },
                    {
                        "transcript": "re the dataset. We need clean data for training our models. Next, we'll implement feature engineeri",
                        "expected": "Should complete previous sentence and handle new incomplete ending"
                    },
                    {
                        "transcript": "ng to extract meaningful patterns. The machine learning models will include both supervised and unsupervis",
                        "expected": "Should complete feature engineering and handle unsupervised cut-off"
                    },
                    {
                        "transcript": "ed learning algorithms. For supervised learning, we'll use classification for predicting categories.",
                        "expected": "Should complete unsupervised and process the complete sentence"
                    },
                    {
                        "transcript": "The data science project also requires visualization tools. We'll use matplotlib and seaborn for Python.",
                        "expected": "Should process normally as complete sentences"
                    }
                ]
            }
        ]
        
        all_results = []
        
        for test_conv in test_conversations:
            result = await self.run_conversation_sequence(
                test_conv["conversation"],
                test_conv["name"]
            )
            all_results.append(result)
            
            # Rate limit between test cases
            await asyncio.sleep(2)
        
        # Save all results
        with open(self.results_file, 'w') as f:
            json.dump(all_results, f, indent=2)
        
        print(f"\n✅ Multi-execution benchmark complete! Results saved to: {self.results_file}")
        
        # Generate summary report
        self.generate_summary_report(all_results)
        
        return all_results
    
    def generate_summary_report(self, results: List[Dict[str, Any]]):
        """Generate a summary report of multi-execution benchmark results"""
        report_file = self.output_dir / "multi_exec_summary.md"
        
        with open(report_file, 'w') as f:
            f.write("# Multi-Execution VoiceTree Benchmark Summary\n\n")
            f.write(f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n\n")
            
            # Overall statistics
            total_conversations = len(results)
            total_executions = sum(r["total_executions"] for r in results)
            avg_time = sum(r["average_time_per_execution"] for r in results) / total_conversations
            
            # Calculate average scores
            score_fields = ["overall_score", "state_persistence", "context_awareness", 
                          "relationship_building", "avoiding_duplicates", "progressive_enhancement"]
            score_totals = {field: 0 for field in score_fields}
            valid_evals = 0
            
            for result in results:
                eval_data = result["quality_evaluation"]
                if isinstance(eval_data.get("overall_score"), (int, float)):
                    valid_evals += 1
                    for field in score_fields:
                        score_totals[field] += eval_data.get(field, 0)
            
            avg_scores = {field: score_totals[field] / valid_evals for field in score_fields} if valid_evals > 0 else {field: 0 for field in score_fields}
            
            f.write("## Overall Performance\n\n")
            f.write(f"- Total conversation sequences: {total_conversations}\n")
            f.write(f"- Total executions: {total_executions}\n")
            f.write(f"- Average time per execution: {avg_time:.2f}s\n")
            f.write(f"- Average overall score: {avg_scores['overall_score']:.2f}/5\n\n")
            
            f.write("### Average Scores by Criterion\n\n")
            f.write(f"- State persistence: {avg_scores['state_persistence']:.2f}/5\n")
            f.write(f"- Context awareness: {avg_scores['context_awareness']:.2f}/5\n")
            f.write(f"- Relationship building: {avg_scores['relationship_building']:.2f}/5\n")
            f.write(f"- Avoiding duplicates: {avg_scores['avoiding_duplicates']:.2f}/5\n")
            f.write(f"- Progressive enhancement: {avg_scores['progressive_enhancement']:.2f}/5\n\n")
            
            # Individual conversation results
            f.write("## Conversation Sequence Results\n\n")
            for result in results:
                f.write(f"### {result['test_name']}\n\n")
                f.write(f"- Executions: {result['total_executions']}\n")
                f.write(f"- Total time: {result['total_time']:.2f}s\n")
                f.write(f"- Final node count: {result['final_statistics'].get('total_nodes', 0)}\n")
                
                eval_data = result["quality_evaluation"]
                if isinstance(eval_data.get("overall_score"), (int, float)):
                    f.write(f"- Overall score: {eval_data['overall_score']}/5\n\n")
                    
                    if eval_data.get("strengths"):
                        f.write("**Strengths:**\n")
                        for strength in eval_data["strengths"]:
                            f.write(f"- {strength}\n")
                        f.write("\n")
                    
                    if eval_data.get("weaknesses"):
                        f.write("**Weaknesses:**\n")
                        for weakness in eval_data["weaknesses"]:
                            f.write(f"- {weakness}\n")
                        f.write("\n")
                
                # Execution details
                f.write("**Execution History:**\n")
                for exec_data in result["execution_history"]:
                    f.write(f"{exec_data['execution_number']}. New nodes: {exec_data['new_nodes']}, Total: {exec_data['total_nodes_after']}\n")
                f.write("\n")
        
        print(f"📄 Summary report saved to: {report_file}")


async def main():
    """Run the multi-execution benchmark suite"""
    benchmarker = MultiExecutionBenchmarker()
    results = await benchmarker.run_benchmark_suite()
    
    # Check if all tests achieved high scores
    all_high_scores = all(
        isinstance(r["quality_evaluation"].get("overall_score"), (int, float)) and 
        r["quality_evaluation"]["overall_score"] >= 4 
        for r in results
    )
    
    if all_high_scores:
        print("\n🎉 All conversation sequences achieved high scores (4+/5)!")
    else:
        print("\n📊 Some conversation sequences need improvement")


if __name__ == "__main__":
    asyncio.run(main()) 