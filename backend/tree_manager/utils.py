import re


def extract_summary(node_content):
    # todo this should no longer be neccessary if we are getting LLM to return structured data.
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

    # removed this since it is pointless,  we should't be explictitly deduping content
    # let's jsut make sure our system has no duplication points in the first place


    # if not content or not content.strip():
    #     return content
    
    # # Split into sentences
    # sentences = re.split(r'[.!?]+', content)
    # seen_sentences = set()
    # unique_sentences = []
    
    # for sentence in sentences:
    #     sentence = sentence.strip()
    #     if not sentence:
    #         continue
            
    #     # Normalize sentence for comparison (lowercase, remove extra spaces)
    #     normalized = ' '.join(sentence.lower().split())
        
    #     # Only add if we haven't seen this sentence before
    #     if normalized not in seen_sentences and len(normalized) > 5:  # Ignore very short fragments
    #         seen_sentences.add(normalized)
    #         unique_sentences.append(sentence)
    
    # # Rejoin sentences with proper punctuation
    # result = '. '.join(unique_sentences)
    # if result and not result.endswith('.'):
    #     result += '.'



    return content


def extract_complete_sentences(text_chunk) -> str:
    """
    Extracts complete sentences from the text buffer, leaving any incomplete
    sentence in the buffer.
    Returns:
        str: The extracted complete sentences.
    """
    # todo, this is stupid, we shouldn't be assuming any punctuation from our voice to text engine.
    # they aren't that good at generating grammar, and it also just simplifies our system a lot if we only use a length based buffering system. so todo is remove and do that instead.

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
