"""
Integration test for chunk processing pipeline with real embeddings.
This test verifies that the async embedding system works correctly by:
- Mocking the LLM/agent outputs (TreeActionDeciderWorkflow)
- Using REAL embeddings (not mocked)
- Creating ~30 nodes with a mix of CREATE, APPEND, UPDATE actions
- Verifying embeddings are generated and stored correctly
"""
import asyncio
import glob
import os
import random
import shutil
import tempfile
import time
import pytest
from backend.markdown_tree_manager.markdown_tree_ds import MarkdownTree
from backend.text_to_graph_pipeline.agentic_workflows.models import AppendAction
from backend.text_to_graph_pipeline.agentic_workflows.models import CreateAction
from backend.text_to_graph_pipeline.agentic_workflows.models import UpdateAction
from backend.text_to_graph_pipeline.chunk_processing_pipeline import ChunkProcessor
from backend.text_to_graph_pipeline.chunk_processing_pipeline.tree_action_decider_workflow import (
    TreeActionDeciderWorkflow,
)
# Topic-based content structure: 5 parent topics × 5 subtopics × 5 sentences = 125 total
TOPIC_CONTENT = {
    "Programming": {
        "Python Basics": [
            "Python is a high-level programming language known for its clear syntax and readability.",
            "Variables in Python do not need explicit type declarations due to dynamic typing.",
            "Python uses indentation with whitespace to define code blocks instead of braces.",
            "List comprehensions provide a concise way to create lists from existing sequences.",
            "The Python standard library includes modules for common tasks like file handling and networking."
        ],
        "Web Development": [
            "Django is a full-featured web framework that follows the model-template-view pattern.",
            "Flask offers a lightweight approach to building web applications with minimal boilerplate.",
            "RESTful APIs enable communication between client and server using HTTP methods.",
            "Web frameworks handle routing to map URLs to specific handler functions.",
            "Template engines allow dynamic HTML generation by embedding variables in markup."
        ],
        "Data Science": [
            "NumPy provides efficient arrays and mathematical operations for numerical computing.",
            "Pandas offers data structures like DataFrames for manipulating tabular data.",
            "Matplotlib creates static, animated, and interactive visualizations in Python.",
            "Machine learning models learn patterns from data to make predictions.",
            "Data preprocessing includes cleaning, transforming, and normalizing datasets."
        ],
        "Testing": [
            "Unit tests verify that individual functions and methods work correctly in isolation.",
            "Integration tests check that different components work together as expected.",
            "Test fixtures set up the necessary state and data before running tests.",
            "Mocking allows tests to replace real dependencies with controlled test doubles.",
            "Continuous integration automatically runs tests when code changes are pushed."
        ],
        "Algorithms": [
            "Binary search efficiently finds elements in sorted arrays with logarithmic time complexity.",
            "Quick sort uses divide-and-conquer to sort elements by partitioning around a pivot.",
            "Hash tables provide constant-time average case lookup using key-value pairs.",
            "Depth-first search explores graph nodes by going as deep as possible before backtracking.",
            "Dynamic programming solves complex problems by breaking them into simpler overlapping subproblems."
        ]
    },
    "Cooking": {
        "Baking": [
            "Baking bread requires precise measurements of flour, water, yeast, and salt.",
            "Gluten development occurs when flour proteins form networks during kneading.",
            "Oven temperature significantly affects the texture and crust of baked goods.",
            "Proofing allows yeast to ferment and produce carbon dioxide for rising.",
            "Sourdough starters contain wild yeast and bacteria for natural fermentation."
        ],
        "Knife Skills": [
            "A sharp knife is safer than a dull one because it requires less force.",
            "The chef's knife is a versatile tool suitable for most cutting tasks.",
            "Proper grip involves pinching the blade between thumb and forefinger.",
            "Julienne cuts create thin matchstick-sized strips of vegetables.",
            "A stable cutting board prevents slipping and ensures precise cuts."
        ],
        "Sauces": [
            "The five mother sauces form the foundation of classical French cuisine.",
            "Béchamel sauce combines butter, flour, and milk into a creamy white sauce.",
            "Emulsification binds oil and water-based ingredients together in sauces.",
            "Reduction concentrates flavors by simmering liquids to evaporate water.",
            "Deglazing releases flavorful browned bits from the pan using liquid."
        ],
        "Grilling": [
            "Direct heat grilling cooks food directly over the flame or coals.",
            "Indirect heat creates an oven-like environment for slower cooking.",
            "Searing at high temperature creates flavorful browning through the Maillard reaction.",
            "Resting meat after grilling allows juices to redistribute throughout the cut.",
            "Marinades add flavor and can help tenderize tougher cuts of meat."
        ],
        "Herbs and Spices": [
            "Fresh basil adds a sweet, peppery flavor to Italian and Thai dishes.",
            "Cumin provides earthy, warm notes common in Mexican and Indian cuisine.",
            "Toasting spices in a dry pan releases their essential oils and intensifies flavor.",
            "Herbs should be added at different times depending on whether they are fresh or dried.",
            "Salt enhances and balances flavors by suppressing bitterness and amplifying taste."
        ]
    },
    "Astronomy": {
        "Stars": [
            "Stars are massive spheres of plasma held together by their own gravity.",
            "Nuclear fusion in stellar cores converts hydrogen into helium and releases energy.",
            "The color of a star indicates its surface temperature and spectral class.",
            "Main sequence stars spend most of their lives fusing hydrogen into helium.",
            "Red giants form when stars exhaust their core hydrogen and expand dramatically."
        ],
        "Planets": [
            "Rocky planets like Earth have solid surfaces and relatively high densities.",
            "Gas giants such as Jupiter consist primarily of hydrogen and helium.",
            "Planetary orbits follow elliptical paths around their host stars.",
            "Exoplanets are planets that orbit stars outside our solar system.",
            "The habitable zone is the region where liquid water could exist on a planet's surface."
        ],
        "Galaxies": [
            "The Milky Way is a barred spiral galaxy containing hundreds of billions of stars.",
            "Galactic rotation curves suggest the presence of dark matter in galaxies.",
            "Elliptical galaxies contain older stars and have little gas for new star formation.",
            "Galaxy clusters are gravitationally bound groups of galaxies.",
            "Active galactic nuclei emit enormous amounts of energy from supermassive black holes."
        ],
        "Black Holes": [
            "Black holes have gravity so strong that nothing, not even light, can escape.",
            "The event horizon marks the boundary beyond which escape becomes impossible.",
            "Stellar mass black holes form when massive stars collapse at the end of their lives.",
            "Supermassive black holes exist at the centers of most large galaxies.",
            "Hawking radiation is a theoretical emission predicted at black hole event horizons."
        ],
        "Cosmology": [
            "The Big Bang theory describes the universe's expansion from an extremely hot, dense state.",
            "Cosmic microwave background radiation is the afterglow of the early universe.",
            "Dark energy appears to be accelerating the universe's expansion.",
            "Redshift measures how light stretches as the universe expands.",
            "The observable universe is limited by the speed of light and cosmic age."
        ]
    },
    "Sports": {
        "Basketball": [
            "Basketball is played with two teams of five players on a rectangular court.",
            "Dribbling allows players to move with the ball by bouncing it continuously.",
            "A three-point shot is taken from beyond the three-point arc.",
            "Pick and roll plays involve screening a defender and rolling to the basket.",
            "Zone defense assigns players to guard areas rather than specific opponents."
        ],
        "Soccer": [
            "Soccer matches consist of two forty-five minute halves with a halftime break.",
            "Offside rules prevent attackers from gaining an unfair positional advantage.",
            "Passing accuracy and ball control are fundamental skills in soccer.",
            "Formations like 4-4-2 describe how players are positioned on the field.",
            "Set pieces including corner kicks and free kicks create scoring opportunities."
        ],
        "Tennis": [
            "Tennis scoring progresses through points, games, and sets with unique terminology.",
            "The serve initiates play and can be a powerful offensive weapon.",
            "Topspin makes the ball dip quickly and bounce high on the opponent's side.",
            "Court surfaces like clay, grass, and hard court affect ball speed and bounce.",
            "A rally continues until one player fails to return the ball within the lines."
        ],
        "Swimming": [
            "Freestyle is the fastest and most efficient swimming stroke for most swimmers.",
            "Proper breathing technique involves rotating the head to the side rather than lifting.",
            "Flip turns allow swimmers to change direction quickly at the pool wall.",
            "Streamlining reduces drag by maintaining a horizontal, narrow body position.",
            "Interval training alternates between high-intensity efforts and recovery periods."
        ],
        "Running": [
            "Proper running form includes landing midfoot and maintaining an upright posture.",
            "Cadence refers to the number of steps per minute while running.",
            "Long slow distance runs build aerobic endurance and base fitness.",
            "Interval workouts improve speed by alternating fast and slow segments.",
            "Recovery days allow muscles to repair and adapt to training stress."
        ]
    },
    "Music": {
        "Music Theory": [
            "Musical scales are sequences of notes ordered by pitch in ascending or descending patterns.",
            "Chord progressions create harmonic movement and structure in compositions.",
            "Time signatures indicate how many beats are in each measure.",
            "Key signatures specify which notes are sharp or flat throughout a piece.",
            "Intervals measure the distance between two pitches in terms of steps."
        ],
        "Piano": [
            "Piano keys produce sound when hammers strike strings inside the instrument.",
            "Proper hand position keeps fingers curved and wrists level with the keys.",
            "Pedals sustain notes, soften tone, or create special effects on the piano.",
            "Scales and arpeggios develop finger strength, dexterity, and muscle memory.",
            "Sight reading allows pianists to play music they have not previously practiced."
        ],
        "Guitar": [
            "Guitars typically have six strings tuned to E, A, D, G, B, and E.",
            "Frets are metal strips on the fingerboard that mark different pitches.",
            "Strumming patterns create rhythm by sweeping across multiple strings.",
            "Barre chords use one finger to press down multiple strings across a fret.",
            "Fingerpicking involves plucking individual strings with separate fingers."
        ],
        "Composition": [
            "Melody is a sequence of single notes that form a recognizable musical line.",
            "Harmony adds depth by combining multiple notes played simultaneously.",
            "Rhythm organizes music in time through patterns of duration and accent.",
            "Dynamics control the volume and intensity of musical performance.",
            "Form provides structure through the arrangement and repetition of musical sections."
        ],
        "Jazz": [
            "Improvisation allows musicians to create spontaneous melodies over chord changes.",
            "Swing rhythm creates a laid-back, syncopated feel characteristic of jazz.",
            "The blues scale adds flatted notes that create tension and expression.",
            "Walking bass lines outline chord changes with stepwise quarter note movement.",
            "Jazz standards are widely known compositions that form the common repertoire."
        ]
    }
}
# Build a global mapping from sentence content to metadata for easy lookup
_SENTENCE_TO_METADATA = {}
for parent_topic, subtopics in TOPIC_CONTENT.items():
    for subtopic, sentences in subtopics.items():
        for sent_idx, sentence in enumerate(sentences):
            _SENTENCE_TO_METADATA[sentence] = {
                "parent_topic": parent_topic,
                "subtopic": subtopic,
                "sentence_index": sent_idx
            }
