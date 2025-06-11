#!/usr/bin/env python3
"""
Test a single benchmark case to verify 5/5 score
"""

import asyncio
from benchmark import VoiceTreeBenchmarker

async def main():
    benchmarker = VoiceTreeBenchmarker()
    
    # Test case that achieved 5/5
    test_case = {
        "name": "Simple Project Planning",
        "transcript": """
        Today I want to work on my new project. 
        I need to set up the development environment first.
        Then I'll implement the core features.
        Finally, I'll add tests and documentation.
        """,
        "existing_nodes": ["Project Management", "Development", "Testing"]
    }
    
    result = await benchmarker.benchmark_transcript(
        test_case["transcript"],
        test_case["existing_nodes"],
        test_case["name"]
    )
    
    quality = result["quality_evaluation"]
    if isinstance(quality.get("overall_score"), (int, float)) and quality["overall_score"] == 5:
        print("\n🎉 PERFECT SCORE ACHIEVED: 5/5!")
        print(f"✅ Accuracy: {quality.get('accuracy')}/5")
        print(f"✅ Completeness: {quality.get('completeness')}/5")
        print(f"✅ Granularity: {quality.get('granularity')}/5")
        print(f"✅ Relationships: {quality.get('relationships')}/5")
        print(f"✅ Clarity: {quality.get('clarity')}/5")
    else:
        print(f"\n❌ Score: {quality.get('overall_score')}/5")

if __name__ == "__main__":
    asyncio.run(main()) 