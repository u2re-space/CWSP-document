export type EnvironmentAction = (payload?: unknown) => void | Promise<void>;
export type EnvironmentEventHandler = (event: Event, detail?: unknown) => void;
export type EnvironmentTrigger = (payload?: unknown) => void;

export const environmentActionRegistry = new Map<string, EnvironmentAction>();
export const environmentEventRegistry = new Map<string, Set<EnvironmentEventHandler>>();
export const environmentTriggerRegistry = new Map<string, EnvironmentTrigger>();

export const registerEnvironmentAction = (id: string, action: EnvironmentAction) => {
    environmentActionRegistry.set(id, action);
    return () => environmentActionRegistry.delete(id);
};

export const invokeEnvironmentAction = async (id: string, payload?: unknown) => {
    const action = environmentActionRegistry.get(id);
    if (!action) return false;
    await action(payload);
    return true;
};

export const registerEnvironmentEvent = (eventName: string, handler: EnvironmentEventHandler) => {
    const set = environmentEventRegistry.get(eventName) ?? new Set<EnvironmentEventHandler>();
    set.add(handler);
    environmentEventRegistry.set(eventName, set);
    return () => set.delete(handler);
};

export const emitEnvironmentEvent = (eventName: string, detail?: unknown, target: EventTarget = document) => {
    const ev = new CustomEvent(eventName, { detail, bubbles: true, composed: true });
    target.dispatchEvent(ev);
    const handlers = environmentEventRegistry.get(eventName);
    handlers?.forEach((handler) => {
        try {
            handler(ev, detail);
        } catch (error) {
            console.warn(error);
        }
    });
};

export const registerEnvironmentTrigger = (id: string, trigger: EnvironmentTrigger) => {
    environmentTriggerRegistry.set(id, trigger);
    return () => environmentTriggerRegistry.delete(id);
};

export const runEnvironmentTrigger = (id: string, payload?: unknown) => {
    const trigger = environmentTriggerRegistry.get(id);
    if (!trigger) return false;
    trigger(payload);
    return true;
};
