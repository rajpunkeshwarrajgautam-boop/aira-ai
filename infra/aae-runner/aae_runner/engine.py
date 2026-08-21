from __future__ import annotations

from agents import Agent, RunConfig, Runner, WebSearchTool
from agents.extensions.memory import AsyncSQLiteSession

from .config import Settings
from .prompts import SYSTEM_INSTRUCTIONS
from .tools import AgentContext, build_tools


class AutonomousEngine:
    def __init__(self, settings: Settings):
        self.settings = settings
        tools = list(build_tools(settings))
        if settings.enable_web_search:
            tools.append(WebSearchTool())
        self.agent = Agent[AgentContext](
            name='AIRA Autonomous Engineer',
            model=settings.model,
            instructions=SYSTEM_INSTRUCTIONS,
            tools=tools,
        )

    async def run(self, *, job_id: str, owner_id: str, task: str, session_id: str) -> dict:
        context = AgentContext(settings=self.settings, job_id=job_id, owner_id=owner_id)
        scoped_session_id = f'{owner_id}:{session_id}'
        session = AsyncSQLiteSession(scoped_session_id, db_path=str(self.settings.session_database_path))
        result = await Runner.run(
            self.agent,
            task,
            context=context,
            session=session,
            max_turns=self.settings.max_turns,
            run_config=RunConfig(trace_include_sensitive_data=False),
        )
        output = str(result.final_output or '')
        if len(output) > self.settings.max_output_chars:
            output = output[: self.settings.max_output_chars] + '\n\n[Output truncated by AIRA]'
        usage = result.context_wrapper.usage
        return {
            'output': output,
            'modified_files': sorted(context.modified_files),
            'usage': {
                'requests': usage.requests,
                'input_tokens': usage.input_tokens,
                'output_tokens': usage.output_tokens,
                'total_tokens': usage.total_tokens,
                'tool_calls': context.tool_calls,
                'verification_calls': context.verification_calls,
            },
        }
