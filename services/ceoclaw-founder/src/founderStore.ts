/**
 * founderStore.ts
 *
 * Supabase persistence for:
 *   - ceoclaw_business_state  (singleton row — the live state of the business)
 *   - ceoclaw_task_log        (append-only log of every agent task executed)
 *
 * Required SQL (run once in Supabase SQL editor):
 *
 *   create table ceoclaw_business_state (
 *     id text primary key default 'singleton',
 *     mrr numeric default 0,
 *     total_signups int default 0,
 *     active_users int default 0,
 *     traffic_last_30d int default 0,
 *     landing_page_url text,
 *     latest_idea text,
 *     latest_content_title text,
 *     tasks_completed_today int default 0,
 *     tasks_completed_total int default 0,
 *     loop_enabled boolean default false,
 *     phase text default 'pre-launch',
 *     updated_at timestamptz default now()
 *   );
 *
 *   create table ceoclaw_task_log (
 *     task_id text primary key,
 *     task_type text not null,
 *     domain text not null,
 *     status text default 'pending',
 *     reason text,
 *     priority text,
 *     input jsonb,
 *     output jsonb,
 *     error text,
 *     mrr_at_time numeric default 0,
 *     started_at timestamptz default now(),
 *     completed_at timestamptz
 *   );
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
    BusinessState,
    BusinessPhase,
    TaskRecord,
    TaskStatus,
    TaskOutput,
} from './founderTypes';

// ─── Client ───────────────────────────────────────────────────────────────────

let _supabase: SupabaseClient | null = null;

const getDb = (): SupabaseClient | null => {
    if (_supabase) return _supabase;
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return null;
    _supabase = createClient(url, key);
    return _supabase;
};

// ─── Default state (used when DB not configured or row doesn't exist) ─────────

const defaultState = (): BusinessState => ({
    mrr: 0,
    totalSignups: 0,
    activeUsers: 0,
    trafficLast30d: 0,
    tasksCompletedToday: 0,
    tasksCompletedTotal: 0,
    loopEnabled: false,
    phase: 'pre-launch',
    updatedAt: new Date().toISOString(),
});

// ─── Business State ───────────────────────────────────────────────────────────

export const loadBusinessState = async (): Promise<BusinessState> => {
    const db = getDb();
    if (!db) {
        console.warn('[FounderStore] Supabase not configured — using in-memory default state.');
        return defaultState();
    }

    const { data, error } = await db
        .from('ceoclaw_business_state')
        .select('*')
        .eq('id', 'singleton')
        .single();

    if (error || !data) {
        // Row doesn't exist yet — seed it
        const initial = defaultState();
        await saveBusinessState(initial);
        return initial;
    }

    return {
        mrr: data.mrr || 0,
        totalSignups: data.total_signups || 0,
        activeUsers: data.active_users || 0,
        trafficLast30d: data.traffic_last_30d || 0,
        landingPageUrl: data.landing_page_url || undefined,
        latestIdea: data.latest_idea || undefined,
        latestContentTitle: data.latest_content_title || undefined,
        tasksCompletedToday: data.tasks_completed_today || 0,
        tasksCompletedTotal: data.tasks_completed_total || 0,
        loopEnabled: data.loop_enabled || false,
        phase: (data.phase as BusinessPhase) || 'pre-launch',
        updatedAt: data.updated_at,
    };
};

export const saveBusinessState = async (state: BusinessState): Promise<void> => {
    const db = getDb();
    if (!db) return;

    const { error } = await db.from('ceoclaw_business_state').upsert({
        id: 'singleton',
        mrr: state.mrr,
        total_signups: state.totalSignups,
        active_users: state.activeUsers,
        traffic_last_30d: state.trafficLast30d,
        landing_page_url: state.landingPageUrl ?? null,
        latest_idea: state.latestIdea ?? null,
        latest_content_title: state.latestContentTitle ?? null,
        tasks_completed_today: state.tasksCompletedToday,
        tasks_completed_total: state.tasksCompletedTotal,
        loop_enabled: state.loopEnabled,
        phase: state.phase,
        updated_at: new Date().toISOString(),
    }, { onConflict: 'id' });

    if (error) {
        console.error('[FounderStore] Failed to save business state:', error.message);
    }
};

export const patchBusinessState = async (
    patch: Partial<Omit<BusinessState, 'updatedAt'>>
): Promise<BusinessState> => {
    const current = await loadBusinessState();
    const updated: BusinessState = {
        ...current,
        ...patch,
        updatedAt: new Date().toISOString(),
    };
    await saveBusinessState(updated);
    return updated;
};

export const setLoopEnabled = async (enabled: boolean): Promise<void> => {
    await patchBusinessState({ loopEnabled: enabled });
};

// ─── Task Log ─────────────────────────────────────────────────────────────────

export const appendTaskLog = async (task: TaskRecord): Promise<void> => {
    const db = getDb();
    if (!db) {
        console.log(`[FounderStore] Task logged (no DB): ${task.taskId} ${task.taskType} ${task.status}`);
        return;
    }

    const { error } = await db.from('ceoclaw_task_log').upsert({
        task_id: task.taskId,
        task_type: task.taskType,
        domain: task.domain,
        status: task.status,
        reason: task.reason,
        priority: task.priority,
        input: task.input ?? null,
        output: task.output ?? null,
        error: task.error ?? null,
        mrr_at_time: task.mrrAtTime,
        started_at: task.startedAt,
        completed_at: task.completedAt ?? null,
    }, { onConflict: 'task_id' });

    if (error) {
        console.error('[FounderStore] Failed to log task:', error.message);
    }
};

export const updateTaskLog = async (
    taskId: string,
    update: {
        status: TaskStatus;
        output?: TaskOutput;
        error?: string;
        completedAt?: string;
    }
): Promise<void> => {
    const db = getDb();
    if (!db) return;

    const { error } = await db.from('ceoclaw_task_log').update({
        status: update.status,
        output: update.output ?? null,
        error: update.error ?? null,
        completed_at: update.completedAt ?? null,
    }).eq('task_id', taskId);

    if (error) {
        console.error('[FounderStore] Failed to update task log:', error.message);
    }
};

export const getTaskHistory = async (limit = 50): Promise<TaskRecord[]> => {
    const db = getDb();
    if (!db) return [];

    const { data, error } = await db
        .from('ceoclaw_task_log')
        .select('*')
        .order('started_at', { ascending: false })
        .limit(limit);

    if (error || !data) return [];

    return data.map((row) => ({
        taskId: row.task_id,
        taskType: row.task_type,
        domain: row.domain,
        status: row.status,
        reason: row.reason || '',
        priority: row.priority || 'medium',
        input: row.input || undefined,
        output: row.output || undefined,
        error: row.error || undefined,
        mrrAtTime: row.mrr_at_time || 0,
        startedAt: row.started_at,
        completedAt: row.completed_at || undefined,
    }));
};

export const getRecentCompletedTaskTypes = async (limit = 5): Promise<string[]> => {
    const db = getDb();
    if (!db) return [];

    const { data } = await db
        .from('ceoclaw_task_log')
        .select('task_type')
        .eq('status', 'completed')
        .order('completed_at', { ascending: false })
        .limit(limit);

    return (data || []).map((r) => r.task_type);
};
