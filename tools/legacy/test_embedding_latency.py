import os
import time
from statistics import mean
from statistics import stdev

import numpy as np
from dotenv import load_dotenv
from google import genai
from google.genai import types

# Load environment variables
load_dotenv()

# Get API key
api_key = os.environ.get("GOOGLE_API_KEY")
if not api_key:
    print("ERROR: GOOGLE_API_KEY not found in environment variables")
    print("Please set GOOGLE_API_KEY or add it to .env file")
    exit(1)

client = genai.Client(api_key=api_key)

# Test queries of different lengths
test_queries = [
    "machine learning",  # Short
    "What are the key concepts in machine learning?",  # Medium
    "I want to understand the fundamental concepts of machine learning including supervised and unsupervised learning, neural networks, and deep learning architectures"  # Long
]

print("Testing Google Gemini Embedding API latency...\n")

for query in test_queries:
    latencies = []
    
    # Run 5 tests for each query
    for i in range(5):
        start_time = time.time()
        
        result = client.models.embed_content(
            model="gemini-embedding-001",
            contents=query,
            config=types.EmbedContentConfig(task_type="RETRIEVAL_QUERY")
        )
        
        end_time = time.time()
        latency = (end_time - start_time) * 1000  # Convert to ms
        latencies.append(latency)
        
        print(f"Query length {len(query)} chars - Test {i+1}: {latency:.0f}ms")
    
    avg_latency = mean(latencies)
    std_latency = stdev(latencies) if len(latencies) > 1 else 0
    
    print(f"\nQuery: '{query[:50]}...'" if len(query) > 50 else f"\nQuery: '{query}'")
    print(f"Average latency: {avg_latency:.0f}ms (±{std_latency:.0f}ms)")
    print(f"Min: {min(latencies):.0f}ms, Max: {max(latencies):.0f}ms")
    print("-" * 60)

print("\nSUMMARY:")
print("If average latency is consistently under 300ms, vector search is viable.")
print("Otherwise, consider keyword search or caching strategies.")