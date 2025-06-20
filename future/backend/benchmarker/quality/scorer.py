#!/usr/bin/env python3
"""
VoiceTree Workflow Quality Scoring System
Implements per-stage quality assessment for the 4-stage workflow pipeline
"""

import re
import json
import math
from typing import Dict, List, Any, Optional, Tuple
from dataclasses import dataclass
from datetime import datetime
import statistics


@dataclass
class StageQualityScore:
    """Quality score for a single workflow stage"""
    stage_name: str
    overall_score: float  # 0-100
    metric_scores: Dict[str, float]  # Individual metric scores
    issues: List[str]  # Quality issues identified
    recommendations: List[str]  # Improvement suggestions
    confidence: float  # Confidence in the assessment (0-1)


@dataclass
class WorkflowQualityAssessment:
    """Complete quality assessment for entire workflow"""
    overall_score: float  # Weighted average of all stages
    stage_scores: Dict[str, StageQualityScore]  # Per-stage scores
    timestamp: str
    regression_alerts: List[Dict[str, Any]]
    summary: str


class QualityMetricsCalculator:
    """Calculates specific quality metrics for each workflow stage"""
    
    def __init__(self):
        self.generic_terms = ["things", "different", "various", "multiple", "untitled", "aspect", "item"]
        self.relationship_strength_keywords = {
            "strong": ["implements", "extends", "defines", "creates", "produces", "generates"],
            "medium": ["relates to", "connects to", "involves", "includes", "uses"],
            "weak": ["mentions", "references", "touches on", "alludes to"]
        }
    
    # =============================================================================
    # SEGMENTATION METRICS
    # =============================================================================
    
    def calculate_content_completeness(self, transcript: str, chunks: List[Dict]) -> float:
        """
        Calculate what percentage of transcript concepts are captured in chunks
        Score: 0-100 (40% weight in segmentation)
        """
        if not transcript or not chunks:
            return 0.0
        
        # Extract key concepts from transcript (simplified - could use NLP)
        transcript_concepts = self._extract_key_concepts(transcript)
        
        # Extract concepts from all chunks
        chunk_text = " ".join([chunk.get("text", "") for chunk in chunks])
        chunk_concepts = self._extract_key_concepts(chunk_text)
        
        if not transcript_concepts:
            return 100.0  # If no concepts detected, assume complete
        
        # Calculate overlap
        covered_concepts = len(transcript_concepts.intersection(chunk_concepts))
        total_concepts = len(transcript_concepts)
        
        return (covered_concepts / total_concepts) * 100.0
    
    def calculate_chunk_coherence(self, chunks: List[Dict]) -> float:
        """
        Calculate semantic coherence of chunks (complete thoughts vs fragments)
        Score: 0-100 (30% weight in segmentation)
        """
        if not chunks:
            return 0.0
        
        coherent_chunks = 0
        for chunk in chunks:
            text = chunk.get("text", "").strip()
            if self._is_coherent_chunk(text):
                coherent_chunks += 1
        
        return (coherent_chunks / len(chunks)) * 100.0
    
    def calculate_boundary_quality(self, chunks: List[Dict]) -> float:
        """
        Calculate quality of chunk boundaries (natural breaks vs mid-sentence)
        Score: 0-100 (20% weight in segmentation)
        """
        if not chunks:
            return 0.0
        
        good_boundaries = 0
        for chunk in chunks:
            text = chunk.get("text", "").strip()
            if self._has_good_boundaries(text):
                good_boundaries += 1
        
        return (good_boundaries / len(chunks)) * 100.0
    
    def calculate_size_appropriateness(self, chunks: List[Dict]) -> float:
        """
        Calculate chunk size distribution appropriateness
        Score: 0-100 (10% weight in segmentation)
        """
        if not chunks:
            return 0.0
        
        sizes = [len(chunk.get("text", "")) for chunk in chunks]
        if not sizes:
            return 0.0
        
        # Optimal range: 100-500 characters per chunk
        optimal_min, optimal_max = 100, 500
        appropriate_chunks = 0
        
        for size in sizes:
            if optimal_min <= size <= optimal_max:
                appropriate_chunks += 1
        
        return (appropriate_chunks / len(chunks)) * 100.0
    
    # =============================================================================
    # RELATIONSHIP ANALYSIS METRICS
    # =============================================================================
    
    def calculate_context_quality(self, existing_nodes: str) -> float:
        """
        Calculate richness and quality of existing nodes context
        Score: 0-100 (25% weight in relationship analysis)
        """
        if not existing_nodes or existing_nodes.strip() == "No existing nodes":
            return 50.0  # Neutral score for empty context
        
        # Check for meaningful node descriptions
        lines = existing_nodes.split('\n')
        meaningful_lines = [line for line in lines if len(line.strip()) > 20]
        
        if not lines:
            return 0.0
        
        richness_score = (len(meaningful_lines) / len(lines)) * 100.0
        
        # Bonus for structured format (node names, summaries, etc.)
        if any(keyword in existing_nodes.lower() for keyword in ["summary:", "links:", "parent:", "content:"]):
            richness_score = min(100.0, richness_score * 1.2)
        
        return richness_score
    
    def calculate_relationship_detection(self, relationships: List[Dict]) -> float:
        """
        Calculate percentage of meaningful relationships identified
        Score: 0-100 (35% weight in relationship analysis)
        """
        if not relationships:
            return 0.0
        
        meaningful_relationships = 0
        for rel in relationships:
            relationship_text = rel.get("relationship", "").lower()
            if any(keyword in relationship_text for keywords in self.relationship_strength_keywords.values() for keyword in keywords):
                meaningful_relationships += 1
        
        return (meaningful_relationships / len(relationships)) * 100.0
    
    def calculate_relationship_strength(self, relationships: List[Dict]) -> float:
        """
        Calculate strength of relationships (strong vs weak connections)
        Score: 0-100 (25% weight in relationship analysis)
        """
        if not relationships:
            return 0.0
        
        strength_scores = []
        for rel in relationships:
            relationship_text = rel.get("relationship", "").lower()
            if any(keyword in relationship_text for keyword in self.relationship_strength_keywords["strong"]):
                strength_scores.append(100.0)
            elif any(keyword in relationship_text for keyword in self.relationship_strength_keywords["medium"]):
                strength_scores.append(60.0)
            elif any(keyword in relationship_text for keyword in self.relationship_strength_keywords["weak"]):
                strength_scores.append(20.0)
            else:
                strength_scores.append(0.0)
        
        return statistics.mean(strength_scores) if strength_scores else 0.0
    
    def calculate_conversation_flow(self, chunks: List[Dict], relationships: List[Dict]) -> float:
        """
        Calculate consistency of context maintenance between chunks
        Score: 0-100 (15% weight in relationship analysis)
        """
        if len(chunks) <= 1:
            return 100.0  # Single chunk, no flow issues
        
        # Check if relationships reference previous chunks/concepts
        flow_maintained = 0
        for i, rel in enumerate(relationships):
            if "previous" in rel.get("relationship", "").lower() or "earlier" in rel.get("relationship", "").lower():
                flow_maintained += 1
        
        if not relationships:
            return 50.0  # Neutral score
        
        return (flow_maintained / len(relationships)) * 100.0
    
    # =============================================================================
    # INTEGRATION DECISION METRICS
    # =============================================================================
    
    def calculate_decision_balance(self, decisions: List[Dict]) -> float:
        """
        Calculate CREATE vs APPEND ratio appropriateness
        Score: 0-100 (20% weight in integration decision)
        """
        if not decisions:
            return 0.0
        
        create_count = sum(1 for d in decisions if d.get("action") == "CREATE")
        append_count = sum(1 for d in decisions if d.get("action") == "APPEND")
        total = create_count + append_count
        
        if total == 0:
            return 0.0
        
        create_ratio = create_count / total
        
        # Optimal range: 30-70% CREATE actions
        if 0.3 <= create_ratio <= 0.7:
            return 100.0
        elif create_ratio < 0.1:  # Too few CREATE actions
            return 20.0
        elif create_ratio > 0.9:  # Too many CREATE actions (over-fragmentation)
            return 30.0
        else:
            # Linear penalty based on distance from optimal range
            distance = min(abs(create_ratio - 0.3), abs(create_ratio - 0.7))
            return max(50.0, 100.0 - (distance * 200))
    
    def calculate_content_quality(self, decisions: List[Dict]) -> float:
        """
        Calculate content quality (structured bullets vs raw text)
        Score: 0-100 (40% weight in integration decision)
        """
        if not decisions:
            return 0.0
        
        quality_scores = []
        for decision in decisions:
            content = decision.get("content", "")
            if not content:
                quality_scores.append(0.0)
                continue
            
            score = 0.0
            
            # Check for bullet point structure
            if "•" in content or "-" in content:
                score += 40.0
            
            # Check for meaningful length (not just fragments)
            if len(content.strip()) >= 50:
                score += 30.0
            
            # Check against raw transcript copying (repetitive patterns)
            if not self._is_repetitive_content(content):
                score += 30.0
            
            quality_scores.append(min(100.0, score))
        
        return statistics.mean(quality_scores) if quality_scores else 0.0
    
    def calculate_decision_logic(self, decisions: List[Dict], relationships: List[Dict]) -> float:
        """
        Calculate alignment between decisions and relationship analysis
        Score: 0-100 (25% weight in integration decision)
        """
        if not decisions or not relationships:
            return 50.0  # Neutral score if missing data
        
        logical_decisions = 0
        
        for decision in decisions:
            decision_action = decision.get("action")
            target_node = decision.get("target_node", "")
            
            # Find corresponding relationship analysis
            matching_relationships = [
                r for r in relationships 
                if target_node in r.get("related_nodes", [])
            ]
            
            if matching_relationships:
                # Check if decision aligns with relationship strength
                strong_relationship = any(
                    any(keyword in r.get("relationship", "").lower() 
                        for keyword in self.relationship_strength_keywords["strong"])
                    for r in matching_relationships
                )
                
                if (strong_relationship and decision_action == "APPEND") or \
                   (not strong_relationship and decision_action == "CREATE"):
                    logical_decisions += 1
        
        return (logical_decisions / len(decisions)) * 100.0 if decisions else 0.0
    
    def calculate_content_synthesis_quality(self, decisions: List[Dict]) -> float:
        """
        Calculate quality of content synthesis vs raw copying
        Score: 0-100 (15% weight in integration decision)
        """
        if not decisions:
            return 0.0
        
        synthesis_scores = []
        for decision in decisions:
            content = decision.get("content", "")
            original_text = decision.get("text", "")
            
            if not content or not original_text:
                synthesis_scores.append(0.0)
                continue
            
            # Compare content with original text to check for synthesis
            synthesis_score = self._calculate_synthesis_score(content, original_text)
            synthesis_scores.append(synthesis_score)
        
        return statistics.mean(synthesis_scores) if synthesis_scores else 0.0
    
    # =============================================================================
    # NODE EXTRACTION METRICS
    # =============================================================================
    
    def calculate_name_quality(self, node_names: List[str]) -> float:
        """
        Calculate descriptiveness vs generic naming
        Score: 0-100 (40% weight in node extraction)
        """
        if not node_names:
            return 0.0
        
        quality_scores = []
        for name in node_names:
            score = 100.0
            
            # Penalty for generic terms
            name_lower = name.lower()
            for generic in self.generic_terms:
                if generic in name_lower:
                    score -= 30.0
            
            # Penalty for unclear names
            if len(name.split()) < 2:  # Single word names are often unclear
                score -= 20.0
            
            # Penalty for numbers/unclear identifiers
            if re.search(r'\d+_', name) or name.startswith('Untitled'):
                score -= 40.0
            
            quality_scores.append(max(0.0, score))
        
        return statistics.mean(quality_scores) if quality_scores else 0.0
    
    def calculate_name_uniqueness(self, node_names: List[str], existing_nodes: List[str]) -> float:
        """
        Calculate uniqueness from existing nodes
        Score: 0-100 (20% weight in node extraction)
        """
        if not node_names:
            return 0.0
        
        unique_names = 0
        for name in node_names:
            if name not in existing_nodes:
                unique_names += 1
        
        return (unique_names / len(node_names)) * 100.0
    
    def calculate_concept_accuracy(self, node_names: List[str], decisions: List[Dict]) -> float:
        """
        Calculate how well node names match their content
        Score: 0-100 (25% weight in node extraction)
        """
        if not node_names or not decisions:
            return 0.0
        
        accuracy_scores = []
        for i, name in enumerate(node_names):
            if i < len(decisions):
                decision = decisions[i]
                content = decision.get("content", "")
                
                # Simple concept matching (could be enhanced with NLP)
                name_concepts = set(name.lower().split('_'))
                content_concepts = self._extract_key_concepts(content)
                
                if name_concepts and content_concepts:
                    overlap = len(name_concepts.intersection(content_concepts))
                    total = len(name_concepts.union(content_concepts))
                    accuracy = (overlap / total) * 100.0 if total > 0 else 0.0
                    accuracy_scores.append(accuracy)
        
        return statistics.mean(accuracy_scores) if accuracy_scores else 0.0
    
    def calculate_hierarchy_awareness(self, node_names: List[str]) -> float:
        """
        Calculate appropriateness of naming for hierarchy level
        Score: 0-100 (15% weight in node extraction)
        """
        if not node_names:
            return 0.0
        
        # Check for hierarchical naming patterns
        hierarchy_scores = []
        for name in node_names:
            score = 50.0  # Base score
            
            # Bonus for descriptive, role-based names
            if any(word in name.lower() for word in ["system", "process", "method", "approach", "strategy"]):
                score += 25.0
            
            # Bonus for specific vs generic
            if len(name.split('_')) >= 3:  # Multi-part names tend to be more specific
                score += 25.0
            
            hierarchy_scores.append(min(100.0, score))
        
        return statistics.mean(hierarchy_scores) if hierarchy_scores else 0.0
    
    # =============================================================================
    # HELPER METHODS
    # =============================================================================
    
    def _extract_key_concepts(self, text: str) -> set:
        """Extract key concepts from text (simplified implementation)"""
        if not text:
            return set()
        
        # Simple word extraction with filtering
        words = re.findall(r'\b[a-zA-Z]{3,}\b', text.lower())
        
        # Filter common words
        stop_words = {"the", "and", "for", "are", "but", "not", "you", "all", "can", "had", "her", "was", "one", "our", "out", "day", "get", "has", "him", "his", "how", "man", "new", "now", "old", "see", "two", "way", "who", "boy", "did", "its", "let", "put", "say", "she", "too", "use"}
        
        concepts = set()
        for word in words:
            if word not in stop_words and len(word) > 3:
                concepts.add(word)
        
        return concepts
    
    def _is_coherent_chunk(self, text: str) -> bool:
        """Check if chunk represents a coherent thought"""
        if not text or len(text.strip()) < 20:
            return False
        
        # Check for complete sentences
        sentence_endings = ['.', '!', '?']
        has_complete_sentence = any(text.strip().endswith(end) for end in sentence_endings)
        
        # Check for reasonable length
        word_count = len(text.split())
        has_reasonable_length = 5 <= word_count <= 100
        
        return has_complete_sentence and has_reasonable_length
    
    def _has_good_boundaries(self, text: str) -> bool:
        """Check if chunk has natural boundaries"""
        if not text:
            return False
        
        text = text.strip()
        
        # Good: starts with capital letter or continues naturally
        good_start = text[0].isupper() or text.startswith(('and', 'but', 'so', 'then', 'also'))
        
        # Good: ends with punctuation or natural pause
        good_end = text.endswith(('.', '!', '?', ':', ';'))
        
        return good_start and good_end
    
    def _is_repetitive_content(self, content: str) -> bool:
        """Check if content has repetitive patterns"""
        if not content:
            return False
        
        lines = [line.strip() for line in content.split('\n') if line.strip()]
        if len(lines) < 2:
            return False
        
        # Check for similar lines
        similar_pairs = 0
        for i in range(len(lines)):
            for j in range(i + 1, len(lines)):
                similarity = self._calculate_similarity(lines[i], lines[j])
                if similarity > 0.8:
                    similar_pairs += 1
        
        return similar_pairs > len(lines) * 0.3  # More than 30% similar pairs
    
    def _calculate_synthesis_score(self, content: str, original_text: str) -> float:
        """Calculate how well content synthesizes vs copies original text"""
        if not content or not original_text:
            return 0.0
        
        # Simple synthesis check - compare lengths and overlap
        content_words = set(content.lower().split())
        original_words = set(original_text.lower().split())
        
        if not original_words:
            return 0.0
        
        overlap_ratio = len(content_words.intersection(original_words)) / len(original_words)
        length_ratio = len(content) / len(original_text)
        
        # Good synthesis: moderate overlap (40-70%), shorter length (30-80%)
        if 0.4 <= overlap_ratio <= 0.7 and 0.3 <= length_ratio <= 0.8:
            return 100.0
        elif overlap_ratio > 0.9:  # Too much copying
            return 20.0
        elif overlap_ratio < 0.2:  # Too little connection
            return 30.0
        else:
            return 60.0
    
    def _calculate_similarity(self, text1: str, text2: str) -> float:
        """Calculate similarity between two text strings"""
        if not text1 or not text2:
            return 0.0
        
        words1 = set(text1.lower().split())
        words2 = set(text2.lower().split())
        
        if not words1 and not words2:
            return 1.0
        if not words1 or not words2:
            return 0.0
        
        intersection = len(words1.intersection(words2))
        union = len(words1.union(words2))
        
        return intersection / union if union > 0 else 0.0


