import { Injectable } from '@angular/core';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../../amplify/data/resource';
import { CalendarEvent } from './events.service';
import { ChatMessage } from './ai-chat.service';

export interface ChatAction {
  type: 'create_event' | 'create_recurring' | 'create_reminder' | 'navigate';
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
}

let _client: ReturnType<typeof generateClient<Schema>> | null = null;
function getClient() {
  if (!_client) _client = generateClient<Schema>();
  return _client;
}

@Injectable({ providedIn: 'root' })
export class BedrockChatService {

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

    // Trim events to essential fields to save tokens
    const trimmedEvents = events.slice(0, 50).map(e => ({
      title: e.title,
      date: e.date,
      startTime: e.startTime,
      endTime: e.endTime,
      category: e.category,
    }));

    // Trim conversation history to last 10 messages
    const history = conversationHistory.slice(-10).map(m => ({
      role: m.role,
      text: m.text,
    }));

    try {
      const { data, errors } = await getClient().queries.chat({
        message,
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
        if (parsed.type && ['create_event', 'create_recurring', 'create_reminder', 'navigate'].includes(parsed.type)) {
          actions.push(parsed);
        }
      } catch {
        // Ignore malformed blocks
      }
    }

    // Also try to find inline JSON objects with action types (no code block wrapper)
    if (actions.length === 0) {
      const inlineRegex = /\{[^{}]*"type"\s*:\s*"(create_event|create_recurring|create_reminder)"[^{}]*\}/g;
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
