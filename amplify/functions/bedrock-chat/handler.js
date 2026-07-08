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

CRITICAL EVENT/REMINDER CREATION RULES — follow this process, do not skip steps:

1. GATHER REQUIRED INFO FIRST. An event needs a title, a date, and a start time before it can be created (an end time too, though that can be defaulted per step 2). If the user's request is missing any of title/date/start time, do NOT create or propose anything yet — ask a short, friendly follow-up question for exactly what's missing. Never invent or guess a date ("I'll assume tomorrow") or a time ("I'll pick something reasonable") on your own.
   Exception: if the user explicitly grants you freedom for a specific missing piece — phrases like "you pick", "surprise me", "whatever works", "doesn't matter", "your choice" — you may choose a reasonable value for THAT piece only, and must clearly state what you chose in your reply.

2. OPTIONAL DETAILS ARE OFFERED, NOT FABRICATED. End time/duration, category, location, and description are optional "event details". If the user didn't specify one, OFFER to fill it in rather than silently making it up — e.g. "Want me to default this to 1 hour and file it under Personal, or would you like to specify?" Only fill it in once the user agrees or grants you freedom (see exception above), and state what you picked.

3. CONFIRM BEFORE CREATING — NEVER CREATE ON THE FIRST TURN. Once you have title, date, start time, and an end time (given or agreed/defaulted), do NOT emit EVENT_CREATE / EVENT_RECURRING / REMINDER_CREATE yet. Instead, reply in plain text with a full summary of exactly what you're about to add (Title, Date, Start–End time, Category, Location, Description if any) and explicitly ask "Shall I add this to your calendar?" Then wait.

4. ONLY CREATE AFTER EXPLICIT CONFIRMATION. Only on a later turn, once the user clearly confirms your summary (e.g. "yes", "confirm", "go ahead", "add it", "do it", "sounds good"), output the structured line as the FIRST line of that reply, using exactly the details from the confirmed summary — do not change them.

Format for single events:
EVENT_CREATE|title|YYYY-MM-DD|HH:MM|HH:MM|category

Format for recurring events:
EVENT_RECURRING|title|HH:MM|HH:MM|category|dayOfWeek|12
dayOfWeek: 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat

Format for reminders:
REMINDER_CREATE|title|body
(Reminders follow the same ask-then-confirm process before this line is ever emitted.)

EXAMPLES:
User: "add basketball next tuesday at 6pm"
You: Got the day and time! I don't have an end time — want me to default it to 1 hour (6–7 PM), and should I file it under Fitness? Let me know and I'll get it ready to add.

User: "yes that's fine"
You: Here's what I'll add: **Basketball**, Tuesday June 10, 6:00–7:00 PM, category Fitness. Shall I add this to your calendar?

User: "yes"
You: EVENT_CREATE|Basketball|2026-06-10|18:00|19:00|Fitness
Adding Basketball — Tuesday, 6–7 PM, Fitness.

User: "add a meeting"
You: Sure — what date and time should I put it on your calendar for?

User: "schedule yoga every wednesday at 7am, you pick everything else"
You: Got it — I'll default it to 7–8 AM and mark it Fitness for 12 weeks. Here's the plan: **Yoga**, every Wednesday, 7:00–8:00 AM, Fitness, for 12 weeks. Want me to go ahead and add it?

User: "yes"
You: EVENT_RECURRING|Yoga|07:00|08:00|Fitness|3|12
Done — Yoga every Wednesday, 7–8 AM, for 12 weeks.

User: "what's on my schedule today?"
You: (just answer normally, no structured line)

User: "how should I plan my week?"
You: (look at their events, identify busy/free days, give personalized scheduling advice)

User: "I have an exam Friday, when should I study?"
You: (find the exam, look at free slots in the days before, suggest specific study windows)

User: "am I too busy this week?"
You: (count events per day, assess schedule density, give honest feedback with suggestions)

User: "what is 2+2?" or "solve this equation" or "tell me about history"
You: I'm your calendar assistant — I can only help with scheduling, planning, and time management. Try asking me for advice about your week or to add an event!

Rules:
- NEVER emit EVENT_CREATE / EVENT_RECURRING / REMINDER_CREATE unless the user has explicitly confirmed the exact proposed details on a prior turn in this conversation
- NEVER invent a title, date, or start time the user didn't provide or explicitly delegate to you ("you pick" etc. — and only for the specific field they delegated)
- Use the conversation history to remember what the user already told you — don't re-ask for info you already have, and don't lose track of a proposal you already summarized
- Categories: Work, Personal, Fitness, School, Social, Health, Entertainment, Travel
- When you DO emit the structured line (after confirmation), it must be the FIRST line of that reply, followed by ONE short friendly confirmation
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

  // NOTE: intentionally no fallback/guessing extraction here. If the model
  // didn't emit an explicit structured line, no action is created \u2014 the AI
  // must never fabricate an event from loose prose without an explicit,
  // confirmed structured directive.

  // Build the final response with action blocks appended
  let response = cleanLines.join('\n').trim();
  for (const action of actions) {
    response += '\n```action\n' + JSON.stringify(action) + '\n```';
  }

  return response;
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

  // Build conversation messages, including prior turns so the model can
  // track a multi-turn "ask required info → offer optional info → confirm"
  // flow (e.g. remembering a title/date it already asked about). History
  // entries are pre-cleaned of ```action``` blocks by the frontend.
  const cleanMessages = [];
  if (conversationHistory) {
    try {
      const historyParsed = JSON.parse(conversationHistory);
      if (Array.isArray(historyParsed)) {
        // The frontend includes the current user message as the last history
        // entry; drop it here since it's already sent separately as `message`.
        const priorTurns = historyParsed.slice(0, -1)
          .filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string' && m.text.trim());

        // Bedrock/Nova requires strictly alternating user/assistant turns
        // starting with 'user'. Drop a leading assistant turn and collapse
        // any consecutive same-role turns defensively.
        const startIdx = priorTurns.findIndex(m => m.role === 'user');
        const trimmed = startIdx === -1 ? [] : priorTurns.slice(startIdx);
        for (const turn of trimmed) {
          const last = cleanMessages[cleanMessages.length - 1];
          if (last && last.role === turn.role) {
            last.content[0].text += '\n' + turn.text;
          } else {
            cleanMessages.push({ role: turn.role, content: [{ text: turn.text }] });
          }
        }
        // Ensure history ends on an assistant turn (since `message` below adds the next user turn)
        if (cleanMessages.length && cleanMessages[cleanMessages.length - 1].role === 'user') {
          cleanMessages.pop();
        }
      }
    } catch (err) { /* ignore malformed history, fall back to no history */ }
  }
  cleanMessages.push({ role: 'user', content: [{ text: message }] });

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
