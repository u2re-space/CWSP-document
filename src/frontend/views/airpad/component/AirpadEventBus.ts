export type AirpadEventMap = {
    "ui.config.open": undefined;
    "ui.reload.request": undefined;
    "ui.motion.reset": undefined;
    "session.connect.request": undefined;
    "session.connection.changed": { connected: boolean };
    "transport.intent": { type: string; payload?: unknown };
};

type AirpadEventHandler<K extends keyof AirpadEventMap> = (payload: AirpadEventMap[K]) => void;

export class AirpadEventBus {
    private handlers = new Map<keyof AirpadEventMap, Set<AirpadEventHandler<any>>>();

    on<K extends keyof AirpadEventMap>(event: K, handler: AirpadEventHandler<K>): () => void {
        const existing = this.handlers.get(event) ?? new Set<AirpadEventHandler<K>>();
        existing.add(handler);
        this.handlers.set(event, existing as Set<AirpadEventHandler<any>>);
        return () => this.off(event, handler);
    }

    off<K extends keyof AirpadEventMap>(event: K, handler: AirpadEventHandler<K>): void {
        const existing = this.handlers.get(event);
        if (!existing) return;
        existing.delete(handler as AirpadEventHandler<any>);
        if (existing.size === 0) {
            this.handlers.delete(event);
        }
    }

    emit<K extends keyof AirpadEventMap>(event: K, payload: AirpadEventMap[K]): void {
        const existing = this.handlers.get(event);
        if (!existing) return;
        for (const handler of existing) {
            handler(payload);
        }
    }

    clear(): void {
        this.handlers.clear();
    }
}
