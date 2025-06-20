#!/usr/bin/env python3
"""
Debug logging utilities for VoiceTree workflow analysis
Provides detailed logging and analysis functions for workflow stages
Enhanced with comprehensive 4-stage scoring framework
"""

import sys
import os
import time
import re
import json
from pathlib import Path
from typing import Dict, List, Tuple, Optional

# Add necessary paths
sys.path.insert(0, str(Path.cwd()))
sys.path.insert(0, str(Path.cwd() / "backend"))

class WorkflowQualityScorer:
    """
    Comprehensive quality scoring system for VoiceTree agentic workflows
    Implements the 4-stage scoring framework from Benchmarker_Agentic_feedback_loop_guide
    """
    
    def __init__(self):
        self.weights = {
            'segmentation': 0.20,      # Foundation affects everything
            'relationship': 0.25,      # Critical for structure
            'integration': 0.35,       # Most impact on final content
            'extraction': 0.20         # Important for usability
        }
        
        self.regression_thresholds = {
            'segmentation': 10,        # Alert if score drops >10 points
            'relationship': 8,         # Alert if score drops >8 points
            'integration': 12,         # Alert if score drops >12 points
            'extraction': 10           # Alert if score drops >10 points
        }
    
    def score_segmentation(self, transcript: str, chunks: List[str], debug_content: str) -> Dict:
        """
        Score segmentation quality (0-100)
        Criteria: Content Completeness (40) + Chunk Coherence (30) + Boundary Logic (20) + Size Appropriateness (10)
        """
        scores = {}
        
        # Content Completeness (40 points): % of transcript concepts present in chunks
        completeness_score = self._calculate_concept_coverage(transcript, chunks) * 40
        scores['content_completeness'] = completeness_score
        
        # Chunk Coherence (30 points): % of chunks that are semantically complete
        coherence_score = self._calculate_chunk_coherence(chunks) * 30
        scores['chunk_coherence'] = coherence_score
        
        # Boundary Logic (20 points): % of chunks ending at natural concept boundaries
        boundary_score = self._calculate_boundary_quality(chunks) * 20
        scores['boundary_logic'] = boundary_score
        
        # Size Appropriateness (10 points): % of chunks within optimal size range
        size_score = self._calculate_size_distribution(chunks) * 10
        scores['size_appropriateness'] = size_score
        
        total_score = completeness_score + coherence_score + boundary_score + size_score
        
        # Check for specific issues
        issues = self._check_segmentation_issues(debug_content)
        
        return {
            "total_score": round(total_score, 1),
            "component_scores": scores,
            "issues": issues,
            "chunk_count": len(chunks),
            "regression_threshold": self.regression_thresholds['segmentation']
        }
    
    def score_relationship_analysis(self, chunks: List[str], existing_nodes: str, relationships: str, debug_content: str) -> Dict:
        """
        Score relationship analysis quality (0-100)
        Criteria: Context Quality (25) + Relationship Detection (35) + Relationship Strength (25) + Conversation Flow (15)
        """
        scores = {}
        
        # Context Quality (25 points): Richness of existing_nodes context provided
        context_score = self._calculate_context_richness(existing_nodes) * 25
        scores['context_quality'] = context_score
        
        # Relationship Detection (35 points): % of meaningful relationships identified
        detection_score = self._calculate_relationship_coverage(relationships) * 35
        scores['relationship_detection'] = detection_score
        
        # Relationship Strength (25 points): % of strong vs weak relationships
        strength_score = self._calculate_relationship_strength(relationships) * 25
        scores['relationship_strength'] = strength_score
        
        # Conversation Flow (15 points): Context maintained between chunks
        flow_score = self._calculate_conversation_flow(chunks, relationships) * 15
        scores['conversation_flow'] = flow_score
        
        total_score = context_score + detection_score + strength_score + flow_score
        
        # Check for specific issues
        issues = self._check_relationship_issues(debug_content)
        
        return {
            "total_score": round(total_score, 1),
            "component_scores": scores,
            "issues": issues,
            "relationships_found": self._count_relationships(relationships),
            "regression_threshold": self.regression_thresholds['relationship']
        }
    
    def score_integration_decisions(self, decisions: List[Dict], relationships: str, debug_content: str) -> Dict:
        """
        Score integration decision quality (0-100)
        Criteria: Decision Balance (20) + Content Quality (40) + Decision Logic (25) + Content Synthesis (15)
        """
        scores = {}
        
        # Decision Balance (20 points): CREATE/APPEND ratio appropriateness
        balance_score = self._calculate_decision_balance(decisions) * 20
        scores['decision_balance'] = balance_score
        
        # Content Quality (40 points): Well-formatted, unique bullet points
        content_score = self._calculate_content_quality(decisions) * 40
        scores['content_quality'] = content_score
        
        # Decision Logic (25 points): CREATE/APPEND decisions match relationships
        logic_score = self._calculate_decision_logic(decisions, relationships) * 25
        scores['decision_logic'] = logic_score
        
        # Content Synthesis (15 points): Intelligent summarization vs copying
        synthesis_score = self._calculate_synthesis_quality(decisions) * 15
        scores['content_synthesis'] = synthesis_score
        
        total_score = balance_score + content_score + logic_score + synthesis_score
        
        # Check for specific issues
        issues = self._check_integration_issues(debug_content)
        
        return {
            "total_score": round(total_score, 1),
            "component_scores": scores,
            "issues": issues,
            "create_append_ratio": self._get_create_append_ratio(decisions),
            "regression_threshold": self.regression_thresholds['integration']
        }
    
    def score_node_extraction(self, node_names: List[str], decisions: List[Dict], existing_nodes: str, debug_content: str) -> Dict:
        """
        Score node extraction quality (0-100)
        Criteria: Name Quality (40) + Name Uniqueness (20) + Concept Accuracy (25) + Hierarchy Awareness (15)
        """
        scores = {}
        
        # Name Quality (40 points): Descriptive, specific, non-generic names
        quality_score = self._calculate_name_quality(node_names) * 40
        scores['name_quality'] = quality_score
        
        # Name Uniqueness (20 points): Distinct from existing nodes
        uniqueness_score = self._calculate_name_uniqueness(node_names, existing_nodes) * 20
        scores['name_uniqueness'] = uniqueness_score
        
        # Concept Accuracy (25 points): Names match content they represent
        accuracy_score = self._calculate_concept_accuracy(node_names, decisions) * 25
        scores['concept_accuracy'] = accuracy_score
        
        # Hierarchy Awareness (15 points): Names reflect appropriate hierarchy level
        hierarchy_score = self._calculate_hierarchy_awareness(node_names) * 15
        scores['hierarchy_awareness'] = hierarchy_score
        
        total_score = quality_score + uniqueness_score + accuracy_score + hierarchy_score
        
        # Check for specific issues
        issues = self._check_extraction_issues(debug_content)
        
        return {
            "total_score": round(total_score, 1),
            "component_scores": scores,
            "issues": issues,
            "nodes_extracted": len(node_names),
            "regression_threshold": self.regression_thresholds['extraction']
        }
    
    def calculate_overall_quality(self, stage_scores: Dict[str, Dict]) -> Dict:
        """Calculate weighted overall quality score"""
        total_score = 0
        valid_stages = 0
        
        for stage, weight in self.weights.items():
            if stage in stage_scores and 'total_score' in stage_scores[stage]:
                total_score += stage_scores[stage]['total_score'] * weight
                valid_stages += 1
        
        if valid_stages == 0:
            return {"overall_score": 0, "valid_stages": 0}
        
        # Adjust for missing stages
        weight_adjustment = len(self.weights) / valid_stages if valid_stages < len(self.weights) else 1
        overall_score = total_score * weight_adjustment
        
        return {
            "overall_score": round(overall_score, 1),
            "valid_stages": valid_stages,
            "stage_weights": self.weights,
            "quality_grade": self._get_quality_grade(overall_score)
        }
    
    # Helper methods for scoring calculations
    def _calculate_concept_coverage(self, transcript: str, chunks: List[str]) -> float:
        """Calculate what % of transcript concepts are covered in chunks"""
        if not transcript or not chunks:
            return 0.0
        
        # Extract key concepts (simple word-based approach)
        transcript_words = set(word.lower().strip('.,!?') for word in transcript.split() if len(word) > 3)
        chunk_words = set()
        for chunk in chunks:
            chunk_words.update(word.lower().strip('.,!?') for word in chunk.split() if len(word) > 3)
        
        if not transcript_words:
            return 1.0
        
        coverage = len(chunk_words.intersection(transcript_words)) / len(transcript_words)
        return min(1.0, coverage)
    
    def _calculate_chunk_coherence(self, chunks: List[str]) -> float:
        """Calculate % of chunks that are semantically complete"""
        if not chunks:
            return 0.0
        
        coherent_chunks = 0
        for chunk in chunks:
            # Check if chunk ends with complete sentence/thought
            chunk = chunk.strip()
            if chunk and (chunk.endswith('.') or chunk.endswith('!') or chunk.endswith('?')):
                coherent_chunks += 1
        
        return coherent_chunks / len(chunks)
    
    def _calculate_boundary_quality(self, chunks: List[str]) -> float:
        """Calculate % of chunks ending at natural concept boundaries"""
        if not chunks:
            return 0.0
        
        good_boundaries = 0
        for chunk in chunks:
            chunk = chunk.strip()
            # Check for natural endings
            if chunk and (chunk.endswith('.') or chunk.endswith('!') or chunk.endswith('?')):
                good_boundaries += 1
        
        return good_boundaries / len(chunks)
    
    def _calculate_size_distribution(self, chunks: List[str]) -> float:
        """Calculate % of chunks within optimal size range (50-300 words)"""
        if not chunks:
            return 0.0
        
        optimal_chunks = 0
        for chunk in chunks:
            word_count = len(chunk.split())
            if 50 <= word_count <= 300:
                optimal_chunks += 1
        
        return optimal_chunks / len(chunks)
    
    def _calculate_context_richness(self, existing_nodes: str) -> float:
        """Calculate richness of existing_nodes context"""
        if not existing_nodes or existing_nodes.strip() == "":
            return 0.0
        
        # Basic richness metrics
        node_count = existing_nodes.count('node:') + existing_nodes.count('Node:')
        content_length = len(existing_nodes)
        
        # Score based on content richness
        if node_count == 0:
            return 0.2
        elif node_count < 3:
            return 0.4
        elif content_length < 500:
            return 0.6
        elif content_length < 1000:
            return 0.8
        else:
            return 1.0
    
    def _calculate_relationship_coverage(self, relationships: str) -> float:
        """Calculate % of meaningful relationships identified"""
        if not relationships:
            return 0.0
        
        # Count relationship indicators
        strong_relationships = relationships.count('implements') + relationships.count('extends') + relationships.count('depends on')
        weak_relationships = relationships.count('relates to') + relationships.count('similar to')
        
        total_relationships = strong_relationships + weak_relationships
        
        if total_relationships == 0:
            return 0.0
        elif total_relationships < 3:
            return 0.4
        elif total_relationships < 6:
            return 0.7
        else:
            return 1.0
    
    def _calculate_relationship_strength(self, relationships: str) -> float:
        """Calculate % of strong vs weak relationships"""
        if not relationships:
            return 0.0
        
        strong_relationships = relationships.count('implements') + relationships.count('extends') + relationships.count('depends on')
        weak_relationships = relationships.count('relates to') + relationships.count('similar to')
        
        total_relationships = strong_relationships + weak_relationships
        
        if total_relationships == 0:
            return 0.5  # Neutral score
        
        return strong_relationships / total_relationships
    
    def _calculate_conversation_flow(self, chunks: List[str], relationships: str) -> float:
        """Calculate context consistency between chunks"""
        if not chunks or len(chunks) < 2:
            return 1.0  # Single chunk gets full score
        
        # Simple heuristic: check for context continuity indicators
        flow_indicators = relationships.count('previous') + relationships.count('continuing') + relationships.count('building on')
        
        if flow_indicators >= len(chunks) // 2:
            return 1.0
        elif flow_indicators > 0:
            return 0.7
        else:
            return 0.4
    
    def _calculate_decision_balance(self, decisions: List[Dict]) -> float:
        """Calculate CREATE/APPEND ratio appropriateness"""
        if not decisions:
            return 0.0
        
        create_count = sum(1 for d in decisions if d.get('action') == 'CREATE')
        append_count = sum(1 for d in decisions if d.get('action') == 'APPEND')
        total_decisions = create_count + append_count
        
        if total_decisions == 0:
            return 0.0
        
        create_ratio = create_count / total_decisions
        
        # Optimal ratio is around 50/50, penalize extremes
        if 0.3 <= create_ratio <= 0.7:
            return 1.0
        elif 0.2 <= create_ratio <= 0.8:
            return 0.8
        elif 0.1 <= create_ratio <= 0.9:
            return 0.6
        else:
            return 0.3
    
    def _calculate_content_quality(self, decisions: List[Dict]) -> float:
        """Calculate quality of content in decisions"""
        if not decisions:
            return 0.0
        
        quality_score = 0
        for decision in decisions:
            content = decision.get('content', '')
            if not content:
                continue
            
            # Check for bullet points
            if '•' in content or '*' in content or content.count('\n-') > 0:
                quality_score += 0.3
            
            # Check for unique content (not repetitive)
            lines = [line.strip() for line in content.split('\n') if line.strip()]
            unique_lines = set(lines)
            if len(lines) > 0 and len(unique_lines) == len(lines):
                quality_score += 0.4
            
            # Check for meaningful length
            if len(content.split()) > 10:
                quality_score += 0.3
        
        return min(1.0, quality_score / len(decisions))
    
    def _calculate_decision_logic(self, decisions: List[Dict], relationships: str) -> float:
        """Calculate if CREATE/APPEND decisions align with relationships"""
        if not decisions:
            return 0.0
        
        # Simple heuristic: strong relationships should lead to APPEND, weak to CREATE
        logical_decisions = 0
        for decision in decisions:
            action = decision.get('action')
            # This is a simplified check - in practice would need more sophisticated analysis
            logical_decisions += 1  # Assume logical for now
        
        return logical_decisions / len(decisions)
    
    def _calculate_synthesis_quality(self, decisions: List[Dict]) -> float:
        """Calculate quality of content synthesis vs raw copying"""
        if not decisions:
            return 0.0
        
        synthesis_score = 0
        for decision in decisions:
            content = decision.get('content', '')
            if not content:
                continue
            
            # Check for synthesis indicators (bullet points, summaries)
            if '•' in content and len(content.split('\n')) > 1:
                synthesis_score += 1
            elif len(content.split()) > 20 and '.' in content:
                synthesis_score += 0.7
            else:
                synthesis_score += 0.3
        
        return min(1.0, synthesis_score / len(decisions))
    
    def _calculate_name_quality(self, node_names: List[str]) -> float:
        """Calculate quality of node names (descriptive vs generic)"""
        if not node_names:
            return 0.0
        
        generic_terms = ['things', 'different', 'various', 'multiple', 'untitled', 'stuff', 'items']
        quality_score = 0
        
        for name in node_names:
            name_lower = name.lower()
            is_generic = any(term in name_lower for term in generic_terms)
            
            if is_generic:
                quality_score += 0.2
            elif len(name.split()) >= 3:  # Multi-word descriptive names
                quality_score += 1.0
            elif len(name.split()) == 2:  # Two-word names
                quality_score += 0.8
            else:  # Single word names
                quality_score += 0.5
        
        return min(1.0, quality_score / len(node_names))
    
    def _calculate_name_uniqueness(self, node_names: List[str], existing_nodes: str) -> float:
        """Calculate uniqueness of node names vs existing nodes"""
        if not node_names:
            return 0.0
        
        if not existing_nodes:
            return 1.0  # All names are unique if no existing nodes
        
        existing_names = set()
        # Extract existing node names (simple pattern matching)
        for line in existing_nodes.split('\n'):
            if 'node:' in line.lower() or 'title:' in line.lower():
                # Extract name after colon
                parts = line.split(':')
                if len(parts) > 1:
                    existing_names.add(parts[1].strip().lower())
        
        unique_count = 0
        for name in node_names:
            if name.lower() not in existing_names:
                unique_count += 1
        
        return unique_count / len(node_names)
    
    def _calculate_concept_accuracy(self, node_names: List[str], decisions: List[Dict]) -> float:
        """Calculate if node names accurately represent their content"""
        if not node_names or not decisions:
            return 0.0
        
        # Simple heuristic: check if key words from content appear in node names
        accurate_count = 0
        
        for i, name in enumerate(node_names):
            if i < len(decisions):
                content = decisions[i].get('content', '')
                name_words = set(word.lower() for word in name.split())
                content_words = set(word.lower() for word in content.split() if len(word) > 3)
                
                # Check for word overlap
                overlap = len(name_words.intersection(content_words))
                if overlap > 0:
                    accurate_count += 1
        
        return accurate_count / len(node_names)
    
    def _calculate_hierarchy_awareness(self, node_names: List[str]) -> float:
        """Calculate if names reflect appropriate hierarchy level"""
        if not node_names:
            return 0.0
        
        # Simple heuristic: check for hierarchical naming patterns
        hierarchy_score = 0
        for name in node_names:
            # Look for hierarchy indicators
            if any(word in name.lower() for word in ['overview', 'summary', 'main', 'core']):
                hierarchy_score += 1.0  # High-level names
            elif any(word in name.lower() for word in ['detail', 'specific', 'implementation', 'step']):
                hierarchy_score += 0.8  # Detail-level names
            else:
                hierarchy_score += 0.6  # Generic score
        
        return min(1.0, hierarchy_score / len(node_names))
    
    def _check_segmentation_issues(self, debug_content: str) -> List[str]:
        """Check for segmentation-specific issues"""
        issues = []
        if "chunks:" not in debug_content.lower():
            issues.append("No chunks found in segmentation output")
        if "[TRUNCATED]" in debug_content:
            issues.append("Content truncated in debug logs")
        return issues
    
    def _check_relationship_issues(self, debug_content: str) -> List[str]:
        """Check for relationship analysis issues"""
        issues = []
        if "no relationships" in debug_content.lower():
            issues.append("No relationships detected")
        if "weak relationship" in debug_content.lower():
            issues.append("Only weak relationships found")
        return issues
    
    def _check_integration_issues(self, debug_content: str) -> List[str]:
        """Check for integration decision issues"""
        issues = []
        if "action': 'CREATE'" in debug_content:
            create_count = debug_content.count("'action': 'CREATE'")
            append_count = debug_content.count("'action': 'APPEND'")
            total_decisions = create_count + append_count
            if total_decisions > 0:
                create_ratio = create_count / total_decisions
                if create_ratio > 0.9:
                    issues.append(f"Over-fragmentation: {create_ratio:.1%} CREATE actions")
        return issues
    
    def _check_extraction_issues(self, debug_content: str) -> List[str]:
        """Check for node extraction issues"""
        issues = []
        if "new_nodes:" in debug_content:
            generic_terms = ["things", "different", "various", "multiple", "untitled"]
            for term in generic_terms:
                if term in debug_content.lower():
                    issues.append(f"Generic node names detected: '{term}'")
        return issues
    
    def _count_relationships(self, relationships: str) -> int:
        """Count total relationships found"""
        if not relationships:
            return 0
        return relationships.count('relationship:') + relationships.count('relates to') + relationships.count('implements')
    
    def _get_create_append_ratio(self, decisions: List[Dict]) -> str:
        """Get CREATE/APPEND ratio as string"""
        if not decisions:
            return "0:0"
        
        create_count = sum(1 for d in decisions if d.get('action') == 'CREATE')
        append_count = sum(1 for d in decisions if d.get('action') == 'APPEND')
        
        return f"{create_count}:{append_count}"
    
    def _get_quality_grade(self, score: float) -> str:
        """Convert numeric score to quality grade"""
        if score >= 90:
            return "Excellent"
        elif score >= 80:
            return "Good"
        elif score >= 70:
            return "Acceptable"
        elif score >= 60:
            return "Poor"
        else:
            return "Critical"

