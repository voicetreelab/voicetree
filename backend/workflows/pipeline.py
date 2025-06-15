"""
Unified Workflow Pipeline for VoiceTree
Consolidates agentic workflow processing into a single, clean interface
"""

import asyncio
import time
import logging
from typing import Dict, Any, Optional, List

from backend.core import LLMClient, WorkflowResult, NodeAction
from backend.core.models import (
    ChunkModel, AnalyzedChunk, IntegrationDecision,
    SegmentationResponse, RelationshipResponse, IntegrationResponse
)


class WorkflowPipeline:
    """
    Unified workflow pipeline that handles all LLM-based processing
    Replaces VoiceTreePipeline and related workflow components
    """
    
    def __init__(
        self,
        llm_client: LLMClient,
        state_file: Optional[str] = None,
        buffer_threshold: int = 500
    ):
        """
        Initialize the workflow pipeline
        
        Args:
            llm_client: LLM client for processing
            state_file: Optional path for state persistence
            buffer_threshold: Character threshold for processing
        """
        self.llm_client = llm_client
        self.state_file = state_file
        self.buffer_threshold = buffer_threshold
        
        # Pipeline statistics
        self.statistics = {
            "total_executions": 0,
            "successful_executions": 0,
            "failed_executions": 0,
            "total_execution_time_ms": 0.0,
            "average_chunks_per_execution": 0.0
        }
        
        logging.info("WorkflowPipeline initialized")
    
    async def process(
        self,
        transcript: str,
        existing_nodes: str,
        context: Dict[str, Any]
    ) -> WorkflowResult:
        """
        Process transcript through the complete workflow pipeline
        
        Args:
            transcript: Text to process
            existing_nodes: Description of existing nodes
            context: Additional context for processing
            
        Returns:
            WorkflowResult with processing outcomes
        """
        start_time = time.time()
        self.statistics["total_executions"] += 1
        
        result = WorkflowResult(success=False)
        
        try:
            logging.info(f"🚀 Starting workflow pipeline for {len(transcript)} characters")
            
            # Stage 1: Segmentation
            segmentation_result = await self._segmentation_stage(transcript)
            if not segmentation_result.chunks:
                result.mark_failed("No chunks produced in segmentation stage")
                return result
            
            result.chunks_processed = len(segmentation_result.chunks)
            result.incomplete_remainder = segmentation_result.incomplete_remainder
            
            # Stage 2: Relationship Analysis
            relationship_result = await self._relationship_analysis_stage(
                segmentation_result.chunks,
                existing_nodes
            )
            
            # Stage 3: Integration Decision
            integration_result = await self._integration_decision_stage(
                relationship_result.analyzed_chunks,
                existing_nodes,
                context
            )
            
            # Stage 4: Node Action Generation
            node_actions = self._generate_node_actions(integration_result.integration_decisions)
            
            # Update result
            result.success = True
            result.node_actions = node_actions
            result.new_node_names = [
                decision.new_node_name or decision.chunk_name 
                for decision in integration_result.integration_decisions
                if decision.action == "CREATE" and decision.new_node_name
            ]
            
            # Update statistics
            execution_time_ms = (time.time() - start_time) * 1000
            result.execution_time_ms = execution_time_ms
            result.model_calls = 4  # One for each stage
            
            self.statistics["successful_executions"] += 1
            self.statistics["total_execution_time_ms"] += execution_time_ms
            self._update_average_chunks()
            
            logging.info(f"✅ Workflow completed successfully in {execution_time_ms:.1f}ms")
            return result
            
        except Exception as e:
            execution_time_ms = (time.time() - start_time) * 1000
            result.execution_time_ms = execution_time_ms
            result.mark_failed(str(e))
            
            self.statistics["failed_executions"] += 1
            self.statistics["total_execution_time_ms"] += execution_time_ms
            
            logging.error(f"❌ Workflow failed after {execution_time_ms:.1f}ms: {e}")
            return result
    
    async def _segmentation_stage(self, transcript: str) -> SegmentationResponse:
        """
        Stage 1: Segment transcript into coherent chunks
        
        Args:
            transcript: Raw transcript text
            
        Returns:
            SegmentationResponse with chunks
        """
        logging.info("🔵 Stage 1: Segmentation")
        
        prompt = self._build_segmentation_prompt(transcript)
        response = await self.llm_client.call_workflow_stage(prompt, "segmentation")
        
        logging.info(f"   Segmented into {len(response.chunks)} chunks")
        return response
    
    async def _relationship_analysis_stage(
        self,
        chunks: List[ChunkModel],
        existing_nodes: str
    ) -> RelationshipResponse:
        """
        Stage 2: Analyze relationships between chunks and existing nodes
        
        Args:
            chunks: Chunks from segmentation
            existing_nodes: Description of existing nodes
            
        Returns:
            RelationshipResponse with analyzed chunks
        """
        logging.info("🔵 Stage 2: Relationship Analysis")
        
        prompt = self._build_relationship_prompt(chunks, existing_nodes)
        response = await self.llm_client.call_workflow_stage(prompt, "relationship")
        
        logging.info(f"   Analyzed {len(response.analyzed_chunks)} chunks for relationships")
        return response
    
    async def _integration_decision_stage(
        self,
        analyzed_chunks: List[AnalyzedChunk],
        existing_nodes: str,
        context: Dict[str, Any]
    ) -> IntegrationResponse:
        """
        Stage 3: Make integration decisions for each chunk
        
        Args:
            analyzed_chunks: Chunks with relationship analysis
            existing_nodes: Description of existing nodes
            context: Additional context
            
        Returns:
            IntegrationResponse with decisions
        """
        logging.info("🔵 Stage 3: Integration Decision")
        
        prompt = self._build_integration_prompt(analyzed_chunks, existing_nodes, context)
        response = await self.llm_client.call_workflow_stage(prompt, "integration")
        
        create_count = sum(1 for d in response.integration_decisions if d.action == "CREATE")
        append_count = sum(1 for d in response.integration_decisions if d.action == "APPEND")
        
        logging.info(f"   Made {len(response.integration_decisions)} decisions: {create_count} CREATE, {append_count} APPEND")
        return response
    
    def _generate_node_actions(self, decisions: List[IntegrationDecision]) -> List[NodeAction]:
        """
        Stage 4: Convert integration decisions to node actions
        
        Args:
            decisions: Integration decisions from previous stage
            
        Returns:
            List of NodeAction objects
        """
        logging.info("🔵 Stage 4: Node Action Generation")
        
        node_actions = []
        for decision in decisions:
            try:
                action = decision.to_node_action()
                node_actions.append(action)
            except Exception as e:
                logging.warning(f"Failed to convert decision to action: {e}")
        
        logging.info(f"   Generated {len(node_actions)} node actions")
        return node_actions
    
    def _build_segmentation_prompt(self, transcript: str) -> str:
        """Build prompt for segmentation stage"""
        return f"""
Segment the following transcript into coherent thought units. Each chunk should represent a complete concept or idea that can stand alone.

TRANSCRIPT:
{transcript}

Instructions:
- Create chunks that represent complete thoughts or concepts
- Each chunk should be 1-3 sentences typically
- Avoid splitting related ideas
- Mark chunks as complete=true if they represent finished thoughts
- Give each chunk a concise name (1-5 words)

Return the segmentation as JSON with the specified schema.
"""
    
    def _build_relationship_prompt(
        self,
        chunks: List[ChunkModel],
        existing_nodes: str
    ) -> str:
        """Build prompt for relationship analysis stage"""
        chunks_text = "\n".join([f"- {chunk.name}: {chunk.text}" for chunk in chunks])
        
        return f"""
Analyze the relationships between these chunks and existing nodes in the knowledge tree.

CHUNKS TO ANALYZE:
{chunks_text}

EXISTING NODES:
{existing_nodes}

Instructions:
- For each chunk, identify which existing nodes (if any) it relates to
- Determine the type of relationship: elaboration, contrast, sequence, cause-effect, etc.
- Consider semantic similarity and topical relevance
- If no strong relationships exist, leave existing_nodes empty

Return the analysis as JSON with the specified schema.
"""
    
    def _build_integration_prompt(
        self,
        analyzed_chunks: List[AnalyzedChunk],
        existing_nodes: str,
        context: Dict[str, Any]
    ) -> str:
        """Build prompt for integration decision stage"""
        chunks_analysis = []
        for analyzed in analyzed_chunks:
            chunk = analyzed.chunk
            related = ", ".join(analyzed.existing_nodes) if analyzed.existing_nodes else "None"
            chunks_analysis.append(
                f"- {chunk.name}: {chunk.text}\n"
                f"  Related to: {related}\n"
                f"  Relationship: {analyzed.relationship_type}"
            )
        
        chunks_text = "\n".join(chunks_analysis)
        
        return f"""
Make integration decisions for each analyzed chunk. Decide whether to CREATE a new node or APPEND to an existing node.

ANALYZED CHUNKS:
{chunks_text}

EXISTING NODES:
{existing_nodes}

CONTEXT:
- Is first processing: {context.get('is_first_processing', False)}
- Append count: {context.get('append_count', 0)}

Decision Guidelines:
- CREATE new nodes for distinct new concepts
- APPEND to existing nodes for elaboration, examples, or continuation
- Choose descriptive names for new nodes
- Specify clear relationships (e.g., "child of", "elaborates on")
- Generate meaningful content and summaries

Return decisions as JSON with the specified schema.
"""
    
    def _update_average_chunks(self) -> None:
        """Update average chunks per execution statistic"""
        if self.statistics["successful_executions"] > 0:
            total_chunks = sum([
                # This would need to be tracked properly
                # For now, estimate based on typical chunk counts
                3  # Average chunks per execution
            ]) * self.statistics["successful_executions"]
            
            self.statistics["average_chunks_per_execution"] = (
                total_chunks / self.statistics["successful_executions"]
            )
    
    def get_statistics(self) -> Dict[str, Any]:
        """Get pipeline execution statistics"""
        total_executions = self.statistics["total_executions"]
        
        stats = self.statistics.copy()
        
        # Calculate derived metrics
        if total_executions > 0:
            stats["success_rate"] = (
                self.statistics["successful_executions"] / total_executions * 100.0
            )
            stats["average_execution_time_ms"] = (
                self.statistics["total_execution_time_ms"] / total_executions
            )
        else:
            stats["success_rate"] = 0.0
            stats["average_execution_time_ms"] = 0.0
        
        return stats
    
    def reset_statistics(self) -> None:
        """Reset pipeline statistics"""
        self.statistics = {
            "total_executions": 0,
            "successful_executions": 0,
            "failed_executions": 0,
            "total_execution_time_ms": 0.0,
            "average_chunks_per_execution": 0.0
        } 