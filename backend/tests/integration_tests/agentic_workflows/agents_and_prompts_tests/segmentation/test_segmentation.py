"""
Live LLM test for the segmentation prompt.

Tests we want to do:
- It correctly splits distinct abstractions, even if they are on the same topic
- It correctly splits an observation / piece of evidence 

Ues for example this (admittedly poorly transcribed) input:

transcript = All right, so we can talk about some of the benefits that you would get from VoiceTree, we would have to talk quite quickly. clearly and a bit louder than usual just because the voice to text engines a bit shit but you were saying that it might be helpful for therapy yes exactly therapy it would be a very good idea cool so we can now open the actual output that we're getting from voicetree and start to see the graph that it's generating. Great. I want to see that graph. But please tell me more about the types of benefits you can imagine. Well, what I think VoiceTree could... I think voice 2 would be pretty useful for therapy because what I like with talking to large language models like ChatGPT is that you can just say your stream of consciousness about whatever problem you're dealing with and it will then structure your thoughts after you speak at it for about 10 minutes. yeah alright well in that case let's


Ensure we end up with atleast 5 segments. The ideal segments would be:

transcript = 

1: All right, so we can talk about some of the benefits that you would get from VoiceTree, 

2: we would have to talk quite quickly. clearly and a bit louder than usual just because the voice to text engines a bit shit

3: but you were saying that it might be helpful for therapy yes exactly therapy it would be a very good idea

4: cool so we can now open the actual output that we're getting from voicetree and start to see the graph that it's generating. 

5: Great. I want to see that graph.

6. But please tell me more about the types of benefits you can imagine. 

7. Well, what I think VoiceTree could... I think voice 2 would be pretty useful for therapy because what I like with talking to large language models like ChatGPT is that you can just say your stream of consciousness about whatever problem you're dealing with and it will then structure your thoughts after you speak at it for about 10 minutes.

8. yeah alright well in that case let's = UNFINISHED


THis test should check:

- atleast 4 segments
- one unfinished segment.raw_text should contain "yeah alright well in that case let's"


"""

import pytest

from backend.text_to_graph_pipeline.agentic_workflows.core.llm_integration import \
    call_llm_structured
from backend.text_to_graph_pipeline.agentic_workflows.core.prompt_engine import \
    PromptLoader
from backend.text_to_graph_pipeline.agentic_workflows.models import (
    SegmentationResponse, TargetNodeResponse)


class TestIdentifyTargetNodeWithIDs:
    """Test the improved identify_target_node prompt that returns node IDs"""
    
    @pytest.fixture 
    def prompt_loader(self):
        """Get prompt loader instance"""
        from pathlib import Path

        # Get the absolute path to prompts directory
        backend_dir = Path(__file__).parent.parent.parent.parent.parent.parent  # Go to backend dir
        prompts_dir = backend_dir / "text_to_graph_pipeline" / "agentic_workflows" / "prompts"
        return PromptLoader(str(prompts_dir.absolute()))
    
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
        transcript_text="All right, so we can talk about some of the benefits that you would get from VoiceTree, we would have to talk quite quickly. clearly and a bit louder than usual just because the voice to text engines a bit shit but you were saying that it might be helpful for therapy yes exactly therapy it would be a very good idea cool so we can now open the actual output that we're getting from voicetree and start to see the graph that it's generating. Great. I want to see that graph. But please tell me more about the types of benefits you can imagine. Well, what I think VoiceTree could... I think voice 2 would be pretty useful for therapy because what I like with talking to large language models like ChatGPT is that you can just say your stream of consciousness about whatever problem you're dealing with and it will then structure your thoughts after you speak at it for about 10 minutes. yeah alright well in that case let's"
     
        # Load and run prompt
        prompt_text = prompt_loader.render_template(
            "segmentation",
            existing_nodes=existing_nodes,
            segments=[],
            transcript_history="",  # Empty history for this test
            transcript_text=transcript_text
        )


        # todo, address this case:
        """
        >       assert len(incomplete_segments) == 1
E       assert 2 == 1
E        +  where 2 = len([SegmentModel(reasoning='This segment begins to elaborate on the imagined benefits, drawing a parallel to using large language models like ChatGPT for structuring thoughts, but is cut off mid-sentence.', edited_text="Well, what I think VoiceTree could... I think voice 2 would be pretty useful for therapy because what I like with talking to large language models like ChatGPT is that you can just say your stream of consciousness about whatever problem you're dealing with and it will then structure your thoughts after you speak at it for about 10 minutes.", raw_text="Well, what I think VoiceTree could... I think voice 2 would be pretty useful for therapy because what I like with talking to large language models like ChatGPT is that you can just say your stream of consciousness about whatever problem you're dealing with and it will then structure your thoughts after you speak at it for about 10 minutes.", is_routable=False), SegmentModel(reasoning='This is an affirmative response that appears to be cut off, possibly acknowledging the previous statement or agreeing to proceed.', edited_text="Yeah, alright. Well, in that case, let's", raw_text="yeah alright well in that case let's", is_routable=False)])
        """
        
        result = await call_llm_structured(
            prompt_text,
            stage_type="segmentation",
            output_schema=SegmentationResponse
        )
        print(result)

        incomplete_segments = []

        raw_text_acc = ""
        for segment in result.segments:
            raw_text_acc += segment.raw_text + " "
            print(segment)
            if not segment.is_routable:
                incomplete_segments.append(segment)
        # Assertions
        assert len(result.segments) >= 4
        assert len(incomplete_segments) == 1
        assert incomplete_segments[-1].raw_text == "yeah alright well in that case let's"
        assert raw_text_acc.strip() == transcript_text


    async def test_related_but_distinct_concepts_in_one_segment(self, prompt_loader):
        """
        Tests a single user utterance that contains two distinct, new "work items".
        The LLM should create two new nodes, not lump them together. This tests
        the identification of 'work item' boundaries.
        """
        existing_nodes = """
        [
            {"id": 40, "name": "Backend Refactor", "summary": "General plan for improving the backend codebase."}
        ]
        """
        segments = """
        [
            {"text": "We need to set up a new CI/CD pipeline, and also we should probably write a formal policy for code reviews.", "is_routable": true}
        ]
        """
        prompt_text = prompt_loader.render_template(
            "segmentation",
            existing_nodes=existing_nodes,
            segments=[],
            transcript_history="",
            transcript_text="We need to set up a new CI/CD pipeline, and also we should probably write a formal policy for code reviews."
        )

        # NOTE: This test assumes your segmentation logic might pass a single, complex
        # sentence as one segment. If your segmentation is more aggressive, this
        # would naturally become two segments. This test is robust for either case.
        # The `identify_target_node` prompt should ideally be able to handle it.
        result = await call_llm_structured(
            prompt_text,
            stage_type="segmentation",
            output_schema=SegmentationResponse
        )

        assert len(result.segments) == 2
        
        assert "ci" in result.segments[0].edited_text.lower()
        assert "review" in result.segments[1].edited_text.lower()

    
if __name__ == "__main__":
    pytest.main([__file__, "-v"])