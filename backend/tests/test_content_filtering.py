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
            'filename': 'root.md',
            'title': 'Root Node',
            'summary': 'This is the root',
            'content': 'Full root content here',
            'distance_from_target': 5
        },
        {
            'filename': 'far.md', 
            'title': 'Far Node',
            'summary': 'Far from target',
            'content': 'Full far content',
            'distance_from_target': 4
        },
        {
            'filename': 'medium.md',
            'title': 'Medium Node', 
            'summary': 'Medium distance',
            'content': 'Full medium content',
            'distance_from_target': 2
        },
        {
            'filename': 'close.md',
            'title': 'Close Node',
            'summary': 'Close to target',
            'content': 'Full close content',
            'distance_from_target': 1
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
    
    # Far nodes (distance > 3) should have titles only
    assert filtered_nodes[0]['title'] == 'Root Node'
    assert filtered_nodes[0]['summary'] is None
    assert filtered_nodes[0]['content'] is None
    assert filtered_nodes[1]['title'] == 'Far Node'
    assert filtered_nodes[1]['summary'] is None
    assert filtered_nodes[1]['content'] is None
    
    # Medium nodes (distance 1-3) should have titles and summaries
    assert filtered_nodes[2]['title'] == 'Medium Node'
    assert filtered_nodes[2]['summary'] == 'Medium distance'
    assert filtered_nodes[2]['content'] is None
    
    # Close nodes (distance 0-1) should have full content
    assert filtered_nodes[3]['title'] == 'Close Node'
    assert filtered_nodes[3]['summary'] == 'Close to target'
    assert filtered_nodes[3]['content'] == 'Full close content'
    assert filtered_nodes[4]['title'] == 'Target Node'
    assert filtered_nodes[4]['summary'] == 'This is the target'
    assert filtered_nodes[4]['content'] == 'Full target content'
    
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
        # Original summary should be preserved if it existed
        if node['distance_from_target'] <= 3:
            assert node['summary'] is not None
        assert node['content'] is None


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