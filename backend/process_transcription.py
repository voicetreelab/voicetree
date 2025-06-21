import logging
import time
import traceback

logging.basicConfig(filename='../voicetree.log', level=logging.INFO,
                    format='%(asctime)s - %(levelname)s - %(message)s')

import os
from datetime import datetime

output_dir_base = "/markdownTreeVault"
# Get current date in short form (e.g., "2024-06-13")
date_str = datetime.now().strftime("%Y-%m-%d")

# Create output directory with date appended
output_dir_default = os.path.join(output_dir_base, date_str)

class TranscriptionProcessor:
    def __init__(self, tree_manager, converter, output_dir=output_dir_default):
        self.tree_manager = tree_manager
        self.converter = converter
        self.output_dir = output_dir

    async def process_and_convert(self, text):
        try:
            logging.info(f"Processing transcribed text: {text}")
            text = text.replace("Thank you.", "") #todo, whisper keeps on hallucinating thank you
            start_time = time.time()

            logging.info(f"TranscriptionProcessor.process_and_convert calling process_voice_input with: '{text}'")
            await self.tree_manager.process_voice_input(text)

            self.converter.convert_node(output_dir=self.output_dir,
                                        nodes_to_update=self.tree_manager.nodes_to_update)

            self.tree_manager.nodes_to_update.clear()

            elapsed_time = time.time() - start_time
            logging.info(f"Processing transcribed text took: {elapsed_time:.4f} seconds")


        except Exception as e:
            logging.error(
                f"Error in convert_text_to_markdown_tree_node: {e} "
                f"- Type: {type(e)} - Traceback: {traceback.format_exc()}")

    async def finalize(self):
        """Finalize processing - convert any remaining nodes to markdown"""
        try:
            logging.info("Finalizing transcription processing")
            self.converter.convert_node(output_dir=self.output_dir,
                                        nodes_to_update=self.tree_manager.nodes_to_update)
            self.tree_manager.nodes_to_update.clear()
        except Exception as e:
            logging.error(f"Error in finalize: {e} - Type: {type(e)} - Traceback: {traceback.format_exc()}")