def setup_debug_logging():
    """Setup debug logging for workflow analysis"""
    from backend.agentic_workflows.debug_logger import clear_debug_logs, create_debug_summary
    
    # Clear any existing debug logs
    clear_debug_logs()
    return create_debug_summary

def analyze_workflow_debug_logs():
    """
    Enhanced analysis with comprehensive 4-stage scoring
    Returns systematic analysis of each workflow stage with detailed quality metrics
    """
    debug_logs_dir = "backend/agentic_workflows/debug_logs"
    
    if not os.path.exists(debug_logs_dir):
        return {"error": "No debug logs found"}
    
    scorer = WorkflowQualityScorer()
    
    analysis = {
        "timestamp": "debug_analysis_" + str(int(time.time())),
        "stages": {},
        "quality_scores": {},
        "overall_quality": {},
        "content_flow": {},
        "quality_issues": [],
        "recommendations": []
    }
    
    # Load debug logs for each stage
    stage_data = _load_stage_debug_data(debug_logs_dir)
    
    # Score each stage with comprehensive metrics
    if 'segmentation' in stage_data:
        seg_data = stage_data['segmentation']
        analysis["quality_scores"]["segmentation"] = scorer.score_segmentation(
            seg_data.get('transcript', ''),
            seg_data.get('chunks', []),
            seg_data.get('debug_content', '')
        )
    
    if 'relationship_analysis' in stage_data:
        rel_data = stage_data['relationship_analysis']
        analysis["quality_scores"]["relationship_analysis"] = scorer.score_relationship_analysis(
            rel_data.get('chunks', []),
            rel_data.get('existing_nodes', ''),
            rel_data.get('relationships', ''),
            rel_data.get('debug_content', '')
        )
    
    if 'integration_decision' in stage_data:
        int_data = stage_data['integration_decision']
        analysis["quality_scores"]["integration_decision"] = scorer.score_integration_decisions(
            int_data.get('decisions', []),
            int_data.get('relationships', ''),
            int_data.get('debug_content', '')
        )
    
    if 'node_extraction' in stage_data:
        ext_data = stage_data['node_extraction']
        analysis["quality_scores"]["node_extraction"] = scorer.score_node_extraction(
            ext_data.get('node_names', []),
            ext_data.get('decisions', []),
            ext_data.get('existing_nodes', ''),
            ext_data.get('debug_content', '')
        )
    
    # Calculate overall quality score
    analysis["overall_quality"] = scorer.calculate_overall_quality(analysis["quality_scores"])
    
    # Legacy compatibility - maintain original stage analysis format
    stages = [
        ("segmentation", "00_transcript_input.txt", "segmentation_debug.txt"),
        ("relationship_analysis", "relationship_analysis_debug.txt", None),
        ("integration_decision", "integration_decision_debug.txt", None),
        ("node_extraction", "node_extraction_debug.txt", None)
    ]
    
    for stage_name, input_file, output_file in stages:
        stage_analysis = analyze_stage_debug_logs(debug_logs_dir, stage_name, input_file, output_file)
        analysis["stages"][stage_name] = stage_analysis
    
    # Detect content pipeline losses
    pipeline_loss = detect_pipeline_content_loss(analysis["stages"])
    if pipeline_loss:
        analysis["quality_issues"].extend(pipeline_loss)
    
    # Generate recommendations based on scores
    analysis["recommendations"] = _generate_quality_recommendations(analysis["quality_scores"])
    
    return analysis

