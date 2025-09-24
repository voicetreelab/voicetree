"""
Performance Comparison Driver V2 - Uses pred.py directly
Compares pruned (vector search) vs unpruned (full context) performance
by calling pred.py's functions for evaluation.
"""

import json
import os
import statistics
import sys
import time
from pathlib import Path
from typing import Any, TypedDict

import google.generativeai as genai
from colorama import Fore
from colorama import Style
from colorama import init
from dotenv import load_dotenv

from backend.context_retrieval.dependency_traversal import accumulate_content
from backend.context_retrieval.traverse_all_relevant_nodes import (
    traverse_all_relevant_nodes,
)
from backend.markdown_tree_manager.markdown_to_tree.markdown_to_tree import (
    load_markdown_tree,
)

# Initialize colorama for cross-platform colored output
init(autoreset=True)


# TypedDict definitions
class QuestionData(TypedDict):
    _id: str
    raw_content: str
    answer: str
    file_path: str


class ParsedQuestion(TypedDict):
    question: str
    choice_A: str
    choice_B: str
    choice_C: str
    choice_D: str


class EvaluationResult(TypedDict):
    response: str
    pred: str
    judge: bool
    context_size: int


class RunResult(TypedDict):
    run: int
    question_id: str
    retrieval_time: float
    response: str
    pred: str
    judge: bool
    context_size: int


class ComparisonMetadata(TypedDict):
    num_runs: int
    num_questions: int
    timestamp: str


class ComparisonResults(TypedDict):
    pruned: list[RunResult]
    unpruned: list[RunResult]
    metadata: ComparisonMetadata

# Load environment variables
load_dotenv()

# Add paths for imports
sys.path.insert(0, str(Path(__file__).parent.parent.parent))


class GeminiClient:
    """Wrapper to make Gemini API compatible with pred.py's OpenAI-style interface."""

    def __init__(self, api_key: str) -> None:
        genai.configure(api_key=api_key)
        self._model = genai.GenerativeModel('gemini-2.5-flash-lite')
        self.chat = type('obj', (object,), {
            'completions': type('obj', (object,), {
                'create': self._create_completion
            })()
        })()

    def _create_completion(self, model=None, messages=None, temperature=0.4):
        """Create a completion using Gemini."""
        content_key = "content"
        prompt = messages[0][content_key] if messages else ""

        response = self._model.generate_content(
            prompt,
            generation_config=genai.types.GenerationConfig(
                temperature=temperature
            )
        )

        # Create OpenAI-style response structure
        class Completion:
            def __init__(self, text):
                self.choices = [type('obj', (object,), {
                    'message': type('obj', (object,), {'content': text})()
                })()]

        return Completion(response.text)


