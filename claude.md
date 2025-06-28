# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

VoiceTree is a Python backend system that converts voice input into structured graphs using an LLM agentic pipeline. The system transcribes audio, processes it through agentic workflows, and outputs interconnected markdown files representing ideas as a visual tree.

## Essential Commands

See "Essential Commands" section in README-dev.md for development testing commands.

### Environment Setup
```bash
# Install dependencies
pip install -r requirements.txt

# Required: Set Google Gemini API key
export GOOGLE_API_KEY="your_gemini_api_key"  # Get from Google AI Studio
```

## Architecture & Code Structure

For detailed architecture information, see the "Current Architecture" section in README-dev.md.

## Development Guidelines

For quality debugging workflow and development philosophy, see README-dev.md.

## Key Documentation

For deeper understanding, read these files in order:
1. `README-dev.md` - High-level developer overview
2. `backend/benchmarker/Benchmarker_Agentic_feedback_loop_guide.md` - Primary developer guide for improving system and handling benchmarker results.
4. `backend/README-dev.md` - Backend architecture details
5. Component-specific `README-dev.md` files in major directories

