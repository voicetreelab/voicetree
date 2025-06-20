# this file runs VoiceTree on sample input and then gets an LLM to rate the quality of the output.

# take in a voice transcript file, such as /Users/bobbobby/repos/VoiceTreePoc/oldVaults/boeing/boeing_transcript.txt

# run VoiceTree system on this content, run it at 7 requests per minute, such that we don't get rate limited

# add n lines into the buffer per request until buffer full enough to be processed.

# Then, input into gemini pro the transcript and the resulting markdown files (e.g using PackageProjectForLLM)

# ask it the following prompt:

# Please evaluate the quality of the output versus the input. Score the quality on a scale of: Unusable, Poor, Acceptable, Good, Perfect.

# Then write to a quality log file the date, most recent git commit name and hash, and then quality score and comments.

#todo: include photo of tree?

#todo: include best representation of tree as text in prompt

import asyncio
import logging
import shutil
import time
import subprocess
import os
from datetime import datetime

import google.generativeai as genai
from google.generativeai import GenerativeModel

from process_transcription import TranscriptionProcessor
from tree_manager.text_to_tree_manager import ContextualTreeManager
from tree_manager.decision_tree_ds import DecisionTree
from tree_manager.tree_to_markdown import TreeToMarkdownConverter
import settings
import PackageProjectForLLM

# Configure Gemini API
genai.configure(api_key=settings.GOOGLE_API_KEY)

# Constants
REQUESTS_PER_MINUTE = 15  # to avoid breaching 15RPM gemini limit
SECONDS_PER_REQUEST = 60 / REQUESTS_PER_MINUTE
OUTPUT_DIR = "/Users/bobbobby/repos/VoiceTreePoc/oldVaults/VoiceTreePOC/QualityTest"  # Replace with your desired output directory
QUALITY_LOG_FILE = "quality_log.txt"


async def process_transcript_with_voicetree(transcript_file):
    """Processes a transcript file with VoiceTree."""
    decision_tree = DecisionTree()
    tree_manager = ContextualTreeManager(decision_tree)
    converter = TreeToMarkdownConverter(decision_tree.tree)
    #first copy all files in QualityTest to ../OLDQualityTest
    BACKUP_DIR = "/Users/bobbobby/repos/VoiceTreePoc/oldVaults/VoiceTreePOC/OLDQualityTest"

    # Backup existing files in OUTPUT_DIR to BACKUP_DIR
    if os.path.exists(BACKUP_DIR):
        BACKUP_DIR = BACKUP_DIR + str(datetime.now())

    shutil.copytree(OUTPUT_DIR, BACKUP_DIR)

    #copy the local voicetree.log to backup_dir
    VOICE_TREE_LOG_FILE = "voicetree.log"
    if os.path.exists(VOICE_TREE_LOG_FILE):
        shutil.move(VOICE_TREE_LOG_FILE, os.path.join(BACKUP_DIR, VOICE_TREE_LOG_FILE))

    # Clear the OUTPUT_DIR for fresh slate
    shutil.rmtree(OUTPUT_DIR)
    os.makedirs(OUTPUT_DIR)


    processor = TranscriptionProcessor(tree_manager, converter, OUTPUT_DIR)

    with open(transcript_file, "r") as f:
        lines = f.readlines()

    buffer = ""
    for i in range(0, len(lines)):
        buffer += lines[i]

        if len(buffer) > tree_manager.text_buffer_size_threshold:
            await processor.process_and_convert(buffer)
            buffer = ""
            time.sleep(SECONDS_PER_REQUEST)  # Rate limiting

    # Process any remaining buffer content
    if buffer:
        await processor.process_and_convert(buffer)


