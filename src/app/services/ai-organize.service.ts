import { Injectable } from '@angular/core';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../../amplify/data/resource';
import { CalendarEvent } from './events.service';
import { I18nService } from './i18n.service';

export interface OrganizedEvent {
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  category: string;
  description: string;
  color: string;
  recurring?: {
    days: number[];       // 0=Sun, 1=Mon ... 6=Sat
    untilDate: string;    // YYYY-MM-DD
  };
}

export interface OrganizeResult {
  events: OrganizedEvent[];
  categories: string[];
  summary: string;
}

let _client: ReturnType<typeof generateClient<Schema>> | null = null;
function getClient() {
  if (!_client) _client = generateClient<Schema>();
  return _client;
}

const CATEGORY_COLORS: Record<string, string> = {
  'Work': '#6c63ff',
  'School': '#3b82f6',
  'Sports': '#10b981',
  'Health': '#10b981',
  'Fitness': '#10b981',
  'Personal': '#ec4899',
  'Social': '#ef4444',
  'Music': '#ec4899',
  'Study': '#f59e0b',
  'Meeting': '#6c63ff',
  'Class': '#3b82f6',
};

function pickColor(category: string): string {
  const lower = category.toLowerCase();
  for (const [key, color] of Object.entries(CATEGORY_COLORS)) {
    if (lower.includes(key.toLowerCase())) return color;
  }
  const palette = ['#6c63ff', '#3b82f6', '#10b981', '#f59e0b', '#ec4899', '#ef4444', '#8b5cf6', '#14b8a6'];
  let hash = 0;
  for (let i = 0; i < category.length; i++) hash = (hash * 31 + category.charCodeAt(i)) & 0x7fffffff;
  return palette[hash % palette.length];
}

@Injectable({ providedIn: 'root' })
export class AiOrganizeService {

  constructor(private i18n: I18nService) {}

  /**
   * Send the user's description to the AI and get organized events back.
   * Falls back to a local parser if Bedrock is unavailable.
   */
  async organize(
    description: string,
    existingEvents: CalendarEvent[],
    existingCategories: string[],
  ): Promise<OrganizeResult> {
    try {
      return await this.organizeWithBedrock(description, existingEvents, existingCategories);
    } catch (err) {
      console.warn('[AiOrganize] Bedrock unavailable, using local parser:', err);
      return this.organizeLocally(description);
    }
  }

  private async organizeWithBedrock(
    description: string,
    existingEvents: CalendarEvent[],
    existingCategories: string[],
  ): Promise<OrganizeResult> {
    const today = new Date().toISOString().split('T')[0];
    const dayOfWeek = new Date().toLocaleDateString('en-US', { weekday: 'long' });
    const lang = this.i18n.getLanguage();

    const systemPrompt = `You are an AI scheduling assistant. The user will describe their schedule, activities, or routines. Your job is to parse their description into structured calendar events with appropriate categories.

Today is ${today} (${dayOfWeek}). 

Rules:
- Create events for the current or upcoming week unless the user specifies otherwise.
- Assign each event a sensible category. Use existing categories when they match: ${existingCategories.join(', ') || 'none yet'}.
- For recurring activities (e.g., "every Monday"), generate the next 4 weeks of occurrences OR return a recurring pattern.
- Use 24-hour time format (HH:MM).
- If the user mentions relative days like "tomorrow" or "next Tuesday", calculate the actual date.
- Keep event titles concise but descriptive.

Respond ONLY with valid JSON in this exact format:
{
  "events": [
    {
      "title": "Event Name",
      "date": "YYYY-MM-DD",
      "startTime": "HH:MM",
      "endTime": "HH:MM",
      "category": "Category Name",
      "description": "Brief description",
      "color": "#hex",
      "recurring": { "days": [1, 3, 5], "untilDate": "YYYY-MM-DD" }
    }
  ],
  "categories": ["Category1", "Category2"],
  "summary": "Brief summary of what was organized"
}

The "recurring" field is optional — only include it for repeating events. The "days" array uses 0=Sunday through 6=Saturday.
Colors should be from: #6c63ff (purple), #3b82f6 (blue), #10b981 (green), #f59e0b (amber), #ec4899 (pink), #ef4444 (red), #8b5cf6 (violet), #14b8a6 (teal).
${lang !== 'en' ? `Respond with the summary in ${lang}.` : ''}`;

    const userMessage = description;

    const { data, errors } = await getClient().queries.chat({
      message: userMessage,
      events: JSON.stringify(existingEvents.slice(0, 30).map(e => ({
        title: e.title,
        date: e.date,
        startTime: e.startTime,
        endTime: e.endTime,
        category: e.category,
      }))),
      today,
      conversationHistory: JSON.stringify([
        { role: 'system', content: systemPrompt },
      ]),
    });

    if (errors?.length) throw new Error(errors[0].message);
    if (!data) throw new Error('No response from AI');

    const responseText = typeof data === 'string' ? data : JSON.stringify(data);

    // Extract JSON from the response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Could not parse AI response');

    const parsed = JSON.parse(jsonMatch[0]) as OrganizeResult;

    // Expand recurring events
    const expanded: OrganizedEvent[] = [];
    for (const ev of parsed.events) {
      if (ev.recurring && ev.recurring.days.length > 0) {
        const occurrences = this.expandRecurring(ev);
        expanded.push(...occurrences);
      } else {
        expanded.push(ev);
      }
    }

    return {
      events: expanded,
      categories: parsed.categories || [],
      summary: parsed.summary || 'Events organized successfully.',
    };
  }

