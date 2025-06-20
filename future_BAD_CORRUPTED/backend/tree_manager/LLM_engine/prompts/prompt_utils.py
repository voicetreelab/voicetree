def remove_first_word(sentence):
    if sentence:
        sentence = sentence.split(' ', 1)[1]
    return sentence


def summarize_node_content(node_content: str, max_length: int = 400) -> str:
    """Summarizes node content to a maximum length."""
    # TODO Implement summarization logic here (e.g., using an LLM or simple truncation)
    # for now could just extract the titles

    return node_content.replace("#", "")
    # [:max_length]  # Replace with your actual summarization



