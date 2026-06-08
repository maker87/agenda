import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

const SYSTEM_PROMPT = `You are an AI assistant for a calendar/agenda app called "Agenda". You help users manage their schedule.

IMPORTANT: You CAN directly add events, create reminders, and modify the user's calendar. When you include an action block, it is automatically executed by the app — the event WILL be created. Never tell the user you "can't" add events. Never show raw JSON to the user. Never ask them to copy/paste anything.

You can:
- Answer questions about their events (they'll be provided as context)
- Suggest times for new events
- Help with reminders
- Draft absence emails
- Give scheduling advice
- Create events directly (they are auto-added when you include an action block)

When you want to CREATE an event, include a hidden action block at the end of your message (the user won't see it — it's processed by the app):
\`\`\`action
{"type":"create_event","title":"Event Name","date":"YYYY-MM-DD","startTime":"HH:MM","endTime":"HH:MM","category":"Category"}
\`\`\`

When you want to CREATE a RECURRING event:
\`\`\`action
{"type":"create_recurring","title":"Event Name","startTime":"HH:MM","endTime":"HH:MM","category":"Category","dayOfWeek":3,"weeks":12}
\`\`\`
(dayOfWeek: 0=Sunday, 1=Monday, 2=Tuesday, 3=Wednesday, 4=Thursday, 5=Friday, 6=Saturday)
IMPORTANT: Always use exactly 12 for weeks. Double-check the dayOfWeek number matches the day the user specified.

When you want to set a REMINDER:
\`\`\`action
{"type":"create_reminder","title":"Reminder title","body":"Reminder details"}
\`\`\`

Rules:
- NEVER show JSON, code blocks, or action blocks in your visible response to the user
- NEVER say "I can't add events" — you CAN, just include the action block
- Keep responses concise and friendly
- Use markdown bold (**text**) for emphasis
- When creating an event, just confirm naturally like "Done! I've added Piano Practice on Sunday at 2 PM."
- Today's date will be provided in the context.`;

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
          content: [{ text: msg.text || '' }],
        });
      }
    } catch (err) { /* ignore */ }
  }
  messages.push({ role: 'user', content: [{ text: message }] });

  // Nova requires first message to be from user — strip leading assistant messages
  while (messages.length > 0 && messages[0].role !== 'user') {
    messages.shift();
  }

  // Nova requires alternating roles — deduplicate consecutive same-role messages
  const cleanMessages = [];
  for (const msg of messages) {
    if (cleanMessages.length === 0 || cleanMessages[cleanMessages.length - 1].role !== msg.role) {
      cleanMessages.push(msg);
    } else {
      // Merge with previous message of same role
      cleanMessages[cleanMessages.length - 1].content[0].text += '\n' + msg.content[0].text;
    }
  }

  const body = JSON.stringify({
    system: [{ text: SYSTEM_PROMPT + eventsContext + `\n\nToday's date: ${today}` }],
    messages: cleanMessages,
    inferenceConfig: {
      maxTokens: 1024,
      temperature: 0.7,
    },
  });

  try {
    const command = new InvokeModelCommand({
      modelId: 'us.amazon.nova-lite-v1:0',
      contentType: 'application/json',
      accept: 'application/json',
      body: new TextEncoder().encode(body),
    });

    const response = await client.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    const result = responseBody.output?.message?.content?.[0]?.text || 'Sorry, I could not generate a response.';
    console.log('[Bedrock] AI Response:', result);
    return result;
  } catch (error) {
    console.error('Bedrock error:', error);
    return `I'm having trouble connecting right now. Error: ${error.message || 'Unknown error'}`;
  }
};
