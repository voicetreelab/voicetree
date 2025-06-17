#!/usr/bin/env python3
"""
Debug Log Parser for VoiceTree Quality Scoring
Parses existing debug logs into structured data for quality assessment
"""

import os
import re
import json
from typing import Dict, List, Any, Optional, Tuple
from pathlib import Path
import logging

logger = logging.getLogger(__name__)


class DebugLogParser:
    """Parse existing debug logs into structured data for quality scoring"""
    
    def __init__(self, debug_logs_dir: str = "backend/agentic_workflows/debug_logs"):
        self.debug_logs_dir = Path(debug_logs_dir)
        self.parsed_data = {}
    
    def parse_all_logs(self, debug_dir: Optional[str] = None) -> Dict[str, Any]:
        """
        Parse all debug logs in the directory
        
        Returns:
            Dictionary with parsed data for each stage
        """
        if debug_dir:
            self.debug_logs_dir = Path(debug_dir)
        
        if not self.debug_logs_dir.exists():
            logger.warning(f"Debug logs directory not found: {self.debug_logs_dir}")
            return {}
        
        parsed_data = {}
        
        # Parse transcript input
        transcript_data = self.parse_transcript_input()
        if transcript_data:
            parsed_data["transcript"] = transcript_data
        
        # Parse each stage
        stage_parsers = {
            "segmentation": self.parse_segmentation_logs,
            "relationship_analysis": self.parse_relationship_logs,
            "integration_decision": self.parse_integration_logs,
            "node_extraction": self.parse_extraction_logs
        }
        
        for stage_name, parser_func in stage_parsers.items():
            try:
                stage_data = parser_func()
                if stage_data:
                    parsed_data[stage_name] = stage_data
                    logger.info(f"✅ Parsed {stage_name} debug logs")
                else:
                    logger.warning(f"⚠️  No data found for {stage_name}")
            except Exception as e:
                logger.error(f"❌ Failed to parse {stage_name}: {e}")
                parsed_data[stage_name] = {"error": str(e)}
        
        self.parsed_data = parsed_data
        return parsed_data
    
    def parse_transcript_input(self) -> Optional[Dict[str, Any]]:
        """Parse the transcript input file"""
        transcript_file = self.debug_logs_dir / "00_transcript_input.txt"
        
        if not transcript_file.exists():
            return None
        
        try:
            with open(transcript_file, 'r', encoding='utf-8') as f:
                content = f.read()
            
            # Extract transcript metadata and content
            transcript_data = {
                "raw_content": content,
                "character_count": 0,
                "word_count": 0,
                "transcript_text": "",
                "source": "unknown"
            }
            
            # Extract the actual transcript text
            content_match = re.search(r'CONTENT:\s*\n(.+)', content, re.DOTALL)
            if content_match:
                transcript_text = content_match.group(1).strip()
                transcript_data["transcript_text"] = transcript_text
                transcript_data["character_count"] = len(transcript_text)
                transcript_data["word_count"] = len(transcript_text.split())
            
            # Extract source information
            source_match = re.search(r'SOURCE:\s*(.+)', content)
            if source_match:
                transcript_data["source"] = source_match.group(1).strip()
            
            return transcript_data
            
        except Exception as e:
            logger.error(f"Failed to parse transcript input: {e}")
            return None
    
    def parse_segmentation_logs(self) -> Optional[Dict[str, Any]]:
        """Parse segmentation debug logs"""
        log_file = self.debug_logs_dir / "segmentation_debug.txt"
        
        if not log_file.exists():
            return None
        
        try:
            with open(log_file, 'r', encoding='utf-8') as f:
                content = f.read()
            
            segmentation_data = {
                "input_text": "",
                "chunks": [],
                "chunk_count": 0,
                "raw_log": content
            }
            
            # Extract input text (transcript_text)
            input_match = re.search(r"transcript_text['\"]:\s*['\"]([^'\"]+)['\"]", content, re.DOTALL)
            if input_match:
                segmentation_data["input_text"] = input_match.group(1)
            
            # Extract chunks from the output
            chunks_section = self._extract_output_section(content, "chunks")
            if chunks_section:
                chunks = self._parse_chunks_from_text(chunks_section)
                segmentation_data["chunks"] = chunks
                segmentation_data["chunk_count"] = len(chunks)
            
            # Extract result count if available
            result_count_match = re.search(r'result_count:\s*(\d+)', content)
            if result_count_match:
                segmentation_data["result_count"] = int(result_count_match.group(1))
            
            return segmentation_data
            
        except Exception as e:
            logger.error(f"Failed to parse segmentation logs: {e}")
            return None
    
    def parse_relationship_logs(self) -> Optional[Dict[str, Any]]:
        """Parse relationship analysis debug logs"""
        log_file = self.debug_logs_dir / "relationship_analysis_debug.txt"
        
        if not log_file.exists():
            return None
        
        try:
            with open(log_file, 'r', encoding='utf-8') as f:
                content = f.read()
            
            relationship_data = {
                "input_chunks": [],
                "existing_nodes": "",
                "relationships": [],
                "analyzed_chunks": [],
                "raw_log": content
            }
            
            # Extract existing nodes context
            existing_nodes_match = re.search(r"existing_nodes['\"]:\s*['\"]([^'\"]*)['\"]", content, re.DOTALL)
            if existing_nodes_match:
                relationship_data["existing_nodes"] = existing_nodes_match.group(1)
            
            # Extract input chunks
            chunks_section = self._extract_input_section(content, "chunks")
            if chunks_section:
                relationship_data["input_chunks"] = self._parse_chunks_from_text(chunks_section)
            
            # Extract analyzed chunks from output
            analyzed_section = self._extract_output_section(content, "analyzed_chunks")
            if analyzed_section:
                analyzed_chunks = self._parse_analyzed_chunks(analyzed_section)
                relationship_data["analyzed_chunks"] = analyzed_chunks
                relationship_data["relationships"] = self._extract_relationships_from_analyzed_chunks(analyzed_chunks)
            
            return relationship_data
            
        except Exception as e:
            logger.error(f"Failed to parse relationship logs: {e}")
            return None
    
    def parse_integration_logs(self) -> Optional[Dict[str, Any]]:
        """Parse integration decision debug logs"""
        log_file = self.debug_logs_dir / "integration_decision_debug.txt"
        
        if not log_file.exists():
            return None
        
        try:
            with open(log_file, 'r', encoding='utf-8') as f:
                content = f.read()
            
            integration_data = {
                "input_analyzed_chunks": [],
                "integration_decisions": [],
                "create_count": 0,
                "append_count": 0,
                "raw_log": content
            }
            
            # Extract input analyzed chunks
            chunks_section = self._extract_input_section(content, "analyzed_chunks")
            if chunks_section:
                integration_data["input_analyzed_chunks"] = self._parse_analyzed_chunks(chunks_section)
            
            # Extract integration decisions from output
            decisions_section = self._extract_output_section(content, "integration_decisions")
            if decisions_section:
                decisions = self._parse_integration_decisions(decisions_section)
                integration_data["integration_decisions"] = decisions
                
                # Count CREATE/APPEND actions
                create_count = sum(1 for d in decisions if d.get("action") == "CREATE")
                append_count = sum(1 for d in decisions if d.get("action") == "APPEND")
                integration_data["create_count"] = create_count
                integration_data["append_count"] = append_count
            
            return integration_data
            
        except Exception as e:
            logger.error(f"Failed to parse integration logs: {e}")
            return None
    
    def parse_extraction_logs(self) -> Optional[Dict[str, Any]]:
        """Parse node extraction debug logs"""
        log_file = self.debug_logs_dir / "node_extraction_debug.txt"
        
        if not log_file.exists():
            return None
        
        try:
            with open(log_file, 'r', encoding='utf-8') as f:
                content = f.read()
            
            extraction_data = {
                "input_decisions": [],
                "new_nodes": [],
                "node_count": 0,
                "raw_log": content
            }
            
            # Extract input integration decisions
            decisions_section = self._extract_input_section(content, "integration_decisions")
            if decisions_section:
                extraction_data["input_decisions"] = self._parse_integration_decisions(decisions_section)
            
            # Extract new nodes from output
            nodes_section = self._extract_output_section(content, "new_nodes")
            if nodes_section:
                new_nodes = self._parse_new_nodes(nodes_section)
                extraction_data["new_nodes"] = new_nodes
                extraction_data["node_count"] = len(new_nodes)
            
            return extraction_data
            
        except Exception as e:
            logger.error(f"Failed to parse extraction logs: {e}")
            return None
    
    def extract_stage_metrics(self, parsed_logs: Dict) -> Dict[str, Any]:
        """Extract key metrics from parsed logs for quality scoring"""
        metrics = {
            "pipeline_flow": {},
            "content_retention": {},
            "stage_effectiveness": {}
        }
        
        # Pipeline flow metrics (count progression through stages)
        if "segmentation" in parsed_logs:
            seg_chunks = len(parsed_logs["segmentation"].get("chunks", []))
            metrics["pipeline_flow"]["segmentation_output"] = seg_chunks
        
        if "integration_decision" in parsed_logs:
            int_decisions = len(parsed_logs["integration_decision"].get("integration_decisions", []))
            metrics["pipeline_flow"]["integration_output"] = int_decisions
        
        if "node_extraction" in parsed_logs:
            ext_nodes = len(parsed_logs["node_extraction"].get("new_nodes", []))
            metrics["pipeline_flow"]["extraction_output"] = ext_nodes
        
        # Content retention analysis
        input_chars = 0
        if "transcript" in parsed_logs:
            input_chars = parsed_logs["transcript"].get("character_count", 0)
            metrics["content_retention"]["input_characters"] = input_chars
        
        # Stage effectiveness
        if "integration_decision" in parsed_logs:
            create_count = parsed_logs["integration_decision"].get("create_count", 0)
            append_count = parsed_logs["integration_decision"].get("append_count", 0)
            total_decisions = create_count + append_count
            
            if total_decisions > 0:
                create_ratio = create_count / total_decisions
                metrics["stage_effectiveness"]["create_append_ratio"] = create_ratio
        
        return metrics
    
    # =============================================================================
    # HELPER METHODS FOR PARSING
    # =============================================================================
    
    def _extract_input_section(self, content: str, variable_name: str) -> Optional[str]:
        """Extract input section for a specific variable"""
        pattern = rf'INPUT VARIABLES:.*?{variable_name}[\'"]?\s*:\s*(.+?)(?=\n\s*[a-zA-Z_]+[\'"]?\s*:|OUTPUT VARIABLES:|$)'
        match = re.search(pattern, content, re.DOTALL | re.IGNORECASE)
        return match.group(1).strip() if match else None
    
    def _extract_output_section(self, content: str, variable_name: str) -> Optional[str]:
        """Extract output section for a specific variable"""
        pattern = rf'OUTPUT VARIABLES:.*?{variable_name}[\'"]?\s*:\s*(.+?)(?=\n\s*[a-zA-Z_]+[\'"]?\s*:|=====|$)'
        match = re.search(pattern, content, re.DOTALL | re.IGNORECASE)
        return match.group(1).strip() if match else None
    
    def _parse_chunks_from_text(self, text: str) -> List[Dict[str, Any]]:
        """Parse chunks from text representation"""
        chunks = []
        
        # Handle list representation
        if text.startswith('[') and text.endswith(']'):
            # Try to parse as Python list literal
            try:
                # Clean up the text for safer evaluation
                cleaned_text = text.replace('\n', ' ').replace('  ', ' ')
                
                # Use regex to find dictionaries in the list
                dict_pattern = r'\{[^{}]*\}'
                matches = re.findall(dict_pattern, cleaned_text)
                
                for match in matches:
                    try:
                        # Extract key-value pairs
                        chunk_dict = {}
                        
                        # Extract text field
                        text_match = re.search(r"['\"]text['\"]:\s*['\"]([^'\"]*)['\"]", match)
                        if text_match:
                            chunk_dict["text"] = text_match.group(1)
                        
                        # Extract other common fields
                        for field in ["name", "summary", "id"]:
                            field_match = re.search(rf"['\"]?{field}['\"]?\s*:\s*['\"]([^'\"]*)['\"]", match)
                            if field_match:
                                chunk_dict[field] = field_match.group(1)
                        
                        if chunk_dict:
                            chunks.append(chunk_dict)
                            
                    except Exception as e:
                        logger.debug(f"Failed to parse chunk: {match}, error: {e}")
                        continue
                        
            except Exception as e:
                logger.debug(f"Failed to parse chunks list: {e}")
        
        return chunks
    
    def _parse_analyzed_chunks(self, text: str) -> List[Dict[str, Any]]:
        """Parse analyzed chunks with relationship information"""
        analyzed_chunks = []
        
        # Similar parsing logic but looking for relationship fields
        if text.startswith('[') and text.endswith(']'):
            dict_pattern = r'\{[^{}]*\}'
            matches = re.findall(dict_pattern, text)
            
            for match in matches:
                try:
                    chunk_dict = {}
                    
                    # Standard chunk fields
                    text_match = re.search(r"['\"]text['\"]:\s*['\"]([^'\"]*)['\"]", match)
                    if text_match:
                        chunk_dict["text"] = text_match.group(1)
                    
                    # Relationship fields
                    for field in ["relationship", "related_nodes", "relationship_strength"]:
                        field_match = re.search(rf"['\"]?{field}['\"]?\s*:\s*['\"]([^'\"]*)['\"]", match)
                        if field_match:
                            chunk_dict[field] = field_match.group(1)
                    
                    if chunk_dict:
                        analyzed_chunks.append(chunk_dict)
                        
                except Exception as e:
                    logger.debug(f"Failed to parse analyzed chunk: {match}, error: {e}")
                    continue
        
        return analyzed_chunks
    
    def _extract_relationships_from_analyzed_chunks(self, analyzed_chunks: List[Dict]) -> List[Dict]:
        """Extract relationship information from analyzed chunks"""
        relationships = []
        
        for chunk in analyzed_chunks:
            if "relationship" in chunk:
                rel_dict = {
                    "relationship": chunk.get("relationship", ""),
                    "related_nodes": chunk.get("related_nodes", "").split(",") if chunk.get("related_nodes") else [],
                    "chunk_text": chunk.get("text", ""),
                    "strength": chunk.get("relationship_strength", "")
                }
                relationships.append(rel_dict)
        
        return relationships
    
    def _parse_integration_decisions(self, text: str) -> List[Dict[str, Any]]:
        """Parse integration decisions from text"""
        decisions = []
        
        if text.startswith('[') and text.endswith(']'):
            dict_pattern = r'\{[^{}]*\}'
            matches = re.findall(dict_pattern, text)
            
            for match in matches:
                try:
                    decision_dict = {}
                    
                    # Key decision fields
                    for field in ["action", "target_node", "new_node_name", "content", "text"]:
                        field_match = re.search(rf"['\"]?{field}['\"]?\s*:\s*['\"]([^'\"]*)['\"]", match)
                        if field_match:
                            decision_dict[field] = field_match.group(1)
                    
                    if decision_dict:
                        decisions.append(decision_dict)
                        
                except Exception as e:
                    logger.debug(f"Failed to parse decision: {match}, error: {e}")
                    continue
        
        return decisions
    
    def _parse_new_nodes(self, text: str) -> List[str]:
        """Parse new node names from text"""
        nodes = []
        
        if text.startswith('[') and text.endswith(']'):
            # Extract strings from list
            string_pattern = r"['\"]([^'\"]+)['\"]"
            matches = re.findall(string_pattern, text)
            nodes = matches
        
        return nodes
    
    def get_parsing_summary(self) -> Dict[str, Any]:
        """Get summary of parsed data"""
        if not self.parsed_data:
            return {"error": "No parsed data available"}
        
        summary = {
            "stages_parsed": list(self.parsed_data.keys()),
            "transcript_available": "transcript" in self.parsed_data,
            "stage_counts": {}
        }
        
        # Count items in each stage
        if "segmentation" in self.parsed_data:
            summary["stage_counts"]["chunks"] = len(self.parsed_data["segmentation"].get("chunks", []))
        
        if "relationship_analysis" in self.parsed_data:
            summary["stage_counts"]["relationships"] = len(self.parsed_data["relationship_analysis"].get("relationships", []))
        
        if "integration_decision" in self.parsed_data:
            summary["stage_counts"]["decisions"] = len(self.parsed_data["integration_decision"].get("integration_decisions", []))
        
        if "node_extraction" in self.parsed_data:
            summary["stage_counts"]["new_nodes"] = len(self.parsed_data["node_extraction"].get("new_nodes", []))
        
        return summary