def _load_stage_debug_data(debug_logs_dir: str) -> Dict:
    """Load and parse debug data for all stages"""
    stage_data = {}
    
    # Load segmentation data
    transcript_file = os.path.join(debug_logs_dir, "00_transcript_input.txt")
    seg_file = os.path.join(debug_logs_dir, "segmentation_debug.txt")
    
    if os.path.exists(transcript_file) and os.path.exists(seg_file):
        with open(transcript_file, 'r') as f:
            transcript = f.read()
        with open(seg_file, 'r') as f:
            seg_content = f.read()
        
        # Extract chunks from debug content (simplified parsing)
        chunks = _extract_chunks_from_debug(seg_content)
        
        stage_data['segmentation'] = {
            'transcript': transcript,
            'chunks': chunks,
            'debug_content': seg_content
        }
    
    # Load relationship analysis data
    rel_file = os.path.join(debug_logs_dir, "relationship_analysis_debug.txt")
    if os.path.exists(rel_file):
        with open(rel_file, 'r') as f:
            rel_content = f.read()
        
        stage_data['relationship_analysis'] = {
            'chunks': stage_data.get('segmentation', {}).get('chunks', []),
            'existing_nodes': _extract_existing_nodes_from_debug(rel_content),
            'relationships': rel_content,
            'debug_content': rel_content
        }
    
    # Load integration decision data
    int_file = os.path.join(debug_logs_dir, "integration_decision_debug.txt")
    if os.path.exists(int_file):
        with open(int_file, 'r') as f:
            int_content = f.read()
        
        decisions = _extract_decisions_from_debug(int_content)
        
        stage_data['integration_decision'] = {
            'decisions': decisions,
            'relationships': stage_data.get('relationship_analysis', {}).get('relationships', ''),
            'debug_content': int_content
        }
    
    # Load node extraction data
    ext_file = os.path.join(debug_logs_dir, "node_extraction_debug.txt")
    if os.path.exists(ext_file):
        with open(ext_file, 'r') as f:
            ext_content = f.read()
        
        node_names = _extract_node_names_from_debug(ext_content)
        
        stage_data['node_extraction'] = {
            'node_names': node_names,
            'decisions': stage_data.get('integration_decision', {}).get('decisions', []),
            'existing_nodes': stage_data.get('relationship_analysis', {}).get('existing_nodes', ''),
            'debug_content': ext_content
        }
    
    return stage_data

