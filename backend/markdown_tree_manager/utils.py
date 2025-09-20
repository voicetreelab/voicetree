import re
from typing import Any
from typing import Dict
from typing import List

# Node import moved inside functions to avoid circular imports


def extract_summary(node_content):
    """
    Extract summary from node content with improved fallback logic
    """
    if not node_content or not node_content.strip():
        return "Empty content"
    
    # Try to find text in between **text**
    summary_re = re.search(r'\*\*(.+?)\*\*', node_content, re.DOTALL)
    if summary_re:
        summary = summary_re.group(1).strip()
        if summary and len(summary) > 3:  # Ensure it's meaningful
            return summary
    
    # Try to find markdown headers (##+ title)
    header_re = re.search(r'^#+\s*(.+)', node_content, re.MULTILINE)
    if header_re:
        summary = header_re.group(1).strip()
        if summary and len(summary) > 3:
            return summary
    
    # Try to find the first meaningful sentence
    lines = node_content.strip().split('\n')
    for line in lines:
        line = line.strip()
        if line and not line.startswith('#') and not line.startswith('-') and len(line) > 10:
            # Take first sentence or first 60 characters
            if '.' in line:
                first_sentence = line.split('.')[0].strip()
                if len(first_sentence) > 10:
                    return first_sentence
            elif len(line) <= 60:
                return line
            else:
                return line[:60].strip() + "..."
    
    # Final fallback - use first non-empty line
    for line in lines:
        line = line.strip()
        if line and not line.startswith('#') and not line.startswith('-'):
            return line[:50].strip() + ("..." if len(line) > 50 else "")
    
    return "Content summary unavailable"


def deduplicate_content(content):
    """
    Remove duplicate sentences and clean up content

    Args:
        content: Text content that may contain duplicates

    Returns:
        Cleaned content with duplicates removed
    """
    if not content or not content.strip():
        return content

    # Split into sentences
    sentences = re.split(r'[.!?]+', content)
    seen_sentences = set()
    unique_sentences = []

    for sentence in sentences:
        sentence = sentence.strip()
        if not sentence:
            continue

        # Normalize sentence for comparison (lowercase, remove extra spaces)
        normalized = ' '.join(sentence.lower().split())

        # Only add if we haven't seen this sentence before
        if normalized not in seen_sentences and len(normalized) > 5:  # Ignore very short fragments
            seen_sentences.add(normalized)
            unique_sentences.append(sentence)

    # Rejoin sentences with proper punctuation
    result = '. '.join(unique_sentences)
    if result and not result.endswith('.'):
        result += '.'

    return result


def extract_complete_sentences(text_chunk) -> str:
    """
    Extracts complete sentences from the text buffer, leaving any incomplete
    sentence in the buffer.
    Returns:
        str: The extracted complete sentences.
    """
    # Split into sentences using nltk-like approach but simpler
    # First, handle ellipses as incomplete sentences
    if text_chunk.rstrip().endswith('...'):
        # Find the last sentence that ends with proper punctuation before the ellipses
        # Split by ellipses first
        parts = text_chunk.split('...')
        if len(parts) > 1:
            # Everything before the last part (which contains ellipses)
            text_before_ellipses = '...'.join(parts[:-1])
            # Check if there are complete sentences in the part before ellipses
            if text_before_ellipses.strip():
                # Find the last proper sentence ending
                matches = re.findall(r'[^.!?]*[.!?]', text_before_ellipses)
                if matches:
                    return ''.join(matches).strip()
        return ""
    
    # For regular case, find all complete sentences
    # This regex captures text ending with . ! or ? (but not ...)
    matches = re.findall(r'[^.!?]*[.!?](?![.])', text_chunk)
    
    if matches:
        return ''.join(matches).strip()
    else:
        return ""  # No complete sentence found


# simpler/faster version:
# last_sentence_end = re.search(r"[.!?][\s\n]*$", self.text_buffer)
# text_to_process = ""
# if last_sentence_end:
#     text_to_process = self.text_buffer[:last_sentence_end.end()]

# return text_to_process

def remove_first_word(sentence):
    if sentence:
        sentence = sentence.split(' ', 1)[1]
    return sentence


