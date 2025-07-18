# TDD Integration Plan for TreeActionDecider

## Overview
Breaking down the integration into isolated, testable components that can be developed using TDD.

## 1. WorkflowAdapter Integration (Isolated & Testable)

### Test First Approach

```python
# test_workflow_adapter_integration.py

class TestWorkflowAdapterWithTreeActionDecider:
    
    @pytest.fixture
    def mock_tree_action_decider(self):
        """Mock TreeActionDecider to test WorkflowAdapter in isolation"""
        decider = Mock(spec=TreeActionDecider)
        decider.run = AsyncMock()
        return decider
    
    @pytest.fixture
    def adapter_with_mock_decider(self, mock_tree_action_decider):
        """Create WorkflowAdapter with mocked TreeActionDecider"""
        adapter = WorkflowAdapter()
        adapter.agent = mock_tree_action_decider  # Inject mock
        return adapter
    
    async def test_adapter_calls_decider_correctly(self, adapter_with_mock_decider, mock_tree_action_decider):
        """WorkflowAdapter should pass correct params to TreeActionDecider"""
        # Given
        transcript = "Test transcript"
        context = "Previous context"
        
        # When
        await adapter_with_mock_decider.process_full_buffer(transcript, context)
        
        # Then
        mock_tree_action_decider.run.assert_called_once_with(
            transcript_text=transcript,
            decision_tree=ANY,  # We'll check this is a DecisionTree
            transcript_history=context
        )
    
    async def test_adapter_transforms_optimization_actions_to_result(self, adapter_with_mock_decider, mock_tree_action_decider):
        """WorkflowAdapter should correctly transform actions to WorkflowResult"""
        # Given
        optimization_actions = [
            UpdateAction(action="UPDATE", node_id=1, new_content="Updated", new_summary="Summary"),
            CreateAction(action="CREATE", parent_node_id=1, new_node_name="New Node", 
                        content="Content", summary="Summary", relationship="child of")
        ]
        mock_tree_action_decider.run.return_value = optimization_actions
        
        # When
        result = await adapter_with_mock_decider.process_full_buffer("test", "")
        
        # Then
        assert result.success == True
        assert result.tree_actions == optimization_actions
        assert result.new_nodes == ["New Node"]  # Extracted from CREATE actions
        assert result.metadata["actions_generated"] == 2
        assert result.metadata["completed_chunks"] == ["test"]
    
    async def test_adapter_handles_empty_optimization_response(self, adapter_with_mock_decider, mock_tree_action_decider):
        """WorkflowAdapter should handle empty optimization list"""
        # Given
        mock_tree_action_decider.run.return_value = []
        
        # When
        result = await adapter_with_mock_decider.process_full_buffer("test", "")
        
        # Then
        assert result.success == True
        assert result.tree_actions == []
        assert result.new_nodes == []
        assert result.metadata["actions_generated"] == 0
```

### Implementation Strategy
1. Create a minimal change to WorkflowAdapter that:
   - Changes the import
   - Updates initialization
   - Transforms TreeActionDecider output to WorkflowResult

## 2. ChunkProcessor Integration (Isolated & Testable)

### Test First Approach

```python
# test_chunk_processor_integration.py

class TestChunkProcessorWithNewActions:
    
    @pytest.fixture
    def mock_workflow_adapter(self):
        """Mock WorkflowAdapter that returns new action format"""
        adapter = Mock(spec=WorkflowAdapter)
        adapter.process_full_buffer = AsyncMock()
        return adapter
    
    @pytest.fixture
    def mock_tree_applier(self):
        """Mock TreeActionApplier"""
        applier = Mock(spec=TreeActionApplier)
        applier.apply = Mock(return_value={1, 2})  # Modified node IDs
        return applier
    
    @pytest.fixture
    def chunk_processor_with_mocks(self, mock_workflow_adapter, mock_tree_applier):
        """Create ChunkProcessor with injected mocks"""
        processor = ChunkProcessor()
        processor.workflow_adapter = mock_workflow_adapter
        processor.tree_action_applier = mock_tree_applier
        return processor
    
    async def test_processor_uses_tree_actions_not_integration_decisions(
        self, chunk_processor_with_mocks, mock_workflow_adapter, mock_tree_applier
    ):
        """ChunkProcessor should use result.tree_actions instead of integration_decisions"""
        # Given
        tree_actions = [
            UpdateAction(action="UPDATE", node_id=1, new_content="Updated", new_summary="Summary")
        ]
        workflow_result = WorkflowResult(
            success=True,
            tree_actions=tree_actions,
            new_nodes=[],
            metadata={"completed_chunks": ["test"]}
        )
        mock_workflow_adapter.process_full_buffer.return_value = workflow_result
        
        # When
        await chunk_processor_with_mocks._process_text_chunk("test chunk")
        
        # Then
        mock_tree_applier.apply.assert_called_once_with(tree_actions)
    
    async def test_processor_handles_action_application_results(
        self, chunk_processor_with_mocks, mock_tree_applier
    ):
        """ChunkProcessor should properly handle modified node IDs from applier"""
        # Given
        modified_nodes = {1, 2, 3}
        mock_tree_applier.apply.return_value = modified_nodes
        
        # When
        result = await chunk_processor_with_mocks._process_text_chunk("test")
        
        # Then
        assert result.updated_nodes == modified_nodes
```