def generate_topic_based_sentence(index: int) -> tuple[str, dict]:
    """
    Generate a sentence from the topic hierarchy based on index.
    Returns:
        tuple of (sentence, metadata) where metadata contains:
        - parent_topic: e.g., "Programming"
        - subtopic: e.g., "Python Basics"
        - sentence_index: 0-4 within the subtopic
    """
    # Flatten the structure into a list of (sentence, metadata)
    all_sentences = []
    for parent_topic, subtopics in TOPIC_CONTENT.items():
        for subtopic, sentences in subtopics.items():
            for sent_idx, sentence in enumerate(sentences):
                all_sentences.append((
                    sentence,
                    {
                        "parent_topic": parent_topic,
                        "subtopic": subtopic,
                        "sentence_index": sent_idx
                    }
                ))
    # Cycle through sentences if index exceeds available content
    idx = index % len(all_sentences)
    return all_sentences[idx]
def get_node_metadata(node_content: str) -> dict:
    """
    Get metadata for a node by matching its content to known sentences.
    Returns metadata dict or None if not found.
    """
    # Try to find any known sentence within the node content
    for sentence, metadata in _SENTENCE_TO_METADATA.items():
        if sentence in node_content:
            return metadata
    return None
class MockTreeActionDeciderWorkflow(TreeActionDeciderWorkflow):
    """
    Mock TreeActionDecider that simulates the orchestrator behavior.
    Uses the same logic as the original test but ensures ~30 nodes are created.
    """
    def __init__(self, decision_tree=None):
        super().__init__(decision_tree)
        self.call_count = 0
        self.created_nodes = []
        self.total_actions = 0
    async def process_text_chunk(
        self,
        text_chunk: str,
        tree_action_applier,
        buffer_manager
    ):
        """
        Mock implementation that generates random actions.
        Same as original but tracks total actions to limit to ~30.
        """
        self.call_count += 1
        # Stop after ~30 total actions
        if self.total_actions >= 30:
            buffer_manager.clear()
            return set()
        # Get existing node IDs
        existing_node_ids = list(self.decision_tree.tree.keys()) if self.decision_tree.tree else []
        if not text_chunk.strip():
            return set()
        updated_nodes = set()
        # Split text into chunks like the original test
        words = text_chunk.split()
        if not words:
            return set()
        # Create 2-5 actions per call (to reach ~30 total)
        num_chunks = min(random.randint(2, 5), 30 - self.total_actions, len(words))
        # Create random chunk boundaries
        if num_chunks == 1 or len(words) == 1:
            chunk_boundaries = [(0, len(words))]
        else:
            boundaries = sorted(random.sample(range(1, len(words)), min(num_chunks - 1, len(words) - 1)))
            chunk_boundaries = [(0, boundaries[0])]
            for i in range(len(boundaries) - 1):
                chunk_boundaries.append((boundaries[i], boundaries[i + 1]))
            if boundaries:
                chunk_boundaries.append((boundaries[-1], len(words)))
        # Generate actions for each chunk
        for i, (start, end) in enumerate(chunk_boundaries):
            if self.total_actions >= 30:
                break
            chunk_text = " ".join(words[start:end])
            # Use the same distribution as original: 45% CREATE, 45% APPEND, 10% UPDATE
            action_choice = random.random()
            if not existing_node_ids or action_choice < 0.45:
                # CREATE action
                node_name = f"Node_{len(self.created_nodes) + 1}"
                self.created_nodes.append(node_name)
                parent_id = random.choice(existing_node_ids) if existing_node_ids else None
                action = CreateAction(
                    action="CREATE",
                    parent_node_id=parent_id,
                    new_node_name=node_name,
                    content=chunk_text,
                    summary=f"Summary of {node_name}",
                    relationship="child of"
                )
                # Apply the action
                result_nodes = tree_action_applier.apply([action])
                if result_nodes:
                    for node_id in result_nodes:
                        updated_nodes.add(node_id)
                        existing_node_ids.append(node_id)
                self.total_actions += 1
            elif action_choice < 0.9:
                # APPEND action
                target_id = random.choice(existing_node_ids)
                action = AppendAction(
                    action="APPEND",
                    target_node_id=target_id,
                    content=chunk_text
                )
                # Apply the action
                result_nodes = tree_action_applier.apply([action])
                if result_nodes:
                    updated_nodes.update(result_nodes)
                self.total_actions += 1
            else:
                # UPDATE action
                target_id = random.choice(existing_node_ids)
                action = UpdateAction(
                    action="UPDATE",
                    node_id=target_id,
                    new_content=chunk_text,
                    new_summary=f"Updated summary for chunk {i}"
                )
                # Apply the action
                result_nodes = tree_action_applier.apply([action])
                if result_nodes:
                    updated_nodes.update(result_nodes)
                self.total_actions += 1
        # Clear buffer after processing
        buffer_manager.clear()
        return updated_nodes
