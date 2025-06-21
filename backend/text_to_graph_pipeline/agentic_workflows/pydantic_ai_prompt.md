Here is a concise example using PydanticAI to build a support agent for a bank:

(Better documented example in the docs)

from dataclasses import dataclass

from pydantic import BaseModel, Field
from pydantic_ai import Agent, RunContext

from bank_database import DatabaseConn


# SupportDependencies is used to pass data, connections, and logic into the model that will be needed when running
# system prompt and tool functions. Dependency injection provides a type-safe way to customise the behavior of your agents.
@dataclass
class SupportDependencies:
    customer_id: int
    db: DatabaseConn


# This pydantic model defines the structure of the output returned by the agent.
class SupportOutput(BaseModel):
    support_advice: str = Field(description='Advice returned to the customer')
    block_card: bool = Field(description="Whether to block the customer's card")
    risk: int = Field(description='Risk level of query', ge=0, le=10)


# This agent will act as first-tier support in a bank.
# Agents are generic in the type of dependencies they accept and the type of output they return.
# In this case, the support agent has type `Agent[SupportDependencies, SupportOutput]`.
support_agent = Agent(
    'openai:gpt-4o',
    deps_type=SupportDependencies,
    # The response from the agent will, be guaranteed to be a SupportOutput,
    # if validation fails the agent is prompted to try again.
    output_type=SupportOutput,
    system_prompt=(
        'You are a support agent in our bank, give the '
        'customer support and judge the risk level of their query.'
    ),
)


# Dynamic system prompts can make use of dependency injection.
# Dependencies are carried via the `RunContext` argument, which is parameterized with the `deps_type` from above.
# If the type annotation here is wrong, static type checkers will catch it.
@support_agent.system_prompt
async def add_customer_name(ctx: RunContext[SupportDependencies]) -> str:
    customer_name = await ctx.deps.db.customer_name(id=ctx.deps.customer_id)
    return f"The customer's name is {customer_name!r}"


# `tool` let you register functions which the LLM may call while responding to a user.
# Again, dependencies are carried via `RunContext`, any other arguments become the tool schema passed to the LLM.
# Pydantic is used to validate these arguments, and errors are passed back to the LLM so it can retry.
@support_agent.tool
async def customer_balance(
        ctx: RunContext[SupportDependencies], include_pending: bool
) -> float:
    """Returns the customer's current account balance."""
    # The docstring of a tool is also passed to the LLM as the description of the tool.
    # Parameter descriptions are extracted from the docstring and added to the parameter schema sent to the LLM.
    balance = await ctx.deps.db.customer_balance(
        id=ctx.deps.customer_id,
        include_pending=include_pending,
    )
    return balance


...  # In a real use case, you'd add more tools and a longer system prompt


async def main():
    deps = SupportDependencies(customer_id=123, db=DatabaseConn())
    # Run the agent asynchronously, conducting a conversation with the LLM until a final response is reached.
    # Even in this fairly simple case, the agent will exchange multiple messages with the LLM as tools are called to retrieve an output.
    result = await support_agent.run('What is my balance?', deps=deps)
    # The `result.output` will be validated with Pydantic to guarantee it is a `SupportOutput`. Since the agent is generic,
    # it'll also be typed as a `SupportOutput` to aid with static type checking.
    print(result.output)
    """
    support_advice='Hello John, your current account balance, including pending transactions, is $123.45.' block_card=False risk=1
    """

    result = await support_agent.run('I just lost my card!', deps=deps)
    print(result.output)
    """
    support_advice="I'm sorry to hear that, John. We are temporarily blocking your card to prevent unauthorized transactions." block_card=True risk=8
    """


HERE ARE ALL RESOURCES YOU MAY NEED 

# PydanticAI

> Agent Framework / shim to use Pydantic with LLMs

PydanticAI is a Python agent framework designed to make it less painful to build production grade
applications with Generative AI.

## Concepts documentation

