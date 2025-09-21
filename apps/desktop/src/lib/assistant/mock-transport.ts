import { generateId, simulateReadableStream, type ChatTransport, type UIMessage, type UIMessageChunk } from 'ai';

const STREAM_DELAY_MS = 45;

type MessagePart = UIMessage['parts'][number];
type TextPart = Extract<MessagePart, { type: 'text'; text: string }>;

function isTextPart(part: MessagePart): part is TextPart {
  return part.type === 'text';
}

function extractUserText(message: UIMessage | undefined): string {
  if (!message) return '';
  return message.parts.filter(isTextPart).map((part) => part.text).join('');
}

function buildReplyContent(userText: string): string {
  const sanitized = userText.trim();
  const headline = sanitized ? `You asked: \`${sanitized}\`` : 'Hello! I am the Rei DbView mock assistant.';
  const details = `\n\n- This is a local mock that streams markdown chunks.\n- Ask for read-only SQL and I will fabricate safe examples.\n\n\`\`\`sql\nSELECT 'assistant mock' AS source, now()::timestamp AS generated_at;\n\`\`\``;
  return `**Mock Assistant**\n\n${headline}${details}`;
}

function toChunks(messageId: string, content: string): UIMessageChunk[] {
  const words = content.match(/[^\s]+\s*|\s+/g) ?? [content];
  const baseChunks: UIMessageChunk[] = [
    { type: 'start', messageId },
    { type: 'text-start', id: messageId },
  ];
  const textChunks: UIMessageChunk[] = words.map((chunk) => ({
    type: 'text-delta',
    id: messageId,
    delta: chunk,
  }));
  const closingChunks: UIMessageChunk[] = [
    { type: 'text-end', id: messageId },
    { type: 'finish', messageMetadata: undefined },
  ];
  return [...baseChunks, ...textChunks, ...closingChunks];
}

export class MockChatTransport implements ChatTransport<UIMessage> {
  async sendMessages({ messages }: Parameters<ChatTransport<UIMessage>['sendMessages']>[0]) {
    const userMessage = [...messages].reverse().find((entry) => entry.role === 'user');
    const responseId = generateId();
    const replyContent = buildReplyContent(extractUserText(userMessage));
    const chunks = toChunks(responseId, replyContent);
    return simulateReadableStream({
      chunks,
      initialDelayInMs: 120,
      chunkDelayInMs: STREAM_DELAY_MS,
    });
  }

  async reconnectToStream() {
    return null;
  }
}
