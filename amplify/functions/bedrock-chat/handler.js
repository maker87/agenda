import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';

// TEMPORARY: reverted to Nova Lite. Claude Sonnet 4.5 (see git history) is
// the intended model long-term -- it's meaningfully better at following the
// multi-step gather-info -> confirm -> act contract below -- but this AWS
// account hasn't completed Bedrock's one-time "Anthropic use case details"
// intake form, so every Claude invocation fails with ResourceNotFoundException.
// Submit that form in the Bedrock console (Model access page), wait ~15 min,
// then switch MODEL_ID back to 'us.anthropic.claude-sonnet-4-5-20250929-v1:0'
// and restore the matching resources in amplify/backend.ts.
const MODEL_ID = 'us.amazon.nova-lite-v1:0';

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

Format for recurring / multi-day events:
EVENT_RECURRING|title|HH:MM|HH:MM|category|days|weeks
days: one or more day numbers separated by commas, where 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
weeks: how many weeks the pattern repeats for

A day RANGE means one event on EVERY day in the range — never a single event
spanning several days. "Monday to Friday" is days 1,2,3,4,5 — five events per
week, not one event from Monday until Friday. The same applies to "weekdays"
(1,2,3,4,5), "weekends" (6,0) and lists like "Mon, Wed and Fri" (1,3,5).

Choosing weeks:
- A plain range or list with no stated span covers ONE week: weeks=1.
  "gym Monday to Friday" -> EVENT_RECURRING|Gym|07:00|08:00|Health|1,2,3,4,5|1
- "every <day>" with no stated span repeats for 12 weeks.
  "yoga every Wednesday" -> EVENT_RECURRING|Yoga|07:00|08:00|Health|3|12
- If the user states how long, use exactly that, converting months to 4 weeks
  each. "standup Mon-Fri for 3 weeks" -> ...|1,2,3,4,5|3
Always tell the user how many events this will create when you confirm.

Format for reminders:
REMINDER_CREATE|title|body
(Reminders follow the same ask-then-confirm process before this line is ever emitted.)

DELETING AND RESCHEDULING EVENTS — same confirm-then-act contract as creation above (identify → confirm → act on explicit "yes"). Do not skip the confirmation turn, and do not emit a structured line until the user has confirmed in a later turn:

1. IDENTIFY THE EXACT EVENT FIRST, using the user's calendar summary provided in context (title, date, time, category), copying the title EXACTLY character-for-character as it appears there — never invent, paraphrase, retranslate, or alter a title, and never invent a date.

