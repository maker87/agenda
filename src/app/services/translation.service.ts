import { Injectable } from '@angular/core';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../../amplify/data/resource';
import { I18nService, LangCode } from './i18n.service';

const CACHE_KEY = 'agenda_title_translations';
const MAX_CACHE_ENTRIES = 3000;
const FLUSH_DEBOUNCE_MS = 120;
// Matches the backend's per-call cap (amplify/functions/bedrock-chat/handler.js)
// so a large pending set (e.g. opening a long chat history) gets split into
// multiple calls instead of silently losing anything past the backend's cap.
const MAX_ITEMS_PER_CALL = 25;

let _client: ReturnType<typeof generateClient<Schema>> | null = null;
function getClient() {
  if (!_client) _client = generateClient<Schema>();
  return _client;
}

/**
 * Translates event titles into the current display language on the fly, so
 * an event entered in one language still reads naturally after switching
 * languages. Reads are synchronous (cache-backed) so this can be used
 * directly from templates via TranslateTitlePipe; cache misses kick off a
 * debounced, batched backend call and resolve on a later render pass.
 */
@Injectable({ providedIn: 'root' })
export class TranslationService {
  // key: `${lang}::${originalText}` -> translated text
  private cache = new Map<string, string>();
  private pending = new Set<string>();
  private inFlight = new Set<string>();
  private flushHandle: ReturnType<typeof setTimeout> | null = null;

  constructor(private i18n: I18nService) {
    this.loadCache();
  }

  /** Synchronous lookup for template use. Returns the original text until the translation lands. */
  translate(text: string): string {
    const trimmed = (text ?? '').trim();
    if (!trimmed) return text;

    const lang = this.i18n.getLanguage();
    const key = this.cacheKey(lang, trimmed);
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;

    if (!this.inFlight.has(key) && !this.pending.has(key)) {
      this.pending.add(key);
      this.scheduleFlush();
    }
    return text;
  }

  private cacheKey(lang: string, text: string): string {
    return `${lang}::${text}`;
  }

  private scheduleFlush() {
    if (this.flushHandle) return;
    this.flushHandle = setTimeout(() => this.flush(), FLUSH_DEBOUNCE_MS);
  }

  private async flush() {
    this.flushHandle = null;
    if (this.pending.size === 0) return;

    // Group the pending keys by language (usually just one, but be safe if
    // the user switches languages while a batch is mid-flight).
    const byLang = new Map<string, string[]>();
    for (const key of this.pending) {
      const sep = key.indexOf('::');
      const lang = key.slice(0, sep);
      const text = key.slice(sep + 2);
      this.inFlight.add(key);
      if (!byLang.has(lang)) byLang.set(lang, []);
      byLang.get(lang)!.push(text);
    }
    this.pending.clear();

    const calls: Promise<void>[] = [];
    for (const [lang, texts] of byLang.entries()) {
      for (let i = 0; i < texts.length; i += MAX_ITEMS_PER_CALL) {
        calls.push(this.translateBatch(lang as LangCode, texts.slice(i, i + MAX_ITEMS_PER_CALL)));
      }
    }
    await Promise.all(calls);
  }

  private async translateBatch(lang: LangCode, texts: string[]) {
    const keys = texts.map(t => this.cacheKey(lang, t));
    try {
      const { data, errors } = await getClient().queries.translateTexts({
        texts: JSON.stringify(texts),
        targetLang: lang,
      });
      if (errors?.length) throw new Error(errors[0].message);
      const translated: string[] = JSON.parse(data ?? '[]');
      texts.forEach((text, i) => {
        this.cache.set(this.cacheKey(lang, text), translated[i] ?? text);
      });
      this.saveCache();
    } catch (err) {
      console.warn('[TranslationService] Batch translation failed, showing originals:', err);
      // Cache the originals too, so we don't keep retrying the same failing batch forever.
      texts.forEach(text => this.cache.set(this.cacheKey(lang, text), text));
    } finally {
      keys.forEach(k => this.inFlight.delete(k));
    }
  }

  private loadCache() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return;
      const entries: [string, string][] = JSON.parse(raw);
      this.cache = new Map(entries);
    } catch { /* ignore corrupt cache */ }
  }

  private saveCache() {
    try {
      let entries = Array.from(this.cache.entries());
      if (entries.length > MAX_CACHE_ENTRIES) {
        entries = entries.slice(entries.length - MAX_CACHE_ENTRIES);
        this.cache = new Map(entries);
      }
      localStorage.setItem(CACHE_KEY, JSON.stringify(entries));
    } catch { /* storage full or unavailable — in-memory cache still works this session */ }
  }
}
