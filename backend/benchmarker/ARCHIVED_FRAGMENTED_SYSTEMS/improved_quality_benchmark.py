#!/usr/bin/env python3
"""
Improved Quality Benchmark for VoiceTree
Focuses on measuring improvements in:
1. Node fragmentation (coherent thought units)
2. Content extraction reliability 
3. Tree coherence and navigation
4. Information preservation
"""

import json
import sys
from pathlib import Path
from typing import Dict, List, Any
import time
from datetime import datetime

# Add the backend directory to Python path
backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))

class ImprovedQualityBenchmark:
    """Benchmark focused on the specific improvements we've made"""
    
    def __init__(self):
        self.metrics = {
            "fragmentation_score": 0.0,      # Lower is better (fewer tiny fragments)
            "content_extraction_success": 0.0,  # Higher is better (% successful extractions)
            "coherence_score": 0.0,         # Higher is better (logical relationships)
            "information_preservation": 0.0, # Higher is better (% of original info preserved)
            "navigation_quality": 0.0,      # Higher is better (clear tree structure)
            "overall_improvement": 0.0      # Combined improvement score
        }
        
    def analyze_node_fragmentation(self, nodes: List[Dict]) -> float:
        """
        Analyze fragmentation - prefer fewer, coherent nodes over many tiny fragments
        """
        if not nodes:
            return 0.0
            
        # Count very small nodes (likely fragments)
        tiny_nodes = sum(1 for node in nodes if len(node.get("content", "")) < 50)
        
        # Calculate average content length
        total_content = sum(len(node.get("content", "")) for node in nodes)
        avg_content_length = total_content / len(nodes) if nodes else 0
        
        # Fragmentation score: lower is better
        fragmentation_ratio = tiny_nodes / len(nodes)
        length_penalty = max(0, 100 - avg_content_length) / 100
        
        # Return inverse score (0-1, where 1 is best)
        fragmentation_score = 1.0 - (fragmentation_ratio * 0.7 + length_penalty * 0.3)
        return max(0.0, fragmentation_score)
    
    def analyze_content_extraction_success(self, nodes: List[Dict]) -> float:
        """
        Analyze content extraction reliability - check for extraction failures
        """
        if not nodes:
            return 0.0
            
        failure_indicators = [
            "unable to extract",
            "extraction failed", 
            "content extraction failed",
            "manual review",
            "fallback",
            "summary generation failed"
        ]
        
        failed_extractions = 0
        for node in nodes:
            content = node.get("content", "").lower()
            summary = node.get("summary", "").lower()
            
            if any(indicator in content or indicator in summary for indicator in failure_indicators):
                failed_extractions += 1
        
        success_rate = (len(nodes) - failed_extractions) / len(nodes)
        return success_rate
    
    def analyze_coherence_score(self, nodes: List[Dict], transcript: str) -> float:
        """
        Analyze tree coherence - logical relationships and flow
        """
        if not nodes:
            return 0.0
            
        coherence_indicators = 0
        total_possible = len(nodes)
        
        for node in nodes:
            content = node.get("content", "")
            name = node.get("name", "")
            
            # Check for meaningful content
            if len(content.split("•")) >= 2:  # Has bullet points
                coherence_indicators += 1
                
            # Check for descriptive names
            if len(name.split()) >= 2 and len(name) <= 50:  # Reasonable length
                coherence_indicators += 1
                
            # Check for actionable content
            actionable_keywords = ["plan", "implement", "analyze", "create", "develop", "research"]
            if any(keyword in content.lower() for keyword in actionable_keywords):
                coherence_indicators += 1
        
        # Normalize score
        max_possible = total_possible * 3  # 3 indicators per node
        coherence_score = coherence_indicators / max_possible if max_possible > 0 else 0
        return min(1.0, coherence_score)
    
    def analyze_information_preservation(self, nodes: List[Dict], transcript: str) -> float:
        """
        Analyze how well the tree preserves information from the original transcript
        """
        if not nodes or not transcript:
            return 0.0
            
        # Extract key terms from transcript
        transcript_words = set(transcript.lower().split())
        important_words = {word for word in transcript_words if len(word) >= 4}
        
        # Extract words from all node content
        node_content = " ".join(node.get("content", "") + " " + node.get("name", "") for node in nodes)
        node_words = set(node_content.lower().split())
        
        # Calculate preservation ratio
        preserved_words = important_words.intersection(node_words)
        preservation_ratio = len(preserved_words) / len(important_words) if important_words else 0
        
        return min(1.0, preservation_ratio)
    
    def analyze_navigation_quality(self, nodes: List[Dict]) -> float:
        """
        Analyze tree navigation quality - clear structure and relationships
        """
        if not nodes:
            return 0.0
            
        navigation_score = 0.0
        
        # Check for clear naming conventions
        names = [node.get("name", "") for node in nodes]
        clear_names = sum(1 for name in names if 3 <= len(name.split()) <= 6)
        name_quality = clear_names / len(names) if names else 0
        
        # Check for varied content lengths (shows proper segmentation)
        content_lengths = [len(node.get("content", "")) for node in nodes]
        if content_lengths:
            avg_length = sum(content_lengths) / len(content_lengths)
            length_variance = sum((length - avg_length) ** 2 for length in content_lengths) / len(content_lengths)
            variance_normalized = min(1.0, length_variance / 1000)  # Normalize variance
        else:
            variance_normalized = 0
        
        # Combine factors
        navigation_score = (name_quality * 0.6 + variance_normalized * 0.4)
        return navigation_score
    
    def run_benchmark(self, transcript: str, generated_nodes: List[Dict]) -> Dict[str, float]:
        """
        Run the complete benchmark on generated nodes
        """
        print("🔍 Running Improved Quality Benchmark...")
        
        # Analyze each dimension
        self.metrics["fragmentation_score"] = self.analyze_node_fragmentation(generated_nodes)
        self.metrics["content_extraction_success"] = self.analyze_content_extraction_success(generated_nodes)
        self.metrics["coherence_score"] = self.analyze_coherence_score(generated_nodes, transcript)
        self.metrics["information_preservation"] = self.analyze_information_preservation(generated_nodes, transcript)
        self.metrics["navigation_quality"] = self.analyze_navigation_quality(generated_nodes)
        
        # Calculate overall improvement score
        weights = {
            "fragmentation_score": 0.25,
            "content_extraction_success": 0.25,
            "coherence_score": 0.20,
            "information_preservation": 0.15,
            "navigation_quality": 0.15
        }
        
        self.metrics["overall_improvement"] = sum(
            self.metrics[metric] * weight for metric, weight in weights.items()
        )
        
        return self.metrics
    
    def generate_report(self) -> str:
        """
        Generate a detailed report of the benchmark results
        """
        report = []
        report.append("=" * 60)
        report.append("VOICETREE IMPROVED QUALITY BENCHMARK REPORT")
        report.append("=" * 60)
        report.append(f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        report.append("")
        
        # Individual metrics
        report.append("📊 DETAILED METRICS:")
        report.append(f"  Fragmentation Score:        {self.metrics['fragmentation_score']:.3f} (1.0 = low fragmentation)")
        report.append(f"  Content Extraction Success: {self.metrics['content_extraction_success']:.3f} (1.0 = all successful)")
        report.append(f"  Coherence Score:           {self.metrics['coherence_score']:.3f} (1.0 = highly coherent)")
        report.append(f"  Information Preservation:   {self.metrics['information_preservation']:.3f} (1.0 = all preserved)")
        report.append(f"  Navigation Quality:        {self.metrics['navigation_quality']:.3f} (1.0 = excellent navigation)")
        report.append("")
        
        # Overall score
        overall = self.metrics["overall_improvement"]
        report.append(f"🎯 OVERALL IMPROVEMENT SCORE: {overall:.3f}")
        
        # Interpretation
        if overall >= 0.8:
            grade = "A+ (Excellent)"
            interpretation = "Outstanding quality with minimal fragmentation and high coherence"
        elif overall >= 0.7:
            grade = "A (Very Good)"
            interpretation = "High quality with good coherence and content extraction"
        elif overall >= 0.6:
            grade = "B (Good)"
            interpretation = "Solid quality with some room for improvement"
        elif overall >= 0.5:
            grade = "C (Fair)"
            interpretation = "Acceptable quality but needs improvement in key areas"
        else:
            grade = "F (Needs Work)"
            interpretation = "Significant quality issues requiring attention"
            
        report.append(f"  Grade: {grade}")
        report.append(f"  Interpretation: {interpretation}")
        report.append("")
        
        # Specific recommendations
        report.append("🔧 RECOMMENDATIONS:")
        if self.metrics["fragmentation_score"] < 0.6:
            report.append("  • REDUCE FRAGMENTATION: Combine related small nodes into coherent thought units")
        if self.metrics["content_extraction_success"] < 0.8:
            report.append("  • IMPROVE EXTRACTION: Debug content generation failures and add better fallbacks")
        if self.metrics["coherence_score"] < 0.7:
            report.append("  • ENHANCE COHERENCE: Improve relationship analysis and integration decisions")
        if self.metrics["information_preservation"] < 0.6:
            report.append("  • PRESERVE INFORMATION: Ensure important details aren't lost during processing")
        if self.metrics["navigation_quality"] < 0.7:
            report.append("  • IMPROVE NAVIGATION: Create clearer node names and better tree structure")
        
        if overall >= 0.7:
            report.append("  • ✅ System is performing well - focus on minor optimizations")
        
        report.append("")
        report.append("=" * 60)
        
        return "\n".join(report)

def main():
    """
    Main function to run the improved benchmark
    """
    # Sample data for testing
    sample_transcript = """
    Today I want to start working on the voice tree project. I need to create a proof of concept
    that can take voice input and convert it into a navigable tree structure. The main goal is
    to make information from conversations easily accessible and well-organized. I'll need to
    research visualization libraries and figure out the best approach for the user interface.
    """
    
    sample_nodes = [
        {
            "name": "Voice Tree Project Planning",
            "content": "• Start working on voice tree project today\n• Create proof of concept for voice-to-tree conversion\n• Focus on making conversational information accessible and organized",
            "summary": "Initial planning and goal-setting for voice tree project"
        },
        {
            "name": "Visualization Research Requirements", 
            "content": "• Research visualization libraries for tree display\n• Determine best approach for user interface design\n• Evaluate options for navigable tree structures",
            "summary": "Technical research needed for visualization components"
        }
    ]
    
    # Run benchmark
    benchmark = ImprovedQualityBenchmark()
    results = benchmark.run_benchmark(sample_transcript, sample_nodes)
    
    # Generate and display report
    report = benchmark.generate_report()
    print(report)
    
    # Save results
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    with open(f"improved_quality_results_{timestamp}.json", "w") as f:
        json.dump(results, f, indent=2)
    
    print(f"\n📊 Results saved to improved_quality_results_{timestamp}.json")

if __name__ == "__main__":
    main() 