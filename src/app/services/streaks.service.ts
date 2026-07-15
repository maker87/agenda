import { Injectable } from '@angular/core';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../../amplify/data/resource';

export interface Streak {
  id: string;
  name: string;
  target: number;
  unit: string;
  checkedDays: string[];
  loggedValues: Record<string, number>;
  aiPlan: string;
  createdAt: string;
  goalTotal?: number;
  goalDeadline?: string;
  /** Set when the streak has been soft-deleted (kept around for the history/restore view). */
  deletedAt?: string;
}

interface PendingWrite {
  op: 'create' | 'update' | 'delete';
  streak: Streak;
  ownerEmail: string;
}

// Lazy client — only instantiated on first use so a missing Amplify config
// does not crash the service at module load time.
let _client: ReturnType<typeof generateClient<Schema>> | null = null;
function getClient() {
  if (!_client) _client = generateClient<Schema>();
  return _client;
}

@Injectable({ providedIn: 'root' })
export class StreaksService {

  private cacheKey(ownerEmail: string) { return `agenda_streaks_${ownerEmail}`; }
  private pendingKey(ownerEmail: string) { return `agenda_streaks_pending_${ownerEmail}`; }

  syncing = false;
  syncWarning: string | null = null;

  // ── localStorage helpers ──────────────────────────────────────────────────

