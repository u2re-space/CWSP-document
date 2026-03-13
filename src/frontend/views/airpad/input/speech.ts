// =========================
// SpeechRecognition (AI-кнопка)
// =========================

import { log, getAiButton, getAiStatusEl, getVoiceTextEl } from '../utils/utils';
import { connectAirPadSession, isAirPadSessionConnected, onAirPadVoiceMessage, sendAirPadIntent } from '../network/session';
import { loadSettings } from '@rs-com/config/Settings';

let recognition: any = null;
let aiListening = false;
export let aiModeActive = false;
let speechLanguage = 'ru-RU';
let speechRecognitionInitialized = false;
let unsubscribeVoiceMessage: (() => void) | null = null;

const normalizeSpeechLanguage = (value: string | undefined): string => {
    const lang = (value || '').trim();
    if (!lang) return 'ru-RU';
    if (lang === 'ru') return 'ru-RU';
    if (lang === 'en') return 'en-US';
    if (lang === 'en-GB') return 'en-GB';
    if (lang === 'en-US') return 'en-US';
    return lang;
};

async function loadSpeechLanguagePreference() {
    try {
        const settings = await loadSettings();
        speechLanguage = normalizeSpeechLanguage(settings?.speech?.language);
        if (recognition) {
            recognition.lang = speechLanguage;
        }
    } catch {
        speechLanguage = 'ru-RU';
    }
}

export const checkIsAiModeActive = () => {
    return aiListening || aiModeActive;
}

function setAiStatus(text: string) {
    const aiStatusEl = getAiStatusEl();
    if (aiStatusEl) {
        aiStatusEl.textContent = text;
    }
}

function setupSpeechRecognition() {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
        log('SpeechRecognition API не поддерживается.');
        return null;
    }
    const recog = new SR();
    recog.lang = speechLanguage;
    recog.interimResults = false;
    recog.maxAlternatives = 1;
    return recog;
}

export function initSpeechRecognition() {
    if (speechRecognitionInitialized) return;

    speechRecognitionInitialized = true;
    void loadSpeechLanguagePreference();
    recognition = setupSpeechRecognition();
    unsubscribeVoiceMessage?.();
    unsubscribeVoiceMessage = onAirPadVoiceMessage((message) => {
        const voiceTextEl = getVoiceTextEl();
        if (voiceTextEl) {
            voiceTextEl.textContent = message.text;
        }
    });

    if (recognition) {
        recognition.onstart = () => {
            const aiButton = getAiButton();
            const voiceTextEl = getVoiceTextEl();
            aiListening = true;
            aiModeActive = true;
            if (aiButton) {
                aiButton.classList.add('listening');
            }
            setAiStatus('listening');
            if (voiceTextEl) {
                voiceTextEl.textContent = 'Слушаю...';
            }
            log('Speech: start');
        };

        recognition.onend = () => {
            const aiButton = getAiButton();
            aiListening = false;
            aiModeActive = false;
            if (aiButton) {
                aiButton.classList.remove('listening');
            }
            setAiStatus('idle');
            log('Speech: end');
        };

        recognition.onerror = (event: any) => {
            const voiceTextEl = getVoiceTextEl();
            if (voiceTextEl) {
                voiceTextEl.textContent = 'Ошибка распознавания: ' + event.error;
            }
            log('Speech error: ' + event.error);
        };

        recognition.onresult = (event: any) => {
            const voiceTextEl = getVoiceTextEl();
            const transcript = event.results[0][0].transcript;
            const normalized = (transcript || '').trim();
            const words = normalized.split(/\s+/).filter(Boolean);

            if (voiceTextEl) {
                voiceTextEl.textContent = normalized
                    ? 'Команда: ' + normalized
                    : 'Команда не распознана';
            }
            log('Speech result: ' + normalized);

            if (words.length < 2) {
                log('Speech: недостаточно слов (нужно >= 2) — не отправляем и не подключаем WS');
                return;
            }

            const trySend = (deadline: number) => {
                if (isAirPadSessionConnected()) {
                    sendAirPadIntent({ type: 'voice.submit', text: normalized });
                    return;
                }
                if (Date.now() > deadline) {
                    log('Speech: не удалось дождаться WS, команда не отправлена');
                    return;
                }
                setTimeout(() => trySend(deadline), 120);
            };

            if (!isAirPadSessionConnected()) {
                log('Speech: подключаем WS перед отправкой команды');
                connectAirPadSession();
                trySend(Date.now() + 2000);
            } else {
                sendAirPadIntent({ type: 'voice.submit', text: normalized });
            }
        };
    }
}

// =========================
// AI-кнопка: pointer
// =========================
export function initAiButton() {
    const aiButton = getAiButton();
    if (!aiButton) return;

    let pointerActive = false;
    let pointerId: number | null = null;

    aiButton.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (pointerActive) return;
        pointerActive = true;
        pointerId = e.pointerId;
        aiButton.setPointerCapture(pointerId);

        if (!recognition) {
            log('SpeechRecognition недоступен');
            return;
        }
        try {
            recognition.start();
        } catch (err: any) {
            log('Recognition start error: ' + err.message);
        }
    });

    aiButton.addEventListener('pointerup', (e) => {
        if (!pointerActive || e.pointerId !== pointerId) return;
        e.preventDefault();
        pointerActive = false;
        aiButton.releasePointerCapture(pointerId);
        pointerId = null;

        if (!recognition) return;
        try {
            recognition.stop();
        } catch (err: any) {
            log('Recognition stop error: ' + err.message);
        }
    });

    aiButton.addEventListener('pointercancel', () => {
        if (!pointerActive) return;
        pointerActive = false;
        pointerId = null;
        if (recognition) {
            try { recognition.stop(); } catch { /* ignore */ }
        }
    });
}

