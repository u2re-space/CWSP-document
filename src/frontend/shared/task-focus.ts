import type { ViewId } from "../shells/types";

export type TaskWindowState = "active" | "background" | "minimized";
export type TaskOpenTarget = "shell" | "window" | "frame" | "screen";
export type TaskHashAction = "focus" | "open" | "view";

export type TaskDescriptor = {
    id: string;
    viewId: ViewId;
    state: TaskWindowState;
    updatedAt: number;
    params?: Record<string, string>;
    target?: TaskOpenTarget;
};

export type TaskHashMeta = {
    taskId: string;
    viewId?: ViewId;
    state?: TaskWindowState;
    target?: TaskOpenTarget;
    action?: TaskHashAction;
    params?: Record<string, string>;
};

const TASK_SYNC_CHANNEL = "cw-task-focus-sync";
const TASK_HASH_PREFIX = "task-";

const taskRegistry = new Map<string, TaskDescriptor>();
let taskSyncChannel: BroadcastChannel | null = null;

const now = () => Date.now();

const normalizeTaskId = (value?: string | null): string => {
    const raw = String(value || "").trim().replace(/^#/, "");
    if (!raw) return "";
    return raw;
};

export const createTaskId = (viewId: ViewId): string => {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return `${TASK_HASH_PREFIX}${viewId}-${crypto.randomUUID().slice(0, 8)}`;
    }
    return `${TASK_HASH_PREFIX}${viewId}-${Math.random().toString(36).slice(2, 10)}`;
};

export const getTaskFromHash = (): string | null => {
    const meta = getTaskHashMeta();
    return meta?.taskId || null;
};

const encodeHashMeta = (meta?: Omit<TaskHashMeta, "taskId">): string => {
    if (!meta) return "";
    const normalized: Omit<TaskHashMeta, "taskId"> = {};
    if (meta.viewId) normalized.viewId = meta.viewId;
    if (meta.state) normalized.state = meta.state;
    if (meta.target) normalized.target = meta.target;
    if (meta.action) normalized.action = meta.action;
    if (meta.params && Object.keys(meta.params).length > 0) normalized.params = meta.params;
    const json = JSON.stringify(normalized);
    return json === "{}" ? "" : encodeURIComponent(json);
};

const decodeHashMeta = (value?: string): Omit<TaskHashMeta, "taskId"> | null => {
    const raw = String(value || "").trim();
    if (!raw) return null;
    try {
        const parsed = JSON.parse(decodeURIComponent(raw));
        if (!parsed || typeof parsed !== "object") return null;
        return parsed as Omit<TaskHashMeta, "taskId">;
    } catch {
        return null;
    }
};

export const getTaskHashMeta = (): TaskHashMeta | null => {
    if (typeof window === "undefined") return null;
    const hashRaw = String(globalThis.location.hash || "").replace(/^#/, "").trim();
    if (!hashRaw) return null;
    // New canonical format: #<viewId> (readable, shareable URL).
    if (!hashRaw.includes("|") && !hashRaw.startsWith(TASK_HASH_PREFIX)) {
        const viewId = decodeURIComponent(hashRaw) as ViewId;
        const taskId = `${TASK_HASH_PREFIX}${viewId}-hash`;
        return {
            taskId,
            viewId,
            state: "active",
            target: "shell",
            action: "focus"
        };
    }
    const [rawId, rawMeta] = hashRaw.split("|", 2);
    const taskId = normalizeTaskId(rawId);
    if (!taskId) return null;
    const meta = decodeHashMeta(rawMeta) || {};
    return {
        taskId,
        ...meta
    };
};

export const setTaskHash = (
    taskId: string,
    replace = true,
    meta?: Omit<TaskHashMeta, "taskId">
): void => {
    if (typeof window === "undefined") return;
    const id = normalizeTaskId(taskId);
    if (!id) return;
    // Canonical, human-readable hash: #<viewId>.
    // Keep legacy task/meta format only as fallback when no viewId is available.
    const canonicalView = String(meta?.viewId || "").trim();
    const nextHash = canonicalView
        ? `#${encodeURIComponent(canonicalView)}`
        : (() => {
            const metaPart = encodeHashMeta(meta);
            return metaPart ? `#${id}|${metaPart}` : `#${id}`;
        })();
    if (globalThis.location.hash === nextHash) return;
    if (replace) {
        globalThis.history.replaceState(globalThis.history.state, "", `${globalThis.location.pathname}${globalThis.location.search}${nextHash}`);
    } else {
        globalThis.location.hash = nextHash.replace(/^#/, "");
    }
};

export const upsertTask = (task: Omit<TaskDescriptor, "updatedAt">): TaskDescriptor => {
    const next: TaskDescriptor = {
        ...task,
        updatedAt: now()
    };
    taskRegistry.set(next.id, next);
    return next;
};

export const getTask = (taskId?: string | null): TaskDescriptor | null => {
    const id = normalizeTaskId(taskId);
    if (!id) return null;
    return taskRegistry.get(id) || null;
};

export const findTaskByView = (viewId: ViewId): TaskDescriptor | null => {
    for (const task of taskRegistry.values()) {
        if (task.viewId === viewId) return task;
    }
    return null;
};

export const listTasks = (): TaskDescriptor[] => Array.from(taskRegistry.values());

export const initTaskSyncChannel = (
    onRemoteTask: (task: TaskDescriptor) => void
): void => {
    if (typeof BroadcastChannel === "undefined") return;
    if (taskSyncChannel) return;
    taskSyncChannel = new BroadcastChannel(TASK_SYNC_CHANNEL);
    taskSyncChannel.addEventListener("message", (event: MessageEvent) => {
        const payload = event.data as { type?: string; task?: TaskDescriptor };
        if (payload?.type !== "task-sync" || !payload.task?.id) return;
        const existing = taskRegistry.get(payload.task.id);
        if (existing && existing.updatedAt >= payload.task.updatedAt) return;
        taskRegistry.set(payload.task.id, payload.task);
        onRemoteTask(payload.task);
    });
};

export const publishTaskSync = (task: TaskDescriptor): void => {
    if (!taskSyncChannel) return;
    taskSyncChannel.postMessage({
        type: "task-sync",
        task
    });
};

