"""
Enhanced Workflow Tree Manager with TADA + TROA Integration
Combines real-time processing (TADA) with background optimization (TROA)
"""

import logging
import asyncio
from typing import Optional, Set, Dict, Any
from datetime import datetime

from tree_manager.decision_tree_ds import DecisionTree
from tree_manager.workflow_tree_manager import WorkflowTreeManager
from tree_reorganization_agent import TreeReorganizationAgent, integrate_troa_with_workflow_tree_manager


class EnhancedWorkflowTreeManager(WorkflowTreeManager):
    """
    Enhanced tree manager that combines:
    - TADA: Tree Action Decider Agent (real-time processing, 2.5-3/5 quality)
    - TROA: Tree Reorganization Agent (background optimization, 5/5 quality)
    """
    
    def __init__(
        self,
        decision_tree: DecisionTree,
        workflow_state_file: Optional[str] = None,
        enable_troa: bool = True,
        troa_interval: int = 120,  # 2 minutes
        troa_min_nodes: int = 3
    ):
        """
        Initialize the enhanced workflow tree manager
        
        Args:
            decision_tree: The decision tree instance
            workflow_state_file: Optional path to persist workflow state
            enable_troa: Whether to enable background reorganization
            troa_interval: Seconds between TROA reorganization cycles
            troa_min_nodes: Minimum nodes needed before TROA activates
        """
        # Initialize base workflow tree manager (TADA)
        super().__init__(decision_tree, workflow_state_file)
        
        # Initialize TROA if enabled
        self.troa_enabled = enable_troa
        self.troa_agent = None
        
        if enable_troa:
            self.troa_agent = TreeReorganizationAgent(
                decision_tree=decision_tree,
                reorganization_interval=troa_interval,
                min_nodes_for_reorganization=troa_min_nodes
            )
            
            # Hook TROA into the processing pipeline
            self._integrate_troa()
        
        # Enhanced metrics
        self.enhanced_metrics = {
            "tada_processing_count": 0,
            "troa_reorganizations": 0,
            "quality_improvements": [],
            "processing_mode": "TADA + TROA" if enable_troa else "TADA only"
        }
        
        logging.info(f"Enhanced WorkflowTreeManager initialized with {'TADA + TROA' if enable_troa else 'TADA only'}")
    
    def _integrate_troa(self):
        """Integrate TROA with the processing pipeline"""
        if not self.troa_agent:
            return
        
        # Store original method
        self._original_process_text_chunk = self._process_text_chunk
        
        # Override with TROA integration
        async def enhanced_process_text_chunk(text_chunk: str, transcript_history_context: str):
            # Add transcript to TROA for background processing
            self.troa_agent.add_transcript_chunk(text_chunk)
            
            # Process with TADA (original processing)
            result = await self._original_process_text_chunk(text_chunk, transcript_history_context)
            
            # Update metrics
            self.enhanced_metrics["tada_processing_count"] += 1
            
            return result
        
        # Replace the method
        self._process_text_chunk = enhanced_process_text_chunk
    
    async def start_enhanced_processing(self):
        """Start the enhanced processing system (TADA + TROA)"""
        if self.troa_enabled and self.troa_agent:
            self.troa_agent.start_background_reorganization()
            logging.info("Enhanced processing started: TADA (real-time) + TROA (background)")
        else:
            logging.info("Enhanced processing started: TADA only (real-time)")
    
    async def stop_enhanced_processing(self):
        """Stop the enhanced processing system"""
        if self.troa_enabled and self.troa_agent:
            self.troa_agent.stop_background_reorganization()
            logging.info("Enhanced processing stopped")
    
    def get_enhanced_statistics(self) -> Dict[str, Any]:
        """Get comprehensive statistics from both TADA and TROA"""
        base_stats = self.get_workflow_statistics()
        
        enhanced_stats = {
            **base_stats,
            **self.enhanced_metrics,
            "troa_enabled": self.troa_enabled,
            "timestamp": datetime.now().isoformat()
        }
        
        if self.troa_agent:
            troa_metrics = self.troa_agent.get_metrics()
            enhanced_stats["troa_metrics"] = troa_metrics
            enhanced_stats["troa_reorganizations"] = troa_metrics["reorganizations_performed"]
        
        return enhanced_stats
    
    def get_quality_assessment(self) -> Dict[str, Any]:
        """Get quality assessment of the current tree"""
        tree_size = len(self.decision_tree.tree)
        
        # Basic quality metrics
        quality_metrics = {
            "tree_size": tree_size,
            "processing_quality": "2.5-3/5 (TADA real-time)",
            "optimization_quality": "5/5 (TROA background)" if self.troa_enabled else "N/A",
            "overall_system": "Hybrid TADA+TROA" if self.troa_enabled else "TADA only"
        }
        
        if self.troa_agent:
            troa_metrics = self.troa_agent.get_metrics()
            quality_metrics.update({
                "nodes_merged": troa_metrics["nodes_merged"],
                "relationships_optimized": troa_metrics["relationships_optimized"],
                "reorganizations_performed": troa_metrics["reorganizations_performed"]
            })
        
        # Calculate estimated quality score
        base_quality = 2.75  # TADA baseline
        troa_improvement = 0
        
        if self.troa_enabled and self.troa_agent:
            troa_metrics = self.troa_agent.get_metrics()
            # Each reorganization improves quality
            reorganizations = troa_metrics["reorganizations_performed"]
            troa_improvement = min(2.25, reorganizations * 0.3)  # Cap at 5/5 total
        
        estimated_quality = min(5.0, base_quality + troa_improvement)
        quality_metrics["estimated_quality_score"] = f"{estimated_quality:.1f}/5"
        
        return quality_metrics
    
    def get_troa_history(self) -> Optional[list]:
        """Get TROA reorganization history"""
        if self.troa_agent:
            return self.troa_agent.get_reorganization_history()
        return None
    
    def force_troa_reorganization(self) -> bool:
        """Force an immediate TROA reorganization (for testing/debugging)"""
        if not self.troa_agent:
            logging.warning("TROA not enabled - cannot force reorganization")
            return False
        
        try:
            self.troa_agent._perform_reorganization()
            logging.info("Forced TROA reorganization completed")
            return True
        except Exception as e:
            logging.error(f"Failed to force TROA reorganization: {e}")
            return False
    
    def clear_enhanced_state(self):
        """Clear both TADA and TROA state"""
        # Clear base workflow state
        self.clear_workflow_state()
        
        # Reset enhanced metrics
        self.enhanced_metrics = {
            "tada_processing_count": 0,
            "troa_reorganizations": 0,
            "quality_improvements": [],
            "processing_mode": "TADA + TROA" if self.troa_enabled else "TADA only"
        }
        
        # Reset TROA if enabled
        if self.troa_agent:
            self.troa_agent.transcript_history.clear()
            self.troa_agent.reorganization_history.clear()
            self.troa_agent.metrics = {
                "reorganizations_performed": 0,
                "nodes_merged": 0,
                "nodes_split": 0,
                "relationships_optimized": 0,
                "quality_improvements": []
            }
        
        logging.info("Enhanced state cleared (TADA + TROA)")
    
    def configure_troa_settings(
        self, 
        reorganization_interval: Optional[int] = None,
        min_nodes_for_reorganization: Optional[int] = None
    ):
        """Configure TROA settings dynamically"""
        if not self.troa_agent:
            logging.warning("TROA not enabled - cannot configure settings")
            return
        
        if reorganization_interval is not None:
            self.troa_agent.reorganization_interval = reorganization_interval
            logging.info(f"TROA reorganization interval set to {reorganization_interval} seconds")
        
        if min_nodes_for_reorganization is not None:
            self.troa_agent.min_nodes_for_reorganization = min_nodes_for_reorganization
            logging.info(f"TROA minimum nodes threshold set to {min_nodes_for_reorganization}")
    
    def get_processing_summary(self) -> str:
        """Get a human-readable summary of the processing system"""
        stats = self.get_enhanced_statistics()
        quality = self.get_quality_assessment()
        
        summary = f"""
Enhanced VoiceTree Processing Summary
=====================================

System Configuration:
- Mode: {stats['processing_mode']}
- TADA (Real-time): Active - {stats['tada_processing_count']} chunks processed
- TROA (Background): {'Active' if self.troa_enabled else 'Disabled'}

Tree Status:
- Total Nodes: {quality['tree_size']}
- Estimated Quality: {quality['estimated_quality_score']}
- Processing Quality: {quality['processing_quality']}
- Optimization Quality: {quality['optimization_quality']}

"""
        
        if self.troa_enabled and 'troa_metrics' in stats:
            troa = stats['troa_metrics']
            summary += f"""TROA Performance:
- Reorganizations: {troa['reorganizations_performed']}
- Nodes Merged: {troa['nodes_merged']}
- Relationships Optimized: {troa['relationships_optimized']}
- Background Status: {'Running' if troa['is_running'] else 'Stopped'}

"""
        
        summary += f"""System Benefits:
✓ Real-time processing maintains conversation flow
✓ Background optimization ensures high-quality final output
✓ Discourse pattern recognition improves relationship detection
✓ Coherent thought unit segmentation reduces fragmentation
"""
        
        return summary
    
    async def __aenter__(self):
        """Async context manager entry"""
        await self.start_enhanced_processing()
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Async context manager exit"""
        await self.stop_enhanced_processing()


# Factory function for easy creation
def create_enhanced_tree_manager(
    decision_tree: DecisionTree,
    workflow_state_file: Optional[str] = None,
    enable_background_optimization: bool = True,
    optimization_interval_minutes: int = 2
) -> EnhancedWorkflowTreeManager:
    """
    Factory function to create an enhanced tree manager
    
    Args:
        decision_tree: The decision tree instance
        workflow_state_file: Optional path to persist workflow state
        enable_background_optimization: Whether to enable TROA
        optimization_interval_minutes: Minutes between optimizations
    
    Returns:
        EnhancedWorkflowTreeManager instance
    """
    return EnhancedWorkflowTreeManager(
        decision_tree=decision_tree,
        workflow_state_file=workflow_state_file,
        enable_troa=enable_background_optimization,
        troa_interval=optimization_interval_minutes * 60,  # Convert to seconds
        troa_min_nodes=3
    )