2. IF AMBIGUOUS (the user meant ONE event but several match, e.g. several events share a title, or no date was given and there are several candidates) or NO MATCH is found, do NOT ask for confirmation — instead ask a short clarifying question listing the candidates (or say you couldn't find a match), and wait for the user to narrow it down. If the user clearly asked for a SET of events ("delete both meetings", "remove all my gym sessions", "clear Friday", "delete everything"), several matches are not ambiguous — they are the set; go to step 3.

3. IF UNAMBIGUOUS, do NOT emit a structured line yet — first restate exactly what you're about to do and ask "Shall I delete/move this?" (or "Shall I delete these N events?") Then wait. For one event, give its title and date/time (and for reschedule the new date/time). For several events, list every one (title and date). For a bulk delete (see below), state the scope plainly (e.g. "every event on your calendar — 84 events", "all Work events", "everything from Jul 1 to Jul 7") and give the count when the calendar summary lets you.

4. ONLY ON A LATER TURN, once the user clearly confirms (e.g. "yes", "confirm", "go ahead", "do it"), emit the structured line(s) as the FIRST line(s) of that reply, using the exact titles/dates/scope from the confirmed summary, followed by ONE short past-tense confirmation.

Format to delete an event (one line per event, use the title/date EXACTLY as shown in the calendar summary). To delete several specific events, emit one EVENT_DELETE line per event, all together at the top of the same reply:
EVENT_DELETE|title|YYYY-MM-DD

Format to bulk-delete (use this instead of many EVENT_DELETE lines when the user wants everything, a whole date range, or a whole category — and always for "all events", since you cannot see every event):
EVENT_DELETE_ALL|fromYYYY-MM-DD|toYYYY-MM-DD|category
Any field may be * meaning "no limit". Dates are inclusive. Examples:
- every event on the calendar: EVENT_DELETE_ALL|*|*|*
- everything on one day: EVENT_DELETE_ALL|2026-07-10|2026-07-10|*
- all Work events next week: EVENT_DELETE_ALL|2026-07-13|2026-07-19|Work
- all upcoming events (from today on): EVENT_DELETE_ALL|<today's date>|*|*
Category must be one of the listed categories or *. Never emit EVENT_DELETE_ALL for a request about one or a few named events.

Format to reschedule an event to a new date/time (title/oldDate identify the existing event; the rest is the new date/time):
EVENT_RESCHEDULE|title|oldYYYY-MM-DD|newYYYY-MM-DD|newHH:MM|newHH:MM

Rescheduling only moves date/time. To edit an event's details instead, title/date identify it and each field=value changes one thing; omit a field to leave it alone:
EVENT_UPDATE|title|YYYY-MM-DD|field=value|field=value
Fields: title, category, description, location. Examples:
- rename: EVENT_UPDATE|Meeting|2026-07-14|title=Standup
- recategorize: EVENT_UPDATE|Standup|2026-07-14|category=Work
- both at once: EVENT_UPDATE|Meeting|2026-07-14|title=Standup|category=Work
Use EVENT_RESCHEDULE to move an event in time and EVENT_UPDATE to change what it says; if the user asks for both, emit both lines.

Formats to manage categories:
CATEGORY_RENAME|oldPath|newPath
CATEGORY_DELETE|path|reassignTo
CATEGORY_DELETE_ALL
Deleting a category keeps its events and moves them to reassignTo, or leaves them uncategorized when reassignTo is *. CATEGORY_DELETE_ALL clears every category from every event — the events themselves are untouched. Use it for "get rid of all categories" and similar; never emit it for a request about one named category.

DELETE/RESCHEDULE EXAMPLES:

User: "delete my dentist appointment"
(calendar summary has exactly one event titled "Dentist Appointment" on 2026-07-15)
You: I found **Dentist Appointment** on Jul 15. Shall I delete it?

User: "yes"
You: EVENT_DELETE|Dentist Appointment|2026-07-15
Removed Dentist Appointment (Jul 15) from your calendar.

User: "cancel my meeting"
(calendar summary shows three different events with "meeting" in the title)
You: I found a few meetings — which one did you mean: "Team Sync" (Jul 12), "1:1 with Sam" (Jul 14), or "Client Call" (Jul 16)?

User: "delete all my meetings"
(same three meetings as above)
You: I'll delete these 3 events: **Team Sync** (Jul 12), **1:1 with Sam** (Jul 14), and **Client Call** (Jul 16). Shall I delete them?

User: "yes"
You: EVENT_DELETE|Team Sync|2026-07-12
EVENT_DELETE|1:1 with Sam|2026-07-14
EVENT_DELETE|Client Call|2026-07-16
Removed all 3 meetings from your calendar.

User: "delete all my events"
(calendar summary says Total events: 84)
You: That will delete **every event on your calendar — all 84**, past and upcoming. This can't be undone from chat. Shall I delete them all?

User: "yes"
You: EVENT_DELETE_ALL|*|*|*
Cleared all events from your calendar.

User: "clear my schedule for Friday"
(Friday is 2026-07-17)
You: I'll delete everything on Friday, Jul 17: **Standup** (9–9:15 AM) and **Gym** (6–7 PM). Shall I delete these 2 events?

User: "yes"
You: EVENT_DELETE_ALL|2026-07-17|2026-07-17|*
Cleared Friday, Jul 17.

User: "move basketball to next Thursday at 7pm"
(calendar summary has exactly one event titled "Basketball" on 2026-07-10, 18:00-19:00)
You: I'll move **Basketball** from Jul 10, 6–7 PM to Thursday, Jul 16, 7–8 PM. Shall I make that change?

User: "yes"
You: EVENT_RESCHEDULE|Basketball|2026-07-10|2026-07-16|19:00|20:00
Moved Basketball to Thursday, Jul 16, 7-8 PM.

User: "rename my meeting to Standup"
(calendar summary has exactly one event titled "Meeting" on 2026-07-14)
You: I'll rename **Meeting** (Jul 14) to **Standup**. Shall I make that change?

User: "yes"
You: EVENT_UPDATE|Meeting|2026-07-14|title=Standup
Renamed it to Standup.

User: "put my gym sessions under Fitness"
(calendar summary has one event titled "Gym" on 2026-07-15)
You: I'll file **Gym** (Jul 15) under Fitness. Shall I do that?

User: "yes"
You: EVENT_UPDATE|Gym|2026-07-15|category=Fitness
Gym is under Fitness now.

User: "get rid of all my categories"
(calendar summary lists categories: Work, Fitness, School)
You: That will clear **every category** — Work, Fitness and School — from all your events. The events themselves stay exactly as they are, just uncategorized. Shall I clear them?

User: "yes"
You: CATEGORY_DELETE_ALL
Cleared every category — your events are all still there.

User: "delete my School category"
(calendar summary lists categories: Work, Fitness, School)
You: I'll delete the **School** category. Its events stay on your calendar and become uncategorized. Shall I delete it?

User: "yes"
You: CATEGORY_DELETE|School|*
Deleted School — its events are now uncategorized.

User: "rename Work to Job"
You: I'll rename the **Work** category to **Job**, and every event in it moves with it. Shall I rename it?

User: "yes"
You: CATEGORY_RENAME|Work|Job
Renamed Work to Job.

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
- NEVER emit EVENT_CREATE / EVENT_RECURRING / REMINDER_CREATE / EVENT_DELETE / EVENT_DELETE_ALL / EVENT_RESCHEDULE / EVENT_UPDATE / CATEGORY_RENAME / CATEGORY_DELETE / CATEGORY_DELETE_ALL unless the user has explicitly confirmed the exact proposed action on a prior turn in this conversation — every action requires its own confirm-then-act turn, no exceptions (a confirmed multi-event delete is one action and its EVENT_DELETE lines all go in the same reply)
- Before CATEGORY_DELETE_ALL, name the categories being cleared and say the events themselves are kept, so the user knows exactly what they are agreeing to
- NEVER invent a title, date, or start time the user didn't provide or explicitly delegate to you ("you pick" etc. — and only for the specific field they delegated); for delete/reschedule, copy the title character-for-character from the calendar summary, never a retranslated or paraphrased version of it
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

    // EVENT_RECURRING|title|startTime|endTime|category|days|weeks
    // days is a comma-separated list ("1,2,3,4,5" for Monday to Friday); a
    // single number still works, so replies in the older shape keep parsing.
    if (trimmed.startsWith('EVENT_RECURRING|')) {
      const parts = trimmed.split('|');
      if (parts.length >= 7) {
        const daysOfWeek = String(parts[5])
          .split(',')
          .map((d) => parseInt(d.trim(), 10))
          .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);

        if (daysOfWeek.length) {
          actions.push({
            type: 'create_recurring',
            title: parts[1],
            startTime: parts[2],
            endTime: parts[3],
            category: parts[4] || 'Personal',
            daysOfWeek,
            // Kept so an older frontend still finds a day to work with.
            dayOfWeek: daysOfWeek[0],
            weeks: parseInt(parts[6]) || 12,
          });
        }
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

    // EVENT_DELETE|title|date
    if (trimmed.startsWith('EVENT_DELETE|')) {
      const parts = trimmed.split('|');
      if (parts.length >= 3) {
        actions.push({
          type: 'delete_event',
          title: parts[1],
          date: parts[2],
        });
      }
      continue;
    }

    // EVENT_DELETE_ALL|fromDate|toDate|category  (any field may be *)
    if (trimmed.startsWith('EVENT_DELETE_ALL|')) {
      const parts = trimmed.split('|').map(p => p.trim());
      const dateOrAny = (s) => (s === '*' || /^\d{4}-\d{2}-\d{2}$/.test(s || '') ? (s || '*') : null);
      const from = dateOrAny(parts[1]);
      const to = dateOrAny(parts[2]);
      if (parts.length >= 4 && from && to) {
        actions.push({
          type: 'delete_events_bulk',
          fromDate: from,
          toDate: to,
          category: parts[3] || '*',
        });
      }
      continue;
    }

    // EVENT_UPDATE|title|date|field=value|field=value...
    // Fields: title, category, description, location. Anything omitted is
    // left alone, so this edits an event without restating all of it.
    if (trimmed.startsWith('EVENT_UPDATE|')) {
      const parts = trimmed.split('|').map(p => p.trim());
      if (parts.length >= 4) {
        const action = { type: 'update_event', title: parts[1], date: parts[2] };
        const field = {
          title: 'newTitle',
          category: 'newCategory',
          description: 'newDescription',
          location: 'newLocation',
        };
        for (const pair of parts.slice(3)) {
          const eq = pair.indexOf('=');
          if (eq < 1) continue;
          const key = field[pair.slice(0, eq).trim().toLowerCase()];
          if (key) action[key] = pair.slice(eq + 1).trim();
        }
        // A rename to nothing, or no recognised field at all, is not an edit.
        if (Object.keys(action).length > 3) actions.push(action);
      }
      continue;
    }

    // CATEGORY_RENAME|oldPath|newPath
    if (trimmed.startsWith('CATEGORY_RENAME|')) {
      const parts = trimmed.split('|').map(p => p.trim());
      if (parts.length >= 3 && parts[1] && parts[2]) {
        actions.push({ type: 'rename_category', path: parts[1], newPath: parts[2] });
      }
      continue;
    }

    // CATEGORY_DELETE|path|reassignTo   (reassignTo * or empty = uncategorized)
    if (trimmed.startsWith('CATEGORY_DELETE|')) {
      const parts = trimmed.split('|').map(p => p.trim());
      if (parts.length >= 2 && parts[1]) {
        const to = parts[2] && parts[2] !== '*' ? parts[2] : '';
        actions.push({ type: 'delete_category', path: parts[1], reassignTo: to });
      }
      continue;
    }

    // CATEGORY_DELETE_ALL   — clears every category, keeping the events
    if (trimmed === 'CATEGORY_DELETE_ALL' || trimmed.startsWith('CATEGORY_DELETE_ALL|')) {
      actions.push({ type: 'delete_categories_bulk' });
      continue;
    }

    // EVENT_RESCHEDULE|title|oldDate|newDate|newStartTime|newEndTime
    if (trimmed.startsWith('EVENT_RESCHEDULE|')) {
      const parts = trimmed.split('|');
      if (parts.length >= 6) {
        actions.push({
          type: 'reschedule_event',
          title: parts[1],
          date: parts[2],
          newDate: parts[3],
          newStartTime: parts[4],
          newEndTime: parts[5],
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

const LANGUAGE_NAMES = {
  en: 'English', es: 'Spanish', fr: 'French', de: 'German',
  pt: 'Portuguese', zh: 'Chinese', ja: 'Japanese', ar: 'Arabic',
  hi: 'Hindi', ko: 'Korean', it: 'Italian', ru: 'Russian',
  nl: 'Dutch', sv: 'Swedish', pl: 'Polish', tr: 'Turkish',
};

/**
 * Batch-translates arbitrary strings — event titles, reminder/notification
 * titles and bodies, and full past AI chat messages — into targetLang.
 * Texts already in the target language, or proper nouns/brand names, are
 * returned unchanged by the model rather than force-translated. Markdown
 * formatting (bold, bullets, etc.) in chat messages is preserved as-is.
 */
async function translateTexts(event) {
  const { texts, targetLang } = event.arguments;
  let input;
  try {
    input = JSON.parse(texts || '[]');
  } catch {
    return JSON.stringify([]);
  }
  if (!Array.isArray(input) || input.length === 0) return JSON.stringify([]);

  // Defensive caps — the frontend already chunks requests to stay under
  // these, this is just a backstop. Long enough to cover a full AI chat
  // reply (maxTokens:1024 on the chat handler is roughly 3-4k characters).
  const capped = input.slice(0, 25).map((t) => String(t ?? '').slice(0, 4000));
  const languageName = LANGUAGE_NAMES[targetLang] || targetLang || 'English';

  const client = new BedrockRuntimeClient({ region: 'us-east-1' });
  const prompt = `Translate each text below into ${languageName}. Entries may be short calendar event/reminder titles or full multi-sentence AI chat messages containing Markdown (bold **like this**, bullet points, line breaks). If a text is already in ${languageName}, or is a proper noun/brand name that shouldn't be translated, return it unchanged. Preserve emoji, Markdown formatting/structure, capitalization style, and punctuation exactly — only translate the natural-language words. Respond with ONLY a JSON array of strings — same length and order as the input, no commentary, no markdown fences around the array itself.\n\nInput:\n${JSON.stringify(capped)}`;

  try {
    const command = new ConverseCommand({
      modelId: MODEL_ID,
      system: [{ text: 'You are a precise translation engine for a calendar app. You only ever output a raw JSON array of strings, nothing else.' }],
      messages: [{ role: 'user', content: [{ text: prompt }] }],
      inferenceConfig: { maxTokens: 8192, temperature: 0 },
    });
    const response = await client.send(command);
    const rawText = response.output?.message?.content?.[0]?.text || '[]';
    const jsonMatch = rawText.match(/\[[\s\S]*\]/);
    const translated = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    if (!Array.isArray(translated) || translated.length !== capped.length) {
      // Alignment broke — fall back to the originals rather than risk mismatched titles.
      return JSON.stringify(capped);
    }
    return JSON.stringify(translated.map((t) => String(t ?? '')));
  } catch (error) {
    console.error('Translate invocation error:', error);
    return JSON.stringify(capped);
  }
}

export const handler = async (event) => {
  if (event.info?.fieldName === 'translateTexts') {
    return translateTexts(event);
  }

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

        // Bedrock requires strictly alternating user/assistant turns
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

  try {
    const command = new ConverseCommand({
      modelId: MODEL_ID,
      system: [{ text: SYSTEM_PROMPT + eventsContext + `\n\nToday's date: ${todaySafe}` }],
      messages: cleanMessages,
      inferenceConfig: {
        maxTokens: 1024,
        temperature: 0.7,
      },
    });

    const response = await client.send(command);
    const rawText = response.output?.message?.content?.[0]?.text || 'Sorry, I could not generate a response.';

    // Parse and convert to structured format
    const finalResponse = parseAIResponse(rawText, todaySafe);
    
    return finalResponse;
  } catch (error) {
    console.error('Bedrock invocation error:', error);
    return 'I\'m having trouble connecting right now. Please try again in a moment.';
  }
};