def _extract_chunks_from_debug(debug_content: str) -> List[str]:
    """Extract chunks from segmentation debug content"""
    chunks = []
    lines = debug_content.split('\n')
    in_chunk = False
    current_chunk = []
    
    for line in lines:
        if 'chunk' in line.lower() and ':' in line:
            if current_chunk:
                chunks.append('\n'.join(current_chunk).strip())
                current_chunk = []
            in_chunk = True
        elif in_chunk and line.strip():
            current_chunk.append(line)
        elif in_chunk and not line.strip():
            if current_chunk:
                chunks.append('\n'.join(current_chunk).strip())
                current_chunk = []
            in_chunk = False
    
    if current_chunk:
        chunks.append('\n'.join(current_chunk).strip())
    
    return [chunk for chunk in chunks if chunk]

def _extract_existing_nodes_from_debug(debug_content: str) -> str:
    """Extract existing nodes context from debug content"""
    # Look for existing_nodes section
    start_marker = "existing_nodes:"
    end_marker = "relationships:"
    
    start_idx = debug_content.find(start_marker)
    if start_idx == -1:
        return ""
    
    end_idx = debug_content.find(end_marker, start_idx)
    if end_idx == -1:
        end_idx = len(debug_content)
    
    return debug_content[start_idx:end_idx].strip()

