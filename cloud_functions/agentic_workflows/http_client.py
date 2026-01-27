"""
HTTP client adapters for all VoiceTree agents

Mimics the interface of the agents but calls the HTTP endpoints instead.
Used for testing the Cloud Functions locally or calling deployed instances.
"""

import httpx
import logging
from typing import Union

from backend.text_to_graph_pipeline.agentic_workflows.models import (
    AppendAgentResult,
    AppendAction,
    CreateAction,
    SegmentModel,
    BaseTreeAction,
    UpdateAction,
)
from backend.markdown_tree_manager.markdown_tree_ds import Node, MarkdownTree
from cloud_functions.agentic_workflows.get_uuid import get_user_uuid


logger = logging.getLogger(__name__)


class AppendToRelevantNodeAgentHTTPClient:
    """HTTP client that mimics AppendToRelevantNodeAgent interface"""

    def __init__(self, base_url: str = "http://localhost:8080"):
        """
        Initialize HTTP client

        Args:
            base_url: Base URL of the Cloud Function (default: localhost:8080)
        """
        self.base_url = base_url

    async def run(
        self,
        transcript_text: str,
        existing_nodes_formatted: str,
        transcript_history: str = ""
    ) -> AppendAgentResult:
        """
        Call the Cloud Function HTTP endpoint

        Args:
            transcript_text: Raw voice transcript to process
            existing_nodes_formatted: List of relevant nodes to consider for placement
            transcript_history: Optional context from previous transcripts

        Returns:
            AppendAgentResult containing actions and segment information
        """
        # Create a fresh client for this request to avoid event loop lifecycle issues
        async with httpx.AsyncClient(timeout=120.0) as client:
            try:
                # Prepare request payload
                payload = {
                    "user_uuid": get_user_uuid(),
                    "transcript_text": transcript_text,
                    "existing_nodes_formatted": existing_nodes_formatted,
                    "transcript_history": transcript_history
                }

                logger.info(f"Calling Cloud Function at {self.base_url}")

                # Make HTTP request
                response = await client.post(
                    self.base_url,
                    json=payload,
                    headers={"Content-Type": "application/json"}
                )

                # Check for HTTP errors
                response.raise_for_status()

                # Parse response
                result_data = response.json()

                # Deserialize actions
                actions: list[Union[AppendAction, CreateAction]] = []
                for action_dict in result_data.get("actions", []):
                    if action_dict["action"] == "APPEND":
                        actions.append(AppendAction(**action_dict))
                    elif action_dict["action"] == "CREATE":
                        actions.append(CreateAction(**action_dict))

                # Deserialize segments
                segments = [
                    SegmentModel(**seg_dict)
                    for seg_dict in result_data.get("segments", [])
                ]

                logger.info(f"Received {len(actions)} actions and {len(segments)} segments from Cloud Function")

                return AppendAgentResult(actions=actions, segments=segments)

            except httpx.HTTPError as e:
                logger.error(f"HTTP error calling Cloud Function: {e}")
                raise
            except Exception as e:
                logger.error(f"Error deserializing response: {e}")
                raise


class SingleAbstractionOptimizerAgentHTTPClient:
    """HTTP client that mimics SingleAbstractionOptimizerAgent interface"""

    def __init__(self, base_url: str = "http://localhost:8081"):
        """
        Initialize HTTP client

        Args:
            base_url: Base URL of the Cloud Function (default: localhost:8081)
        """
        self.base_url = base_url

    async def run(
        self,
        node: Node,
        neighbours_context: str
    ) -> list[BaseTreeAction]:
        """
        Call the Cloud Function HTTP endpoint

        Args:
            node: The node to optimize
            neighbours_context: String representation of neighboring nodes

        Returns:
            List of tree actions (CreateAction, UpdateAction, or AppendAction)
        """
        # Create a fresh client for this request to avoid event loop lifecycle issues
        async with httpx.AsyncClient(timeout=120.0) as client:
            try:
                # Prepare request payload
                payload = {
                    "user_uuid": get_user_uuid(),
                    "node_dict": {
                        "id": node.id,
                        "title": node.title,
                        "content": node.content,
                        "summary": node.summary
                    },
                    "neighbours_context": neighbours_context
                }

                logger.info(f"Calling Optimizer Cloud Function at {self.base_url}")

                # Make HTTP request
                response = await client.post(
                    self.base_url,
                    json=payload,
                    headers={"Content-Type": "application/json"}
                )

                # Check for HTTP errors
                response.raise_for_status()

                # Parse response
                result_data = response.json()

                # Deserialize actions
                actions: list[BaseTreeAction] = []
                for action_dict in result_data.get("actions", []):
                    action_type = action_dict.get("action")
                    if action_type == "CREATE":
                        actions.append(CreateAction(**action_dict))
                    elif action_type == "UPDATE":
                        actions.append(UpdateAction(**action_dict))
                    elif action_type == "APPEND":
                        actions.append(AppendAction(**action_dict))

                logger.info(f"Received {len(actions)} actions from Optimizer Cloud Function")

                return actions

            except httpx.HTTPError as e:
                logger.error(f"HTTP error calling Optimizer Cloud Function: {e}")
                raise
            except Exception as e:
                logger.error(f"Error deserializing optimizer response: {e}")
                raise


class ConnectOrphansAgentHTTPClient:
    """HTTP client that mimics ConnectOrphansAgent interface"""

    def __init__(self, base_url: str = "http://localhost:8082"):
        """
        Initialize HTTP client

        Args:
            base_url: Base URL of the Cloud Function (default: localhost:8082)
        """
        self.base_url = base_url

    async def run(
        self,
        tree: MarkdownTree,
        max_roots_to_process: int = 20,
        include_full_content: bool = True
    ) -> list[CreateAction]:
        """
        Call the Cloud Function HTTP endpoint

        Args:
            tree: The markdown tree to process
            max_roots_to_process: Maximum number of root nodes to process
            include_full_content: Whether to include full content in the tree dict

        Returns:
            List of CreateActions
        """
        # Create a fresh client for this request to avoid event loop lifecycle issues
        async with httpx.AsyncClient(timeout=120.0) as client:
            try:
                # Serialize tree to dict
                tree_dict = tree.to_dict()

                # Prepare request payload
                payload = {
                    "user_uuid": get_user_uuid(),
                    "tree_dict": tree_dict,
                    "max_roots_to_process": max_roots_to_process,
                    "include_full_content": include_full_content
                }

                logger.info(f"Calling Orphan Connection Cloud Function at {self.base_url}")

                # Make HTTP request
                response = await client.post(
                    self.base_url,
                    json=payload,
                    headers={"Content-Type": "application/json"}
                )

                # Check for HTTP errors
                response.raise_for_status()

                # Parse response
                result_data = response.json()

                # Deserialize actions
                actions: list[CreateAction] = []
                for action_dict in result_data.get("actions", []):
                    actions.append(CreateAction(**action_dict))

                logger.info(f"Received {len(actions)} actions from Orphan Connection Cloud Function")

                return actions

            except httpx.HTTPError as e:
                logger.error(f"HTTP error calling Orphan Connection Cloud Function: {e}")
                raise
            except Exception as e:
                logger.error(f"Error deserializing orphan connection response: {e}")
                raise