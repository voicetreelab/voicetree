import re


def extract_summary(node_content):
    # extract summary from rewritten_content
    # find the first text in between **text**
    # or fallback to first ##+ a title

    summary_re: re.Match[str] | None = re.search(r'\*\*(.+)\*\*', node_content, re.DOTALL)
    if not summary_re:
        summary_re = re.search(r'#+(.*)', node_content)
        if not summary_re:
            return "unable to extract summary"

    summary: str = summary_re.group(1).strip()
    return summary


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
