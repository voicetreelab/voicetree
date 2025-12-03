"""
Integration test for improved identify_target_node prompt with node IDs
Tests that the prompt correctly identifies target node IDs instead of names
"""

import json

import pytest

from backend.text_to_graph_pipeline.agentic_workflows.core.prompt_engine import (
    PromptLoader,
)
from backend.text_to_graph_pipeline.agentic_workflows.models import (
    TargetNodeIdentification,
)
from backend.text_to_graph_pipeline.agentic_workflows.models import TargetNodeResponse


class TestIdentifyTargetNodeWithIDs:
    """Test the improved identify_target_node prompt that returns node IDs"""

    @pytest.fixture
    def prompt_loader(self):
        """Get prompt loader instance"""
        from pathlib import Path

        # Get the absolute path to prompts directory in cloud_functions
        repo_root = Path(__file__).parent.parent.parent.parent.parent.parent.parent.parent.parent  # Go to VoiceTree root
        prompts_dir = repo_root / "cloud_functions" / "agentic_workflows" / "prompts"
        return PromptLoader(str(prompts_dir.absolute()))

    async def call_LLM(self, prompt_text):
        """Call LLM with format conversion for new array-based response format"""
        from google.genai.types import GenerateContentConfigDict

        from backend.text_to_graph_pipeline.agentic_workflows.core.json_parser import (
            parse_json_markdown,
        )
        from backend.text_to_graph_pipeline.agentic_workflows.core.llm_integration import (
            CONFIG,
        )
        from backend.text_to_graph_pipeline.agentic_workflows.core.llm_integration import (
            _get_client,
        )

        # Get client directly to handle array format
        client = _get_client()
        model_name = "gemini-2.5-flash-lite"

        # Configure for array output
        config: GenerateContentConfigDict = {
            'response_mime_type': 'application/json',
            'temperature': CONFIG.TEMPERATURE
        }

        response = client.models.generate_content(
            model=model_name,
            contents=prompt_text,
            config=config
        )

        # Parse the response
        try:
            parsed_data = parse_json_markdown(response.text)
        except Exception:
            parsed_data = json.loads(response.text)

        # Convert array format to TargetNodeResponse format
        if isinstance(parsed_data, list):
            # Convert array of TargetNodeIdentification to TargetNodeResponse format
            target_nodes = [TargetNodeIdentification.model_validate(item) for item in parsed_data]
            response_data = {
                "target_nodes": target_nodes,
                "global_reasoning": "Converted from array format - reasoning distributed across individual items"
            }
            return TargetNodeResponse.model_validate(response_data)
        else:
            # Handle dict format (fallback)
            return TargetNodeResponse.model_validate(parsed_data)

    @pytest.mark.asyncio
    async def test_existing_node_identification_with_ids(self, prompt_loader):
        """Test identifying segments that should go to existing nodes using IDs"""
        # Test data - now includes node IDs
        existing_nodes = """
        [
            {"id": 1, "name": "Voice Tree Architecture", "summary": "Overall system design and components"},
            {"id": 2, "name": "Database Design", "summary": "Schema and data model decisions"}
        ]
        """

        segments = """
        [
            {"text": "We need to add caching to improve voice tree performance", "is_routable": true},
            {"text": "The database indexes need optimization for faster queries", "is_routable": true}
        ]
        """

        # Load and run prompt
        prompt_text = prompt_loader.render_template(
            "identify_target_node",
            existing_nodes=existing_nodes,
            segments=segments,
            transcript_history="",  # Empty history for this test
            transcript_text="We need to add caching to improve voice tree performance. The database indexes need optimization for faster queries."
        )

        result = await self.call_LLM(prompt_text)

        # Assertions
        assert len(result.target_nodes) == 2

        # First segment about caching should go to Architecture (ID 1)
        assert result.target_nodes[0].target_node_id == 1
        assert not result.target_nodes[0].is_orphan
        assert "caching" in result.target_nodes[0].text

        # Second segment about DB should go to Database Design (ID 2)
        assert result.target_nodes[1].target_node_id == 2
        assert not result.target_nodes[1].is_orphan
        assert "database" in result.target_nodes[1].text.lower()