def _extract_decisions_from_debug(debug_content: str) -> List[Dict]:
    """Extract integration decisions from debug content"""
    decisions = []
    
    # Look for decision patterns
    create_pattern = r"'action':\s*'CREATE'"
    append_pattern = r"'action':\s*'APPEND'"
    
    create_matches = re.findall(create_pattern, debug_content)
    append_matches = re.findall(append_pattern, debug_content)
    
    # Simple extraction - in practice would need more sophisticated parsing
    for _ in create_matches:
        decisions.append({'action': 'CREATE', 'content': 'extracted_content'})
    
    for _ in append_matches:
        decisions.append({'action': 'APPEND', 'content': 'extracted_content'})
    
    return decisions

def _extract_node_names_from_debug(debug_content: str) -> List[str]:
    """Extract node names from extraction debug content"""
    node_names = []
    
    # Look for node name patterns
    lines = debug_content.split('\n')
    for line in lines:
        if 'node_name:' in line.lower() or 'new_node:' in line.lower():
            # Extract name after colon
            parts = line.split(':')
            if len(parts) > 1:
                name = parts[1].strip().strip('"\'')
                if name:
                    node_names.append(name)
    
    return node_names

def _generate_quality_recommendations(quality_scores: Dict) -> List[str]:
    """Generate recommendations based on quality scores"""
    recommendations = []
    
    for stage, scores in quality_scores.items():
        total_score = scores.get('total_score', 0)
        threshold = scores.get('regression_threshold', 10)
        
        if total_score < 70:  # Below acceptable threshold
            if stage == 'segmentation':
                recommendations.append(f"Improve segmentation: Score {total_score}/100. Focus on chunk coherence and boundary logic.")
            elif stage == 'relationship_analysis':
                recommendations.append(f"Enhance relationship analysis: Score {total_score}/100. Improve context quality and relationship detection.")
            elif stage == 'integration_decision':
                recommendations.append(f"Refine integration decisions: Score {total_score}/100. Balance CREATE/APPEND ratio and improve content quality.")
            elif stage == 'node_extraction':
                recommendations.append(f"Improve node extraction: Score {total_score}/100. Focus on name quality and concept accuracy.")
    
    return recommendations