def main():
    """Test the debug log parser"""
    print("🧪 Testing Debug Log Parser")
    print("=" * 50)
    
    parser = DebugLogParser()
    
    # Check if debug logs exist
    if not parser.debug_logs_dir.exists():
        print(f"❌ Debug logs directory not found: {parser.debug_logs_dir}")
        print("Run the workflow first to generate debug logs")
        return
    
    # Parse all logs
    parsed_data = parser.parse_all_logs()
    
    if not parsed_data:
        print("❌ No debug logs found to parse")
        return
    
    # Display summary
    summary = parser.get_parsing_summary()
    print("✅ Debug logs parsed successfully!")
    print(f"Stages parsed: {', '.join(summary['stages_parsed'])}")
    print(f"Transcript available: {summary['transcript_available']}")
    print("\nStage counts:")
    for stage, count in summary["stage_counts"].items():
        print(f"  • {stage}: {count}")
    
    # Extract metrics
    metrics = parser.extract_stage_metrics(parsed_data)
    print("\nPipeline flow:")
    for stage, count in metrics["pipeline_flow"].items():
        print(f"  • {stage}: {count}")
    
    if "create_append_ratio" in metrics["stage_effectiveness"]:
        ratio = metrics["stage_effectiveness"]["create_append_ratio"]
        print(f"\nCREATE/APPEND ratio: {ratio:.2f} ({ratio*100:.1f}% CREATE)")


if __name__ == "__main__":
    main() 