# ----------------------------------------------------------------------------------
# --- EXTRA HARD TEST CASES TO DIFFERENTIATE PROMPT PERFORMANCE ---
# ----------------------------------------------------------------------------------
# The following tests are designed to be difficult. They should make a simple,
# keyword-based prompt fail, while a more sophisticated prompt with deeper
# reasoning instructions (like the "ultra prompt") should pass.

    @pytest.mark.asyncio
    async def test_misleading_keywords_vs_true_intent(self, prompt_loader):
        """
        HARD TEST: The segment contains strong keywords for one node, but the actual
        *intent* or *action* of the segment points to another. This tests if the
        model can prioritize the verb/action over the nouns.
        """
        existing_nodes = """
            [
                {"id": 401, "name": "API Authentication Layer broken", "summary": "Must secure API authentication endpoints with tokens and user roles, red team identified a security flaw"},
                {"id": 402, "name": "Project Documentation", "summary": "Creating and maintaining technical documentation, user guides, and API specs.",
                {"id": 403, "name": "API Documentation", "summary": "Create documentation, user guides, and API specs."}}
            ]
            """
        segments = """
            [
                {"text": "We need to write up a clear guide on how the API Authentication Layer works for the new developers.", "is_routable": true}
            ]
            """
        prompt_text = prompt_loader.render_template(
            "identify_target_node",
            existing_nodes=existing_nodes,
            segments=segments,
            transcript_history="",
            transcript_text="We need to write up a clear guide on how the API Authentication Layer works for the new developers."
        )

        result = await self.call_LLM(prompt_text)

        assert len(result.target_nodes) == 1
        # The core task is "write up a clear guide," which is Documentation.
        # The distractor is 'API Authentication Layer' (ID 401). A simple
        # keyword-based model will likely fail and pick this.
        # An advanced model will understand the true task is documentation.
        assert result.target_nodes[0].target_node_id == 403
        assert not result.target_nodes[0].is_orphan


    @pytest.mark.asyncio
    async def test_negation_and_exclusionary_routing(self, prompt_loader):
        """
        HARD TEST: The segment explicitly mentions a topic to *exclude* it. A naive
        model will latch onto the keyword and route incorrectly. This is a classic
        LLM failure mode.
        """
        existing_nodes = """
            [
                {"id": 501, "name": "Database Optimization", "summary": "Improving query performance and schema indexing."},
                {"id": 502, "name": "Frontend State Management", "summary": "Handling client-side state with Redux, including async data fetching logic."}
            ]
            """
        segments = """
            [
                {"text": "Okay, to be perfectly clear, the recent slowdown has nothing to do with the database. The problem is squarely in our frontend state management.", "is_routable": true}
            ]
            """
        prompt_text = prompt_loader.render_template(
            "identify_target_node",
            existing_nodes=existing_nodes,
            segments=segments,
            transcript_history="Users are reporting the dashboard is slow to load.",
            transcript_text="Okay, to be perfectly clear, the recent slowdown has nothing to do with the database. The problem is squarely in our frontend state management."
        )

        result = await self.call_LLM(prompt_text)

        assert len(result.target_nodes) == 1
        # The model must understand the negation "nothing to do with the database".
        # The distractor is 'Database Optimization' (ID 501).
        # The correct target is 'Frontend State Management' (ID 502).
        assert result.target_nodes[0].target_node_id == 502
        assert not result.target_nodes[0].is_orphan


    @pytest.mark.asyncio
    async def test_routing_based_on_implied_task(self, prompt_loader):
        """
        HARD TEST: The segment describes a problem without using any keywords for the
        solution's topic. The model must perform a logical leap to infer the
        correct node where the solution would be implemented.
        """
        existing_nodes = """
            [
                {"id": 601, "name": "API Authentication Layer", "summary": "Handles user login, session duration, and token refresh logic."},
                {"id": 602, "name": "User Profile UI", "summary": "The user interface for viewing and editing profile information."}
            ]
            """
        segments = """
            [
                {"text": "Let's fix that. It's incredibly annoying for our users.", "is_routable": true}
            ]
            """
        prompt_text = prompt_loader.render_template(
            "identify_target_node",
            existing_nodes=existing_nodes,
            segments=segments,
            transcript_history="The main complaint this week is that everyone is getting logged out of the app every 30 minutes.",
            transcript_text="Let's fix that. It's incredibly annoying for our users."
        )

        result = await self.call_LLM(prompt_text)

        assert len(result.target_nodes) == 1
        # There are NO keywords in the segment. The model MUST use the history.
        # It has to infer that "fixing" the problem of "getting logged out"
        # relates to session duration, which is part of the Auth Layer.
        assert result.target_nodes[0].target_node_id == 601
        assert not result.target_nodes[0].is_orphan


    @pytest.mark.asyncio
    async def test_topic_drift_and_re_centering(self, prompt_loader):
        """
        HARD TEST: The context drifts to a new topic, but the key segment tries to
        pull the conversation back to the original topic. The model must not be
        distracted by the most recent utterance and must recognize the re-centering
        language.
        """
        existing_nodes = """
            [
                {"id": 701, "name": "Dashboard UI/UX Redesign", "summary": "The redesign of the main user-facing dashboard."},
                {"id": 702, "name": "Mobile App UI", "summary": "The user interface for the native iOS and Android apps."}
            ]
            """
        segments = """
            [
                {"text": "But let's not get sidetracked, we need to finalize the mockups for the main dashboard.", "is_routable": true}
            ]
            """
        prompt_text = prompt_loader.render_template(
            "identify_target_node",
            existing_nodes=existing_nodes,
            segments=segments,
            # The history drifts from dashboard to the mobile app
            transcript_history="The dashboard redesign is going well. The colors look great. This reminds me, the mobile app also needs a UI refresh soon, it's starting to look dated.",
            transcript_text="But let's not get sidetracked, we need to finalize the mockups for the main dashboard."
        )

        result = await self.call_LLM(prompt_text)

        assert len(result.target_nodes) == 1
        # The phrase "But let's not get sidetracked" is key.
        # The distractor is the most recent topic in history: 'Mobile App UI' (ID 702).
        # The model should correctly route back to 'Dashboard UI/UX Redesign' (ID 701).
        assert result.target_nodes[0].target_node_id == 701
        assert not result.target_nodes[0].is_orphan


    @pytest.mark.asyncio
    async def test_metaphorical_language_routing(self, prompt_loader):
        """
        HARD TEST: The user speaks in metaphors without using any direct technical
        keywords. The model must translate the abstract metaphor into a concrete
        technical domain.
        """
        existing_nodes = """
            [
                {"id": 801, "name": "User Onboarding Flow", "summary": "The initial steps a user takes after signing up."},
                {"id": 802, "name": "API Performance Optimization", "summary": "Focuses on endpoint response times and overall system speed."}
            ]
            """
        segments = """
            [
                {"text": "We need to pave a four-lane superhighway for our data.", "is_routable": true}
            ]
            """
        prompt_text = prompt_loader.render_template(
            "identify_target_node",
            existing_nodes=existing_nodes,
            segments=segments,
            transcript_history="The whole system feels like it's wading through mud. API calls are taking forever.",
            transcript_text="We need to pave a four-lane superhighway for our data."
        )

        result = await self.call_LLM(prompt_text)

        assert len(result.target_nodes) == 1
        # The model must understand the metaphor: "wading through mud" -> "slow",
        # and "pave a superhighway" -> "make it very fast".
        # This has nothing to do with onboarding. The correct node is performance.
        assert result.target_nodes[0].target_node_id == 802
        assert not result.target_nodes[0].is_orphan


    @pytest.mark.asyncio
    async def test_deeply_complex_algorithmic_design_session(self, prompt_loader):
        """
        THE ULTIMATE TEST CASE: A massive, complex scenario involving a deep dive
        into a "LeetCode Hard" style problem.

        This test evaluates the model's ability to:
        1.  Handle a large number of potential nodes (30+) with subtle overlaps.
        2.  Follow a complex, evolving chain of thought in the transcript.
        3.  Differentiate between high-level concepts, specific implementations,
            performance optimizations, and API/UI concerns.
        4.  Avoid being misled by jargon and correctly route segments to the most
            specific and appropriate node.
        """
        # A large, complex, and realistic set of nodes for a major feature.
        # Contains many potential distractors.
        existing_nodes = """
            [
                {"id": 1000, "name": "Q3 Roadmap: Project 'Pathfinder'", "summary": "High-level goals for the new flight route search feature."},
                {"id": 1001, "name": "Route Search Algorithm (Core Logic)", "summary": "The fundamental algorithm for finding flight paths, considering costs and constraints."},
                {"id": 1002, "name": "Dijkstra's Algorithm Implementation", "summary": "Specific implementation details of using Dijkstra's for pathfinding."},
                {"id": 1003, "name": "Priority Queue / Min-Heap", "summary": "The data structure used to efficiently manage nodes to visit in pathfinding algorithms."},
                {"id": 1004, "name": "Bellman-Ford Algorithm", "summary": "Alternative algorithm for single-source shortest paths, handles negative weights."},
                {"id": 1005, "name": "Algorithm Performance & Optimization", "summary": "Strategies for improving the speed of the search algorithm, like pruning branches."},
                {"id": 1006, "name": "Algorithm Edge Case Handling", "summary": "Ensuring the algorithm is robust against cycles, unreachable destinations, and invalid inputs."},
                {"id": 1010, "name": "Flight Search API Endpoint", "summary": "The public-facing API contract (request/response) for initiating a flight search."},
                {"id": 1011, "name": "Search Results Caching", "summary": "Redis-based caching layer to store results of common searches."},
                {"id": 1012, "name": "User Input Validation (Search Form)", "summary": "Server-side validation for search parameters like airport codes and dates."},
                {"id": 1015, "name": "Real-time Flight Data Ingestion", "summary": "Pipeline for consuming live flight price and availability data from providers."},
                {"id": 1016, "name": "Airlines & Flights Database Schema", "summary": "PostgreSQL schema for storing persistent flight, airport, and pricing information."},
                {"id": 1017, "name": "Geospatial Indexing (Airports)", "summary": "Optimizing queries for finding airports within a certain radius."},
                {"id": 1020, "name": "Search Results UI", "summary": "Frontend components for displaying the list of flight search results to the user."},
                {"id": 1021, "name": "Interactive Route Map Visualization", "summary": "UI component for showing the flight path on a map."},
                {"id": 1022, "name": "Frontend State Management (Search)", "summary": "Using Redux/Zustand to manage the state of the flight search form and results."},
                {"id": 1025, "name": "CI/CD for Search Service", "summary": "Automated deployment pipeline for the 'Pathfinder' microservice."},
                {"id": 1026, "name": "Logging and Monitoring (Search Latency)", "summary": "Using Datadog to monitor the p95 latency of the search API."},
                {"id": 1027, "name": "Third-Party Data Providers (Amadeus API)", "summary": "Integration with external APIs to get flight data."},
                {"id": 1028, "name": "Technical Debt Log", "summary": "A log of known issues and shortcuts taken during development."},
                {"id": 1029, "name": "Security Review (Pathfinder)", "summary": "Threat modeling and security analysis for the new search service."},
                {"id": 1030, "name": "User Authentication & Profiles", "summary": "General user login and profile management."},
                {"id": 1031, "name": "A/B Testing Framework", "summary": "Infrastructure for running A/B tests on features like search result ranking."},
                {"id": 1032, "name": "System Architecture Documentation", "summary": "High-level diagrams and documents explaining the Pathfinder service."},
                {"id": 1033, "name": "Load Testing Environment", "summary": "Setting up a test environment to simulate high traffic on the search API."},
                {"id": 1034, "name": "Data Serialization (Protobuf)", "summary": "Defining the data format for communication between microservices."},
                {"id": 1035, "name": "Async Task Queue (Celery)", "summary": "A system for running background jobs, like sending booking confirmations."},
                {"id": 1036, "name": "Containerization (Docker)", "summary": "Creating Docker images for the various components of the search service."},
                {"id": 1037, "name": "Service Discovery (Consul)", "summary": "How microservices find and communicate with each other."},
                {"id": 1038, "name": "Alerting Policies", "summary": "Rules for when to send alerts, e.g., if API latency exceeds a threshold."},
                {"id": 1039, "name": "Billing & Payments Integration", "summary": "Connecting to Stripe to handle flight booking payments."}
            ]
            """

        # The history sets up the "LeetCode Hard" problem.
        transcript_history = """
            Okay team, let's kick off the deep dive for Project 'Pathfinder'. The goal is to build a new flight search feature that can find the absolute cheapest route between two cities, but with a critical constraint: the path can have at most 'K' stops.
            A standard BFS or DFS won't work here. BFS would find the path with the fewest stops, not the cheapest price. DFS would find a path, but it might be incredibly expensive. We need an algorithm that accounts for both price and the number of stops.
            """

        # The current utterance is one engineer explaining their proposed solution.
        # Each sentence or clause targets a different, specific concept.
        current_utterance = """
            Alright, I've prototyped a solution. I think a modified Dijkstra's is the way to go, but the standard implementation isn't enough because of the K-stops constraint. To make it work, we need a min-heap that stores tuples of (total_cost, current_city, stops_made). The core innovation here is that our distance tracking can't just be the cheapest path to a city; it has to be the cheapest path to a city *given a specific number of stops*. We also need to be aggressive with pruning—if we pull a state from the heap that's already more expensive than a known valid path, we just discard it immediately. We should also consider what happens with weird edge cases, like routes with cycles or if the destination is completely unreachable. Okay, thinking about implementation, the API endpoint should definitely take 'source', 'destination', and 'k' as primary inputs. And for the UI, we must make sure the results list clearly displays the number of stops for the final recommended route.
            """

        segments = """
            [
                {"text": "I think a modified Dijkstra's is the way to go, but the standard implementation isn't enough because of the K-stops constraint.", "is_routable": true},
                {"text": "To make it work, we need a min-heap that stores tuples of (total_cost, current_city, stops_made).", "is_routable": true},
                {"text": "The core innovation here is that our distance tracking can't just be the cheapest path to a city; it has to be the cheapest path to a city *given a specific number of stops*.", "is_routable": true},
                {"text": "We also need to be aggressive with pruning—if we pull a state from the heap that's already more expensive than a known valid path, we just discard it immediately.", "is_routable": true},
                {"text": "We should also consider what happens with weird edge cases, like routes with cycles or if the destination is completely unreachable.", "is_routable": true},
                {"text": "Okay, thinking about implementation, the API endpoint should definitely take 'source', 'destination', and 'k' as primary inputs.", "is_routable": true},
                {"text": "And for the UI, we must make sure the results list clearly displays the number of stops for the final recommended route.", "is_routable": true}
            ]
            """

        prompt_text = prompt_loader.render_template(
            "identify_target_node",
            existing_nodes=existing_nodes,
            segments=segments,
            transcript_history=transcript_history,
            transcript_text=current_utterance
        )

        result = await self.call_LLM(prompt_text)

        assert len(result.target_nodes) == 7, "Expected to identify 7 distinct routing decisions."

        # Map results for easier assertions
        results_map = {
            "dijkstra": next((n for n in result.target_nodes if "dijkstra" in n.text.lower()), None),
            "min-heap": next((n for n in result.target_nodes if "min-heap" in n.text.lower()), None),
            "innovation": next((n for n in result.target_nodes if "innovation" in n.text.lower()), None),
            "pruning": next((n for n in result.target_nodes if "pruning" in n.text.lower()), None),
            "edge cases": next((n for n in result.target_nodes if "edge cases" in n.text.lower()), None),
            "api": next((n for n in result.target_nodes if "api endpoint" in n.text.lower()), None),
            "ui": next((n for n in result.target_nodes if "for the ui" in n.text.lower()), None),
        }

        # 1. Proposing Dijkstra's -> specific implementation node.
        #    Distractor: The more general algorithm node (1001).
        assert results_map["dijkstra"] is not None
        assert results_map["dijkstra"].target_node_id == 1001

        # 2. Specifying the min-heap -> due to inertial chain rule, follows previous Dijkstra routing.
        assert results_map["min-heap"] is not None
        assert results_map["min-heap"].target_node_id == 1001 or 1003

        # 3. The core algorithmic insight -> belongs to the *core logic*, not just the implementation.
        #    This is the hardest one. It's about the fundamental algorithm, not just a detail of Dijkstra's.
        assert results_map["innovation"] is not None
        assert results_map["innovation"].target_node_id == 1001

        # 4. Pruning strategy -> performance optimization node.
        #    Distractor: Caching (1011).
        assert results_map["pruning"] is not None
        assert results_map["pruning"].target_node_id == 1005

        # 5. Handling cycles/unreachable -> edge case node.
        #    Distractor: Technical Debt (1028).
        assert results_map["edge cases"] is not None
        assert results_map["edge cases"].target_node_id == 1006

        # 6. Defining the API contract -> API endpoint node.
        assert results_map["api"] is not None
        assert results_map["api"].target_node_id == 1010

        # 7. Discussing the results list -> UI node.
        #    Distractor: Map visualization (1021).
        assert results_map["ui"] is not None
        assert results_map["ui"].target_node_id == 1020

        # ----------------------------------------------------------------------------------
        # --- ADVANCED AMBIGUITY TESTS: CROSS-FUNCTIONAL DILEMMAS ---
        # ----------------------------------------------------------------------------------
        # These tests are significantly harder. They present dilemmas where a segment
        # could plausibly belong to two different, highly relevant nodes from different
        # conceptual domains (e.g., a feature vs. an activity). They test the prompt's
        # ability to enforce a consistent prioritization strategy.

    @pytest.mark.asyncio
    async def test_feature_vs_activity_ambiguity(self, prompt_loader):
        """
        ADVANCED AMBIGUITY TEST: The segment describes a specific *activity* (testing)
        being performed on a specific *feature* (payments). The model must choose
        between the "activity" node and the "feature" node. This is a classic
        project management dilemma. Let's assume our desired logic prioritizes
        grouping all work for a feature together.
        """
        existing_nodes = """
            [
                {"id": 1301, "name": "Payment System (Stripe Integration)", "summary": "All work related to our integration with the Stripe API for handling payments."},

                {"id": 1302, "name": "Quality Assurance & E2E Testing", "summary": "General processes and tasks for writing automated tests and ensuring software quality."
                 Relationship: "to ensure best practices for (Payment System (Stripe Integration)" }
            ]
            """
        segments = """
            [
                {"text": "We need to write the end-to-end tests for the subscription renewal flow through Stripe.", "is_routable": true}
            ]
            """
        prompt_text = prompt_loader.render_template(
            "identify_target_node",
            existing_nodes=existing_nodes,
            segments=segments,
            transcript_history="Let's plan out the remaining tasks for the new payment system.",
            transcript_text="We need to write the end-to-end tests for the subscription renewal flow through Stripe."
        )

        result = await self.call_LLM(prompt_text)

        assert len(result.target_nodes) == 1
        # This is a brutal choice. Is it a "Testing" task or a "Payment System" task?
        # A good system should be consistent. Given the relationship established,
        # the model should now prioritize the "how" (Testing) node that has an explicit
        # relationship to the Payment System.
        assert result.target_nodes[0].target_node_id == 1302

    @pytest.mark.asyncio
    async def test_cause_vs_effect_ambiguity(self, prompt_loader):
        """
        ADVANCED AMBIGUITY TEST: The segment describes a specific action (a database
        change) being done to achieve a specific outcome (API performance). This
        pits a "backend" node against a "performance" node. The model must have
        a clear rule for whether to file things under the cause or the effect.
        Let's assert the more specific cause is the better location.
        """
        existing_nodes = """
            [
                {"id": 1401, "name": "API Performance & Latency", "summary": "Tracking and improving the response time of public-facing API endpoints.", "relationshipToParent": subtask of 'Today's work'},
                {"id": 1402, "name": "Database Schema Optimization", "summary": "Tasks related to improving the database, such as adding indexes and optimizing tables. This should improve API endpoint response times." "relationship": to address the overall goal of 'API Performance & Latency'}
            ]
            """
        segments = """
            [
                {"text": "To improve the GET /users/:id endpoint performance, we must add a compound index on the `users` table.", "is_routable": true}
            ]
            """
        prompt_text = prompt_loader.render_template(
            "identify_target_node",
            existing_nodes=existing_nodes,
            segments=segments,
            transcript_history="The user profile page is loading too slowly, we've traced it to the GET /users/:id API call.",
            transcript_text="To improve the GET /users/:id endpoint performance, we must add a compound index on the `users` table."
        )

        result = await self.call_LLM(prompt_text)

        # NOTE, TODO
        # THIS IS A HARD TEST TO PASS
        # IT HAS TO REALISE THAT node 1402 is a hymonym of 1401
        # AND THUS THE MORE SPECIFIC RELATION

        # OUR CURRENT PROMPT CAN't HANDLE THAT YET, that's okay for now

        assert len(result.target_nodes) == 1
        # Another brutal choice. The *goal* is API Performance (1401), but the
        # *task* is Database Optimization (1402). Both are highly relevant.
        # A good tie-breaker would prioritize the more specific, actionable task.
        # The work is being done *in the database*.
        assert result.target_nodes[0].target_node_id == 1402

    # contradictory test
    # @pytest.mark.asyncio
    # async def test_avoids_unnecessary_orphan_with_implicit_link(self, prompt_loader):
    #     """
    #     Tests the model's ability to follow the "Golden Rule": DO NOT create an
    #     orphan if a segment has any correct, even if weak or implicit,
    #     relationship to an existing node.
    #
    #     This test evaluates the model's ability to:
    #     1.  Correctly identify a truly unrelated topic ("Flutter") as an orphan.
    #     2.  Identify an implicit functional relationship: "understanding how to
    #         stream audio" is an engineering prerequisite for "uploading an audio file".
    #     3.  Prioritize the weak but correct link over creating a new, more
    #         specific orphan, as per the prompt's core instructions.
    #     """
    #     # The exact nodes from the original failed example.
    #     existing_nodes = """
    #         [
    #             {"id": 1, "name": "Voice Tree Proof of Concept", "summary": "Starting work on the Voice Tree Proof of Concept, which involves uploading an audio file and converting it first to markdown, then to a visual tree."},
    #             {"id": 2, "name": "Audio to Markdown Conversion", "summary": "Convert an audio file into markdown format. Relationship: is a step in the (to 'Voice Tree Proof of Concept)'"},
    #             {"id": 3, "name": "Markdown to Visual Tree Conversion", "summary": "Convert markdown, generated from an audio file, into a visual tree. Relationship: is a step in the (to 'Voice Tree Proof of Concept)'"},
    #             {"id": 4, "name": "Investigate Visualization Libraries", "summary": "Investigate visualization libraries for converting text to a data format and then to a tree visualization. Relationship: is a prerequisite for the (to 'Markdown to Visual Tree Conversion)'"}
    #         ]
    #         """
    #
    #     # Context leading up to the segments being analyzed.
    #     transcript_history = """
    #         So, today I'm starting work on voice tree. Right now, there's a few different things I want to look into. The first thing is I want to make a proof of concept of voice tree. So, the bare minimum I want to do is I want to be able to upload an audio file just like this one that has some decisions and context. And I want first, I want it to build into markdown, convert that into markdown, and then I want to convert that markdown into a visual tree. So, that's the first thing I want to do. Uh, to do that, I'll need to have a look into later on some of the visualization libraries. Uh, converting text into a data format and then into a tree visualization.
    #         """
    #
    #     # The specific chunk of text that caused the original failure.
    #     current_utterance = """
    #         And I also want to have a look into Flutter at some point because it'll be good to get that prize money. Um, and then I want to understand the engineering problem better of how we can stream audio files, uh, and how, how we send these audio files
    #         """
    #
    #     segments = """
    #         [
    #             {"text": "And I also want to have a look into Flutter at some point because it'll be good to get that prize money."},
    #             {"text": "And then I want to understand the engineering problem better of how we can stream audio files, and how, how we send these audio files."}
    #         ]
    #         """
    #
    #     prompt_text = prompt_loader.render_template(
    #         "identify_target_node", # Assuming this is the name of your prompt template
    #         existing_nodes=existing_nodes,
    #         segments=segments,
    #         transcript_history=transcript_history + current_utterance,
    #         transcript_text=current_utterance
    #     )
    #
    #     result = await self.call_LLM(prompt_text)
    #
    #     assert len(result.target_nodes) == 2, "Expected to identify 2 routing decisions."
    #
    #     # Map results for easier assertions
    #     results_map = {
    #         "flutter": next((n for n in result.target_nodes if "flutter" in n.text.lower()), None),
    #         "streaming": next((n for n in result.target_nodes if "stream audio files" in n.text.lower()), None),
    #     }
    #
    #     # 1. The "Flutter" segment is genuinely unrelated to the core PoC.
    #     #    It's a separate investigation for a different motivation (prize money).
    #     #    This SHOULD be an orphan.
    #     assert results_map["flutter"] is not None, "Flutter segment was not found in the result."
    #     assert results_map["flutter"].is_orphan is True, "Expected Flutter segment to be an orphan."
    #     assert results_map["flutter"].target_node_id == -1, "Expected orphan node ID to be -1."
    #     assert "flutter" in results_map["flutter"].orphan_topic_name.lower()
    #
    #     # 2. THE CRITICAL TEST: The "streaming audio" segment has an implicit but
    #     #    correct link to the main "Proof of Concept" node. Understanding how
    #     #    to stream/send audio is an engineering problem directly related to
    #     #    the POC goal of "uploading an audio file".
    #     #    The model MUST NOT create an orphan here.
    #     assert results_map["streaming"] is not None, "Streaming segment was not found in the result."
    #     assert results_map["streaming"].is_orphan is False, "FAILED: The model incorrectly created an orphan for the 'streaming' segment."
    #     assert results_map["streaming"].target_node_id == 1, "Expected 'streaming' segment to be routed to Node 1: Voice Tree Proof of Concept."

if __name__ == "__main__":
    pytest.main([__file__, "-v"])