# Legacy compatibility functions
def analyze_stage_debug_logs(debug_dir: str, stage_name: str, input_file: str, output_file: str):
    """Analyze individual stage debug logs following guide methodology (legacy compatibility)"""
    import time
    
    stage_analysis = {
        "stage": stage_name,
        "input_count": 0,
        "output_count": 0,
        "content_issues": [],
        "quality_score": 0
    }
    
    try:
        if input_file and os.path.exists(os.path.join(debug_dir, input_file)):
            with open(os.path.join(debug_dir, input_file), 'r') as f:
                input_content = f.read()
                # Count meaningful content units
                if stage_name == "segmentation":
                    # For transcript input, count concepts
                    stage_analysis["input_count"] = len([line for line in input_content.split('\n') if len(line.strip()) > 20])
                
        if output_file and os.path.exists(os.path.join(debug_dir, output_file)):
            with open(os.path.join(debug_dir, output_file), 'r') as f:
                output_content = f.read()
                # Extract output counts from debug format
                if "result_count:" in output_content:
                    import re
                    count_match = re.search(r'result_count:\s*(\d+)', output_content)
                    if count_match:
                        stage_analysis["output_count"] = int(count_match.group(1))
                
                # Check for quality issues specific to each stage
                stage_analysis["content_issues"] = check_stage_quality_issues(stage_name, output_content)
        
        # Calculate basic quality score (0-100)
        stage_analysis["quality_score"] = calculate_stage_quality_score(stage_name, stage_analysis)
        
    except Exception as e:
        stage_analysis["error"] = str(e)
    
    return stage_analysis

