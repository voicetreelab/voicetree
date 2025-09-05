"""Behavioral test for content filtering module."""

import pytest
from backend.context_retrieval.content_filtering import (
    ContentLevel,
    apply_content_filter,
    get_neighborhood
)


def test_apply_content_filter_with_distance_based_pruning():
    """Test that apply_content_filter correctly filters content based on distance from target."""
    
    # Test data with various distances from target
    nodes = [
        {
            'filename': 'very_far.md',
            'title': 'Very Far Node',
            'summary': 'Very far from target',
            'content': 'Full very far content',
            'distance_from_target': 15
        },
        {
            'filename': 'medium_far.md',
            'title': 'Medium Far Node',
            'summary': 'Medium far from target',
            'content': 'Full medium far content',
            'distance_from_target': 8
        },
        {
            'filename': 'close.md',
            'title': 'Close Node',
            'summary': 'Close to target',
            'content': 'Full close content',
            'distance_from_target': 3
        },
        {
            'filename': 'target.md',
            'title': 'Target Node',
            'summary': 'This is the target',
            'content': 'Full target content',
            'distance_from_target': 0
        }
    ]
    
    # Test with automatic coarse-to-fine filtering
    filtered_nodes = apply_content_filter(nodes, ContentLevel.FULL_CONTENT)
    
    # Very far nodes (distance > 12) should have titles only
    assert filtered_nodes[0]['title'] == 'Very Far Node'
    assert filtered_nodes[0]['summary'] is None
    assert filtered_nodes[0]['content'] is None
    
    # Medium distance nodes (distance 6-12) should have titles and summaries
    assert filtered_nodes[1]['title'] == 'Medium Far Node'
    assert filtered_nodes[1]['summary'] == 'Medium far from target'
    assert filtered_nodes[1]['content'] is None
    
    # Close nodes (distance 0-5) should have full content
    assert filtered_nodes[2]['title'] == 'Close Node'
    assert filtered_nodes[2]['summary'] == 'Close to target'
    assert filtered_nodes[2]['content'] == 'Full close content'
    assert filtered_nodes[3]['title'] == 'Target Node'
    assert filtered_nodes[3]['summary'] == 'This is the target'
    assert filtered_nodes[3]['content'] == 'Full target content'
    
    # Test with TITLES_ONLY level
    filtered_nodes = apply_content_filter(nodes.copy(), ContentLevel.TITLES_ONLY)
    for node in filtered_nodes:
        assert node['title'] is not None
        assert node['summary'] is None
        assert node['content'] is None
    
    # Test with TITLES_AND_SUMMARIES level
    filtered_nodes = apply_content_filter(nodes.copy(), ContentLevel.TITLES_AND_SUMMARIES)
    for node in filtered_nodes:
        assert node['title'] is not None
        # With TITLES_AND_SUMMARIES, all nodes should keep their summaries
        assert node['summary'] is not None
        assert node['content'] is None


def test_depth_to_distance_conversion():
    """Test that apply_content_filter correctly converts depth to distance_from_target."""
    
    # Test data using 'depth' field instead of 'distance_from_target'
    nodes_with_depth = [
        {
            'filename': 'far.md',
            'title': 'Far Node',
            'summary': 'Far from target',
            'content': 'Full far content',
            'depth': 15
        },
        {
            'filename': 'medium.md',
            'title': 'Medium Node',
            'summary': 'Medium distance',
            'content': 'Full medium content',
            'depth': 7
        },
        {
            'filename': 'close.md',
            'title': 'Close Node',
            'summary': 'Close to target',
            'content': 'Full close content',
            'depth': 2
        }
    ]
    
    # Apply filter with FULL_CONTENT
    filtered_nodes = apply_content_filter(nodes_with_depth, ContentLevel.FULL_CONTENT)
    
    # Verify depth was converted to distance_from_target
    assert filtered_nodes[0]['distance_from_target'] == 15
    assert filtered_nodes[1]['distance_from_target'] == 7
    assert filtered_nodes[2]['distance_from_target'] == 2
    
    # Verify filtering worked correctly
    # Far node (distance > 12): titles only
    assert filtered_nodes[0]['summary'] is None
    assert filtered_nodes[0]['content'] is None
    
    # Medium node (distance 6-12): titles + summaries
    assert filtered_nodes[1]['summary'] == 'Medium distance'
    assert filtered_nodes[1]['content'] is None
    
    # Close node (distance 0-5): full content
    assert filtered_nodes[2]['summary'] == 'Close to target'
    assert filtered_nodes[2]['content'] == 'Full close content'


def test_get_neighborhood_finds_nodes_within_n_hops():
    """Test that get_neighborhood finds all nodes within N hops of target."""
    
    # Mock node connections data
    # Structure: target -> [node1, node2] -> [node3, node4]
    connections = {
        'target.md': ['node1.md', 'node2.md'],
        'node1.md': ['target.md', 'node3.md'],
        'node2.md': ['target.md', 'node4.md'],
        'node3.md': ['node1.md'],
        'node4.md': ['node2.md']
    }
    
    # Mock node loader
    def mock_load_node(filename):
        return {
            'filename': filename,
            'title': filename.replace('.md', ''),
            'content': f'Content of {filename}'
        }
    
    # Test radius 1 - should get immediate neighbors
    neighbors = get_neighborhood('target.md', connections, radius=1, 
                                  load_node_func=mock_load_node)
    neighbor_files = [n['filename'] for n in neighbors]
    assert 'node1.md' in neighbor_files
    assert 'node2.md' in neighbor_files
    assert 'node3.md' not in neighbor_files
    assert 'node4.md' not in neighbor_files
    
    # Verify distance is set correctly
    for neighbor in neighbors:
        assert neighbor['distance_from_target'] == 1
    
    # Test radius 2 - should get neighbors and their neighbors
    neighbors = get_neighborhood('target.md', connections, radius=2,
                                  load_node_func=mock_load_node)
    neighbor_files = [n['filename'] for n in neighbors]
    assert 'node1.md' in neighbor_files
    assert 'node2.md' in neighbor_files  
    assert 'node3.md' in neighbor_files
    assert 'node4.md' in neighbor_files
    
    # Verify distances
    for neighbor in neighbors:
        if neighbor['filename'] in ['node1.md', 'node2.md']:
            assert neighbor['distance_from_target'] == 1
        else:
            assert neighbor['distance_from_target'] == 2
    
    # Test radius 0 - should get no neighbors
    neighbors = get_neighborhood('target.md', connections, radius=0,
                                  load_node_func=mock_load_node)
    assert len(neighbors) == 0