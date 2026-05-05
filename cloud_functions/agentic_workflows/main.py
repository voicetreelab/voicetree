"""
Google Cloud Function HTTP handlers for all VoiceTree agents

Wraps the agents in HTTP interfaces for serverless deployment.
"""

import functions_framework
import json
import logging
import os
from flask import Request

from agents.append_to_relevant_node_agent import AppendToRelevantNodeAgent
from agents.single_abstraction_optimizer_agent import SingleAbstractionOptimizerAgent
from agents.connect_orphans_agent import ConnectOrphansAgent
from tree_models import Node, MarkdownTree
from redis_limiter import is_ratelimited

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@functions_framework.http
def append_agent_handler(request: Request):
    """
    HTTP Cloud Function entry point for AppendToRelevantNodeAgent

    Expected JSON request body:
    {
        "user_uuid": str,
        "transcript_text": str,
        "existing_nodes_formatted": str,
        "transcript_history": str (optional)
    }

    Returns JSON response:
    {
        "actions": [...],
        "segments": [...]
    }
    """
    # Set CORS headers for the preflight request
    if request.method == 'OPTIONS':
        headers = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Max-Age': '3600'
        }
        return ('', 204, headers)

    # Set CORS headers for the main request
    headers = {
        'Access-Control-Allow-Origin': '*'
    }

    try:
        # Parse request JSON
        request_json = request.get_json(silent=True)
        if not request_json:
            logger.error("No JSON body in request")
            return (json.dumps({"error": "Request must be JSON"}), 400, headers)

        # Check rate limits (validates user_uuid internally)
        rate_limit_response = is_ratelimited(request_json, headers)
        if rate_limit_response:
            return rate_limit_response

        # Extract parameters
        transcript_text = request_json.get("transcript_text")
        existing_nodes_formatted = request_json.get("existing_nodes_formatted")
        transcript_history = request_json.get("transcript_history", "")

        # Validate required parameters
        if not transcript_text or not existing_nodes_formatted:
            logger.error("Missing required parameters")
            return (
                json.dumps({"error": "Missing required parameters: transcript_text, existing_nodes_formatted"}),
                400,
                headers
            )

        logger.info(f"Processing request with transcript length: {len(transcript_text)}")

        # Run agent
        import asyncio
        agent = AppendToRelevantNodeAgent()
        result = asyncio.run(agent.run(
            transcript_text=transcript_text,
            existing_nodes_formatted=existing_nodes_formatted,
            transcript_history=transcript_history
        ))

        # Serialize result to JSON
        response_data = {
            "actions": [action.model_dump() for action in result.actions],
            "segments": [segment.model_dump() for segment in result.segments]
        }

        logger.info(f"Successfully processed request. Actions: {len(result.actions)}, Segments: {len(result.segments)}")

        return (json.dumps(response_data), 200, headers)

    except Exception as e:
        logger.error(f"Error processing request: {str(e)}", exc_info=True)
        return (
            json.dumps({"error": f"Internal server error: {str(e)}"}),
            500,
            headers
        )


@functions_framework.http
def optimizer_agent_handler(request: Request):
    """
    HTTP Cloud Function entry point for SingleAbstractionOptimizerAgent

    Expected JSON request body:
    {
        "user_uuid": str,
        "node_dict": {
            "id": int,
            "title": str,
            "content": str,
            "summary": str
        },
        "neighbours_context": str
    }

    Returns JSON response:
    {
        "actions": [...]
    }
    """
    # Set CORS headers for the preflight request
    if request.method == 'OPTIONS':
        headers = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Max-Age': '3600'
        }
        return ('', 204, headers)

    # Set CORS headers for the main request
    headers = {
        'Access-Control-Allow-Origin': '*'
    }

    try:
        # Parse request JSON
        request_json = request.get_json(silent=True)
        if not request_json:
            logger.error("No JSON body in request")
            return (json.dumps({"error": "Request must be JSON"}), 400, headers)

        # Check rate limits (validates user_uuid internally)
        rate_limit_response = is_ratelimited(request_json, headers)
        if rate_limit_response:
            return rate_limit_response

        # Extract parameters
        node_dict = request_json.get("node_dict")
        neighbours_context = request_json.get("neighbours_context")

        # Validate required parameters
        if not node_dict or neighbours_context is None:
            logger.error("Missing required parameters")
            return (
                json.dumps({"error": "Missing required parameters: node_dict, neighbours_context"}),
                400,
                headers
            )

        # Validate node_dict structure
        required_node_fields = ["id", "title", "content", "summary"]
        for field in required_node_fields:
            if field not in node_dict:
                logger.error(f"Missing required field in node_dict: {field}")
                return (
                    json.dumps({"error": f"Missing required field in node_dict: {field}"}),
                    400,
                    headers
                )

        logger.info(f"Processing optimization request for node ID: {node_dict['id']}")

        # Reconstruct Node object from dict
        node = Node(
            name=node_dict["title"],
            node_id=node_dict["id"],
            content=node_dict["content"],
            summary=node_dict["summary"]
        )

        # Run agent
        import asyncio
        agent = SingleAbstractionOptimizerAgent()
        result = asyncio.run(agent.run(
            node=node,
            neighbours_context=neighbours_context
        ))

        # Serialize result to JSON
        response_data = {
            "actions": [action.model_dump() for action in result]
        }

        logger.info(f"Successfully processed request. Actions: {len(result)}")

        return (json.dumps(response_data), 200, headers)

    except Exception as e:
        logger.error(f"Error processing request: {str(e)}", exc_info=True)
        return (
            json.dumps({"error": f"Internal server error: {str(e)}"}),
            500,
            headers
        )