def check_stage_quality_issues(stage_name: str, content: str) -> list:
    """Check for quality issues specific to each stage (following our guide)"""
    issues = []
    
    if stage_name == "segmentation":
        # Check for content completeness and coherence
        if "chunks:" not in content.lower():
            issues.append("No chunks found in segmentation output")
        if "[TRUNCATED]" in content:
            issues.append("Content truncated in debug logs")
    
    elif stage_name == "integration_decision":
        # Check for repetitive bullet points and raw transcript copying
        if "action': 'CREATE'" in content:
            create_count = content.count("'action': 'CREATE'")
            append_count = content.count("'action': 'APPEND'")
            total_decisions = create_count + append_count
            if total_decisions > 0:
                create_ratio = create_count / total_decisions
                if create_ratio > 0.9:  # > 90% CREATE actions
                    issues.append(f"Over-fragmentation: {create_ratio:.1%} CREATE actions")
    
    elif stage_name == "node_extraction":
        # Check for generic node names
        if "new_nodes:" in content:
            # Extract node names and check for generic terms
            generic_terms = ["things", "different", "various", "multiple", "untitled"]
            for term in generic_terms:
                if term in content.lower():
                    issues.append(f"Generic node names detected: '{term}'")
    
    return issues

def calculate_stage_quality_score(stage_name: str, stage_analysis: dict) -> float:
    """Calculate quality score for individual stage (0-100)"""
    base_score = 80.0  # Start with good baseline
    
    # Deduct points for issues
    issue_penalty = len(stage_analysis["content_issues"]) * 15
    base_score -= issue_penalty
    
    # Deduct for pipeline losses
    input_count = stage_analysis.get("input_count", 0)
    output_count = stage_analysis.get("output_count", 0)
    
    if input_count > 0 and output_count > 0:
        retention_rate = output_count / input_count
        if retention_rate < 0.8:  # Lost > 20% of content
            base_score -= (1 - retention_rate) * 50
    
    return max(0, min(100, base_score))

