"""
Legacy quality benchmarker file - redirects to new modular implementation.

The quality benchmarker has been refactored into a modular structure.
Please use: python -m backend.benchmarker.quality_tests.quality_LLM_benchmarker
"""

import asyncio
import sys
import os

# Add parent directories to path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../..')))

from quality_tests.quality_LLM_benchmarker import main


if __name__ == "__main__":
    print("Note: This file has been refactored. The implementation is now in backend/benchmarker/quality_tests/")
    print("Running the new modular implementation...\n")
    asyncio.run(main())