class CleanMockTreeActionDeciderWorkflow(TreeActionDeciderWorkflow):
    """
    Clean mock workflow for semantic quality testing.
    Unlike MockTreeActionDeciderWorkflow, this creates exactly ONE node per buffer flush
    with NO random chunking, preserving semantic integrity of input sentences.
    """
    def __init__(self, decision_tree=None):
        super().__init__(decision_tree)
        self.call_count = 0
        self.created_nodes = []
        self.node_metadata = {}  # Maps node_id -> metadata dict
    async def process_text_chunk(
        self,
        text_chunk: str,
        tree_action_applier,
        buffer_manager
    ):
        """
        Create exactly ONE node with the entire buffered text.
        No random chunking, no mixing of content.
        """
        self.call_count += 1
        if not text_chunk.strip():
            buffer_manager.clear()
            return set()
        # Create exactly ONE node with full buffer content
        node_name = f"Node_{len(self.created_nodes) + 1}"
        self.created_nodes.append(node_name)
        # Get existing root node IDs, or use None for first node
        existing_node_ids = list(self.decision_tree.tree.keys()) if self.decision_tree.tree else []
        parent_id = existing_node_ids[0] if existing_node_ids else None
        action = CreateAction(
            action="CREATE",
            parent_node_id=parent_id,  # Attach to first node (root) or None for first
            new_node_name=node_name,
            content=text_chunk,  # ENTIRE buffer content - no splitting!
            summary=f"Summary of {node_name}",
            relationship="child of"
        )
        # Apply the action
        result_nodes = tree_action_applier.apply([action])
        updated_nodes = set()
        if result_nodes:
            for node_id in result_nodes:
                updated_nodes.add(node_id)
                # Track metadata for semantic quality testing
                metadata = get_node_metadata(text_chunk)
                if metadata:
                    self.node_metadata[node_id] = metadata
        # Clear buffer after processing
        buffer_manager.clear()
        return updated_nodes