def insert_yaml_frontmatter(key_value_pairs: Dict[str, Any]) -> str:
    """
    Generate YAML frontmatter from a dictionary of key-value pairs.
    Properly handles special characters by using YAML serialization.
    
    Args:
        key_value_pairs: Dictionary containing the frontmatter keys and values
        
    Returns:
        Formatted YAML frontmatter string with opening and closing delimiters
        
    Example:
        >>> insert_yaml_frontmatter({"title": "My Node", "tags": ["important", "todo"]})
        '---\\ntitle: My Node\\ntags:\\n  - important\\n  - todo\\n---\\n'
    """
    if not key_value_pairs:
        return ""
    
    import yaml
    
    # Sanitize keys and values to handle special characters
    sanitized_pairs = dict()
    for key, value in key_value_pairs.items():
        # Sanitize the key (remove problematic characters for YAML keys)
        clean_key = _sanitize_yaml_key(key)
        
        # Keep the value as-is, YAML serialization will handle special characters
        sanitized_pairs[clean_key] = value
    
    # Use YAML dump to properly serialize the data
    yaml_content = yaml.dump(sanitized_pairs, default_flow_style=False, allow_unicode=True)
    
    # Format as frontmatter with delimiters
    return f"---\n{yaml_content}---\n"


def _sanitize_yaml_key(key: str) -> str:
    """
    Sanitize YAML keys by removing or replacing problematic characters.
    
    Args:
        key: The original key string
        
    Returns:
        Sanitized key safe for YAML
    """
    # Remove or replace characters that can break YAML keys
    # Keep alphanumeric, underscore, hyphen
    import re
    
    # Replace problematic characters with underscores
    sanitized = re.sub(r'[^\w\-]', '_', key)
    
    # Remove consecutive underscores
    sanitized = re.sub(r'_+', '_', sanitized)
    
    # Remove leading/trailing underscores
    sanitized = sanitized.strip('_')
    
    # If empty after sanitization, provide a default
    if not sanitized:
        sanitized = 'key'
    
    return sanitized


def get_node_summaries(decision_tree, max_nodes) -> str:
    """
    Get node summaries from decision tree

    Args:
        decision_tree: Decision tree object with tree attribute containing nodes
        max_nodes: Maximum number of recent nodes to include

    Returns:
        String with node summaries
    """
    node_summaries = []
    node_ids = decision_tree.get_recent_nodes(max_nodes)
    for node_id in node_ids:
        node = decision_tree.tree[node_id]
        if hasattr(node, 'title') and hasattr(node, 'summary'): # todo, title or name?
            node_summaries.append(f"{node.title}: {node.summary}")

    return "\n".join(node_summaries) if node_summaries else "No existing nodes yet"


def map_titles_to_node_ids(titles: List[str], nodes: List, fuzzy_match: bool = True) -> List[int]:
    """Map node titles to their IDs, with optional fuzzy matching

    Args:
        titles: List of node titles to map
        nodes: List of Node objects to search
        fuzzy_match: If True, attempts fuzzy matching for unmatched titles

    Returns:
        List of node IDs corresponding to the titles
    """
    title_to_id = {node.title: node.id for node in nodes}
    node_ids = []

    for title in titles:
        if title in title_to_id:
            node_ids.append(title_to_id[title])
        elif fuzzy_match:
            # Simple fuzzy match: case-insensitive partial match
            matched = False
            for node in nodes:
                if title.lower() in node.title.lower() or node.title.lower() in title.lower():
                    node_ids.append(node.id)
                    matched = True
                    break
            if not matched:
                import logging
                logging.warning(f"No match found for title: '{title}'")

    return node_ids


def generate_filename_from_keywords(node_title, max_keywords=3):
    """Generate a filename from node title by cleaning and formatting it.

    Args:
        node_title: The title to convert to filename
        max_keywords: Maximum keywords to use (not currently implemented)

    Returns:
        Cleaned filename with .md extension
    """
    import re

    file_name = node_title
    file_name = re.sub(r'summary\s*:', '', file_name, flags=re.IGNORECASE)  # Remove "summary:"
    file_name = re.sub(r'#+\s*title\s*:', '', file_name, flags=re.IGNORECASE)  # Remove "## title"

    # Allow only letters, numbers, hyphens, and underscores
    # Replace all other characters with underscores
    file_name = re.sub(r'[^a-zA-Z0-9_-]', '_', file_name)

    # Replace multiple consecutive underscores with a single underscore
    file_name = re.sub(r'_+', '_', file_name)

    # Remove leading and trailing underscores
    file_name = file_name.strip('_')

    # Ensure filename is not empty
    if not file_name:
        file_name = "untitled"

    return file_name + ".md"


def slugify(text):
    """Converts text to a valid filename."""
    import re
    text = text.lower()
    text = re.sub(r'[^a-z0-9]+', '_', text)
    text = text.strip('_')
    return text