def evaluate_tree_quality(transcript_file):
    """Evaluates the quality of the generated tree using an LLM."""
    # Package the Markdown output for the LLM
    packaged_output = PackageProjectForLLM.package_project(OUTPUT_DIR, ".md")

    # Construct the evaluation prompt
    prompt = (
        f"I have a system which converts in real-time, spoken voice into a content tree (similar to a mind-map)"
        "Please evaluate the quality of the output (Markdown files) generated from the following transcript\n\n"
        """
        You are an expert at evaluating the quality of decision trees created from spoken transcripts. 

        Here are the criteria for evaluating tree quality:
        
        * **Accuracy & Completeness:**  The tree should accurately represent the key information, points, and decisions from the transcript. It should include all essential information without significant omissions.
        * **Coherence:** The tree should be structured logically, with clear parent-child relationships between nodes. The connections between nodes should be meaningful and easy to follow.
        * **Conciseness:**  The tree should be free of redundancy. Each node should contain unique information and avoid repeating points already covered in other nodes.
        * **Relevance:**  The tree should prioritize the most important information from the transcript, focusing on key decisions and outcomes.
        * **Node Structure:** The tree should effectively separate distinct ideas into individual nodes.  There should be a balance between the number of nodes and their size.  Avoid creating too few large, unfocused nodes or too many small, fragmented nodes.  
        
        ## Scoring:
        
        Rate each dimension on a scale of 1 to 5, where:
        
        * 1: Unusable
        * 2: Poor 
        * 3: Acceptable
        * 4: Good
        * 5: Excellent
        
        Now, evaluate the following decision tree created from a spoken transcript:
        
        Provide a detailed evaluation of the tree's quality, addressing each of the criteria listed above.
         Outline a positive and a negative for each category. 
         Use specific examples from the tree to support your points.  
         Be sure to include a score for each dimension.
         Spend some time brainstorming, and allowing yourself time to think, 
         then work out the best answer in a step-by-step way to be sure we have the right answer. 
        """
        f"```{open(transcript_file, 'r').read()}```\n\n"
        f"And here is the output, I will want you to assess the quality of the outputted markdown files and tree structure"
        "Markdown Output:\n\n"
        f"```{packaged_output}```\n\n"
        "Evaluate the tree. Please also include one final overall score, and a short summary of where the biggest areas for improvement are"
    )

    logging.info("Assess quality prompt:\n" + prompt)

    #     """
    #     ## Example:
    #
    # Here is an example of a transcript and a high-quality decision tree:
    #
    # **Transcript:**
    # We need to plan a marketing campaign for our new product launch.  First, we should define our target audience.  Who are we trying to reach? Then, we need to decide on our marketing channels. Will we use social media, email, or paid advertising?  Finally, we need to set a budget for the campaign.
    #
    # **Decision Tree:**
    #
    # ## Marketing Campaign Plan
    # -  Define Target Audience
    #     -  Research demographics, interests, and needs.
    # -  Choose Marketing Channels
    #     -  Social media strategy.
    #     -  Email marketing plan.
    #     -  Consider paid advertising options.
    # -  Set Campaign Budget
    #     -  Allocate funds across channels.
    #     -  Track return on investment (ROI)."""

    # Get the most recent Git commit information
    commit_hash = subprocess.check_output(['git', 'rev-parse', 'HEAD']).decode('utf-8').strip()
    commit_message = subprocess.check_output(['git', 'log', '-1', '--pretty=%B']).decode('utf-8').strip()

    # Use Gemini Pro for evaluation
    model = GenerativeModel('models/gemini-1.5-pro-latest')
    response = model.generate_content(prompt)
    evaluation = response.text.strip()

    # Write to the quality log file
    with open(QUALITY_LOG_FILE, "a") as log_file:
        log_file.write(f"Date: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
        log_file.write(f"Git Commit: {commit_message} ({commit_hash})\n")
        log_file.write(f"Quality Score: {evaluation}\n\n")


async def main():
    transcript_file = "/Users/bobbobby/repos/VoiceTreePoc/oldVaults/VoiceTreePOC/transcript.txt"  # Replace with your transcript file
    await process_transcript_with_voicetree(transcript_file)
    evaluate_tree_quality(transcript_file)


if __name__ == "__main__":
    asyncio.run(main())
