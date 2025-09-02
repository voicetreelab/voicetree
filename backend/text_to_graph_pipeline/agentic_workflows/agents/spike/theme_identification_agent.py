"""
ThemeIdentificationAgent - Analyzes and identifies themes in VoiceTree nodes
"""

from typing import Any
from langgraph.graph import END

from ..core.agent import Agent
from ..core.state import ThemeIdentificationAgentState
from ..models import ThemeResponse


class ThemeIdentificationAgent(Agent):
    """Agent that identifies themes in nodes by semantic similarity of titles and summaries"""

    def __init__(self):
        super().__init__("ThemeIdentificationAgent", ThemeIdentificationAgentState)
        self._setup_workflow()

    def _setup_workflow(self):
        """Single prompt workflow"""
        self.add_prompt_node(
            "theme_identification",
            ThemeResponse,
            model_name="gemini-2.5-flash"
        )
        self.add_dataflow("theme_identification", END)

    async def run(self, formatted_nodes: str, num_themes: int) -> ThemeResponse:
        """Analyze and assign themes to nodes by semantic similarity

        Args:
            formatted_nodes: Output from _format_nodes_for_prompt()
            num_themes: The number of themes to identify.

        Returns:
            ThemeResponse with identified themes.
        """

        # Create initial state
        initial_state: ThemeIdentificationAgentState = {
            "formatted_nodes": formatted_nodes,
            "num_themes": num_themes,
            # Agent response field
            "theme_identification_response": None
        }

        # Run workflow
        app = self.compile()
        result = await app.ainvoke(initial_state)

        # Extract theme identification response
        return result["theme_identification_response"]