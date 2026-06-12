import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

const SYSTEM_PROMPT = `You are an AI assistant for a calendar app.

CRITICAL: When creating events, you MUST start your response with the structured line. NO EXCEPTIONS.

Format for single events:
EVENT_CREATE|title|YYYY-MM-DD|HH:MM|HH:MM|category

Format for recurring events:
EVENT_RECURRING|title|HH:MM|HH:MM|category|dayOfWeek|12
dayOfWeek: 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat

Format for reminders:
REMINDER_CREATE|title|body

EXAMPLES:
User: "add basketball next tuesday at 6pm"
You: EVENT_CREATE|Basketball|2026-06-10|18:00|19:00|Fitness
Done! Basketball is on your calendar for Tuesday at 6 PM.

User: "schedule yoga every wednesday at 7am"
You: EVENT_RECURRING|Yoga|07:00|08:00|Fitness|3|12
Done! Yoga scheduled every Wednesday at 7 AM for 12 weeks.

User: "add a meeting tomorrow at 2"
You: EVENT_CREATE|Meeting|2026-06-09|14:00|15:00|Work
Done! Meeting added for tomorrow at 2 PM.

User: "what's on my schedule today?"
You: (just answer normally, no EVENT_CREATE prefix)

Rules:
- EVERY time you create an event, the FIRST line MUST be EVENT_CREATE or EVENT_RECURRING
- If no date given, use tomorrow
- If no time given, pick something reasonable
- Default duration: 1 hour
- Categories: Work, Personal, Fitness, School, Social, Health, Entertainment, Travel
- After the structured line, write ONE short friendly confirmation
- For non-creation questions, just respond normally`;

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
      continue;
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

  // FALLBACK: If no actions were parsed but the text mentions adding/creating,
  // try to extract event info from the natural language response
  if (actions.length === 0) {
    const fullText = text;
    const fullLower = text.toLowerCase();
    if (/added|scheduled|created|set up/.test(fullLower)) {
      // Try to find a date (YYYY-MM-DD)
      let date = null;
      const isoMatch = fullText.match(/(\d{4}-\d{2}-\d{2})/);
      if (isoMatch) {
        date = isoMatch[1];
      } else {
        // Try "Jun 15", "June 15", "Jun. 15" etc.
        const months = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
        const monthMatch = fullText.match(/(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)(?:day)?,?\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?\s+(\d{1,2})/i);
        if (monthMatch) {
          const m = months[monthMatch[1].toLowerCase().slice(0, 3)];
          const d = monthMatch[2].padStart(2, '0');
          const y = today ? today.slice(0, 4) : new Date().getFullYear().toString();
          date = `${y}-${m}-${d}`;
        }
      }

      // Try to find times
      const timeMatches = fullText.match(/(\d{1,2}:\d{2})/g);
      let startTime = timeMatches ? timeMatches[0] : null;
      let endTime = timeMatches && timeMatches.length >= 2 ? timeMatches[1] : null;

      // Also try "10 AM", "5 PM" format
      if (!startTime) {
        const ampmMatch = fullText.match(/(\d{1,2})\s*(AM|PM)/i);
        if (ampmMatch) {
          let h = parseInt(ampmMatch[1]);
          if (ampmMatch[2].toUpperCase() === 'PM' && h !== 12) h += 12;
          if (ampmMatch[2].toUpperCase() === 'AM' && h === 12) h = 0;
          startTime = `${String(h).padStart(2, '0')}:00`;
        }
      }

      if (!endTime && startTime) {
        endTime = addHour(startTime);
      }

      // Try to find a title in quotes or bold
      const titleMatch = fullText.match(/["\u201c]([^"\u201d]+)["\u201d]/) || fullText.match(/\*\*([^*]+)\*\*/);
      let title = titleMatch ? titleMatch[1] : null;

      // If we have enough info, create the action
      if (date && startTime && title) {
        actions.push({
          type: 'create_event',
          title: title,
          date: date,
          startTime: startTime,
          endTime: endTime || addHour(startTime),
          category: 'Personal',
        });
      }
    }
  }

  // Build the final response with action blocks appended
  let response = cleanLines.join('\n').trim();
  for (const action of actions) {
    response += '\n```action\n' + JSON.stringify(action) + '\n```';
  }

  return response;
}

function addHour(time) {
  const [h, m] = time.split(':').map(Number);
  const newH = (h + 1) % 24;
  return `${String(newH).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
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

  // Build conversation messages — only include current message, no history
  // (History confuses Nova into not following the structured format)
  const cleanMessages = [{ role: 'user', content: [{ text: message }] }];

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
