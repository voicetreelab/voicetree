"""
Enhanced Transcription Processor for TADA + TROA System
Integrates with the enhanced workflow tree manager for optimal processing
"""

import logging
import time
import traceback
import os
from datetime import datetime
from typing import Optional

from backend.tree_manager.future.enhanced_workflow_tree_manager import EnhancedWorkflowTreeManager
from backend.tree_manager.tree_to_markdown import TreeToMarkdownConverter


class EnhancedTranscriptionProcessor:
    """
    Enhanced transcription processor that works with TADA + TROA system
    Provides real-time processing with background optimization
    """
    
    def __init__(
        self, 
        enhanced_tree_manager: EnhancedWorkflowTreeManager,
        converter: TreeToMarkdownConverter,
        output_dir: Optional[str] = None
    ):
        """
        Initialize the enhanced transcription processor
        
        Args:
            enhanced_tree_manager: The enhanced workflow tree manager (TADA + TROA)
            converter: Tree to markdown converter
            output_dir: Output directory for markdown files
        """
        self.enhanced_tree_manager = enhanced_tree_manager
        self.converter = converter
        
        # Set up output directory
        if output_dir is None:
            output_dir_base = "/Users/bobbobby/repos/VoiceTreePoc/markdownTreeVault" # todo make relative
            date_str = datetime.now().strftime("%Y-%m-%d")
            output_dir = os.path.join(output_dir_base, date_str)
        
        self.output_dir = output_dir
        
        # Processing metrics
        self.processing_metrics = {
            "chunks_processed": 0,
            "total_processing_time": 0.0,
            "average_processing_time": 0.0,
            "errors": 0,
            "last_processing_time": None
        }
        
        logging.info(f"Enhanced Transcription Processor initialized with output dir: {output_dir}")
    
    async def process_and_convert(self, text: str):
        """
        Process transcribed text through TADA + TROA system and convert to markdown
        
        Args:
            text: The transcribed text to process
        """
        try:
            logging.info(f"Processing transcribed text: {text[:100]}...")
            
            # Clean up common transcription artifacts
            text = self._clean_transcription(text)
            
            start_time = time.time()
            
            # Process through enhanced tree manager (TADA + TROA)
            await self.enhanced_tree_manager.process_voice_input(text)
            
            # Convert updated nodes to markdown
            self._convert_updated_nodes()
            
            # Update processing metrics
            elapsed_time = time.time() - start_time
            self._update_metrics(elapsed_time)
            
            logging.info(f"Processing completed in {elapsed_time:.4f} seconds")
            
        except Exception as e:
            self.processing_metrics["errors"] += 1
            logging.error(
                f"Error in enhanced transcription processing: {e} "
                f"- Type: {type(e)} - Traceback: {traceback.format_exc()}"
            )
    
    def _clean_transcription(self, text: str) -> str:
        """Clean up common transcription artifacts"""
        # Remove common hallucinations
        text = text.replace("Thank you.", "")
        
        return text.strip()
    
    def _convert_updated_nodes(self):
        """Convert updated nodes to markdown files"""
        try:
            # Get nodes that need updating
            nodes_to_update = self.enhanced_tree_manager.nodes_to_update
            
            if nodes_to_update:
                self.converter.convert_nodes(
                    output_dir=self.output_dir,
                    nodes_to_update=nodes_to_update
                )
                
                # Clear the update set
                self.enhanced_tree_manager.nodes_to_update.clear()
                
                logging.info(f"Converted {len(nodes_to_update)} nodes to markdown")
            
        except Exception as e:
            logging.error(f"Error converting nodes to markdown: {e}")
    
    def _update_metrics(self, elapsed_time: float):
        """Update processing metrics"""
        self.processing_metrics["chunks_processed"] += 1
        self.processing_metrics["total_processing_time"] += elapsed_time
        self.processing_metrics["last_processing_time"] = elapsed_time
        
        # Calculate average
        if self.processing_metrics["chunks_processed"] > 0:
            self.processing_metrics["average_processing_time"] = (
                self.processing_metrics["total_processing_time"] / 
                self.processing_metrics["chunks_processed"]
            )
    
    async def finalize(self):
        """Finalize processing and generate comprehensive output"""
        try:
            logging.info("Finalizing enhanced transcription processing")
            
            # Convert any remaining nodes
            self._convert_updated_nodes()
            
            # Force final TROA optimization
            if self.enhanced_tree_manager.troa_enabled:
                logging.info("Performing final TROA optimization...")
                self.enhanced_tree_manager.force_troa_reorganization()
                
                # Convert any nodes updated by TROA
                self._convert_updated_nodes()
            
            # Generate comprehensive report
            self._generate_final_report()
            
            logging.info("Enhanced transcription processing finalized")
            
        except Exception as e:
            logging.error(f"Error in finalize: {e} - Type: {type(e)} - Traceback: {traceback.format_exc()}")
    
    def _generate_final_report(self):
        """Generate a comprehensive final report"""
        try:
            # Get system statistics
            enhanced_stats = self.enhanced_tree_manager.get_enhanced_statistics()
            quality_assessment = self.enhanced_tree_manager.get_quality_assessment()
            processing_summary = self.enhanced_tree_manager.get_processing_summary()
            
            # Create report file
            report_path = os.path.join(self.output_dir, "PROCESSING_REPORT.md")
            os.makedirs(self.output_dir, exist_ok=True)
            
            with open(report_path, 'w') as f:
                f.write("# VoiceTree Processing Report\n\n")
                f.write(f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n\n")
                
                f.write("## System Configuration\n\n")
                f.write(f"- Processing Mode: {enhanced_stats.get('processing_mode', 'Unknown')}\n")
                f.write(f"- TADA Enabled: ✅ Real-time processing\n")
                f.write(f"- TROA Enabled: {'✅' if self.enhanced_tree_manager.troa_enabled else '❌'} Background optimization\n\n")
                
                f.write("## Processing Metrics\n\n")
                f.write(f"- Chunks Processed: {self.processing_metrics['chunks_processed']}\n")
                f.write(f"- Total Processing Time: {self.processing_metrics['total_processing_time']:.2f}s\n")
                f.write(f"- Average Processing Time: {self.processing_metrics['average_processing_time']:.4f}s\n")
                f.write(f"- Errors: {self.processing_metrics['errors']}\n")
                f.write(f"- TADA Processes: {enhanced_stats.get('tada_processing_count', 0)}\n\n")
                
                f.write("## Quality Assessment\n\n")
                f.write(f"- Tree Size: {quality_assessment['tree_size']} nodes\n")
                f.write(f"- Estimated Quality: {quality_assessment['estimated_quality_score']}\n")
                f.write(f"- Processing Quality: {quality_assessment['processing_quality']}\n")
                f.write(f"- Optimization Quality: {quality_assessment['optimization_quality']}\n\n")
                
                if self.enhanced_tree_manager.troa_enabled and 'troa_metrics' in enhanced_stats:
                    troa = enhanced_stats['troa_metrics']
                    f.write("## TROA Performance\n\n")
                    f.write(f"- Reorganizations: {troa['reorganizations_performed']}\n")
                    f.write(f"- Nodes Merged: {troa['nodes_merged']}\n")
                    f.write(f"- Relationships Optimized: {troa['relationships_optimized']}\n")
                    f.write(f"- Background Status: {'Running' if troa['is_running'] else 'Stopped'}\n\n")
                
                f.write("## System Summary\n\n")
                f.write("```\n")
                f.write(processing_summary)
                f.write("```\n\n")
                
                f.write("## Files Generated\n\n")
                f.write(f"- Markdown files: `{self.output_dir}/`\n")
                f.write(f"- Processing report: `{report_path}`\n")
                f.write(f"- System logs: `voicetree.log`\n")
            
            logging.info(f"Final report generated: {report_path}")
            
        except Exception as e:
            logging.error(f"Error generating final report: {e}")
    
    def get_processing_metrics(self) -> dict:
        """Get current processing metrics"""
        return self.processing_metrics.copy()
    
    def get_system_status(self) -> dict:
        """Get comprehensive system status"""
        enhanced_stats = self.enhanced_tree_manager.get_enhanced_statistics()
        quality_assessment = self.enhanced_tree_manager.get_quality_assessment()
        
        return {
            "processing_metrics": self.processing_metrics,
            "enhanced_stats": enhanced_stats,
            "quality_assessment": quality_assessment,
            "output_directory": self.output_dir,
            "timestamp": datetime.now().isoformat()
        }


# Backward compatibility wrapper
class TranscriptionProcessor(EnhancedTranscriptionProcessor):
    """
    Backward compatibility wrapper for existing code
    """
    
    def __init__(self, tree_manager, converter, output_dir=None):
        """
        Initialize with backward compatibility 
        # todo why the hell do we need backwards compatability here? we should only ever have one option for doing something
        
        Args:
            tree_manager: Can be regular or enhanced tree manager
            converter: Tree to markdown converter
            output_dir: Output directory
        """
        # Check if it's an enhanced tree manager
        if hasattr(tree_manager, 'troa_enabled'):
            # It's already an enhanced tree manager
            super().__init__(tree_manager, converter, output_dir)
        else:
            # Wrap regular tree manager in enhanced version
            from backend.tree_manager.future.enhanced_workflow_tree_manager import EnhancedWorkflowTreeManager
            
            # Create enhanced wrapper (without TROA for compatibility)
            enhanced_manager = EnhancedWorkflowTreeManager(
                decision_tree=tree_manager.decision_tree,
                workflow_state_file=getattr(tree_manager, 'workflow_state_file', None),
                enable_troa=False  # Disable TROA for backward compatibility
            )
            
            super().__init__(enhanced_manager, converter, output_dir)
            
            logging.info("Wrapped regular tree manager in enhanced version (TADA only)")


# Factory function for easy creation
def create_enhanced_transcription_processor(
    decision_tree,
    workflow_state_file: Optional[str] = None,
    output_dir: Optional[str] = None,
    enable_background_optimization: bool = True,
    optimization_interval_minutes: int = 2
):
    """
    Factory function to create an enhanced transcription processor
    
    Args:
        decision_tree: The decision tree instance
        workflow_state_file: Optional path to persist workflow state
        output_dir: Output directory for markdown files
        enable_background_optimization: Whether to enable TROA
        optimization_interval_minutes: Minutes between optimizations
    
    Returns:
        EnhancedTranscriptionProcessor instance
    """
    from backend.tree_manager.future.enhanced_workflow_tree_manager import create_enhanced_tree_manager
    from backend.tree_manager.tree_to_markdown import TreeToMarkdownConverter
    
    # Create enhanced tree manager
    enhanced_manager = create_enhanced_tree_manager(
        decision_tree=decision_tree,
        workflow_state_file=workflow_state_file,
        enable_background_optimization=enable_background_optimization,
        optimization_interval_minutes=optimization_interval_minutes
    )
    
    # Create converter
    converter = TreeToMarkdownConverter(decision_tree.tree)
    
    # Create processor
    return EnhancedTranscriptionProcessor(enhanced_manager, converter, output_dir)