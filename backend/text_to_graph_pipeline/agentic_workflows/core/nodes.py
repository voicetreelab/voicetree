"""
Legacy node functions - kept for backward compatibility
These are no longer used by the new Agent-based implementation
"""

import logging
from pathlib import Path
from typing import Dict, Any

logger = logging.getLogger(__name__)

# This file is deprecated but kept for backward compatibility
# The actual node logic is now handled inside the Agent class

def segmentation_node(state: Dict[str, Any]) -> Dict[str, Any]:
    """Legacy segmentation node - DO NOT USE"""
    logger.warning("Using deprecated segmentation_node - please use Agent-based approach")
    return state

def relationship_analysis_node(state: Dict[str, Any]) -> Dict[str, Any]:
    """Legacy relationship analysis node - DO NOT USE"""
    logger.warning("Using deprecated relationship_analysis_node - please use Agent-based approach")
    return state

def integration_decision_node(state: Dict[str, Any]) -> Dict[str, Any]:
    """Legacy integration decision node - DO NOT USE"""
    logger.warning("Using deprecated integration_decision_node - please use Agent-based approach")
    return state