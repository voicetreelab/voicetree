## Voicetree

**Obsidian meets Claude Code**

Voicetree is an interactive graph-view where nodes are either markdown notes, or terminal based agents (Claude code, Codex, OpenCode, Gemini etc. )

Agents can spawn their own subagents onto the graph. Agents will have the nearby nodes injected into their context. 
Agents are also able to edit and create their own nodes.

This project aims to build from first principles the most possibly efficient human-AI interaction system. 

![Voicetree Demo](meta/core_loop_only_agents.gif)

[![Build](https://github.com/voicetreelab/voicetree/actions/workflows/release.yml/badge.svg)](https://github.com/voicetreelab/voicetree/actions/workflows/release.yml)
[![macOS](https://img.shields.io/badge/macOS-supported-blue)](https://github.com/voicetreelab/voicetree/releases/latest/download/voicetree-arm64.dmg)
[![Windows](https://img.shields.io/badge/Windows-supported-blue)](https://github.com/voicetreelab/voicetree/releases/latest/download/voicetree.exe)
[![Linux](https://img.shields.io/badge/Linux-supported-blue)](https://github.com/voicetreelab/voicetree/releases/latest/download/voicetree.AppImage)
[![Discord](https://img.shields.io/badge/Discord-Join%20Server-5865F2?style=flat&logo=discord&logoColor=white)](https://discord.gg/r2ZBtJ9zvk)


### Why?

| Challenge                                 | Voicetree Solution                                                                    |
|-------------------------------------------|---------------------------------------------------------------------------------------|
| Manual agent coordination                 | Agents can breakdown tasks into subgraphs and recursively spawn children terminals |
| 4-10 agent terminals is overwhelming      | Spatially organise agents, tasks and progress on the graph                            |
| Agents don't know what you know           | You share the same memory graph with agents                                           |
| Agents suffer context-rot and lack memory | Defaults to short, focussed sessions with automatic handover                          |

## Install

Download links [macOS (Apple Silicon)](https://github.com/voicetreelab/voicetree/releases/latest/download/voicetree-arm64.dmg) | [macOS (Intel)](https://github.com/voicetreelab/voicetree/releases/latest/download/voicetree-x64.dmg) | [Windows](https://github.com/voicetreelab/voicetree/releases/latest/download/voicetree.exe) | [Linux](https://github.com/voicetreelab/voicetree/releases/latest/download/voicetree.AppImage)

MacOS
```bash
brew tap voicetreelab/voicetree && brew install voicetree
```
Linux
```bash
curl -fsSL https://raw.githubusercontent.com/voicetreelab/voicetree/main/install.sh | sh
```
Windows:
https://github.com/voicetreelab/voicetree/releases/latest/download/voicetree.exe

---

## How It Works

Your agents (Claude Code, Codex, Opencode, Gemini etc.) live inside the graph, next to their tasks, plans, and progress updates.

**Context retrieval:** Agents see all nodes within a configurable radius and can semantic search against local embeddings.

**Spatial layout:** Location-based memory is the most efficient way to remember things.

**Externalized working memory:** Each node represents a concept at any level of abstraction. The graph structure mirrors your mental model - relationships between ideas are represented exactly as you think about them, offloading cognitive load to the canvas.


### In Detail

Nodes are markdown files, connections are wikilinks to the .md file paths. You open rich markdown editors directly within the graph by hovering over a node, (or use speech-to-graph mode).

You can spawn coding agents on a node, the contents of that node will become the agents task, and it will also be given all context within an adjustable distance around them, and can semantic search against local embeddings. This means agents see what you see. You share the same memory, the same second brain.
The graph structure allows for context retrieval to be targeted to only what is most relevant rather than dumping entire conversation history - avoiding the 30-60% performance degradation from context rot[^1].

Agents can build their own subgraphs, decomposing their tasks into small connected chunks of work. You can glance at the high-level structure and progress of these, and zoom in to the details of what matters most.
For example, ask a Voicetree agent to divide their plan into nodes of data-model, architecture, pure logic, edge logic, UI components, and integration. This lets you carefully track the planing to implementation for what matters most: the high level changes & core logic.

Agents can then spawn and orchestrate their own parallel subagents to work through these dependency graphs. In Voicetree, subagents are just native terminals so you have full transparency and control over them unlike with other CLI agents.

As your project & context grows, the Voicetree approach scales. You use your brains most efficient form of memory: remembering the location of where things are.
Each node can represent any concept at any level of abstraction. You can see and reason about the structure between these concepts more easily as it is represented exactly as your brain represented them. This lets you externalise your working memory, freeing up cognitive load for the real problem-solving.

---

## Voice Mode

Capture ideas hands-free with speech-to-graph.

**Why speaking works:** Speaking activates deliberate (System 2) thinking - verbalizing forces you to think about what you are doing. Japanese train conductors use "point and calling" (shisa kanko) to reduce errors by 85% for the same reason. Speech also engages different brain regions than writing, with lower cognitive load for idea generation. It's usually messy and hard to store/retrieve, so we turn voice into a structured mindmap.

**Backtracking without mental load:** Go arbitrarily deep down a problem. The graph holds the chain of "why am I doing this?" so you don't have to.

**Tangibility:** Thought becomes visible and persistent. This isn't just documentation; Making progress tangible is a prerequisite for flow states.

---

## Development

**Prerequisites:** Node.js 18+, Python 3.13, uv

```bash
cd webapp && npm install && npm run electron  # App
uv sync && uv run pytest                               # Backend
```

## License

BSL 1.1, converts to Apache 2.0 after 4 years. See [LICENSE](LICENSE).

### Telemetry

We collect anonymous usage telemetry. You can disable this by setting `VITE_DISABLE_ANALYTICS=true` in `webapp/.env`. You can read more about this [here](https://voicetree.io/docs/Privacy+Policy).

## Contact

Questions? [Join the Discord.](https://discord.gg/r2ZBtJ9zvk) Feedback is valuable - ping us with thoughts, criticisms, or feature requests.


[^1]: Chroma Research, "Context Rot: How Increasing Input Tokens Impacts LLM Performance" (July 2025). 30-60% performance gaps between focused (~300 token) and full (~113k token) prompts. https://research.trychroma.com/context-rot