### Implementation Strategy
1. Update ChunkProcessor to:
   - Use `result.tree_actions` instead of `result.integration_decisions`
   - Call `apply()` instead of `apply_integration_decisions()`

## 3. Import Update Script (Isolated & Testable)

### Test First Approach

```python
# test_import_updater.py

class TestImportUpdater:
    
    def test_update_workflow_adapter_imports(self, tmp_path):
        """Script should update WorkflowAdapter imports correctly"""
        # Given
        old_content = '''
from backend.text_to_graph_pipeline.agentic_workflows.agents.tree_action_decider_agent import TreeActionDeciderAgent

class WorkflowAdapter:
    def __init__(self):
        self.agent = TreeActionDeciderAgent()
'''
        file_path = tmp_path / "workflow_adapter.py"
        file_path.write_text(old_content)
        
        # When
        update_imports(file_path)
        
        # Then
        new_content = file_path.read_text()
        assert "from backend.text_to_graph_pipeline.orchestration.tree_action_decider import TreeActionDecider" in new_content
        assert "TreeActionDeciderAgent" not in new_content
        assert "self.agent = TreeActionDecider()" in new_content
```

## 4. Backward Compatibility Adapter (Optional but Useful)

### Test First Approach

```python
# test_backward_compatibility.py

class TestBackwardCompatibilityAdapter:
    """Adapter that makes new WorkflowResult look like old format"""
    
    def test_adapter_transforms_tree_actions_to_integration_decisions(self):
        # Given
        new_result = WorkflowResult(
            success=True,
            tree_actions=[UpdateAction(...)],
            new_nodes=["Node1"],
            metadata={}
        )
        
        # When
        compat_result = BackwardCompatibilityAdapter.transform(new_result)
        
        # Then
        assert hasattr(compat_result, 'integration_decisions')
        assert compat_result.integration_decisions == new_result.tree_actions
```

## 5. Integration Test Harness

### Test First Approach

```python
# test_integration_harness.py

class TestIntegrationHarness:
    """Test the integration without running the full system"""
    
    @pytest.fixture
    def integration_harness(self):
        """Create a test harness that wires components together"""
        return IntegrationTestHarness()
    
    async def test_full_flow_with_mocked_llms(self, integration_harness):
        """Test full flow: transcript → TreeActionDecider → ChunkProcessor"""
        # Given
        integration_harness.mock_append_agent_response([
            AppendAction(action="APPEND", target_node_id=1, content="Test")
        ])
        integration_harness.mock_optimizer_response([
            UpdateAction(action="UPDATE", node_id=1, new_content="Optimized", new_summary="Summary")
        ])
        
        # When
        result = await integration_harness.process_transcript("Test transcript")
        
        # Then
        assert result.tree_was_modified
        assert result.optimization_actions_applied == 1
        assert result.final_tree_state.get_node(1).content == "Optimized"
```

## Implementation Order (TDD Style)

1. **WorkflowAdapter Tests** → Implementation (30 min)
2. **ChunkProcessor Tests** → Implementation (30 min)
3. **Import Updater Tests** → Script (15 min)
4. **Integration Harness Tests** → Harness (45 min)
5. **Full Integration Tests** → Debug (30 min)

## Key TDD Principles Applied

1. **Dependency Injection**: All components accept their dependencies, making mocking easy
2. **Single Responsibility**: Each component has one job, making tests focused
3. **Interface Segregation**: Components depend on interfaces (specs) not implementations
4. **Test Isolation**: Each test verifies one specific behavior

## Benefits

- **Fast Feedback**: Tests run in milliseconds, not seconds
- **Clear Contracts**: Tests document exactly what each component expects
- **Safe Refactoring**: Can change implementation without breaking tests
- **Progress Tracking**: Each passing test is measurable progress