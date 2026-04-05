import type { WorkCenterState, WorkCenterDependencies } from "./WorkCenterState";

export class WorkCenterVoice {
    private deps: WorkCenterDependencies;
    private voiceTimeout: number | null = null;

    constructor(dependencies: WorkCenterDependencies) {
        this.deps = dependencies;
    }

    async startVoiceRecording(state: WorkCenterState): Promise<void> {
        if (state.voiceRecording) return;

        state.voiceRecording = true;

        try {
            const prompt = await this.deps.getSpeechPrompt();
            if (prompt) {
                state.currentPrompt = prompt;
            }
        } catch (e) {
            console.warn('Voice recording failed:', e);
            this.deps.showMessage?.('Voice recording failed');
        } finally {
            state.voiceRecording = false;
        }
    }

    stopVoiceRecording(state: WorkCenterState): void {
        state.voiceRecording = false;
        if (this.voiceTimeout) {
            globalThis?.clearTimeout?.(this.voiceTimeout);
            this.voiceTimeout = null;
        }
    }

    isRecording(state: WorkCenterState): boolean {
        return state.voiceRecording;
    }

    setVoiceTimeout(callback: () => void, delay: number = 30000): void {
        // Clear existing timeout
        if (this.voiceTimeout) {
            globalThis?.clearTimeout?.(this.voiceTimeout);
        }

        // Set new timeout (30 seconds default)
        this.voiceTimeout = globalThis?.setTimeout?.(() => {
            callback();
            this.voiceTimeout = null;
        }, delay) as any;
    }

    clearVoiceTimeout(): void {
        if (this.voiceTimeout) {
            globalThis?.clearTimeout?.(this.voiceTimeout);
            this.voiceTimeout = null;
        }
    }
}