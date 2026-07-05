import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

const SYSTEM_PROMPT = `You are an AI assistant for a calendar/scheduling app. You help users plan their time, manage their schedule, and get the most out of their agenda.

SCOPE (what you help with):
- Creating, editing, or deleting calendar events
- Scheduling and time management
- Viewing or summarizing the user's schedule
- Setting reminders
- Suggesting optimal times for activities
- Answering questions about the user's existing events
- Planning advice: helping the user organize their week, prioritize tasks, balance commitments
- Study planning: suggesting when and how to prepare for exams or deadlines
- Productivity tips based on the user's actual calendar load
- Work-life balance observations and suggestions
- Conflict detection: warning about overlapping or tightly packed events
- Goal-oriented scheduling: helping the user make time for goals they mention
- Providing calendar/productivity advice and recommendations

You MUST REFUSE any request that is NOT related to calendars, scheduling, time management, or planning. This includes but is not limited to:
- Math calculations, equations, or homework solutions
- General knowledge questions (history, science, geography, etc.)
- Coding or programming help
- Creative writing, stories, or essays
- Translations (unless for event titles)
- Recipes, health advice, relationship advice
- Trivia, games, or entertainment

When refusing, respond with: "I'm your calendar assistant — I can only help with scheduling, planning, and time management. Try asking me for advice about your week or to add an event!"

PLANNING ADVICE GUIDELINES:
When the user asks for advice, tips, or recommendations related to their calendar:
- Look at their actual events to give personalized answers
- Identify busy days vs. free days
- Notice patterns (recurring activities, categories with many events)
- Suggest breaks if the schedule is packed
- Recommend study/prep time before exams or deadlines
- Point out scheduling conflicts or back-to-back events
- Be concise but helpful — give 3-5 actionable tips when appropriate
- Reference specific events or days from their calendar when relevant

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

User: "how should I plan my week?"
You: (look at their events, identify busy/free days, give personalized scheduling advice)

User: "I have an exam Friday, when should I study?"
You: (find the exam, look at free slots in the days before, suggest specific study windows)

User: "am I too busy this week?"
You: (count events per day, assess schedule density, give honest feedback with suggestions)

User: "what is 2+2?" or "solve this equation" or "tell me about history"
You: I'm your calendar assistant — I can only help with scheduling, planning, and time management. Try asking me for advice about your week or to add an event!

Rules:
- EVERY time you create an event, the FIRST line MUST be EVENT_CREATE or EVENT_RECURRING
- If no date given, use tomorrow
- If no time given, pick something reasonable
- Default duration: 1 hour
- Categories: Work, Personal, Fitness, School, Social, Health, Entertainment, Travel
- After the structured line, write ONE short friendly confirmation
- For non-creation questions about the calendar, just respond normally
- For planning/advice questions, give personalized tips based on the user's actual events
- For ANY non-calendar question, politely refuse and redirect to calendar tasks`;

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

  // ── Input validation ──────────────────────────────────────────────────────
  if (!message || typeof message !== 'string') {
    return 'Please provide a message.';
  }

  // Enforce maximum input lengths to prevent abuse and control Bedrock costs
  const MAX_MESSAGE_LENGTH = 2000;
  const MAX_EVENTS_LENGTH = 50000;
  const MAX_HISTORY_LENGTH = 10000;

  if (message.length > MAX_MESSAGE_LENGTH) {
    return `Message too long. Please keep your message under ${MAX_MESSAGE_LENGTH} characters.`;
  }

  if (events && events.length > MAX_EVENTS_LENGTH) {
    return 'Too much event data sent. Please try again with fewer events in context.';
  }

  if (conversationHistory && conversationHistory.length > MAX_HISTORY_LENGTH) {
    return 'Conversation history too long. Please start a new chat.';
  }

  // Sanitize today input — must be a valid YYYY-MM-DD date
  const todaySafe = /^\d{4}-\d{2}-\d{2}$/.test(today || '') ? today : new Date().toISOString().split('T')[0];

  const client = new BedrockRuntimeClient({ region: 'us-east-1' });

  let eventsContext = '\n\nUser has no events on their calendar yet.';
  if (events) {
    try {
      const parsed = JSON.parse(events);
      if (parsed.length > 0) {
        // Separate upcoming and past events for better context
        const upcoming = parsed.filter(e => e.date >= todaySafe);
        const past = parsed.filter(e => e.date < todaySafe);

        // Count events by day for the next 7 days
        const next7days = [];
        for (let i = 0; i < 7; i++) {
          const d = new Date(todaySafe + 'T00:00:00');
          d.setDate(d.getDate() + i);
          const dateStr = d.toISOString().split('T')[0];
          const dayEvents = upcoming.filter(e => e.date === dateStr);
          if (dayEvents.length > 0) {
            const dayName = d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
            next7days.push(`${dayName}: ${dayEvents.length} events (${dayEvents.map(e => e.title).join(', ')})`);
          }
        }

        // Category breakdown
        const catCounts = {};
        parsed.forEach(e => {
          const cat = e.category || 'Uncategorized';
          catCounts[cat] = (catCounts[cat] || 0) + 1;
        });
        const catSummary = Object.entries(catCounts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([cat, count]) => `${cat}: ${count}`)
          .join(', ');

        eventsContext = `\n\nUser's calendar summary:
- Total events: ${parsed.length} (${upcoming.length} upcoming, ${past.length} past)
- Categories: ${catSummary}
- Next 7 days overview:\n${next7days.length > 0 ? next7days.join('\n') : '  No events in the next 7 days.'}

Upcoming events (next 50):\n` +
          upcoming.slice(0, 50).map((e) =>
            `- ${e.title} | ${e.date} ${e.startTime}-${e.endTime} | ${e.category || 'No category'}`
          ).join('\n');
      }
    } catch (err) { /* ignore */ }
  }

  // Build conversation messages — only include current message, no history
  // (History confuses Nova into not following the structured format)
  const cleanMessages = [{ role: 'user', content: [{ text: message }] }];

  const body = JSON.stringify({
    system: [{ text: SYSTEM_PROMPT + eventsContext + `\n\nToday's date: ${todaySafe}` }],
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
    
    // Parse and convert to structured format
    const finalResponse = parseAIResponse(rawText, todaySafe);
    
    return finalResponse;
  } catch (error) {
    console.error('Bedrock invocation error');
    return 'I\'m having trouble connecting right now. Please try again in a moment.';
  }
};
