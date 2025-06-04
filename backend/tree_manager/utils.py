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
    last_sentence_end_matches = re.findall(r"[.!?)]", text_chunk)

    if last_sentence_end_matches:
        last_sentence_end = last_sentence_end_matches[-1]
        last_sentence_end_index = text_chunk.rfind(last_sentence_end) + len(last_sentence_end)
        text_to_process = text_chunk[:last_sentence_end_index]
        return text_to_process
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