class PerformanceComparatorV2:
    def __init__(self):
        """Initialize using environment variables."""
        # Get API key from environment
        self.api_key = os.getenv('GEMINI_API_KEY') or os.getenv('GOOGLE_API_KEY')
        if not self.api_key:
            raise ValueError("GEMINI_API_KEY or GOOGLE_API_KEY must be set in .env file")

        # Setup paths using environment variable
        voicetree_root = os.getenv('VOICETREE_ROOT')
        if not voicetree_root:
            raise ValueError("VOICETREE_ROOT environment variable not set. Run setup.sh first.")

        project_root = Path(voicetree_root)
        self.markdown_dir = project_root / "backend/benchmarker/output/user_guide_qa_audio_processing_connected_final"
        self.embeddings_path = project_root / "backend/embeddings_output"
        self.full_context_path = project_root / "backend/context_retrieval/full_context.txt"

        # Load template from pred.py's location
        template_path = project_root / "long_context_benchmarks/LongBench/prompts/0shot.txt"
        with open(template_path) as f:
            self.template = f.read()

        # Initialize Gemini client with OpenAI-compatible interface
        self.client = GeminiClient(self.api_key)

        # Load tree as MarkdownTree object
        print(f"Loading tree from: {self.markdown_dir}")
        self.tree = load_markdown_tree(str(self.markdown_dir))
        print(f"Successfully loaded {len(self.tree.tree)} nodes")
        self._setup_node_filenames()

        # Load full context once
        with open(self.full_context_path) as f:
            self.full_context = f.read()
        print(f"Loaded full context: {len(self.full_context)} characters")

    def _setup_node_filenames(self):
        """Ensure each node has its filename attribute set."""
        import os
        md_files = {f: f for f in os.listdir(self.markdown_dir) if f.endswith('.md')}

        for node_id, node in self.tree.tree.items():
            node_id_str = str(node_id)
            for filename in md_files:
                if filename.startswith(f"{node_id_str}_"):
                    node.filename = filename
                    break
            else:
                if hasattr(node, 'file_name') and node.file_name:
                    node.filename = node.file_name

    def load_test_questions(self) -> list[QuestionData]:
        """Load the 4 QA test questions - just use raw markdown."""
        voicetree_root = os.getenv('VOICETREE_ROOT')
        if not voicetree_root:
            raise ValueError("VOICETREE_ROOT environment variable not set. Run setup.sh first.")
        questions_dir = Path(voicetree_root) / "backend/context_retrieval/QA_test_questions"
        questions: list[QuestionData] = []

        # Correct answers based on the documentation
        correct_answers = {
            "1.md": "B",
            "2.md": "B",
            "3.md": "D",
            "4.md": "A"
        }

        for file in sorted(questions_dir.glob("*.md")):
            with open(file) as f:
                raw_content = f.read()

            question_data: QuestionData = {
                '_id': file.name,
                'raw_content': raw_content,
                'answer': correct_answers.get(file.name, "Unknown"),
                'file_path': str(file)
            }
            questions.append(question_data)

        return questions

    def parse_question_file(self, content: str) -> ParsedQuestion:
        """Parse a question file to extract question and choices."""
        import re

        lines = content.strip().split('\n')
        question = ""
        choices = {}

        # Extract question - it's usually after "Question" header
        in_question = False
        for line in lines:
            if 'Question' in line:
                in_question = True
                continue
            if in_question and line.strip():
                # Skip markdown headers
                if not line.startswith('#'):
                    # Stop at choices
                    if any(f'{letter})' in line for letter in ['A', 'B', 'C', 'D']):
                        break
                    question += line.strip() + " "

        question = question.strip()

        # Extract choices
        full_text = '\n'.join(lines)
        for letter in ['A', 'B', 'C', 'D']:
            # Try multiple patterns
            patterns = [
                rf'{letter}\)\s+([^A-D\n]+?)(?=[A-D]\)|$)',  # Basic pattern
                rf'\*\*{letter}\)\*\*\s+([^A-D\n]+?)(?=[A-D]\)|$)',  # Bold pattern
                rf'-\s+\*\*{letter}\)\*\*\s+([^A-D\n]+?)(?=[A-D]\)|$)',  # List with bold
            ]

            for pattern in patterns:
                match = re.search(pattern, full_text, re.DOTALL | re.MULTILINE)
                if match:
                    choice_text = match.group(1).strip()
                    # Clean up the choice text
                    choice_text = re.sub(r'\s+', ' ', choice_text)
                    choices[f'choice_{letter}'] = choice_text
                    break

        result: ParsedQuestion = {
            'question': question,
            'choice_A': choices.get('choice_A', ''),
            'choice_B': choices.get('choice_B', ''),
            'choice_C': choices.get('choice_C', ''),
            'choice_D': choices.get('choice_D', '')
        }
        return result

    def get_pruned_context(self, query: str) -> str:
        """Get context using the pruned algorithm (vector search + traversal)."""
        results = traverse_all_relevant_nodes(
            query,
            self.tree,
            self.markdown_dir,
            top_k=15,
            embeddings_path=self.embeddings_path
        )

        if results:
            return accumulate_content(results, include_metadata=True)
        return ""

    def get_unpruned_context(self, query: str) -> str:
        """Get the full unpruned context (entire file)."""
        return self.full_context

    def extract_answer(self, response: str) -> str:
        """Extract answer from response using pred.py's exact pattern."""
        import re
        response = response.replace('*', '')
        match = re.search(r'The correct answer is \(([A-D])\)', response)
        if match:
            return match.group(1)
        else:
            match = re.search(r'The correct answer is ([A-D])', response)
            if match:
                return match.group(1)
            else:
                return ""

    def evaluate_single_question(self, item: QuestionData, context: str) -> EvaluationResult:
        """Evaluate a single question using raw markdown content."""
        # Debug: Check what we're working with
        print("\n   🔍 Building prompt...")
        print(f"   Context passed in: {len(context)} chars")
        print(f"   Context preview: {context[:200]}...")

        # Build simple prompt with raw question content
        raw_content_key = 'raw_content'
        prompt = f"""Please read the following text and answer the question.

<text>
{context.strip()}
</text>

{item[raw_content_key]}

Format your response as follows: "The correct answer is (insert answer here)"."""

        # Check if context made it into prompt
        if context[:100] not in prompt:
            print("   ⚠️ WARNING: Context doesn't appear to be in prompt!")
        else:
            print("   ✅ Context confirmed in prompt")

        # Use pred.py's query_llm function with our Gemini client
        # We need a dummy tokenizer for compatibility
        class DummyTokenizer:
            def encode(self, text, **kwargs):
                return text.split()  # Simple word tokenization
            def decode(self, tokens, **kwargs):
                return ' '.join(tokens) if isinstance(tokens, list) else tokens


        # Query LLM - no retry, fail fast
        raw_content_key = 'raw_content'
        question_preview = item.get(raw_content_key, '')[:100] if raw_content_key in item else 'Unknown question'
        print(f"\n📝 Question: {question_preview}...")
        print(f"   Context size: {len(context)} chars")
        print("\n🔍 PROMPT BEING SENT TO LLM (first 1000 chars):")
        print("="*60)
        print(prompt[:1000])
        print("="*60)
        print(f"   Total prompt size: {len(prompt)} chars")

        completion = self.client.chat.completions.create(
            model="gemini-2.5-flash-lite",
            messages=[{"role": "user", "content": prompt}]
        )
        response = completion.choices[0].message.content

        print(f"   LLM Response length: {len(response)} chars")
        print(f"   {Fore.GREEN}LLM Response: {response}{Style.RESET_ALL}")

        if not response:
            raise ValueError("Empty response from LLM!")

        # Extract answer using pred.py's pattern
        pred_answer = self.extract_answer(response)
        answer_key = 'answer'
        is_correct = pred_answer == item[answer_key] if pred_answer else False

        print(f"   Extracted: {pred_answer}, Expected: {item[answer_key]}, Correct: {is_correct}")

        result: EvaluationResult = {
            'response': response,
            'pred': pred_answer,
            'judge': is_correct,
            'context_size': len(context)
        }
        return result

    def run_comparison(self, num_runs: int = 10) -> ComparisonResults:
        """Run the comparison test with specified number of runs per question."""
        questions = self.load_test_questions()
        metadata: ComparisonMetadata = {
            "num_runs": num_runs,
            "num_questions": len(questions),
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S")
        }
        results: ComparisonResults = {
            "pruned": [],
            "unpruned": [],
            "metadata": metadata
        }

        print(f"\n{'='*60}")
        print(f"Running comparison: {num_runs} runs × {len(questions)} questions")
        print("Using Gemini API with pred.py evaluation")
        print(f"{'='*60}\n")

        # Track accumulative accuracy
        total_pruned_correct = 0
        total_unpruned_correct = 0
        total_runs_completed = 0

        for question_data in questions:
            id_key = "_id"
            answer_key = "answer"
            question_id = question_data[id_key]
            correct_answer = question_data[answer_key]

            print(f"\n📝 Processing {question_id} (Correct: {correct_answer})")
            print("-" * 40)
            raw_content_key = 'raw_content'
            print(f"Question preview: {question_data.get(raw_content_key, '')[:150]}...")

            # Extract just the question text for vector search (simple extraction)
            raw_content_key = 'raw_content'
            raw_content = question_data.get(raw_content_key, '')
            # Try to get just the question part (skip "Question 1", "Question 2", etc.)
            lines = raw_content.strip().split('\n')

            # Skip the first line (Question N) and get the actual question text
            # The question is usually on line 2 (index 1) after "Question N"
            if len(lines) > 2:
                # Join lines 2-3 to get the main question (skip empty lines)
                question_lines = []
                for line in lines[1:]:
                    line = line.strip()
                    if line and not line.startswith(('A)', 'B)', 'C)', 'D)')):
                        question_lines.append(line)
                    elif line.startswith(('A)', 'B)', 'C)', 'D)')):
                        break  # Stop when we hit the choices
                query_for_search = ' '.join(question_lines)
            else:
                query_for_search = raw_content  # Fallback to full content

            # Alternate between pruned and unpruned for each run
            pruned_runs = []
            unpruned_runs = []

            for run in range(num_runs):
                # PRUNED RUN
                print(f"\n=== PRUNED METHOD - Run {run + 1}/{num_runs} ===")
                start_time = time.time()
                context = self.get_pruned_context(query_for_search)
                retrieval_time = time.time() - start_time
                print(f"   Retrieved context (first 500 chars): {context[:500]}...")
                print(f"   Context length: {len(context)} chars")
                eval_result = self.evaluate_single_question(question_data, context)

                run_result: RunResult = {
                    "run": run + 1,
                    "question_id": question_id,
                    "retrieval_time": retrieval_time,
                    **eval_result
                }
                pruned_runs.append(run_result)

                # Update accumulative stats
                judge_key = "judge"
                if eval_result[judge_key]:
                    total_pruned_correct += 1
                total_runs_completed += 1

                # Print accumulative accuracy in orange
                pruned_acc = (total_pruned_correct / total_runs_completed) * 100 if total_runs_completed > 0 else 0
                unpruned_acc = (total_unpruned_correct / total_runs_completed) * 100 if total_runs_completed > 0 else 0
                print(f"\n{Fore.YELLOW}📊 Accumulative Accuracy:{Style.RESET_ALL}")
                print(f"{Fore.YELLOW}   Pruned:   {total_pruned_correct}/{total_runs_completed} ({pruned_acc:.1f}%){Style.RESET_ALL}")
                print(f"{Fore.YELLOW}   Unpruned: {total_unpruned_correct}/{total_runs_completed} ({unpruned_acc:.1f}%){Style.RESET_ALL}")

                time.sleep(0.5)  # Rate limiting

                # UNPRUNED RUN
                print(f"\n=== UNPRUNED METHOD - Run {run + 1}/{num_runs} ===")
                start_time = time.time()
                context = self.get_unpruned_context(query_for_search)  # Use same query
                retrieval_time = time.time() - start_time
                print(f"   Retrieved context (first 500 chars): {context[:500]}...")
                print(f"   Context length: {len(context)} chars")

                eval_result = self.evaluate_single_question(question_data, context)

                run_result: RunResult = {
                    "run": run + 1,
                    "question_id": question_id,
                    "retrieval_time": retrieval_time,
                    **eval_result
                }
                unpruned_runs.append(run_result)

                # Update accumulative stats
                judge_key = "judge"
                if eval_result[judge_key]:
                    total_unpruned_correct += 1
                total_runs_completed += 1

                # Print accumulative accuracy in orange
                pruned_acc = (total_pruned_correct / (total_runs_completed // 2)) * 100 if (total_runs_completed // 2) > 0 else 0
                unpruned_acc = (total_unpruned_correct / (total_runs_completed // 2)) * 100 if (total_runs_completed // 2) > 0 else 0
                print(f"\n{Fore.YELLOW}📊 Accumulative Accuracy:{Style.RESET_ALL}")
                print(f"{Fore.YELLOW}   Pruned:   {total_pruned_correct}/{total_runs_completed // 2} ({pruned_acc:.1f}%){Style.RESET_ALL}")
                print(f"{Fore.YELLOW}   Unpruned: {total_unpruned_correct}/{total_runs_completed // 2} ({unpruned_acc:.1f}%){Style.RESET_ALL}")

                time.sleep(0.5)  # Rate limiting

            # Store results
            pruned_key = "pruned"
            unpruned_key = "unpruned"
            results[pruned_key].extend(pruned_runs)
            results[unpruned_key].extend(unpruned_runs)

            # Print summary for this question
            judge_key = "judge"
            pruned_correct = sum(1 for r in pruned_runs if r[judge_key])
            unpruned_correct = sum(1 for r in unpruned_runs if r[judge_key])

            print(f"\n✅ {question_id} Results:")
            print(f"  Pruned:   {pruned_correct}/{num_runs} correct ({pruned_correct*100/num_runs:.1f}%)")
            print(f"  Unpruned: {unpruned_correct}/{num_runs} correct ({unpruned_correct*100/num_runs:.1f}%)")

        return results

    def generate_report(self, results: ComparisonResults) -> str:
        """Generate a detailed performance comparison report using pred.py format."""
        report = []
        report.append("=" * 70)
        report.append("CONTEXT RETRIEVAL PERFORMANCE COMPARISON REPORT")
        report.append("Using pred.py evaluation methodology")
        report.append("=" * 70)
        metadata_key = 'metadata'
        timestamp_key = 'timestamp'
        num_runs_key = 'num_runs'
        num_questions_key = 'num_questions'
        report.append(f"\nGenerated: {results[metadata_key][timestamp_key]}")
        report.append(f"Configuration: {results[metadata_key][num_runs_key]} runs × {results[metadata_key][num_questions_key]} questions")
        report.append("\n" + "=" * 70)

        # Calculate overall metrics
        pruned_key = "pruned"
        unpruned_key = "unpruned"
        for method in [pruned_key, unpruned_key]:
            method_results = results[method]

            report.append(f"\n{method.upper()} METHOD RESULTS:")
            report.append("-" * 40)

            # Accuracy (using 'judge' field from pred.py)
            judge_key = "judge"
            correct_count = sum(1 for r in method_results if r.get(judge_key, False))
            total_count = len(method_results)
            accuracy = correct_count / total_count * 100 if total_count > 0 else 0

            report.append(f"Overall Accuracy: {correct_count}/{total_count} ({accuracy:.2f}%)")

            # Context size statistics
            context_size_key = "context_size"
            context_sizes = [r.get(context_size_key, 0) for r in method_results]
            if context_sizes:
                avg_context_size = statistics.mean(context_sizes)
                report.append(f"Avg Context Size: {avg_context_size:.0f} chars")

            # Retrieval time statistics
            retrieval_time_key = "retrieval_time"
            retrieval_times = [r.get(retrieval_time_key, 0) for r in method_results]
            if retrieval_times:
                avg_retrieval_time = statistics.mean(retrieval_times)
                report.append(f"Avg Retrieval Time: {avg_retrieval_time:.3f}s")

            # Per-question breakdown
            report.append("\nPer-Question Accuracy:")
            question_id_key = "question_id"
            judge_key = "judge"
            question_ids = set(r[question_id_key] for r in method_results)
            for qid in sorted(question_ids):
                q_results = [r for r in method_results if r[question_id_key] == qid]
                q_correct = sum(1 for r in q_results if r.get(judge_key, False))
                q_accuracy = q_correct / len(q_results) * 100 if q_results else 0
                report.append(f"  {qid}: {q_correct}/{len(q_results)} ({q_accuracy:.0f}%)")

        # Comparison summary
        report.append("\n" + "=" * 70)
        report.append("COMPARISON SUMMARY")
        report.append("=" * 70)

        pruned_key = "pruned"
        unpruned_key = "unpruned"
        judge_key = "judge"
        pruned_accuracy = sum(1 for r in results[pruned_key] if r.get(judge_key, False)) / len(results[pruned_key]) * 100
        unpruned_accuracy = sum(1 for r in results[unpruned_key] if r.get(judge_key, False)) / len(results[unpruned_key]) * 100

        if pruned_accuracy > unpruned_accuracy:
            report.append(f"✅ PRUNED method performs BETTER by {pruned_accuracy - unpruned_accuracy:.1f}%")
        elif unpruned_accuracy > pruned_accuracy:
            report.append(f"❌ UNPRUNED method performs BETTER by {unpruned_accuracy - pruned_accuracy:.1f}%")
        else:
            report.append("🔄 Both methods perform EQUALLY")

        # Context size reduction
        context_size_key = "context_size"
        pruned_key = "pruned"
        unpruned_key = "unpruned"
        pruned_sizes = [r.get(context_size_key, 0) for r in results[pruned_key]]
        unpruned_sizes = [r.get(context_size_key, 0) for r in results[unpruned_key]]
        if pruned_sizes and unpruned_sizes:
            pruned_size = statistics.mean(pruned_sizes)
            unpruned_size = statistics.mean(unpruned_sizes)
            size_reduction = (1 - pruned_size/unpruned_size) * 100
            report.append(f"\nContext Size Reduction: {size_reduction:.1f}%")
            report.append(f"Pruned: {pruned_size:.0f} chars vs Unpruned: {unpruned_size:.0f} chars")

        return "\n".join(report)


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Compare pruned vs unpruned using pred.py evaluation")
    parser.add_argument("--runs", type=int, default=3, help="Number of runs per question (default: 10)")
    parser.add_argument("--output", default="performance_comparison_v2_results.json", help="Output file for results")

    args = parser.parse_args()

    # Initialize comparator (uses .env for API key)
    comparator = PerformanceComparatorV2()

    # Run comparison
    results = comparator.run_comparison(num_runs=args.runs)

    # Save raw results
    with open(args.output, 'w') as f:
        json.dump(results, f, indent=2)
    print(f"\n💾 Raw results saved to: {args.output}")

    # Generate and print report
    report = comparator.generate_report(results)
    print("\n" + report)

    # Save report
    report_file = args.output.replace('.json', '_report.txt')
    with open(report_file, 'w') as f:
        f.write(report)
    print(f"\n📄 Report saved to: {report_file}")

if __name__ == "__main__":
    main()
