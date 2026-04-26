//
const matchPath = (path = "", dir = "") => {
    const normalizedDir = dir.endsWith('/') ? dir : `${dir}/`;
    return path.startsWith(normalizedDir);
}

//
const channel = new BroadcastChannel('rs-fs'), watchers = new Map<string, Set<() => void>>();
channel.addEventListener('close', () => watchers.clear());
channel.addEventListener('message', (event: MessageEvent) => {
    const payload = event?.data;
    if (!payload || (payload.type !== 'commit-result' && payload.type !== 'commit-to-clipboard')) return;
    const results: any[] = payload?.results ?? [];
    if (!Array.isArray(results) || !results.length) return;
    for (const [dir, listeners] of watchers.entries()) {
        if (!listeners.size) continue;
        const hit = results.some((item) => matchPath(item?.path, dir));
        if (!hit) continue;
        for (const listener of listeners) {
            try { listener(); } catch (e) { console.warn(e); }
        }
    }
});

//
export const stopAllWatchers = () => watchers.clear();
export const watchFsDirectory = (dir: string, listener: () => void) => {
    if (!dir || typeof listener !== 'function') return () => void 0;
    const normalized = dir.endsWith('/') ? dir : `${dir}/`;
    let listeners = watchers.get(normalized);
    if (!listeners) {
        listeners = new Set();
        watchers.set(normalized, listeners);
    }
    listeners.add(listener);
    return () => {
        const current = watchers.get(normalized);
        if (!current) return;
        current.delete(listener);
        if (!current.size) watchers.delete(normalized);
    };
};
