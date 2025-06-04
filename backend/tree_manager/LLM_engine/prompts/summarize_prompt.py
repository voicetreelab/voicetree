def create_summarization_prompt(text, transcript_history):
    """Constructs the prompt for the LLM to summarize text and generate a title."""

    return (
        """
        You are a meeting note-taker, skilled at summarizing key points and decisions concisely.
        You will be provided with a transcript history for context, and a new transcript that is required to be 
        summarized.
        focus on the content in the new user input, do not include any content from the transcript history in your summary,
        only use that to provide yourself context, such that your summary can be maximally concise, 
        as you can assume the history has already been summarized, and this new content 
        will be appended to the existing summary.\n
        Write in shortform, do not include pronouns,
        focus on the core information, rather than how the information was communicated.
        """
        "Format the summary using Markdown, including:\n"
        "* A title of up to 7 words (## My Title)\n"
        "* A concise summary of the content, up to one paragraph in length. (**my summary**)\n"
        "* bullet points for points and details not obvious from the above summary.\n\n"
        "Here's an example:\n\n"
        "Previous conversation to provide context: \n"
        "```\n"
        "We need to come up with a name for the new project. We also need to decide on the technology we'll be using. "
        "We're considering Python, but are open to other options.\n"
        "We also need to figure out the key features and what makes this project unique.\n"
        "```\n\n"
        "New user input:\n"
        "```\n"
        "So I think we should call it 'Project Phoenix.' It'll be built using Python, and it'll heavily leverage "
        "machine learning for predictive analysis. We'll also incorporate a user-friendly interface to make it "
        "accessible to a wide audience.\n"
        "```\n\n"
        "Your summary:\n"
        "```\n"
        "## Project Phoenix Decisions\n"
        "\n"
        "**This node outlines the name, chosen technology stack, and key features for the new project.**\n"
        "\n"
        "- Project Name: Project Phoenix\n"
        "- Technology: Python\n"
        "- Machine learning for predictive analysis\n"
        "- User-friendly interface for broad accessibility\n"
        "```\n\n"
        "Consider the context of the previous conversation to avoid redundancy in your summary:\n"
        f"```{transcript_history}```\n\n"
        "New user input:\n"
        f"```{text}```\n\n"
        "Your summary of the new user input:\n"
    )