- [Agents](https://ai.pydantic.dev/agents/index.md)
- [Common Tools](https://ai.pydantic.dev/common-tools/index.md)
- [Dependencies](https://ai.pydantic.dev/dependencies/index.md)
- [Messages and chat history](https://ai.pydantic.dev/message-history/index.md)
- [Multi-agent Applications](https://ai.pydantic.dev/multi-agent-applications/index.md)
- [Function Tools](https://ai.pydantic.dev/tools/index.md)

## Models

- [Model Providers](https://ai.pydantic.dev/models/index.md)
- [Anthropic](https://ai.pydantic.dev/models/anthropic/index.md)
- [Bedrock](https://ai.pydantic.dev/models/bedrock/index.md)
- [Cohere](https://ai.pydantic.dev/models/cohere/index.md)
- [Gemini](https://ai.pydantic.dev/models/gemini/index.md)
- [Google](https://ai.pydantic.dev/models/google/index.md)
- [Groq](https://ai.pydantic.dev/models/groq/index.md)
- [Mistral](https://ai.pydantic.dev/models/mistral/index.md)
- [OpenAI](https://ai.pydantic.dev/models/openai/index.md)

## Graphs

- [Graphs](https://ai.pydantic.dev/graph/index.md)

## API Reference

- [pydantic_ai.agent](https://ai.pydantic.dev/api/agent/index.md)
- [pydantic_ai.common_tools](https://ai.pydantic.dev/api/common_tools/index.md)
- [pydantic_ai.direct](https://ai.pydantic.dev/api/direct/index.md)
- [pydantic_ai.exceptions](https://ai.pydantic.dev/api/exceptions/index.md)
- [fasta2a](https://ai.pydantic.dev/api/fasta2a/index.md)
- [pydantic_ai.format_as_xml](https://ai.pydantic.dev/api/format_as_xml/index.md)
- [pydantic_ai.mcp](https://ai.pydantic.dev/api/mcp/index.md)
- [pydantic_ai.messages](https://ai.pydantic.dev/api/messages/index.md)
- [pydantic_ai.profiles](https://ai.pydantic.dev/api/profiles/index.md)
- [pydantic_ai.providers](https://ai.pydantic.dev/api/providers/index.md)
- [pydantic_ai.result](https://ai.pydantic.dev/api/result/index.md)
- [pydantic_ai.settings](https://ai.pydantic.dev/api/settings/index.md)
- [pydantic_ai.tools](https://ai.pydantic.dev/api/tools/index.md)
- [pydantic_ai.usage](https://ai.pydantic.dev/api/usage/index.md)
- [pydantic_ai.models.anthropic](https://ai.pydantic.dev/api/models/anthropic/index.md)
- [pydantic_ai.models](https://ai.pydantic.dev/api/models/base/index.md)
- [pydantic_ai.models.bedrock](https://ai.pydantic.dev/api/models/bedrock/index.md)
- [pydantic_ai.models.cohere](https://ai.pydantic.dev/api/models/cohere/index.md)
- [pydantic_ai.models.fallback](https://ai.pydantic.dev/api/models/fallback/index.md)
- [pydantic_ai.models.function](https://ai.pydantic.dev/api/models/function/index.md)
- [pydantic_ai.models.gemini](https://ai.pydantic.dev/api/models/gemini/index.md)
- [pydantic_ai.models.google](https://ai.pydantic.dev/api/models/google/index.md)
- [pydantic_ai.models.groq](https://ai.pydantic.dev/api/models/groq/index.md)
- [pydantic_ai.models.instrumented](https://ai.pydantic.dev/api/models/instrumented/index.md)
- [pydantic_ai.models.mcp_sampling](https://ai.pydantic.dev/api/models/mcp-sampling/index.md)
- [pydantic_ai.models.mistral](https://ai.pydantic.dev/api/models/mistral/index.md)
- [pydantic_ai.models.openai](https://ai.pydantic.dev/api/models/openai/index.md)
- [pydantic_ai.models.test](https://ai.pydantic.dev/api/models/test/index.md)
- [pydantic_ai.models.wrapper](https://ai.pydantic.dev/api/models/wrapper/index.md)
- [pydantic_evals.dataset](https://ai.pydantic.dev/api/pydantic_evals/dataset/index.md)
- [pydantic_evals.evaluators](https://ai.pydantic.dev/api/pydantic_evals/evaluators/index.md)
- [pydantic_evals.generation](https://ai.pydantic.dev/api/pydantic_evals/generation/index.md)
- [pydantic_evals.otel](https://ai.pydantic.dev/api/pydantic_evals/otel/index.md)
- [pydantic_evals.reporting](https://ai.pydantic.dev/api/pydantic_evals/reporting/index.md)
- [pydantic_graph.exceptions](https://ai.pydantic.dev/api/pydantic_graph/exceptions/index.md)
- [pydantic_graph](https://ai.pydantic.dev/api/pydantic_graph/graph/index.md)
- [pydantic_graph.mermaid](https://ai.pydantic.dev/api/pydantic_graph/mermaid/index.md)
- [pydantic_graph.nodes](https://ai.pydantic.dev/api/pydantic_graph/nodes/index.md)
- [pydantic_graph.persistence](https://ai.pydantic.dev/api/pydantic_graph/persistence/index.md)

## Evals

- [Evals](https://ai.pydantic.dev/evals/index.md)

## MCP

- [Model Context Protocol (MCP)](https://ai.pydantic.dev/mcp/index.md)
- [Client](https://ai.pydantic.dev/mcp/client/index.md)
- [MCP Run Python](https://ai.pydantic.dev/mcp/run-python/index.md)
- [Server](https://ai.pydantic.dev/mcp/server/index.md)

## Optional

- [Command Line Interface (CLI)](https://ai.pydantic.dev/cli/index.md)
- [Debugging and Monitoring](https://ai.pydantic.dev/logfire/index.md)
- [Unit testing](https://ai.pydantic.dev/testing/index.md)
- [Examples](https://ai.pydantic.dev/examples/index.md)
- [Bank support](https://ai.pydantic.dev/examples/bank-support/index.md)
- [Chat App with FastAPI](https://ai.pydantic.dev/examples/chat-app/index.md)
- [Flight booking](https://ai.pydantic.dev/examples/flight-booking/index.md)
- [Pydantic Model](https://ai.pydantic.dev/examples/pydantic-model/index.md)
- [Question Graph](https://ai.pydantic.dev/examples/question-graph/index.md)
- [RAG](https://ai.pydantic.dev/examples/rag/index.md)
- [SQL Generation](https://ai.pydantic.dev/examples/sql-gen/index.md)
- [Stream markdown](https://ai.pydantic.dev/examples/stream-markdown/index.md)
- [Stream whales](https://ai.pydantic.dev/examples/stream-whales/index.md)
- [Weather agent](https://ai.pydantic.dev/examples/weather-agent/index.md)
