import Anthropic from '@anthropic-ai/sdk';
import {
  IClaudeClient,
  AgentResult,
  AnthropicTool,
  ToolExecutor,
} from '@amacc/shared-kernel';

export class AnthropicClaudeClient implements IClaudeClient {
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async runWithTools(
    systemPrompt: string,
    userMessage: string,
    tools: AnthropicTool[],
    toolExecutor: ToolExecutor,
  ): Promise<AgentResult> {
    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: userMessage },
    ];

    const anthropicTools: Anthropic.Tool[] = tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema as Anthropic.Tool.InputSchema,
    }));

    let actionTaken = '';
    let outcome = '';
    let humanRequired = false;
    const details: Record<string, unknown> = {};

    // Tool use loop
    for (let i = 0; i < 10; i++) {
      const response = await this.client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: systemPrompt,
        messages,
        tools: anthropicTools,
      });

      if (response.stop_reason === 'end_turn') {
        const textBlock = response.content.find((b) => b.type === 'text');
        outcome = textBlock && 'text' in textBlock ? textBlock.text : 'Completed';
        break;
      }

      if (response.stop_reason === 'tool_use') {
        const toolUseBlocks = response.content.filter((b) => b.type === 'tool_use');
        messages.push({ role: 'assistant', content: response.content });

        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        for (const block of toolUseBlocks) {
          if (block.type === 'tool_use') {
            const result = await toolExecutor(block.name, block.input as Record<string, unknown>);
            actionTaken += `${block.name}; `;

            if (block.name === 'flag_for_human_review') {
              humanRequired = true;
              details['flagReason'] = (block.input as any)?.reason;
            }

            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify(result),
            });
          }
        }

        messages.push({ role: 'user', content: toolResults });
      }
    }

    return {
      agentName: '',
      actionTaken: actionTaken.trim(),
      outcome,
      humanRequired,
      details,
    };
  }

  async streamWithTools(
    systemPrompt: string,
    userMessage: string,
    tools: AnthropicTool[],
    toolExecutor: ToolExecutor,
    onChunk: (chunk: string) => void,
  ): Promise<AgentResult> {
    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: userMessage },
    ];

    const anthropicTools: Anthropic.Tool[] = tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema as Anthropic.Tool.InputSchema,
    }));

    let actionTaken = '';
    let outcome = '';
    let humanRequired = false;
    const details: Record<string, unknown> = {};

    for (let i = 0; i < 10; i++) {
      const stream = this.client.messages.stream({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: systemPrompt,
        messages,
        tools: anthropicTools,
      });

      let fullText = '';
      const toolUseBlocks: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];

      for await (const event of stream) {
        if (event.type === 'content_block_delta') {
          if ('delta' in event && 'text' in (event as any).delta) {
            const text = (event as any).delta.text;
            fullText += text;
            onChunk(text);
          }
        }
      }

      const finalMessage = await stream.finalMessage();

      if (finalMessage.stop_reason === 'end_turn') {
        outcome = fullText || 'Completed';
        break;
      }

      if (finalMessage.stop_reason === 'tool_use') {
        const blocks = finalMessage.content.filter((b) => b.type === 'tool_use');
        messages.push({ role: 'assistant', content: finalMessage.content });

        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        for (const block of blocks) {
          if (block.type === 'tool_use') {
            const result = await toolExecutor(block.name, block.input as Record<string, unknown>);
            actionTaken += `${block.name}; `;
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify(result),
            });
          }
        }
        messages.push({ role: 'user', content: toolResults });
      }
    }

    return { agentName: '', actionTaken, outcome, humanRequired, details };
  }
}
