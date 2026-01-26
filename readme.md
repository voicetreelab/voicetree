## The spatial IDE for recursive multi-agent orchestration.

### The Problem

You're running 4 coding agents across different terminal panes. You switch to one and scroll through history trying to figure out what it's doing. Then the next. Constantly rebuilding that mental model is exhausting.
When an agent finishes and your feature is still half-built, you start a fresh session to avoid context-rot. You write a HANDOVER.md to get the new agent up to speed. An hour later you have 20 handover files. What's the state of each feature? Which ones still need planning? What should the agents be doing next? It's an unorganized mess, and you're back to prompting from scratch, losing the context you and your agents had slowly built together

### The Solution

Voicetree is a canvas where every agent sits next to its task, planning documents, and progress updates. All visible at a glance. The closer something is, the more relevant it is.

Now you can effortlessly switch between swarms of parallel agents across your project. Your project becomes an interactive graph view made of markdown files and terminals. All stored locally.

## Installation

### macOS (Apple Silicon)

Download directly or install via Homebrew:

```bash
brew tap voicetreelab/voicetree && brew install voicetree
```

### macOS (Intel)

Download directly or install via Homebrew:

```bash
brew tap voicetreelab/voicetree && brew install voicetree
```

### Windows

Download the Windows installer from [releases](https://github.com/voicetreelab/voicetree/releases).

### Linux

Download the AppImage or install via script:

```bash
curl -fsSL https://raw.githubusercontent.com/voicetreelab/voicetree/main/install.sh | sh
```


**Discord community:** https://discord.gg/3z4Gbquv

### Divide and Conquer

Long, complex tasks make agents unpredictable. Simple, isolated tasks make them reliable.

VoiceTree lets you break work into subtasks: what needs to happen, in what order, and what can run in parallel. Each agent gets one clear job. When agents are reliable, their outputs become building blocks — you assemble massive projects fractally from tiny tasks.

### Transparent Orchestration

Agents can spawn their own subagents automatically. In other tools, this is invisible. In VoiceTree, every subagent is fully transparent and controllable, running live on the graph in its own terminal.

### Built for Flow

- **No cold starts**: Step away for a minute or a week. The graph will be exactly as you left it.
- **Spatial navigation**: Your project becomes a map you can explore. Agents become landmarks, not just another terminal pane.
- **Hackable**: Everything is stored on-device as markdown files. Keep your same Claude settings and workflows.
- **Efficient**: Pruning context leads to ammoritzed fewer input tokens and more accurate responses.


## Beyond Agents: Voice & Thinking

VoiceTree also works as a tool for thinking. Use speech-to-graph mode to capture ideas hands-free — your voice becomes nodes on the canvas.

**Use cases:**
- **Day-to-day work**: Organize tasks and decisions as you think through them
- **Deep problem-solving**: Let the graph offload your working memory, freeing your cognition
- **Human-agent collaboration**: Build the graph yourself, then let agents continue in the background
- **Context compression**: The graph structure naturally solves the LLM long-context problem

Everything is local markdown files. Use it with agents, with voice, or just as a spatial thinking tool.

## Development

### Prerequisites

```bash
# Install dependencies
pip install -r requirements.txt

# Set up API key (save to .env)
echo "GOOGLE_API_KEY=your_gemini_api_key" > .env
```

### Essential Commands

```bash
# Run the main system
python backend/main.py

# Run unit tests
pytest backend/tests/unit_tests

# Run integration tests
pytest backend/tests/integration_tests/

# Run benchmarker for quality testing
python backend/benchmarker/src/quality_LLM_benchmarker.py
```

All tests and scripts should always be run from the root directory for consistency.

## Contact

Need help? Reach out to us at hello@voicetree.io

Feedback is immensely valuable. Email us with any thoughts, criticisms, or feature requests.

## License

This project is licensed under the AGPL-3.0 License - see the [LICENSE](LICENSE) file for details.