def _deserialize_node(node_dict: dict) -> Node:
    """Deserialize a node dictionary to a Node object"""
    node = Node(
        name=node_dict["title"],
        node_id=node_dict["id"],
        content=node_dict["content"],
        summary=node_dict.get("summary", ""),
        parent_id=node_dict.get("parent_id")
    )
    node.children = node_dict.get("children", [])
    node.relationships = node_dict.get("relationships", {})
    return node


def _reconstruct_tree(tree_dict: dict) -> MarkdownTree:
    """Reconstruct a MarkdownTree from a serialized dictionary"""
    tree = MarkdownTree()

    # Deserialize nodes
    for node_id_str, node_dict in tree_dict.get("tree", {}).items():
        node_id = int(node_id_str)
        tree.tree[node_id] = _deserialize_node(node_dict)

    # Store roots
    tree.roots = [
        node_id for node_id, node in tree.tree.items()
        if node.parent_id is None
    ]

    return tree


@functions_framework.http
def orphan_agent_handler(request: Request):
    """
    HTTP Cloud Function entry point for ConnectOrphansAgent

    Expected JSON request body:
    {
        "user_uuid": str,
        "tree_dict": dict,  # Serialized MarkdownTree
        "max_roots_to_process": int (optional, default: 20),
        "include_full_content": bool (optional, default: True)
    }

    Returns JSON response:
    {
        "actions": [...]
    }
    """
    # Set CORS headers for the preflight request
    if request.method == 'OPTIONS':
        headers = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Max-Age': '3600'
        }
        return ('', 204, headers)

    # Set CORS headers for the main request
    headers = {
        'Access-Control-Allow-Origin': '*'
    }

    try:
        # Parse request JSON
        request_json = request.get_json(silent=True)
        if not request_json:
            logger.error("No JSON body in request")
            return (json.dumps({"error": "Request must be JSON"}), 400, headers)

        # Check rate limits (validates user_uuid internally)
        rate_limit_response = is_ratelimited(request_json, headers)
        if rate_limit_response:
            return rate_limit_response

        # Extract parameters
        tree_dict = request_json.get("tree_dict")
        max_roots_to_process = request_json.get("max_roots_to_process", 20)
        include_full_content = request_json.get("include_full_content", True)

        # Validate required parameters
        if not tree_dict:
            logger.error("Missing required parameter: tree_dict")
            return (
                json.dumps({"error": "Missing required parameter: tree_dict"}),
                400,
                headers
            )

        logger.info(f"Processing orphan connection request with {len(tree_dict.get('tree', {}))} nodes")

        # Reconstruct tree from dict
        tree = _reconstruct_tree(tree_dict)

        # Run agent
        import asyncio
        agent = ConnectOrphansAgent()
        actions = asyncio.run(agent.run(
            tree=tree,
            max_roots_to_process=max_roots_to_process,
            include_full_content=include_full_content
        ))

        # Serialize result to JSON
        response_data = {
            "actions": [action.model_dump() for action in actions]
        }

        logger.info(f"Successfully processed request. Actions: {len(actions)}")

        return (json.dumps(response_data), 200, headers)

    except Exception as e:
        logger.error(f"Error processing request: {str(e)}", exc_info=True)
        return (
            json.dumps({"error": f"Internal server error: {str(e)}"}),
            500,
            headers
        )


@functions_framework.http
def soniox_temp_key_handler(request: Request):
    """
    HTTP Cloud Function entry point for generating temporary Soniox API keys.

    No request body required.

    Returns JSON response:
    {
        "apiKey": str  # Temporary API key valid for 60 seconds
    }
    """
    if request.method == 'OPTIONS':
        headers = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Max-Age': '3600'
        }
        return ('', 204, headers)

    headers = {'Access-Control-Allow-Origin': '*'}

    soniox_api_key = os.getenv("SONIOX_API_KEY")
    if not soniox_api_key:
        return (json.dumps({"error": "SONIOX_API_KEY not set"}), 500, headers)

    import httpx
    import asyncio

    async def get_temp_key():
        async with httpx.AsyncClient() as client:
            response = await client.post(
                "https://api.soniox.com/v1/auth/temporary-api-key",
                headers={"Authorization": f"Bearer {soniox_api_key}"},
                json={"usage_type": "transcribe_websocket", "expires_in_seconds": 60}
            )
            response.raise_for_status()
            return response.json()["api_key"]

    try:
        temp_key = asyncio.run(get_temp_key())
        return (json.dumps({"apiKey": temp_key}), 200, headers)
    except Exception as e:
        return (json.dumps({"error": str(e)}), 500, headers)