class WorkflowStageQualityScorer:
    """Main quality scoring class for workflow stages"""
    
    def __init__(self):
        self.metrics_calculator = QualityMetricsCalculator()
        
        # Stage weights for overall score calculation
        self.stage_weights = {
            "segmentation": 0.20,      # Foundation affects everything
            "relationship_analysis": 0.25,  # Critical for structure
            "integration_decision": 0.35,   # Most impact on final content
            "node_extraction": 0.20         # Important for usability
        }
    
    def score_segmentation(self, transcript: str, chunks: List[Dict]) -> StageQualityScore:
        """Score the segmentation stage"""
        issues = []
        recommendations = []
        
        # Calculate individual metrics
        completeness = self.metrics_calculator.calculate_content_completeness(transcript, chunks)
        coherence = self.metrics_calculator.calculate_chunk_coherence(chunks)
        boundaries = self.metrics_calculator.calculate_boundary_quality(chunks)
        size_quality = self.metrics_calculator.calculate_size_appropriateness(chunks)
        
        # Weighted overall score
        overall_score = (
            completeness * 0.40 +
            coherence * 0.30 +
            boundaries * 0.20 +
            size_quality * 0.10
        )
        
        # Generate issues and recommendations
        if completeness < 70:
            issues.append(f"Low content completeness: {completeness:.1f}%")
            recommendations.append("Improve segmentation to capture more transcript concepts")
        
        if coherence < 60:
            issues.append(f"Poor chunk coherence: {coherence:.1f}%")
            recommendations.append("Ensure chunks contain complete thoughts")
        
        if boundaries < 50:
            issues.append(f"Poor boundary quality: {boundaries:.1f}%")
            recommendations.append("Improve chunk boundary detection at natural breaks")
        
        # Calculate confidence based on data quality
        confidence = min(1.0, len(chunks) / 5) if chunks else 0.0  # Higher confidence with more data
        
        return StageQualityScore(
            stage_name="segmentation",
            overall_score=overall_score,
            metric_scores={
                "content_completeness": completeness,
                "chunk_coherence": coherence,
                "boundary_quality": boundaries,
                "size_appropriateness": size_quality
            },
            issues=issues,
            recommendations=recommendations,
            confidence=confidence
        )
    
    def score_relationship_analysis(self, chunks: List[Dict], relationships: List[Dict], existing_nodes: str = "") -> StageQualityScore:
        """Score the relationship analysis stage"""
        issues = []
        recommendations = []
        
        # Calculate individual metrics
        context_quality = self.metrics_calculator.calculate_context_quality(existing_nodes)
        detection_quality = self.metrics_calculator.calculate_relationship_detection(relationships)
        strength_quality = self.metrics_calculator.calculate_relationship_strength(relationships)
        flow_quality = self.metrics_calculator.calculate_conversation_flow(chunks, relationships)
        
        # Weighted overall score
        overall_score = (
            context_quality * 0.25 +
            detection_quality * 0.35 +
            strength_quality * 0.25 +
            flow_quality * 0.15
        )
        
        # Generate issues and recommendations
        if context_quality < 60:
            issues.append(f"Poor existing nodes context: {context_quality:.1f}%")
            recommendations.append("Improve existing node summaries and context preparation")
        
        if detection_quality < 70:
            issues.append(f"Low relationship detection: {detection_quality:.1f}%")
            recommendations.append("Enhance relationship detection algorithms")
        
        if strength_quality < 50:
            issues.append(f"Weak relationships: {strength_quality:.1f}%")
            recommendations.append("Focus on identifying stronger, more specific relationships")
        
        confidence = min(1.0, len(relationships) / 3) if relationships else 0.0
        
        return StageQualityScore(
            stage_name="relationship_analysis",
            overall_score=overall_score,
            metric_scores={
                "context_quality": context_quality,
                "relationship_detection": detection_quality,
                "relationship_strength": strength_quality,
                "conversation_flow": flow_quality
            },
            issues=issues,
            recommendations=recommendations,
            confidence=confidence
        )
    
    def score_integration_decision(self, relationships: List[Dict], decisions: List[Dict]) -> StageQualityScore:
        """Score the integration decision stage"""
        issues = []
        recommendations = []
        
        # Calculate individual metrics
        balance_score = self.metrics_calculator.calculate_decision_balance(decisions)
        content_quality = self.metrics_calculator.calculate_content_quality(decisions)
        logic_score = self.metrics_calculator.calculate_decision_logic(decisions, relationships)
        synthesis_score = self.metrics_calculator.calculate_content_synthesis_quality(decisions)
        
        # Weighted overall score
        overall_score = (
            balance_score * 0.20 +
            content_quality * 0.40 +
            logic_score * 0.25 +
            synthesis_score * 0.15
        )
        
        # Generate issues and recommendations
        if balance_score < 60:
            issues.append(f"Poor CREATE/APPEND balance: {balance_score:.1f}%")
            recommendations.append("Review CREATE vs APPEND decision criteria")
        
        if content_quality < 70:
            issues.append(f"Low content quality: {content_quality:.1f}%")
            recommendations.append("Improve content formatting and eliminate repetition")
        
        if logic_score < 50:
            issues.append(f"Poor decision logic: {logic_score:.1f}%")
            recommendations.append("Align integration decisions with relationship analysis")
        
        confidence = min(1.0, len(decisions) / 3) if decisions else 0.0
        
        return StageQualityScore(
            stage_name="integration_decision",
            overall_score=overall_score,
            metric_scores={
                "decision_balance": balance_score,
                "content_quality": content_quality,
                "decision_logic": logic_score,
                "content_synthesis": synthesis_score
            },
            issues=issues,
            recommendations=recommendations,
            confidence=confidence
        )
    
    def score_node_extraction(self, decisions: List[Dict], node_names: List[str], existing_nodes: List[str] = None) -> StageQualityScore:
        """Score the node extraction stage"""
        issues = []
        recommendations = []
        existing_nodes = existing_nodes or []
        
        # Calculate individual metrics
        name_quality = self.metrics_calculator.calculate_name_quality(node_names)
        uniqueness = self.metrics_calculator.calculate_name_uniqueness(node_names, existing_nodes)
        accuracy = self.metrics_calculator.calculate_concept_accuracy(node_names, decisions)
        hierarchy_awareness = self.metrics_calculator.calculate_hierarchy_awareness(node_names)
        
        # Weighted overall score
        overall_score = (
            name_quality * 0.40 +
            uniqueness * 0.20 +
            accuracy * 0.25 +
            hierarchy_awareness * 0.15
        )
        
        # Generate issues and recommendations
        if name_quality < 60:
            issues.append(f"Poor name quality: {name_quality:.1f}%")
            recommendations.append("Use more descriptive, specific node names")
        
        if uniqueness < 90:
            issues.append(f"Name uniqueness issues: {uniqueness:.1f}%")
            recommendations.append("Ensure all node names are unique")
        
        if accuracy < 50:
            issues.append(f"Poor name-content accuracy: {accuracy:.1f}%")
            recommendations.append("Improve alignment between node names and their content")
        
        confidence = min(1.0, len(node_names) / 2) if node_names else 0.0
        
        return StageQualityScore(
            stage_name="node_extraction",
            overall_score=overall_score,
            metric_scores={
                "name_quality": name_quality,
                "name_uniqueness": uniqueness,
                "concept_accuracy": accuracy,
                "hierarchy_awareness": hierarchy_awareness
            },
            issues=issues,
            recommendations=recommendations,
            confidence=confidence
        )
    
    def calculate_overall_score(self, stage_scores: Dict[str, StageQualityScore]) -> float:
        """Calculate weighted overall workflow quality score"""
        if not stage_scores:
            return 0.0
        
        weighted_sum = 0.0
        total_weight = 0.0
        
        for stage_name, weight in self.stage_weights.items():
            if stage_name in stage_scores:
                score = stage_scores[stage_name].overall_score
                weighted_sum += score * weight
                total_weight += weight
        
        return weighted_sum / total_weight if total_weight > 0 else 0.0
    
    def create_workflow_assessment(self, stage_scores: Dict[str, StageQualityScore]) -> WorkflowQualityAssessment:
        """Create complete workflow quality assessment"""
        overall_score = self.calculate_overall_score(stage_scores)
        
        # Identify any significant regressions or issues
        regression_alerts = []
        all_issues = []
        
        for stage_name, stage_score in stage_scores.items():
            if stage_score.overall_score < 50:
                regression_alerts.append({
                    "stage": stage_name,
                    "score": stage_score.overall_score,
                    "severity": "high",
                    "issues": stage_score.issues
                })
            all_issues.extend(stage_score.issues)
        
        # Generate summary
        summary = self._generate_assessment_summary(overall_score, stage_scores, all_issues)
        
        return WorkflowQualityAssessment(
            overall_score=overall_score,
            stage_scores=stage_scores,
            timestamp=datetime.now().isoformat(),
            regression_alerts=regression_alerts,
            summary=summary
        )
    
    def _generate_assessment_summary(self, overall_score: float, stage_scores: Dict[str, StageQualityScore], all_issues: List[str]) -> str:
        """Generate human-readable assessment summary"""
        if overall_score >= 80:
            quality_level = "Excellent"
        elif overall_score >= 70:
            quality_level = "Good"
        elif overall_score >= 60:
            quality_level = "Acceptable"
        elif overall_score >= 40:
            quality_level = "Poor"
        else:
            quality_level = "Failing"
        
        summary = [
            f"Workflow Quality Assessment: {quality_level} ({overall_score:.1f}/100)",
            "",
            "Stage Scores:"
        ]
        
        # Add individual stage scores
        for stage_name, stage_score in stage_scores.items():
            summary.append(f"  • {stage_name.replace('_', ' ').title()}: {stage_score.overall_score:.1f}/100")
        
        # Add top issues if any
        if all_issues:
            summary.extend(["", "Key Issues:"])
            for issue in all_issues[:5]:  # Top 5 issues
                summary.append(f"  • {issue}")
        
        return "\n".join(summary)