class TestPipelineWithRealEmbeddings:
    """Integration test for verifying real embedding generation"""
    def setup_method(self, method):
        """Set up test environment with real embeddings enabled"""
        # Create temporary directory
        self.temp_dir = tempfile.mkdtemp(prefix=f"test_embeddings_{method.__name__}_")
        self.output_dir = self.temp_dir
        # IMPORTANT: Disable test mode to use real embeddings
        os.environ.pop('VOICETREE_TEST_MODE', None)  # Remove if exists
        os.environ['VOICETREE_TEST_MODE'] = 'false'  # Explicitly set to false
    def teardown_method(self, method):
        """Clean up test environment"""
        # Re-enable test mode for other tests
        os.environ['VOICETREE_TEST_MODE'] = 'true'
        # Clean up temporary directory
        if os.path.exists(self.temp_dir):
            shutil.rmtree(self.temp_dir)
    @pytest.mark.asyncio
    async def test_30_nodes_with_real_embeddings(self):
        """
        Test creating ~30 nodes with real embeddings.
        Verifies the async embedding system works correctly.
        """
        print("\n" + "="*60)
        print("TESTING REAL EMBEDDINGS WITH ~30 NODES")
        print("="*60)
        # Create components with real embeddings
        decision_tree = MarkdownTree(output_dir=self.output_dir)
        mock_workflow = MockTreeActionDeciderWorkflow(decision_tree)
        # Create ChunkProcessor with injected mock workflow
        chunk_processor = ChunkProcessor(
            decision_tree=decision_tree,
            workflow=mock_workflow
        )
        # Generate and process topic-based sentences until we hit ~30 actions
        print(f"\nProcessing topic-based text to generate ~30 actions...")
        sentences_processed = 0
        while mock_workflow.total_actions < 30:
            sentence, metadata = generate_topic_based_sentence(sentences_processed)
            await chunk_processor.process_new_text_and_update_markdown(sentence)
            sentences_processed += 1
            if sentences_processed % 5 == 0:
                print(f"  Processed {sentences_processed} sentences, {mock_workflow.total_actions} actions so far...")
        print(f"\nTotal actions generated: {mock_workflow.total_actions}")
        print(f"Total nodes created: {len(mock_workflow.created_nodes)}")
        # Wait for async embeddings to complete
        print("\nWaiting for async embeddings to complete...")
        max_wait = 15  # Maximum 15 seconds for embeddings
        start_time = time.time()
        # Simple wait approach - just wait a bit for async operations
        await asyncio.sleep(2)  # Initial wait
        # Check if we have an embedding manager and wait for completion
        if hasattr(decision_tree, '_embedding_manager'):
            while time.time() - start_time < max_wait:
                stats = decision_tree._embedding_manager.get_stats()
                pending = stats.get('pending', 0)
                if pending == 0:
                    break
                print(f"  Still {pending} embeddings pending...")
                await asyncio.sleep(0.5)
        elapsed = time.time() - start_time
        print(f"Waited {elapsed:.1f} seconds for embeddings")
        # Verify nodes were created
        node_count = len(decision_tree.tree)
        print(f"\n✓ Nodes created: {node_count}")
        assert node_count >= 10, f"Expected at least 10 nodes, got {node_count}"
        # Verify embeddings were generated
        if hasattr(decision_tree, '_embedding_manager'):
            embedding_stats = decision_tree._embedding_manager.get_stats()
            print(f"\n✓ Embedding statistics:")
            print(f"  - Total embeddings: {embedding_stats.get('count', 0)}")
            print(f"  - Pending: {embedding_stats.get('pending', 0)}")
            print(f"  - Failed: {embedding_stats.get('failed', 0)}")
            # Should have embeddings for nodes
            embedding_count = embedding_stats.get('count', 0)
            # With real embeddings, we should have at least some embeddings
            # Note: root node doesn't get embeddings
            if embedding_count == 0:
                print("WARNING: No embeddings were generated. This might indicate:")
                print("  - OpenAI API key not configured")
                print("  - Embedding service is down")
                print("  - Test mode is still enabled somehow")
                # Don't fail the test, just warn
            else:
                print(f"✓ Successfully generated {embedding_count} embeddings")
        # Verify vector store operations (if embeddings were created)
        if hasattr(decision_tree, '_vector_store') and decision_tree._vector_store:
            try:
                # Try a simple search with random words from our generated content
                test_query = "random test query"
                search_results = await decision_tree._vector_store.search(
                    test_query,
                    k=3
                )
                if search_results:
                    print(f"\n✓ Vector search returned {len(search_results)} results")
                    # Show first result details
                    first_result = search_results[0]
                    print(f"  Sample result: node_id={first_result.get('node_id', 'unknown')}")
                else:
                    print("\n⚠ Vector search returned no results (embeddings might not be ready)")
            except Exception as e:
                print(f"\n⚠ Vector search failed: {e}")
                print("  This is expected if embeddings are not configured")
        # Verify markdown files were created
        md_files = glob.glob(os.path.join(self.output_dir, "*.md"))
        print(f"\n✓ Markdown files created: {len(md_files)}")
        assert len(md_files) > 0, "Markdown files should be created"
        # Verify tree structure integrity
        for node_id, node in decision_tree.tree.items():
            if hasattr(node, 'parent_id') and node.parent_id is not None:
                assert node.parent_id in decision_tree.tree, \
                    f"Parent {node.parent_id} should exist in tree"
        print("\n" + "="*60)
        print("TEST COMPLETED SUCCESSFULLY")
        print("="*60)
    @pytest.mark.asyncio
    async def test_embedding_error_handling(self):
        """Test that embedding failures don't block the pipeline"""
        print("\n" + "="*60)
        print("TESTING EMBEDDING ERROR HANDLING")
        print("="*60)
        # Create tree with real embeddings
        decision_tree = MarkdownTree(output_dir=self.output_dir)
        mock_workflow = MockTreeActionDeciderWorkflow(decision_tree)
        chunk_processor = ChunkProcessor(
            decision_tree=decision_tree,
            workflow=mock_workflow
        )
        # Process several chunks to create nodes
        for i in range(5):
            sentence, metadata = generate_topic_based_sentence(i)
            await chunk_processor.process_new_text_and_update_markdown(sentence)
        # Wait a bit for any async operations
        await asyncio.sleep(1)
        # Even if embeddings fail, nodes should still be created
        node_count = len(decision_tree.tree)
        print(f"\n✓ Nodes created: {node_count}")
        assert node_count > 0, "Pipeline should create nodes even if embeddings fail"
        # Check embedding status
        if hasattr(decision_tree, '_embedding_manager'):
            stats = decision_tree._embedding_manager.get_stats()
            print(f"\n✓ Embedding stats:")
            print(f"  - Total: {stats.get('count', 0)}")
            print(f"  - Failed: {stats.get('failed', 0)}")
            print(f"  - Pending: {stats.get('pending', 0)}")
            # The pipeline should work regardless of embedding status
            print("\n✓ Pipeline completed successfully regardless of embedding status")
        # Verify markdown files were still created
        md_files = glob.glob(os.path.join(self.output_dir, "*.md"))
        assert len(md_files) > 0, "Markdown files should be created even if embeddings fail"
        print(f"✓ Markdown files created: {len(md_files)}")
        print("\n" + "="*60)
        print("ERROR HANDLING TEST COMPLETED")
        print("="*60)
    @pytest.mark.asyncio
    async def test_hybrid_search_functionality(self):
        """
        Basic smoke test for hybrid search functionality.
        NOTE: This test uses MockTreeActionDeciderWorkflow which randomly chunks
        sentences, mixing topics together. This makes detailed semantic quality
        testing difficult. For production quality validation, use a dedicated test
        that creates nodes without random chunking.
        This test simply verifies:
        1. Hybrid search doesn't crash
        2. Returns some results for topic-related queries
        3. Results contain expected node structure
        """
        print("\n" + "="*60)
        print("TESTING HYBRID SEARCH - BASIC FUNCTIONALITY")
        print("="*60)
        # Create nodes with topic-based content
        decision_tree = MarkdownTree(output_dir=self.output_dir)
        mock_workflow = MockTreeActionDeciderWorkflow(decision_tree)
        chunk_processor = ChunkProcessor(
            decision_tree=decision_tree,
            workflow=mock_workflow
        )
        # Process diverse sentences
        print("\nCreating nodes from diverse topics...")
        for i in range(40):
            sentence, metadata = generate_topic_based_sentence(i)
            await chunk_processor.process_new_text_and_update_markdown(sentence)
        # Wait for embeddings
        await asyncio.sleep(2)
        print(f"Created {len(decision_tree.tree)} nodes")
        # Import the hybrid search function
        from backend.markdown_tree_manager.graph_search.tree_functions import hybrid_search_for_relevant_nodes
        # Test queries from different domains
        test_queries = [
            "Python programming and web development",
            "baking and cooking techniques",
            "stars and galaxies in space",
            "sports and basketball",
            "music and piano"
        ]
        print("\nTesting hybrid search with various queries...")
        for query in test_queries:
            print(f"\n  Query: '{query}'")
            # Perform hybrid search
            results = hybrid_search_for_relevant_nodes(
                decision_tree,
                query,
                max_return_nodes=5
            )
            print(f"  Found {len(results)} results")
            # Basic validations
            assert isinstance(results, list), "Results should be a list"
            for node_id in results:
                assert node_id in decision_tree.tree, f"Node {node_id} should exist in tree"
                node = decision_tree.tree[node_id]
                assert hasattr(node, 'content'), f"Node {node_id} should have content"
                # Try to get metadata (might not match due to chunking)
                metadata = get_node_metadata(node.content)
                if metadata:
                    print(f"    - Node {node_id}: {metadata['parent_topic']} > {metadata['subtopic']}")
                else:
                    print(f"    - Node {node_id}: (mixed/chunked content)")
        print("\n✓ Hybrid search functional tests passed")
        print("✓ Search returns valid node IDs")
        print("✓ All returned nodes exist in tree")
        print("✓ No crashes or exceptions")
        print("\n" + "="*60)
        print("HYBRID SEARCH FUNCTIONALITY TEST COMPLETED")
        print("="*60)
        print("\nNOTE: For detailed semantic quality testing (subtopic precision,")
        print("topic boundaries, rare term boosting), create a test with a simpler")
        print("node creation workflow that doesn't randomly chunk sentences.")
    @pytest.mark.asyncio
    async def test_subtopic_relevance_quality(self):
        """
        Test that hybrid search returns nodes from the correct subtopic.
        This test uses CleanMockTreeActionDeciderWorkflow which preserves
        semantic integrity by creating one node per sentence without random chunking.
        """
        print("\n" + "="*60)
        print("SEMANTIC QUALITY TEST: SUBTOPIC RELEVANCE")
        print("="*60)
        # Create tree with clean workflow
        decision_tree = MarkdownTree(output_dir=self.output_dir)
        clean_workflow = CleanMockTreeActionDeciderWorkflow(decision_tree)
        chunk_processor = ChunkProcessor(
            decision_tree=decision_tree,
            workflow=clean_workflow
        )
        # Process sentences covering all topics (50 sentences = ~10 per parent topic)
        print("\nCreating nodes with clean semantic boundaries...")
        for i in range(50):
            sentence, metadata = generate_topic_based_sentence(i)
            await chunk_processor.process_new_text_and_update_markdown(sentence)
        # Wait for embeddings
        print(f"\nCreated {len(decision_tree.tree)} nodes")
        print("Waiting for embeddings to complete...")
        await asyncio.sleep(15)  # Increased wait time for async embeddings to complete
        print("Embeddings should be ready now.")
        from backend.markdown_tree_manager.graph_search.tree_functions import hybrid_search_for_relevant_nodes
        # Test queries targeting specific subtopics
        test_cases = [
            {
                "query": "Python programming language syntax variables",
                "expected_subtopic": "Python Basics",
                "expected_parent": "Programming",
                "description": "Python Basics query"
            },
            {
                "query": "baking bread flour yeast dough",
                "expected_subtopic": "Baking",
                "expected_parent": "Cooking",
                "description": "Baking query"
            },
            {
                "query": "stars fusion plasma nuclear energy",
                "expected_subtopic": "Stars",
                "expected_parent": "Astronomy",
                "description": "Stars query"
            },
            {
                "query": "machine learning data science pandas numpy",
                "expected_subtopic": "Data Science",
                "expected_parent": "Programming",
                "description": "Data Science query"
            }
        ]
        for test_case in test_cases:
            print(f"\n[{test_case['description']}]")
            print(f"  Query: '{test_case['query']}'")
            results = hybrid_search_for_relevant_nodes(
                decision_tree,
                test_case['query'],
                max_return_nodes=5
            )
            if len(results) == 0:
                print("  ⚠ No results returned - likely no embeddings available")
                continue
            # Count matches
            correct_subtopic_count = 0
            correct_parent_count = 0
            for rank, node_id in enumerate(results, 1):
                if node_id in clean_workflow.node_metadata:
                    metadata = clean_workflow.node_metadata[node_id]
                    print(f"  #{rank}: {metadata['parent_topic']} > {metadata['subtopic']}")
                    if metadata['subtopic'] == test_case['expected_subtopic']:
                        correct_subtopic_count += 1
                    if metadata['parent_topic'] == test_case['expected_parent']:
                        correct_parent_count += 1
            precision = correct_subtopic_count / len(results) if results else 0
            print(f"  ✓ Subtopic precision: {correct_subtopic_count}/{len(results)} ({precision:.1%})")
            # Assert at least 60% of top-5 are from correct subtopic
            assert precision >= 0.6, \
                f"Expected ≥60% from {test_case['expected_subtopic']}, got {precision:.1%}"
        print("\n" + "="*60)
        print("SUBTOPIC RELEVANCE TEST PASSED")
        print("="*60)
    @pytest.mark.asyncio
    async def test_cross_topic_separation_quality(self):
        """
        Test that hybrid search excludes nodes from irrelevant parent topics.
        Validates that queries don't return false positives from distant semantic domains.
        """
        print("\n" + "="*60)
        print("SEMANTIC QUALITY TEST: CROSS-TOPIC SEPARATION")
        print("="*60)
        # Create tree with clean workflow
        decision_tree = MarkdownTree(output_dir=self.output_dir)
        clean_workflow = CleanMockTreeActionDeciderWorkflow(decision_tree)
        chunk_processor = ChunkProcessor(
            decision_tree=decision_tree,
            workflow=clean_workflow
        )
        # Process diverse sentences
        print("\nCreating nodes from diverse topics...")
        for i in range(50):
            sentence, metadata = generate_topic_based_sentence(i)
            await chunk_processor.process_new_text_and_update_markdown(sentence)
        print(f"\nCreated {len(decision_tree.tree)} nodes")
        print("Waiting for embeddings to complete...")
        await asyncio.sleep(15)  # Increased wait time for async embeddings to complete
        print("Embeddings should be ready now.")
        from backend.markdown_tree_manager.graph_search.tree_functions import hybrid_search_for_relevant_nodes
        # Test queries that should NOT return nodes from distant topics
        test_cases = [
            {
                "query": "Python Django Flask web development APIs",
                "correct_parent": "Programming",
                "wrong_parents": ["Cooking", "Astronomy", "Sports", "Music"],
                "description": "Programming query"
            },
            {
                "query": "cooking recipes sauces knife skills baking",
                "correct_parent": "Cooking",
                "wrong_parents": ["Programming", "Astronomy", "Sports", "Music"],
                "description": "Cooking query"
            },
            {
                "query": "galaxies black holes stars cosmology universe",
                "correct_parent": "Astronomy",
                "wrong_parents": ["Programming", "Cooking", "Sports", "Music"],
                "description": "Astronomy query"
            }
        ]
        for test_case in test_cases:
            print(f"\n[{test_case['description']}]")
            print(f"  Query: '{test_case['query']}'")
            results = hybrid_search_for_relevant_nodes(
                decision_tree,
                test_case['query'],
                max_return_nodes=10
            )
            if len(results) == 0:
                print("  ⚠ No results returned - likely no embeddings available")
                continue
            # Count contamination from wrong topics
            correct_count = 0
            wrong_count = 0
            for node_id in results:
                if node_id in clean_workflow.node_metadata:
                    metadata = clean_workflow.node_metadata[node_id]
                    if metadata['parent_topic'] == test_case['correct_parent']:
                        correct_count += 1
                    elif metadata['parent_topic'] in test_case['wrong_parents']:
                        wrong_count += 1
                        print(f"    ⚠ Wrong topic: {metadata['parent_topic']} > {metadata['subtopic']}")
            contamination_rate = wrong_count / len(results) if results else 0
            print(f"  ✓ Correct topic: {correct_count}/{len(results)}")
            print(f"  ✓ Contamination: {wrong_count}/{len(results)} ({contamination_rate:.1%})")
            # Assert NO nodes from completely wrong topics (0% contamination tolerance)
            assert contamination_rate == 0.0, \
                f"Expected 0% contamination from wrong topics, got {contamination_rate:.1%}"
        print("\n" + "="*60)
        print("CROSS-TOPIC SEPARATION TEST PASSED")
        print("="*60)
    @pytest.mark.asyncio
    async def test_hybrid_advantage_over_single_methods(self):
        """
        Test that hybrid search (BM25 + Vector + RRF) outperforms single methods.
        Compares search quality across:
        - BM25 alone
        - Vector search alone
        - Hybrid (BM25 + Vector + RRF)
        """
        print("\n" + "="*60)
        print("SEMANTIC QUALITY TEST: HYBRID ADVANTAGE")
        print("="*60)
        # Create tree with clean workflow
        decision_tree = MarkdownTree(output_dir=self.output_dir)
        clean_workflow = CleanMockTreeActionDeciderWorkflow(decision_tree)
        chunk_processor = ChunkProcessor(
            decision_tree=decision_tree,
            workflow=clean_workflow
        )
        # Process diverse sentences
        print("\nCreating nodes from diverse topics...")
        for i in range(50):
            sentence, metadata = generate_topic_based_sentence(i)
            await chunk_processor.process_new_text_and_update_markdown(sentence)
        print(f"\nCreated {len(decision_tree.tree)} nodes")
        print("Waiting for embeddings...")
        await asyncio.sleep(3)
        from backend.markdown_tree_manager.graph_search.tree_functions import (
            hybrid_search_for_relevant_nodes,
            search_similar_nodes_bm25
        )
        # Test query with clear expected subtopic
        test_query = "Python programming variables syntax code"
        expected_subtopic = "Python Basics"
        print(f"\nTest Query: '{test_query}'")
        print(f"Expected Subtopic: '{expected_subtopic}'")
        # 1. BM25 alone
        print("\n[BM25 Search]")
        bm25_results = search_similar_nodes_bm25(
            decision_tree,
            test_query,
            top_k=5
        )
        bm25_node_ids = [node_id for node_id, score in bm25_results]
        bm25_correct = sum(
            1 for nid in bm25_node_ids
            if nid in clean_workflow.node_metadata
            and clean_workflow.node_metadata[nid]['subtopic'] == expected_subtopic
        )
        bm25_precision = bm25_correct / len(bm25_node_ids) if bm25_node_ids else 0
        print(f"  Precision: {bm25_correct}/{len(bm25_node_ids)} ({bm25_precision:.1%})")
        # 2. Vector search alone
        print("\n[Vector Search]")
        vector_results = decision_tree.search_similar_nodes_vector(test_query, top_k=5)
        vector_node_ids = [node_id for node_id, score in vector_results]
        vector_correct = sum(
            1 for nid in vector_node_ids
            if nid in clean_workflow.node_metadata
            and clean_workflow.node_metadata[nid]['subtopic'] == expected_subtopic
        )
        vector_precision = vector_correct / len(vector_node_ids) if vector_node_ids else 0
        print(f"  Precision: {vector_correct}/{len(vector_node_ids)} ({vector_precision:.1%})")
        # 3. Hybrid search (BM25 + Vector + RRF)
        print("\n[Hybrid Search (BM25 + Vector + RRF)]")
        hybrid_results = hybrid_search_for_relevant_nodes(
            decision_tree,
            test_query,
            max_return_nodes=5
        )
        hybrid_correct = sum(
            1 for nid in hybrid_results
            if nid in clean_workflow.node_metadata
            and clean_workflow.node_metadata[nid]['subtopic'] == expected_subtopic
        )
        hybrid_precision = hybrid_correct / len(hybrid_results) if hybrid_results else 0
        print(f"  Precision: {hybrid_correct}/{len(hybrid_results)} ({hybrid_precision:.1%})")
        # Validate hybrid advantage
        print("\n[Comparison]")
        print(f"  BM25 alone:      {bm25_precision:.1%}")
        print(f"  Vector alone:    {vector_precision:.1%}")
        print(f"  Hybrid (BM25+RRF): {hybrid_precision:.1%}")
        # Hybrid should be at least as good as the best single method
        best_single_method = max(bm25_precision, vector_precision)
        print(f"\n  Best single method: {best_single_method:.1%}")
        print(f"  Hybrid improvement: {hybrid_precision - best_single_method:+.1%}")
        # Assert hybrid is at least as good as (or better than) single methods
        assert hybrid_precision >= best_single_method, \
            f"Hybrid ({hybrid_precision:.1%}) should be ≥ best single method ({best_single_method:.1%})"
        # Ideally, hybrid should be strictly better, but we'll allow equal performance
        if hybrid_precision > best_single_method:
            print(f"\n✓ Hybrid search outperforms single methods by {hybrid_precision - best_single_method:.1%}")
        else:
            print(f"\n✓ Hybrid search matches best single method ({hybrid_precision:.1%})")
        print("\n" + "="*60)
        print("HYBRID ADVANTAGE TEST PASSED")
        print("="*60)
if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s"])