  private readCache(ownerEmail: string): Streak[] {
    try {
      const raw = localStorage.getItem(this.cacheKey(ownerEmail));
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  }

  private writeCache(ownerEmail: string, streaks: Streak[]) {
    try { localStorage.setItem(this.cacheKey(ownerEmail), JSON.stringify(streaks)); }
    catch (e) { console.warn('[StreaksService] localStorage write failed:', e); }
  }

  private readPending(ownerEmail: string): PendingWrite[] {
    try {
      const raw = localStorage.getItem(this.pendingKey(ownerEmail));
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  }

  private writePending(ownerEmail: string, queue: PendingWrite[]) {
    try { localStorage.setItem(this.pendingKey(ownerEmail), JSON.stringify(queue)); }
    catch (e) { console.warn('[StreaksService] pending write failed:', e); }
  }

  private enqueuePending(ownerEmail: string, entry: PendingWrite) {
    const queue = this.readPending(ownerEmail);
    const filtered = queue.filter(p => !(p.streak.id === entry.streak.id && p.op === entry.op));
    filtered.push(entry);
    this.writePending(ownerEmail, filtered);
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  listStreaks(
    ownerEmail: string,
    onSyncComplete?: (streaks: Streak[]) => void
  ): Streak[] {
    const cached = this.readCache(ownerEmail);
    if (ownerEmail) this.backgroundSync(ownerEmail, onSyncComplete);
    return cached;
  }

  async createStreak(streak: Omit<Streak, 'id'>, ownerEmail: string): Promise<Streak> {
    const tempId = `local_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const local: Streak = { id: tempId, ...streak };

    const cache = this.readCache(ownerEmail);
    this.writeCache(ownerEmail, [...cache, local]);

    try {
      const { data, errors } = await getClient().models.Streak.create({
        name:         streak.name,
        target:       streak.target,
        unit:         streak.unit,
        checkedDays:  streak.checkedDays,
        loggedValues: streak.loggedValues,
        aiPlan:       streak.aiPlan || undefined,
        startedOn:    streak.createdAt || undefined,
        goalTotal:    streak.goalTotal ?? undefined,
        goalDeadline: streak.goalDeadline ?? undefined,
        ownerEmail,
      } as any);
      if (errors?.length) throw new Error(errors[0].message);
      const saved = this.toLocal(data!);
      const currentCache = this.readCache(ownerEmail);
      const hasTemp = currentCache.some(s => s.id === tempId);
      const updated = hasTemp
        ? currentCache.map(s => s.id === tempId ? saved : s)
        : [...currentCache, saved];
      this.writeCache(ownerEmail, updated);
      this.syncWarning = null;
      return saved;
    } catch (err) {
      console.warn('[StreaksService] createStreak offline, queued:', err);
      this.syncWarning = 'Working offline — changes will sync when connection is restored.';
      this.enqueuePending(ownerEmail, { op: 'create', streak: local, ownerEmail });
      return local;
    }
  }

  async updateStreak(streak: Streak, ownerEmail: string): Promise<Streak> {
    const cache = this.readCache(ownerEmail);
    this.writeCache(ownerEmail, cache.map(s => s.id === streak.id ? streak : s));

    if (streak.id.startsWith('local_')) {
      this.enqueuePending(ownerEmail, { op: 'update', streak, ownerEmail });
      return streak;
    }

    try {
      const { data, errors } = await getClient().models.Streak.update({
        id:           streak.id,
        name:         streak.name,
        target:       streak.target,
        unit:         streak.unit,
        checkedDays:  streak.checkedDays,
        loggedValues: streak.loggedValues,
        aiPlan:       streak.aiPlan || undefined,
        goalTotal:    streak.goalTotal ?? undefined,
        goalDeadline: streak.goalDeadline ?? undefined,
        // Explicit null (not undefined) so restoring a streak actually clears
        // deletedAt server-side instead of leaving the field untouched.
        deletedAt:    streak.deletedAt ?? null,
      } as any);
      if (errors?.length) throw new Error(errors[0].message);
      const saved = this.toLocal(data!);
      const refreshed = this.readCache(ownerEmail).map(s => s.id === saved.id ? saved : s);
      this.writeCache(ownerEmail, refreshed);
      this.syncWarning = null;
      return saved;
    } catch (err) {
      console.warn('[StreaksService] updateStreak offline, queued:', err);
      this.syncWarning = 'Working offline — changes will sync when connection is restored.';
      this.enqueuePending(ownerEmail, { op: 'update', streak, ownerEmail });
      return streak;
    }
  }

  async deleteStreak(id: string, ownerEmail: string): Promise<void> {
    this.writeCache(ownerEmail, this.readCache(ownerEmail).filter(s => s.id !== id));

    if (id.startsWith('local_')) {
      this.writePending(ownerEmail, this.readPending(ownerEmail).filter(p => p.streak.id !== id));
      return;
    }

    try {
      const { errors } = await getClient().models.Streak.delete({ id });
      if (errors?.length) throw new Error(errors[0].message);
      this.syncWarning = null;
    } catch (err) {
      console.warn('[StreaksService] deleteStreak offline, queued:', err);
      this.syncWarning = 'Working offline — changes will sync when connection is restored.';
      const deleted = this.readCache(ownerEmail).find(s => s.id === id)
        ?? { id, name: '', target: 1, unit: '', checkedDays: [], loggedValues: {}, aiPlan: '', createdAt: '' };
      this.enqueuePending(ownerEmail, { op: 'delete', streak: deleted, ownerEmail });
    }
  }

  /** One-time import of legacy browser-only streaks (from before backend sync existed) into this account. */
  async migrateLegacyStreaks(legacy: Streak[], ownerEmail: string): Promise<void> {
    for (const s of legacy) {
      const { id, ...rest } = s;
      await this.createStreak(rest, ownerEmail);
    }
  }

  // ── Background sync ───────────────────────────────────────────────────────

  private async backgroundSync(ownerEmail: string, onSyncComplete?: (streaks: Streak[]) => void) {
    if (this.syncing) return;
    this.syncing = true;
    try {
      await this.flushPending(ownerEmail);
      const { data, errors } = await getClient().models.Streak.list({
        filter: { ownerEmail: { eq: ownerEmail } },
      });
      if (errors?.length) throw new Error(errors[0].message);
      const remote = (data ?? []).map(r => this.toLocal(r));
      const cache = this.readCache(ownerEmail);
      // Keep local-only items AND any cached items not yet in remote
      // (handles the race where createStreak completes but list doesn't include it yet)
      const remoteIds = new Set(remote.map(r => r.id));
      const notInRemote = cache.filter(s => !remoteIds.has(s.id));
      const merged = [...remote, ...notInRemote];
      this.writeCache(ownerEmail, merged);
      this.syncWarning = null;
      if (onSyncComplete) onSyncComplete(merged);
    } catch (err) {
      console.warn('[StreaksService] backgroundSync failed:', err);
      this.syncWarning = 'Working offline — changes will sync when connection is restored.';
      if (onSyncComplete) onSyncComplete(this.readCache(ownerEmail));
    } finally {
      this.syncing = false;
    }
  }

  private async flushPending(ownerEmail: string) {
    const queue = this.readPending(ownerEmail);
    if (!queue.length) return;
    const remaining: PendingWrite[] = [];
    for (const entry of queue) {
      try {
        if (entry.op === 'create') {
          const { data, errors } = await getClient().models.Streak.create({
            name:         entry.streak.name,
            target:       entry.streak.target,
            unit:         entry.streak.unit,
            checkedDays:  entry.streak.checkedDays,
            loggedValues: entry.streak.loggedValues,
            aiPlan:       entry.streak.aiPlan || undefined,
            startedOn:    entry.streak.createdAt || undefined,
            goalTotal:    entry.streak.goalTotal ?? undefined,
            goalDeadline: entry.streak.goalDeadline ?? undefined,
            ownerEmail:   entry.ownerEmail,
          } as any);
          if (errors?.length) throw new Error(errors[0].message);
          const saved = this.toLocal(data!);
          const cache = this.readCache(ownerEmail).map(s => s.id === entry.streak.id ? saved : s);
          this.writeCache(ownerEmail, cache);
        } else if (entry.op === 'update' && !entry.streak.id.startsWith('local_')) {
          const { errors } = await getClient().models.Streak.update({
            id:           entry.streak.id,
            name:         entry.streak.name,
            target:       entry.streak.target,
            unit:         entry.streak.unit,
            checkedDays:  entry.streak.checkedDays,
            loggedValues: entry.streak.loggedValues,
            aiPlan:       entry.streak.aiPlan || undefined,
            goalTotal:    entry.streak.goalTotal ?? undefined,
            goalDeadline: entry.streak.goalDeadline ?? undefined,
            deletedAt:    entry.streak.deletedAt ?? null,
          } as any);
          if (errors?.length) throw new Error(errors[0].message);
        } else if (entry.op === 'delete' && !entry.streak.id.startsWith('local_')) {
          const { errors } = await getClient().models.Streak.delete({ id: entry.streak.id });
          if (errors?.length) throw new Error(errors[0].message);
        }
      } catch (err) {
        console.warn('[StreaksService] flushPending entry failed:', err);
        remaining.push(entry);
      }
    }
    this.writePending(ownerEmail, remaining);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private toLocal(record: Schema['Streak']['type']): Streak {
    return {
      id:           record.id,
      name:         record.name ?? '',
      target:       record.target ?? 1,
      unit:         record.unit ?? 'times',
      checkedDays:  (record.checkedDays ?? []).filter((d): d is string => d !== null),
      loggedValues: (record.loggedValues as Record<string, number>) ?? {},
      aiPlan:       record.aiPlan ?? '',
      createdAt:    (record as any).startedOn ?? '',
      ...(record.goalTotal != null ? { goalTotal: record.goalTotal } : {}),
      ...(record.goalDeadline ? { goalDeadline: record.goalDeadline } : {}),
      ...((record as any).deletedAt ? { deletedAt: (record as any).deletedAt } : {}),
    };
  }
}
