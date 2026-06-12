import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

const SYSTEM_PROMPT = `You are an AI assistant for a calendar/agenda app. You help users manage their schedule.

When the user asks to create/add/schedule an event, respond in this EXACT format:
EVENT_CREATE|title|YYYY-MM-DD|HH:MM|HH:MM|category
Then on a new line, write a friendly confirmation.

When the user asks for a recurring event, respond in this EXACT format:
EVENT_RECURRING|title|HH:MM|HH:MM|category|dayOfWeek(0-6)|weeks
Then on a new line, write a friendly confirmation.
dayOfWeek: 0=Sunday, 1=Monday, 2=Tuesday, 3=Wednesday, 4=Thursday, 5=Friday, 6=Saturday

When the user asks for a reminder, respond in this format:
REMINDER_CREATE|title|body text
Then on a new line, write a friendly confirmation.

For all other questions (schedule queries, suggestions, etc.), just respond normally.

Rules:
- If creating an event, ALWAYS start your response with the EVENT_CREATE or EVENT_RECURRING line
- Pick a reasonable date if none specified (use tomorrow or next occurrence of the day)
- Pick a reasonable time based on the activity type (meetings: 10am, workouts: 7am, dinner: 7pm, etc.)
- Pick a reasonable duration (meetings: 1hr, workouts: 1hr, lunch: 1hr, classes: 1.5hr)
- Pick a reasonable category (Work, Personal, Fitness, School, Social, Health, Entertainment, Travel)
- Keep confirmations short and friendly
- Today's date will be provided`;

// Parse the AI response and extract structured actions
function parseAIResponse(text, today) {
  const lines = text.split('\n');
  const actions = [];
  const cleanLines = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // EVENT_CREATE|title|date|startTime|endTime|category
    if (trimmed.startsWith('EVENT_CREATE|')) {
      const parts = trimmed.split('|');
      if (parts.length >= 6) {
        actions.push({
          type: 'create_event',
          title: parts[1],
          date: parts[2],
          startTime: parts[3],
          endTime: parts[4],
          category: parts[5] || 'Personal',
        });
      }
      continue; // Don't include this line in clean text
    }

    // EVENT_RECURRING|title|startTime|endTime|category|dayOfWeek|weeks
    if (trimmed.startsWith('EVENT_RECURRING|')) {
      const parts = trimmed.split('|');
      if (parts.length >= 7) {
        actions.push({
          type: 'create_recurring',
          title: parts[1],
          startTime: parts[2],
          endTime: parts[3],
          category: parts[4] || 'Personal',
          dayOfWeek: parseInt(parts[5]),
          weeks: parseInt(parts[6]) || 12,
        });
      }
      continue;
    }

    // REMINDER_CREATE|title|body
    if (trimmed.startsWith('REMINDER_CREATE|')) {
      const parts = trimmed.split('|');
      if (parts.length >= 3) {
        actions.push({
          type: 'create_reminder',
          title: parts[1],
          body: parts.slice(2).join('|'),
        });
      }
      continue;
    }

    cleanLines.push(line);
  }

  // Build the final response with action blocks appended (for frontend parser)
  let response = cleanLines.join('\n').trim();
  for (const action of actions) {
    response += '\n```action\n' + JSON.stringify(action) + '\n```';
  }

  return response;
}

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

  // Build conversation messages
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

  // Ensure first message is from user
  while (messages.length > 0 && messages[0].role !== 'user') {
    messages.shift();
  }

  // Ensure alternating roles
  const cleanMessages = [];
  for (const msg of messages) {
    if (cleanMessages.length === 0 || cleanMessages[cleanMessages.length - 1].role !== msg.role) {
      cleanMessages.push(msg);
    } else {
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
    const rawText = responseBody.output?.message?.content?.[0]?.text || 'Sorry, I could not generate a response.';
    
    console.log('[Bedrock] Raw AI response:', rawText);
    
    // Parse and convert to structured format
    const finalResponse = parseAIResponse(rawText, today);
    console.log('[Bedrock] Final response:', finalResponse);
    
    return finalResponse;
  } catch (error) {
    console.error('Bedrock error:', error);
    return `I'm having trouble connecting right now. Error: ${error.message || 'Unknown error'}`;
  }
};