def main():
    """Test the quality scoring system"""
    print("🧪 Testing VoiceTree Quality Scoring System")
    print("=" * 60)
    
    # Create test data
    test_transcript = "We need to create a voice tree system that processes audio files and converts them to markdown format for visualization."
    
    test_chunks = [
        {"text": "We need to create a voice tree system."},
        {"text": "The system processes audio files."},
        {"text": "It converts them to markdown format for visualization."}
    ]
    
    test_relationships = [
        {"relationship": "implements voice processing", "related_nodes": ["audio_system"]},
        {"relationship": "creates markdown output", "related_nodes": ["output_system"]}
    ]
    
    test_decisions = [
        {"action": "CREATE", "content": "• Process audio input\n• Convert to structured format", "text": "We need to create a voice tree system."},
        {"action": "APPEND", "content": "• Generate markdown files\n• Enable visualization", "text": "It converts them to markdown format."}
    ]
    
    test_node_names = ["Voice_Processing_System", "Markdown_Output_Generator"]
    
    # Test the scoring system
    scorer = WorkflowStageQualityScorer()
    
    # Score each stage
    segmentation_score = scorer.score_segmentation(test_transcript, test_chunks)
    relationship_score = scorer.score_relationship_analysis(test_chunks, test_relationships, "existing nodes context")
    integration_score = scorer.score_integration_decision(test_relationships, test_decisions)
    extraction_score = scorer.score_node_extraction(test_decisions, test_node_names, [])
    
    # Create complete assessment
    stage_scores = {
        "segmentation": segmentation_score,
        "relationship_analysis": relationship_score,
        "integration_decision": integration_score,
        "node_extraction": extraction_score
    }
    
    assessment = scorer.create_workflow_assessment(stage_scores)
    
    # Print results
    print(assessment.summary)
    print("\nDetailed Scores:")
    for stage_name, stage_score in assessment.stage_scores.items():
        print(f"\n{stage_name.replace('_', ' ').title()}:")
        print(f"  Overall: {stage_score.overall_score:.1f}/100")
        for metric_name, metric_score in stage_score.metric_scores.items():
            print(f"  {metric_name.replace('_', ' ').title()}: {metric_score:.1f}")
        if stage_score.issues:
            print(f"  Issues: {', '.join(stage_score.issues)}")


if __name__ == "__main__":
    main() 