def detect_pipeline_content_loss(stages_analysis: dict) -> list:
    """Detect content loss through pipeline (like our 8→7→6 issue)"""
    issues = []
    
    try:
        seg_count = stages_analysis.get("segmentation", {}).get("output_count", 0)
        int_count = stages_analysis.get("integration_decision", {}).get("output_count", 0) 
        ext_count = stages_analysis.get("node_extraction", {}).get("output_count", 0)
        
        if seg_count > int_count > 0:
            loss_pct = (seg_count - int_count) / seg_count
            if loss_pct > 0.1:  # > 10% loss
                issues.append(f"Content loss: Segmentation→Integration: {seg_count}→{int_count} ({loss_pct:.1%} loss)")
        
        if int_count > ext_count > 0:
            loss_pct = (int_count - ext_count) / int_count
            if loss_pct > 0.1:
                issues.append(f"Content loss: Integration→Extraction: {int_count}→{ext_count} ({loss_pct:.1%} loss)")
    
    except (KeyError, ZeroDivisionError):
        pass
    
    return issues

# Legacy function for backwards compatibility
def run_debug_workflow():
    """Legacy function - now redirects to unified benchmarker"""
    print("🔄 debug_workflow.py has been enhanced!")
    print("📊 Now includes comprehensive 4-stage quality scoring")
    print("🚀 Run: python backend/benchmarker/unified_voicetree_benchmarker.py")
    print("")
    print("For enhanced debug analysis with scoring:")
    print("python -c \"from backend.benchmarker.debug_workflow import analyze_workflow_debug_logs; import json; print(json.dumps(analyze_workflow_debug_logs(), indent=2))\"")

if __name__ == "__main__":
    run_debug_workflow() 