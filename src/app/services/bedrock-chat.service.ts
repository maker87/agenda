import { Injectable } from '@angular/core';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../../amplify/data/resource';
import { CalendarEvent } from './events.service';
import { ChatMessage } from './ai-chat.service';
import { I18nService } from './i18n.service';

export interface ChatAction {
  type: 'create_event' | 'create_recurring' | 'create_reminder' | 'navigate' | 'delete_event' | 'reschedule_event';
  title?: string;
  date?: string;
  startTime?: string;
  endTime?: string;
  category?: string;
  dayOfWeek?: number;
  weeks?: number;
  body?: string;
  tab?: string;
  label?: string;
  newDate?: string;
  newStartTime?: string;
  newEndTime?: string;
}

let _client: ReturnType<typeof generateClient<Schema>> | null = null;
function getClient() {
  if (!_client) _client = generateClient<Schema>();
  return _client;
}

@Injectable({ providedIn: 'root' })
export class BedrockChatService {

  constructor(private i18n: I18nService) {}

  /**
   * Send a message to Claude via the Bedrock Lambda.
   * Returns the AI's response text and any parsed actions.
   */
  async sendMessage(
    message: string,
    events: CalendarEvent[],
    conversationHistory: ChatMessage[],
  ): Promise<{ text: string; actions: ChatAction[] }> {
    const today = new Date().toISOString().split('T')[0];
    const lang = this.i18n.getLanguage();

    // Trim events to essential fields to save tokens
    const trimmedEvents = events.slice(0, 50).map(e => ({
      title: e.title,
      date: e.date,
      startTime: e.startTime,
      endTime: e.endTime,
      category: e.category,
    }));

    // Trim conversation history to last 10 messages. Strip the client-side
    // "⚠️ could not be saved..." annotation (appended in the UI when an
    // action failed to parse/apply) before feeding a message back as
    // history — otherwise the model sees its own failure note as an
    // established fact and spirals into repeatedly apologizing/telling the
    // user to do it manually instead of just retrying cleanly next turn.
    const history = conversationHistory.slice(-10).map(m => ({
      role: m.role,
      text: m.role === 'assistant' ? m.text.replace(/\n\n⚠️[\s\S]*$/, '') : m.text,
    }));

    // Prepend language instruction to the message so the AI responds in the user's language
    const langInstruction = lang !== 'en'
      ? `[IMPORTANT: Respond in ${this.getLanguageName(lang)}. Do NOT respond in English.]\n\n`
      : '';

    try {
      const { data, errors } = await getClient().queries.chat({
        message: langInstruction + message,
        events: JSON.stringify(trimmedEvents),
        today,
        conversationHistory: JSON.stringify(history),
      });

      if (errors?.length) {
        throw new Error(errors[0].message);
      }

      const responseText = data ?? 'Sorry, I could not generate a response.';
      const { cleanText, actions } = this.parseActions(responseText);

      return { text: cleanText, actions };
    } catch (err: any) {
      console.error('[BedrockChat] Error:', err);
      // Fallback message
      return {
        text: `I'm having trouble connecting right now. Please try again in a moment.\n\n_Error: ${err.message || 'Unknown'}_`,
        actions: [],
      };
    }
  }

  private getLanguageName(code: string): string {
    const map: Record<string, string> = {
      en: 'English', es: 'Spanish', fr: 'French', de: 'German',
      pt: 'Portuguese', zh: 'Chinese', ja: 'Japanese', ar: 'Arabic',
      hi: 'Hindi', ko: 'Korean', it: 'Italian', ru: 'Russian',
      nl: 'Dutch', sv: 'Swedish', pl: 'Polish', tr: 'Turkish',
    };
    return map[code] || 'English';
  }

  /**
   * Parse action blocks from the AI's response.
   * Actions are embedded as ```action {...} ``` blocks.
   */
  private parseActions(text: string): { cleanText: string; actions: ChatAction[] } {
    const actions: ChatAction[] = [];
    
    // Match ```action, ```json, or plain ``` blocks containing action JSON
    const actionRegex = /```(?:action|json)?\s*\n?([\s\S]*?)\n?```/g;

    let match;
    while ((match = actionRegex.exec(text)) !== null) {
      try {
        const parsed = JSON.parse(match[1].trim());
        // Only treat it as an action if it has a valid type field
        if (parsed.type && ['create_event', 'create_recurring', 'create_reminder', 'navigate', 'delete_event', 'reschedule_event'].includes(parsed.type)) {
          actions.push(parsed);
        }
      } catch {
        // Ignore malformed blocks
      }
    }

    // Also try to find inline JSON objects with action types (no code block wrapper)
    if (actions.length === 0) {
      const inlineRegex = /\{[^{}]*"type"\s*:\s*"(create_event|create_recurring|create_reminder|delete_event|reschedule_event)"[^{}]*\}/g;
      let inlineMatch;
      while ((inlineMatch = inlineRegex.exec(text)) !== null) {
        try {
          const parsed = JSON.parse(inlineMatch[0]);
          actions.push(parsed);
        } catch { /* ignore */ }
      }
    }

    // Remove all code blocks from the displayed text
    const cleanText = text.replace(/```(?:action|json)?\s*\n?[\s\S]*?\n?```/g, '').trim();

    return { cleanText, actions };
  }
}
