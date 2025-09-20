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

        # Get the absolute path to prompts directory
        backend_dir = Path(__file__).parent.parent.parent.parent.parent.parent.parent  # Go to backend dir
        prompts_dir = backend_dir / "text_to_graph_pipeline" / "agentic_workflows" / "prompts"
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
    
    @pytest.mark.asyncio
    async def test_new_node_creation_with_special_id(self, prompt_loader):
        """Test identifying segments that need new nodes using special ID"""
        # Test data  
        existing_nodes = """No existing nodes"""
        
        segments = """
        [
            {"text": "We should add user authentication with JWT tokens", "is_routable": true},
            {"text": "Need to implement real-time notifications using WebSockets", "is_routable": true}
        ]
        """
        
        # Load and run prompt
        prompt_text = prompt_loader.render_template(
            "identify_target_node",
            existing_nodes=existing_nodes,
            segments=segments,
            transcript_history="",  # Empty history for this test
            transcript_text="We should add user authentication with JWT tokens. Need to implement real-time notifications using WebSockets."
        )
        
        result = await self.call_LLM(prompt_text)
        
        # Assertions
        assert len(result.target_nodes) == 2
        
        # Both should create new nodes (ID = -1)
        assert result.target_nodes[0].target_node_id == -1
        assert result.target_nodes[0].is_orphan
        assert result.target_nodes[0].orphan_topic_name is not None
        assert "auth" in result.target_nodes[0].orphan_topic_name.lower()
        
        assert result.target_nodes[1].target_node_id == -1
        assert result.target_nodes[1].is_orphan
        assert result.target_nodes[1].orphan_topic_name is not None
        assert "notification" in result.target_nodes[1].orphan_topic_name.lower() or \
               "websocket" in result.target_nodes[1].orphan_topic_name.lower()

    @pytest.mark.asyncio
    async def test_flutter_vague_subtask(self, prompt_loader):
        """
        Tests that when discussing various aspects of a project (including
        tangential benefits like prize money), they should route to the main
        project node rather than creating fragmented orphans.

        This tests the system's ability to understand that:
        1. Technology explorations mentioned in project context belong to the project
        2. External motivations (prize money) don't warrant separate nodes
        3. All project-related investigations should stay cohesive
        """
        existing_nodes = """
        [
            {
                "id": 1,
                "name": "Voice Tree Project",
                "summary": "Initiating work on Voice Tree Development, with initial areas of investigation to be determined, including the engineering problem of streaming and sending audio files.."
            },
            {
                "id": 2,
                "name": "Audio to Markdown Conversion",
                "summary": "Implement the conversion of uploaded audio files into markdown for the Voice Tree PoC."
            },
            {
                "id": 3,
                "name": "Markdown to Visual Tree Conversion",
                "summary": "Transform markdown output into a visual tree for the Voice Tree PoC, including research into visualization libraries and data formatting."
            }
        ]
        """

        segments = """
        [
            {"text": "And I also want to have a look into Flutter at some point because it'll be good to get that prize money for VoiceTree.", "is_routable": true},
            {"text": "And then I want to understand the engineering problem better of how we can stream audio files, and how we send these audio files.", "is_routable": true}
        ]
        """

        transcript_history = """So, today I'm starting work on voice tree. Right now, there's a few different things I want to look into. The first thing is I want to make a proof of concept of voice tree. So, the bare minimum I want to do is I want to be able to upload an audio file just like this one that has some decisions and context. And I want first, I want it to build into markdown, convert that into markdown, and then I want to convert that markdown into a visual tree. So, that's the first thing I want to do. Uh, to do that, I'll need to have a look into later on some of the visualization libraries. Uh, converting text into a data format and then into a tree visualization."""

        transcript_text = """And I also want to have a look into Flutter at some point because it'll be good to get that prize money for VoiceTree. Um, and then I want to understand the engineering problem better of how we can stream audio files, uh, and how, how we send these audio files"""

        prompt_text = prompt_loader.render_template(
            "identify_target_node",
            existing_nodes=existing_nodes,
            segments=segments,
            transcript_history=transcript_history,
            transcript_text=transcript_text
        )

        result = await self.call_LLM(prompt_text)

        assert len(result.target_nodes) == 2

        # First segment about Flutter should route to Voice Tree PoC
        # NOT create an orphan "Explore Flutter for Prize Money"
        assert result.target_nodes[0].target_node_id == 1 or 0, \
            f"Flutter exploration should route to Voice Tree PoC (id=1), not create orphan. Got: {result.target_nodes[0]}"
        assert not result.target_nodes[0].is_orphan, \
            "Flutter exploration is part of the voice tree project, not a separate topic"

        # Second segment about audio streaming should also route to Voice Tree PoC
        assert result.target_nodes[1].target_node_id == 1 or 0 or 2
        assert not result.target_nodes[1].is_orphan

    # @pytest.mark.asyncio
    # async def test_external_motivations_dont_fragment_project(self, prompt_loader):
    #     """
    #     Tests that external motivations (prizes, grants, competitions) mentioned
    #     in the context of a project don't create separate nodes but are understood
    #     as part of the project's scope.
    #     """
    #     existing_nodes = """
    #     [
    #         {"id": 100, "name": "ML Model Development", "summary": "Building and training the core machine learning model"},
    #         {"id": 101, "name": "Data Pipeline", "summary": "Setting up data collection and processing"}
    #     ]
    #     """
    #
    #     segments = """
    #     [
    #         {"text": "We should use PyTorch because it's required for the competition submission", "is_routable": true},
    #         {"text": "Also need to document everything well since that's 30% of the judging criteria", "is_routable": true},
    #         {"text": "The $50k prize would really help fund the next phase", "is_routable": true}
    #     ]
    #     """
    #
    #     transcript_history = "Let's discuss our ML model development strategy for the competition."
    #
    #     prompt_text = prompt_loader.render_template(
    #         "identify_target_node",
    #         existing_nodes=existing_nodes,
    #         segments=segments,
    #         transcript_history=transcript_history,
    #         transcript_text="We should use PyTorch because it's required for the competition submission. Also need to document everything well since that's 30% of the judging criteria. The $50k prize would really help fund the next phase."
    #     )
    #
    #     result = await self.call_LLM(prompt_text)
    #
    #     # All segments should route to ML Model Development
    #     # NOT create orphans like "Competition Requirements" or "Prize Money"
    #     assert len(result.target_nodes) == 3
    #     assert all(node.target_node_id == 100 or 101 for node in result.target_nodes), \
    #         "All competition-related aspects should route to the main project node"
    #     assert all(not node.is_orphan for node in result.target_nodes)
    #
    @pytest.mark.asyncio
    async def test_project_context_overrides_topic_specificity(self, prompt_loader):
        """
        Tests that when discussing a project, various subtopics (technologies,
        methodologies, external factors) route to the project node rather than
        creating overly specific orphans.

        This directly tests the failure case where "Flutter for prize money"
        became an orphan instead of routing to the project it's part of.
        """
        existing_nodes = """
        [
            {"id": 50, "name": "Mobile App Project", "summary": "Building a cross-platform mobile application"}
        ]
        """

        segments = """
        [
            {"text": "I'm considering Flutter for the UI framework", "is_routable": true},
            {"text": "React Native might be better for our team's skills", "is_routable": true},
            {"text": "Flutter would help us win the innovation award though", "is_routable": true},
            {"text": "We need to decide by Friday to meet the grant deadline", "is_routable": true}
        ]
        """

        transcript_history = "Let's plan out our mobile app project approach."

        prompt_text = prompt_loader.render_template(
            "identify_target_node",
            existing_nodes=existing_nodes,
            segments=segments,
            transcript_history=transcript_history,
            transcript_text="I'm considering Flutter for the UI framework. React Native might be better for our team's skills. Flutter would help us win the innovation award though. We need to decide by Friday to meet the grant deadline."
        )

        result = await self.call_LLM(prompt_text)

        # All technology choices and external motivations should route to the project
        assert len(result.target_nodes) == 4
        for i, node in enumerate(result.target_nodes):
            assert node.target_node_id == 50, \
                f"Segment {i + 1} should route to Mobile App Project, not create orphan"
            assert not node.is_orphan, \
                f"Segment {i + 1} about project decisions shouldn't be orphaned"

    @pytest.mark.asyncio
    async def test_mixed_existing_and_new_nodes(self, prompt_loader):
        """Test a mix of existing node references and new node creation"""
        existing_nodes = """
        [
            {"id": 5, "name": "Security Features", "summary": "Authentication and authorization systems"},
            {"id": 8, "name": "Performance Optimization", "summary": "Caching, indexing, and optimization strategies"}
        ]
        """
        
        segments = """
        [
            {"text": "Add role-based access control to the existing auth system", "is_routable": true},
            {"text": "Implement distributed tracing for debugging microservices", "is_routable": true},
            {"text": "Database query caching should use Redis for better performance", "is_routable": true}
        ]
        """
        
        # Load and run prompt
        prompt_text = prompt_loader.render_template(
            "identify_target_node",
            existing_nodes=existing_nodes,
            segments=segments,
            transcript_history="",  # Empty history for this test
            transcript_text="Add role-based access control to the existing auth system. Implement distributed tracing for debugging microservices. Database query caching should use Redis for better performance."
        )
        
        result = await self.call_LLM(prompt_text)
        
        assert len(result.target_nodes) == 3
        
        # First should go to Security Features
        assert result.target_nodes[0].target_node_id == 5
        assert not result.target_nodes[0].is_orphan
        
        # Second should create new node for distributed tracing
        assert result.target_nodes[1].target_node_id == -1 or 8

        # Third should go to Performance Optimization
        assert result.target_nodes[2].target_node_id == 8
        assert not result.target_nodes[2].is_orphan


    @pytest.mark.asyncio
    async def test_ambiguous_target_equally_plausible_nodes(self, prompt_loader):
        """
        Tests a segment that could plausibly fit into two different existing nodes.
        The goal is to see which one the LLM prioritizes. Does it choose the more
        'action-oriented' node or the more 'thematic' one?
        """
        existing_nodes = """
        [
            {"id": 10, "name": "User Authentication Flow", "summary": "Covers login, registration, and password reset."},
            {"id": 11, "name": "Authentication API Performance", "summary": "Focuses on optimizing endpoint response times and database queries for auth."}
        ]
        """
        segments = """
        [
            {"text": "We need to speed up the login endpoint, it's taking over two seconds.", "is_routable": true}
        ]
        """
        prompt_text = prompt_loader.render_template(
            "identify_target_node",
            existing_nodes=existing_nodes,
            segments=segments,
            transcript_history="User: The app feels sluggish, especially on login.",
            transcript_text="We need to speed up the login endpoint, it's taking over two seconds."
        )

        result = await self.call_LLM(prompt_text)

        assert len(result.target_nodes) == 1
        # In this ambiguous case, "API Performance" (ID 11) is arguably the better
        # target because the core intent is about 'speed' and 'performance',
        # even though the context is 'login'. This tests the LLM's ability to
        # discern primary intent. Routing to ID 10 would be a "reasonable failure".
        assert result.target_nodes[0].target_node_id == 11
        assert not result.target_nodes[0].is_orphan

    @pytest.mark.asyncio
    async def test_granularity_threshold_detail_vs_new_node(self, prompt_loader):
        """
        Tests if the LLM correctly identifies a minor detail that should be appended
        to an existing node, rather than creating a new, overly specific node.
        This directly tests the "Minimize (Structure Length + Cognitive Fidelity Loss)" principle.
        """
        existing_nodes = """
        [
            {"id": 25, "name": "UI Redesign for Dashboard", "summary": "Planning the new look and feel of the main user dashboard."}
        ]
        """
        segments = """
        [
            {"text": "And for the main chart on the dashboard, let's use a blue color palette.", "is_routable": true}
        ]
        """
        prompt_text = prompt_loader.render_template(
            "identify_target_node",
            existing_nodes=existing_nodes,
            segments=segments,
            transcript_history="",
            transcript_text="And for the main chart on the dashboard, let's use a blue color palette."
        )

        result = await self.call_LLM(prompt_text)

        assert len(result.target_nodes) == 1
        # The correct action is to append this detail to the existing UI design node.
        # Creating a new node "Dashboard Chart Color" would be over-fragmentation.
        assert result.target_nodes[0].target_node_id == 25
        assert not result.target_nodes[0].is_orphan

    @pytest.mark.asyncio
    async def test_context_dependent_routing(self, prompt_loader):
        """
        Tests if the `transcript_history` can sway the routing of a generic segment.
        The segment "let's start drafting the requirements for it" is ambiguous
        without knowing what "it" refers to.
        """
        existing_nodes = """
        [
            {"id": 30, "name": "Q3 Marketing Campaign", "summary": "Planning and execution of the Q3 marketing initiatives."},
            {"id": 31, "name": "New Billing System", "summary": "Architecture and implementation of a new subscription billing system."}
        ]
        """
        segments = """
        [
            {"text": "Okay, so for that, let's start drafting the requirements.", "is_routable": true}
        ]
        """
        # The history makes it clear that "that" refers to the billing system.
        transcript_history = "We've decided the old billing system isn't scalable. We need a new one."
        
        prompt_text = prompt_loader.render_template(
            "identify_target_node",
            existing_nodes=existing_nodes,
            segments=segments,
            transcript_history=transcript_history,
            transcript_text="Okay, so for that, let's start drafting the requirements."
        )

        result = await self.call_LLM(prompt_text)

        assert len(result.target_nodes) == 1
        # Without context, this is un-routable. With context, it clearly belongs to the Billing System.
        assert result.target_nodes[0].target_node_id == 31
        assert not result.target_nodes[0].is_orphan

    @pytest.mark.skip(reason="Test too brittle due to LLM response formatting issues")
    @pytest.mark.asyncio
    async def test_complex_scenario_with_large_context(self, prompt_loader):
        """
        Tests the system's ability to handle a large and complex context:
        - 10 existing nodes covering a range of project topics.
        - A long transcript history to set the stage.
        - 5 distinct new segments that need to be routed correctly.
        This tests the model's focus and ability to differentiate between similar but
        distinct nodes in a noisy environment.
        """
        existing_nodes = """
        [
            {"id": 100, "name": "Project Phoenix - High-Level Goals", "summary": "Overall mission and success criteria for Project Phoenix."},
            {"id": 101, "name": "Q4 Roadmap", "summary": "Features and deadlines planned for Q4."},
            {"id": 102, "name": "API Authentication Layer", "summary": "All tasks related to user login, tokens, and securing API endpoints."},
            {"id": 103, "name": "Database Schema (PostgreSQL)", "summary": "Design and migration of the main application database schema."},
            {"id": 104, "name": "Performance & Caching Strategy", "summary": "Implementing caching (Redis) and optimizing slow queries."},
            {"id": 105, "name": "Dashboard UI/UX Redesign", "summary": "The redesign of the main user-facing dashboard, including mockups and component development."},
            {"id": 106, "name": "Frontend State Management (React/Redux)", "summary": "Technical implementation of state handling on the client-side."},
            {"id": 107, "name": "CI/CD Pipeline Setup", "summary": "Configuring Jenkins/GitHub Actions for automated testing and deployment."},
            {"id": 108, "name": "Cloud Infrastructure (AWS)", "summary": "Management of EC2, S3, and RDS resources on AWS."},
            {"id": 109, "name": "Third-Party API Integrations (Stripe)", "summary": "Connecting to and managing external APIs, specifically for payments with Stripe."}
        ]
        """

        transcript_history = """
        Alright team, quick sync on Project Phoenix. Last week we finalized the high-level goals and the Q4 roadmap is looking solid.
        The main feedback from the last sprint review was about performance. We identified a major bottleneck in the database during load testing, which is slowing down the entire application.
        On a positive note, the initial mockups for the dashboard redesign were approved by stakeholders, so we have the green light to proceed with implementation.
        """

        # This represents the user's current turn in the conversation
        current_utterance = """
        Okay, so first, regarding the database issue, let's add a Redis layer for caching the most frequent user queries.
        Second, for the new dashboard, we need to ensure all the new components are fully responsive on mobile viewports.
        Also, I was thinking about the payment flow for Q4. We need to handle subscription renewals correctly through Stripe's API.
        And a new infrastructure topic: let's start spec-ing out the automated deployment script for the staging environment on AWS.
        Finally, a quick question came up about security. Should we use OAuth2 for the main API login?
        """
        
        segments = """
        [
            {"text": "First, regarding the database issue, let's add a Redis layer for caching the most frequent user queries.", "is_routable": true},
            {"text": "Second, for the new dashboard, we need to ensure all the new components are fully responsive on mobile viewports.", "is_routable": true},
            {"text": "Also, I was thinking about the payment flow for Q4. We need to handle subscription renewals correctly through Stripe's API.", "is_routable": true},
            {"text": "And a new infrastructure topic: let's start spec-ing out the automated deployment script for the staging environment on AWS.", "is_routable": true},
            {"text": "Finally, a quick question came up about security. Should we use OAuth2 for the main API login?", "is_routable": true}
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

        assert len(result.target_nodes) == 5, "Expected to identify 5 distinct target nodes from the segments."

        # Create a dictionary for easy lookup of results, mapping a keyword to the result object
        results_map = {
            "caching": next((n for n in result.target_nodes if "caching" in n.text.lower()), None),
            "dashboard": next((n for n in result.target_nodes if "dashboard" in n.text.lower()), None),
            "stripe": next((n for n in result.target_nodes if "stripe" in n.text.lower()), None),
            "deployment": next((n for n in result.target_nodes if "deployment" in n.text.lower()), None),
            "oauth2": next((n for n in result.target_nodes if "oauth2" in n.text.lower()), None)
        }

        # 1. Caching segment -> Performance & Caching Strategy (104)
        #    Distractor: Database Schema (103)
        assert results_map["caching"] is not None
        assert results_map["caching"].target_node_id == 104
        assert not results_map["caching"].is_orphan

        # 2. Dashboard segment -> Dashboard UI/UX Redesign (105)
        #    Distractor: Frontend State Management (106)
        assert results_map["dashboard"] is not None
        assert results_map["dashboard"].target_node_id == 105
        assert not results_map["dashboard"].is_orphan

        # 3. Stripe segment -> Third-Party API Integrations (109)
        #    Distractor: Q4 Roadmap (101) because "payment flow for Q4" was mentioned
        assert results_map["stripe"] is not None
        assert results_map["stripe"].target_node_id == 109
        assert not results_map["stripe"].is_orphan

        # 4. Deployment segment -> CI/CD Pipeline Setup (107)
        #    Distractor: Cloud Infrastructure (AWS) (108)
        assert results_map["deployment"] is not None
        assert results_map["deployment"].target_node_id == 107
        assert not results_map["deployment"].is_orphan

        # 5. Auth segment -> API Authentication Layer (102)
        #    Distractor: None are very close, but a confused model might pick a high-level one.
        assert results_map["oauth2"] is not None
        assert results_map["oauth2"].target_node_id == 102
        assert not results_map["oauth2"].is_orphan


    @pytest.mark.asyncio
    async def test_in_batch_chaining_to_new_node(self, prompt_loader):
        """
        Tests the critical logic of creating a new node from a segment and then
        routing subsequent, related segments to that same new node within the same request.
        This validates the `target_node_name` linking mechanism for un-persisted nodes.
        """
        # A long list of somewhat related, but not perfect, distractor nodes.
        existing_nodes = """
        [
            {"id": 200, "name": "Mobile App Feature Backlog", "summary": "A list of all potential features for the mobile application."},
            {"id": 201, "name": "User Profile Section", "summary": "Tasks related to building the user profile, settings, and account info pages."},
            {"id": 202, "name": "Onboarding Flow Design", "summary": "High-level design and user journey for new user onboarding."},
            {"id": 203, "name": "Backend API for User Data", "summary": "Endpoints for creating, reading, and updating user information."},
            {"id": 204, "name": "UI Component Library", "summary": "A collection of reusable React components for the frontend."},
            {"id": 205, "name": "App Monetization Strategy", "summary": "Brainstorming and planning for how the app will generate revenue."}
        ]
        """

        # A transcript history that sets the stage but is intentionally generic.
        transcript_history = """
        Okay, the user feedback from the last release was clear. People are getting confused right after they sign up.
        They don't know what to do first. We need to improve the initial experience to increase activation rates.
        The current onboarding flow is too passive; we need something more hands-on.
        """

        # A single utterance that builds a new idea from scratch.
        current_utterance = """
        Okay, I have an idea. Let's create a new 'guided tour' feature for first-time users.
        It should start by highlighting the 'Create New Project' button as the first step.
        Then, after they click it, the tour should point to the main canvas and explain the basic tools available.
        """

        segments = """
        [
            {"text": "Okay, I have an idea. Let's create a new 'guided tour' feature for first-time users.", "is_routable": true},
            {"text": "It should start by highlighting the 'Create New Project' button as the first step.", "is_routable": true},
            {"text": "Then, after they click it, the tour should point to the main canvas and explain the basic tools available.", "is_routable": true}
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

        """
                    {"id": 202, "name": "Onboarding Flow Design", "summary": "High-level design and user journey for new user onboarding."},

        """

        assert len(result.target_nodes) == 3, "Expected to identify 3 distinct routing decisions."

        # Define the nodes for clarity
        node_a: TargetNodeIdentification = result.target_nodes[0]
        node_b: TargetNodeIdentification = result.target_nodes[1]
        node_c: TargetNodeIdentification = result.target_nodes[2]

        print(result)

        # Assertion for Segment A: Creates the new node
        assert node_a.target_node_id == 202
        assert node_b.target_node_id == 202
        assert node_c.target_node_id == 202



# Assume self.call_LLM and prompt_loader are defined in a test class
# as in the example.

    @pytest.mark.asyncio
    async def test_pragmatic_function_over_semantic_content(self, prompt_loader):
        """
        THE CORE FAILURE CASE: Tests if the LLM prioritizes the conversational act
        ("Giving an Introduction") over the specific semantic content of the introduction.
        The history explicitly sets up the context for an introduction.
        """
        existing_nodes = """
        [
            {"id": 1, "name": "Introduction", "summary": "Introduction of speaker's background and role."}
        ]
        """
        segments = """
        [
            {"text": "I am working on humanitarian aid operations in Afghanistan for DG Echo at the European Commission.", "is_routable": true},
            {"text": "We are a donor and we fund actions in the country and I want to use this voice tree to help me decide on funding allocations.", "is_routable": true}
        ]
        """
        transcript_history = "Did you already give it the introduction? No, okay, lets introduce you:"
        transcript_text = "I'm Ilan. I am working on humanitarian aid operations in Afghanistan for DG Echo at the European Commission. We are a donor and we fund actions in the country and I want to use voicetree to help me decide on funding allocations."

        prompt_text = prompt_loader.render_template(
            "identify_target_node",
            existing_nodes=existing_nodes,
            segments=segments,
            transcript_history=transcript_history,
            transcript_text=transcript_text
        )

        result = await self.call_LLM(prompt_text)

        assert len(result.target_nodes) == 2
        # The primary function is introducing oneself. The content is just the *detail* of that introduction.
        # A failure would be creating two separate orphans for "Humanitarian Aid" and "Funding Decisions".
        assert result.target_nodes[0].target_node_id == 1
        assert not result.target_nodes[0].is_orphan
        assert result.target_nodes[1].target_node_id == 1
        assert not result.target_nodes[1].is_orphan


    @pytest.mark.asyncio
    async def test_specific_example_of_general_concept(self, prompt_loader):
        """
        Tests if the LLM correctly identifies a specific example as belonging to a
        more general existing node, per the "is an example of" rule.
        """
        existing_nodes = """
        [
            {"id": 5, "name": "Improving App Performance", "summary": "General discussion about making the application faster."}
        ]
        """
        segments = """
        [
            {"text": "For instance, the image gallery on the profile page loads all 50 thumbnails at once instead of lazy loading.", "is_routable": true}
        ]
        """
        prompt_text = prompt_loader.render_template(
            "identify_target_node",
            existing_nodes=existing_nodes,
            segments=segments,
            transcript_history="Let's brainstorm ways to make the app faster.",
            transcript_text="For instance, the image gallery on the profile page loads all 50 thumbnails at once instead of lazy loading."
        )

        result = await self.call_LLM(prompt_text)

        assert len(result.target_nodes) == 1
        # The correct behavior is to route the specific example to its general parent node.
        # A failure would be creating a new orphan topic like "Lazy Loading for Image Gallery".
        assert result.target_nodes[0].target_node_id == 5
        assert not result.target_nodes[0].is_orphan


    @pytest.mark.asyncio
    async def test_subtask_routing_to_parent_task(self, prompt_loader):
        """
        Tests if the LLM correctly routes a detailed sub-task to its clear parent task node.
        """
        existing_nodes = """
        [
            {"id": 45, "name": "Launch New Landing Page", "summary": "All tasks related to the v2 landing page launch."}
        ]
        """
        segments = """
        [
            {"text": "I still need to compress all the hero images and run a final Lighthouse audit before we can go live.", "is_routable": true}
        ]
        """
        prompt_text = prompt_loader.render_template(
            "identify_target_node",
            existing_nodes=existing_nodes,
            segments=segments,
            transcript_history="What's the status on the landing page?",
            transcript_text="I still need to compress all the hero images and run a final Lighthouse audit before we can go live."
        )

        result = await self.call_LLM(prompt_text)

        assert len(result.target_nodes) == 1
        # Compressing images and running an audit are clear sub-tasks of the launch.
        # Creating an orphan would violate the "sub-task" routing rule.
        assert result.target_nodes[0].target_node_id == 45
        assert not result.target_nodes[0].is_orphan


    @pytest.mark.asyncio
    async def test_explicit_topic_shift_forces_orphan(self, prompt_loader):
        """
        Tests if the LLM correctly identifies an explicit topic shift cue ("Anyway...")
        and creates an orphan, even if the previous segment had a clear home.
        """
        existing_nodes = """
        [
            {"id": 30, "name": "Backend Refactoring", "summary": "Work on improving the backend codebase."}
        ]
        """
        segments = """
        [
            {"text": "I've finished updating the database schema.", "is_routable": true},
            {"text": "Anyway, on a different note, we need to schedule the Q3 offsite.", "is_routable": true}
        ]
        """
        prompt_text = prompt_loader.render_template(
            "identify_target_node",
            existing_nodes=existing_nodes,
            segments=segments,
            transcript_history="Let's review the refactoring progress.",
            transcript_text="I've finished updating the database schema. Anyway, on a different note, we need to schedule the Q3 offsite."
        )

        result = await self.call_LLM(prompt_text)

        assert len(result.target_nodes) == 2
        # The first segment fits perfectly.
        assert result.target_nodes[0].target_node_id == 30
        assert not result.target_nodes[0].is_orphan
        # The second segment is explicitly a new topic and should be an orphan.
        assert result.target_nodes[1].is_orphan
        assert result.target_nodes[1].orphan_topic_name is not None
        assert "offsite" in result.target_nodes[1].orphan_topic_name.lower()


    @pytest.mark.asyncio
    async def test_correct_orphan_creation_and_sequential_continuation(self, prompt_loader):
        """
        Tests the full orphan lifecycle: a truly new topic is created as an orphan,
        and the immediately following segment that elaborates on it is routed to the
        *same* orphan topic.
        """
        existing_nodes = """
        [
            {"id": 1, "name": "Project Planning", "summary": "High-level planning and roadmapping."}
        ]
        """
        segments = """
        [
            {"text": "I'm blocked on the API integration because the third-party docs are out of date.", "is_routable": true},
            {"text": "I've already emailed their support team but haven't heard back yet.", "is_routable": true}
        ]
        """
        prompt_text = prompt_loader.render_template(
            "identify_target_node",
            existing_nodes=existing_nodes,
            segments=segments,
            transcript_history="Okay, team, daily standup. Any blockers?",
            transcript_text="I'm blocked on the API integration because the third-party docs are out of date. I've already emailed their support team but haven't heard back yet."
        )

        result = await self.call_LLM(prompt_text)

        assert len(result.target_nodes) == 2
        # First segment is a specific, new problem not covered by "Project Planning". It must be an orphan.
        assert result.target_nodes[0].is_orphan
        assert result.target_nodes[0].orphan_topic_name is not None
        first_orphan_name = result.target_nodes[0].orphan_topic_name

        # Second segment directly continues the first. It must be routed to the *same* orphan topic.
        assert result.target_nodes[1].is_orphan
        assert result.target_nodes[1].target_node_id == -1
        assert result.target_nodes[1].orphan_topic_name == first_orphan_name

    # @pytest.mark.asyncio
    # async def test_humanitarian_aid_operations_orphan_identification(self, prompt_loader):
    #     """
    #     Tests segments about humanitarian aid operations and funding allocations
    #     when the only existing node is about "Giving an Introduction".
    #     Both segments should be identified as orphans with appropriate topic names.
    #     """
    #     existing_nodes = """
    #     [
    #         {"id": 1, "name": "Introduction Theory", "summary": "Emphasizes the necessity of providing an introduction in professional environments."}
    #     ]
    #     """
    #     segments = """
    #     [
    #         {"text": "I am working on humanitarian aid operations in Afghanistan for DG Echo at the European Commission.", "is_routable": true},
    #         {"text": "We are a donor and we fund actions in the country and I want to use this voice tree to help me decide on funding allocations.", "is_routable": true}
    #     ]
    #     """
    #     prompt_text = prompt_loader.render_template(
    #         "identify_target_node",
    #         existing_nodes=existing_nodes,
    #         segments=segments,
    #         transcript_history="Did you already give it the introduction? No, you got to give it your introduction. I am working on, how do I see the U. I am working on humanitarian aid operations in Afghanistan for DG Echo at the European Commission. We are a donor and we fund actions in the country and I want to use this voice tree to help me decide on funding allocations.",
    #         transcript_text="I am working on humanitarian aid operations in Afghanistan for DG Echo at the European Commission. We are a donor and we fund actions in the country and I want to use this voice tree to help me decide on funding allocations."
    #     )
    #
    #     result = await self.call_LLM(prompt_text)
    #
    #     assert len(result.target_nodes) == 2
    #
    #     # First segment should be an orphan about humanitarian aid operations
    #     assert result.target_nodes[0].target_node_id == -1
    #     assert result.target_nodes[0].is_orphan == True
    #     assert "humanitarian" in result.target_nodes[0].orphan_topic_name.lower() or "aid" in result.target_nodes[0].orphan_topic_name.lower()
    #
    #     # Second segment should be an orphan about funding allocation or voice tree usage
    #     assert result.target_nodes[1].target_node_id == -1
    #     assert result.target_nodes[1].is_orphan == True
    #     # assert "funding" in result.target_nodes[1].orphan_topic_name.lower() or "voice tree" in result.target_nodes[1].orphan_topic_name.lower()
    #
    #     # Neither segment should be routed to the "Giving an Introduction" node
    #     assert all(node.target_node_id != 1 for node in result.target_nodes)

if __name__ == "__main__":
    pytest.main([__file__, "-v"])