import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

const SYSTEM_PROMPT = `You are an AI assistant for a calendar/agenda app called "Agenda". You help users manage their schedule.

You can:
- Answer questions about their events (they'll be provided as context)
- Suggest times for new events
- Help with reminders
- Draft absence emails
- Give scheduling advice
- Create events when asked (respond with a JSON action block)

When the user wants to CREATE an event, respond with your message AND include a JSON block at the end like this:
\`\`\`action
{"type":"create_event","title":"Event Name","date":"YYYY-MM-DD","startTime":"HH:MM","endTime":"HH:MM","category":"Category"}
\`\`\`

When the user wants to CREATE a RECURRING event, use:
\`\`\`action
{"type":"create_recurring","title":"Event Name","startTime":"HH:MM","endTime":"HH:MM","category":"Category","dayOfWeek":3,"weeks":12}
\`\`\`
(dayOfWeek: 0=Sunday, 1=Monday, ..., 6=Saturday)

When the user wants a REMINDER, use:
\`\`\`action
{"type":"create_reminder","title":"Reminder title","body":"Reminder details"}
\`\`\`

Keep responses concise and friendly. Use markdown bold (**text**) for emphasis. Today's date will be provided in the context.`;

export const handler = async (event) => {
  const { message, events, today, conversationHistory } = event.arguments;

  const client = new BedrockRuntimeClient({ region: 'us-east-1' });

  let eventsContext = '\n\nUser has no events on their calendar yet.';
  if (events) {
    try {
      const parsed = JSON.parse(events);
      if (parsed.length > 0) {
        eventsContext = `\n\nUser's calendar events (${parsed.length} total):\n` +
          parsed.slice(0, 50).map((e) =>
            `- ${e.title} | ${e.date} ${e.startTime}-${e.endTime} | ${e.category || 'No category'}`
          ).join('\n');
      }
    } catch (err) { /* ignore */ }
  }

  const messages = [];
  if (conversationHistory) {
    try {
      const history = JSON.parse(conversationHistory);
      for (const msg of history.slice(-10)) {
        messages.push({
          role: msg.role === 'user' ? 'user' : 'assistant',
          content: msg.text,
        });
      }
    } catch (err) { /* ignore */ }
  }
  messages.push({ role: 'user', content: message });

  const body = JSON.stringify({
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 1024,
    system: SYSTEM_PROMPT + eventsContext + `\n\nToday's date: ${today}`,
    messages,
  });

  try {
    const command = new InvokeModelCommand({
      modelId: 'anthropic.claude-3-5-haiku-20241022-v1:0',
      contentType: 'application/json',
      accept: 'application/json',
      body: new TextEncoder().encode(body),
    });

    const response = await client.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    return responseBody.content?.[0]?.text || 'Sorry, I could not generate a response.';
  } catch (error) {
    console.error('Bedrock error:', error);
    return `I'm having trouble connecting right now. Error: ${error.message || 'Unknown error'}`;
  }
};