  /**
   * Local fallback parser — uses regex patterns to extract events from natural language.
   */
  private organizeLocally(description: string): OrganizeResult {
    const events: OrganizedEvent[] = [];
    const categories = new Set<string>();
    const today = new Date();

    // Split by common delimiters
    const lines = description.split(/[,;\n]+/).map(l => l.trim()).filter(Boolean);

    const dayNames: Record<string, number> = {
      'sunday': 0, 'sun': 0,
      'monday': 1, 'mon': 1,
      'tuesday': 2, 'tue': 2, 'tues': 2,
      'wednesday': 3, 'wed': 3,
      'thursday': 4, 'thu': 4, 'thurs': 4,
      'friday': 5, 'fri': 5,
      'saturday': 6, 'sat': 6,
    };

    const timePattern = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/gi;
    const dayPattern = new RegExp(
      `\\b(${Object.keys(dayNames).join('|')})(s)?\\b|\\b(every\\s+day|daily|weekdays|weekends)\\b`,
      'gi'
    );

    for (const line of lines) {
      const lowerLine = line.toLowerCase();

      // Try to find days
      const foundDays: number[] = [];
      let dayMatch;
      const dayRe = new RegExp(
        `\\b(${Object.keys(dayNames).join('|')})s?\\b`,
        'gi'
      );
      while ((dayMatch = dayRe.exec(lowerLine)) !== null) {
        const day = dayNames[dayMatch[1].toLowerCase()];
        if (day !== undefined && !foundDays.includes(day)) foundDays.push(day);
      }
      if (/\b(daily|every\s*day)\b/i.test(lowerLine)) {
        foundDays.push(0, 1, 2, 3, 4, 5, 6);
      }
      if (/\bweekdays?\b/i.test(lowerLine)) {
        foundDays.push(1, 2, 3, 4, 5);
      }
      if (/\bweekends?\b/i.test(lowerLine)) {
        foundDays.push(0, 6);
      }

      // Try to find times
      const times: string[] = [];
      let timeMatch;
      const timeRe = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/gi;
      while ((timeMatch = timeRe.exec(line)) !== null) {
        let hour = parseInt(timeMatch[1], 10);
        const min = timeMatch[2] || '00';
        const ampm = timeMatch[3]?.toLowerCase();
        if (ampm === 'pm' && hour < 12) hour += 12;
        if (ampm === 'am' && hour === 12) hour = 0;
        times.push(`${hour.toString().padStart(2, '0')}:${min}`);
      }

      // Extract title (remove time and day references)
      let title = line
        .replace(/\b(every|on|from|to|at|-|–)\b/gi, ' ')
        .replace(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/gi, ' ')
        .replace(new RegExp(`\\b(${Object.keys(dayNames).join('|')})s?\\b`, 'gi'), ' ')
        .replace(/\b(daily|weekdays?|weekends?)\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      if (!title || title.length < 2) continue;
      title = title.charAt(0).toUpperCase() + title.slice(1);

      // Guess category
      const category = this.guessCategory(title);
      categories.add(category);

      const startTime = times[0] || '09:00';
      const endTime = times[1] || this.addHour(startTime);

      if (foundDays.length > 0) {
        // Create recurring events for the next 4 weeks
        const untilDate = new Date(today);
        untilDate.setDate(untilDate.getDate() + 28);
        const untilStr = untilDate.toISOString().split('T')[0];

        for (const dayNum of foundDays) {
          const nextDate = this.getNextDayOfWeek(today, dayNum);
          events.push({
            title,
            date: nextDate,
            startTime,
            endTime,
            category,
            description: `Recurring: every ${this.dayNumToName(dayNum)}`,
            color: pickColor(category),
            recurring: { days: foundDays, untilDate: untilStr },
          });
        }
      } else {
        // Single event — put it tomorrow
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        events.push({
          title,
          date: tomorrow.toISOString().split('T')[0],
          startTime,
          endTime,
          category,
          description: '',
          color: pickColor(category),
        });
      }
    }

    // Deduplicate recurring events — keep one representative per unique title+days
    const seen = new Set<string>();
    const deduped: OrganizedEvent[] = [];
    for (const ev of events) {
      const key = ev.recurring
        ? `${ev.title}|${ev.recurring.days.sort().join(',')}`
        : `${ev.title}|${ev.date}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(ev);
      }
    }

    // Expand recurring into individual dates
    const expanded: OrganizedEvent[] = [];
    for (const ev of deduped) {
      if (ev.recurring) {
        expanded.push(...this.expandRecurring(ev));
      } else {
        expanded.push(ev);
      }
    }

    return {
      events: expanded,
      categories: Array.from(categories),
      summary: expanded.length > 0
        ? `Organized ${expanded.length} events into ${categories.size} categories.`
        : 'Could not parse any events. Try describing your schedule with times and days.',
    };
  }

  private expandRecurring(ev: OrganizedEvent): OrganizedEvent[] {
    if (!ev.recurring) return [ev];
    const results: OrganizedEvent[] = [];
    const today = new Date();
    const until = new Date(ev.recurring.untilDate + 'T23:59:59');
    const cur = new Date(today);

    // Start from today, go forward
    while (cur <= until && results.length < 60) {
      if (ev.recurring.days.includes(cur.getDay())) {
        results.push({
          ...ev,
          date: cur.toISOString().split('T')[0],
          recurring: undefined,
        });
      }
      cur.setDate(cur.getDate() + 1);
    }
    return results;
  }

  private guessCategory(title: string): string {
    const lower = title.toLowerCase();
    if (/\b(class|lecture|exam|test|homework|study|tutor|school|ap |calculus|english|history|chemistry|physics|biology|math)\b/.test(lower)) return 'School';
    if (/\b(soccer|football|basketball|baseball|track|swim|gym|workout|run|practice|game|sport|fitness|yoga|exercise)\b/.test(lower)) return 'Sports';
    if (/\b(work|meeting|standup|call|client|office|shift|job)\b/.test(lower)) return 'Work';
    if (/\b(doctor|dentist|appointment|therapy|health|medical)\b/.test(lower)) return 'Health';
    if (/\b(piano|guitar|violin|music|band|choir|orchestra|rehearsal|lesson)\b/.test(lower)) return 'Music';
    if (/\b(lunch|dinner|brunch|coffee|hangout|party|birthday|social)\b/.test(lower)) return 'Social';
    if (/\b(club|robotics|debate|volunteer|community)\b/.test(lower)) return 'Clubs';
    return 'Personal';
  }

  private getNextDayOfWeek(from: Date, dayOfWeek: number): string {
    const d = new Date(from);
    const diff = (dayOfWeek - d.getDay() + 7) % 7 || 7;
    d.setDate(d.getDate() + diff);
    return d.toISOString().split('T')[0];
  }

  private dayNumToName(num: number): string {
    return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][num];
  }

  private addHour(time: string): string {
    const [h, m] = time.split(':').map(Number);
    const newH = Math.min(h + 1, 23);
    return `${newH.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
  }
}
