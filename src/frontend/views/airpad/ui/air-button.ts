// =========================
// Air-кнопка: pointer + жесты + AirMove (Trackball/Touchpad)
// =========================

import { log, getAirButton, getAirNeighborButton, getAirStatusEl } from '../utils/utils';
import { connectAirPadSession, sendAirPadIntent } from '../network/session';
import { checkIsAiModeActive } from '../input/speech';
import { HOLD_DELAY, TAP_THRESHOLD, MOVE_TAP_THRESHOLD, SWIPE_THRESHOLD } from '../config/config';
import { onEnterAirMove as gyroOnEnterAirMove } from '../input/unfinised/gyroscope';
import { onEnterAirMove as accelOnEnterAirMove } from '../input/unfinised/accelerometer';

export type AirState = 'IDLE' | 'WAIT_TAP_OR_HOLD' | 'AIR_MOVE' | 'GESTURE_SWIPE';

let airState: AirState = 'IDLE';
let airDownTime = 0;
let airDownPos: { x: number; y: number } | null = null;
let airMoveTimer: number | null = null;
let dragActive = false;
let lastSwipePos: { x: number; y: number } | null = null;
let swipeDirection: 'vertical' | 'horizontal' | null = null;

// База (калибровка) и фильтр для датчиков
let baseGx = 0, baseGy = 0, baseGz = 0;
let motionCalibrated = false;
let filteredDx = 0;
let filteredDy = 0;
let lastMotionSentAt = 0;

// ===== НОВАЯ ЛОГИКА DRAG =====
// Состояние для отслеживания tap-tap-hold паттерна
let lastTapEndTime = 0;           // Когда закончился последний tap
let lastTapWasClean = false;      // Был ли последний tap "чистым" (короткий, без движения)
let pendingDragOnHold = false;    // Флаг: если hold — активировать drag
const neighborPointerHandlersBound = new WeakSet<Element>();
const airPointerDownBound = new WeakSet<Element>();
let airSurfaceDocumentRoutingAttached = false;
let airSurfacePointerId: number | null = null;
let airSurfaceCaptureTarget: HTMLElement | null = null;

const DOUBLE_TAP_WINDOW = 300;    // Окно между tap и следующим down для drag
const DRAG_HOLD_DELAY = 150;      // Задержка hold для drag (короче обычного HOLD_DELAY)
const TAP_MOVE_FORGIVENESS = Math.max(MOVE_TAP_THRESHOLD, 12);
const AIR_MOVE_TAP_GRACE_MS = TAP_THRESHOLD + 140;
const AIR_MOVE_TAP_GRACE_MOVE = Math.max(MOVE_TAP_THRESHOLD, 16);

// ========== Getters / Setters ==========

export function getAirState(): AirState {
    return airState;
}

export function isDragActive(): boolean {
    return dragActive;
}

export function isMotionCalibrated(): boolean {
    return motionCalibrated;
}

export function setMotionCalibrated(value: boolean) {
    motionCalibrated = value;
}

export function getMotionBaseline() {
    return { baseGx, baseGy, baseGz };
}

export function setMotionBaseline(gx: number, gy: number, gz: number) {
    baseGx = gx;
    baseGy = gy;
    baseGz = gz;
    motionCalibrated = true;
}

export function resetMotionBaseline() {
    baseGx = baseGy = baseGz = 0;
    motionCalibrated = false;
    filteredDx = filteredDy = 0;
    lastMotionSentAt = 0;
}

export function getFilteredMotion() {
    return { filteredDx, filteredDy };
}

export function setFilteredMotion(dx: number, dy: number) {
    filteredDx = dx;
    filteredDy = dy;
}

export function getLastMotionSentAt(): number {
    return lastMotionSentAt;
}

export function setLastMotionSentAt(time: number) {
    lastMotionSentAt = time;
}

// ========== State Management ==========

function setAirStatus(state: AirState) {
    const airStatusEl = getAirStatusEl();
    const airButton = getAirButton();
    airState = state;
    if (airStatusEl) {
        airStatusEl.textContent = state + (dragActive ? ' [DRAG]' : '');
    }
    if (airButton) {
        airButton.classList.toggle('air-move', state === 'AIR_MOVE');
        airButton.classList.toggle('active', state !== 'IDLE');
        airButton.classList.toggle('drag-active', dragActive);
    }
}

export function resetAirState() {
    const wasDragging = dragActive;

    setAirStatus('IDLE');
    airDownPos = null;
    lastSwipePos = null;
    swipeDirection = null;
    pendingDragOnHold = false;

    if (airMoveTimer !== null) {
        clearTimeout(airMoveTimer);
        airMoveTimer = null;
    }

    // НЕ сбрасываем lastTapEndTime и lastTapWasClean здесь!
    // Они нужны для определения double-tap между разными нажатиями

    resetMotionBaseline();
}

// ========== Air Move (Cursor Control via Sensors) ==========

/**
 * Входит в режим AIR_MOVE — управление курсором через гироскоп/акселерометр.
 * @param startDrag - если true, сразу активируется drag-режим (зажатая ЛКМ)
 */
export function enterAirMove(startDrag: boolean = false) {
    setAirStatus('AIR_MOVE');
    resetMotionBaseline();

    // Инициализируем датчики для управления курсором
    gyroOnEnterAirMove();
    accelOnEnterAirMove();

    // Активируем drag если нужно
    if (startDrag && !dragActive) {
        dragActive = true;
        sendAirPadIntent({ type: 'pointer.down', button: 'left' });
        log('Air: AIR_MOVE + DRAG started (mouse down)');

        // Обновляем статус чтобы показать [DRAG]
        setAirStatus('AIR_MOVE');
    } else {
        log('Air: AIR_MOVE started (cursor control via sensors)');
    }
}

/**
 * Выход из AIR_MOVE режима
 */
function exitAirMove() {
    if (airState !== 'AIR_MOVE') return;

    // Если был drag-режим, отпускаем кнопку мыши
    if (dragActive) {
        sendAirPadIntent({ type: 'pointer.up', button: 'left' });
        log('Air: DRAG ended (mouse up)');
        dragActive = false;
    } else {
        log('Air: AIR_MOVE ended');
    }
}

// ========== Pointer Handlers ==========

function airOnDown(e: PointerEvent) {
    // Любое действие по air-кнопке пытается поднять WS
    connectAirPadSession();

    if (checkIsAiModeActive()) return;

    const now = Date.now();

    // ===== ОПРЕДЕЛЯЕМ: ЭТО НАЧАЛО DRAG? =====
    // Drag активируется если:
    // 1. Предыдущий tap был "чистым" (короткий, без движения)
    // 2. Прошло не больше DOUBLE_TAP_WINDOW с момента окончания предыдущего tap
    const timeSinceLastTap = now - lastTapEndTime;
    const shouldPrepareForDrag = lastTapWasClean && (timeSinceLastTap < DOUBLE_TAP_WINDOW);

    if (shouldPrepareForDrag) {
        pendingDragOnHold = true;
        log(`Air: double-tap detected (${timeSinceLastTap}ms since last tap), preparing for drag...`);
    } else {
        pendingDragOnHold = false;
    }

    // Сбрасываем флаги предыдущего tap
    lastTapWasClean = false;

    // Clear any existing hold timer
    if (airMoveTimer !== null) {
        clearTimeout(airMoveTimer);
        airMoveTimer = null;
    }

    airDownTime = now;
    airDownPos = { x: e.clientX, y: e.clientY };
    setAirStatus('WAIT_TAP_OR_HOLD');

    // ===== ДВА ТАЙМЕРА =====
    // Если это потенциальный drag — используем короткий таймер
    // Иначе — обычный HOLD_DELAY

    const holdDelay = pendingDragOnHold ? DRAG_HOLD_DELAY : HOLD_DELAY;

    airMoveTimer = globalThis?.setTimeout?.(() => {
        if (airState === 'WAIT_TAP_OR_HOLD') {
            enterAirMove(pendingDragOnHold);
        }
    }, holdDelay) as any;
}

function airOnUp(e: PointerEvent | null) {
    if (checkIsAiModeActive()) {
        resetAirState();
        return;
    }

    const now = Date.now();
    const dt = now - airDownTime;
    const pointerUpX = e?.clientX ?? airDownPos?.x ?? 0;
    const pointerUpY = e?.clientY ?? airDownPos?.y ?? 0;

    // Определяем был ли это "чистый" tap
    let wasCleanTap = false;
    let shouldClickFromAirMoveGrace = false;

    if (airState === 'AIR_MOVE' && !dragActive && airDownPos) {
        const dx = pointerUpX - airDownPos.x;
        const dy = pointerUpY - airDownPos.y;
        const dist = Math.hypot(dx, dy);

        // Если AIR_MOVE включился из-за слегка длинного тапа, всё равно считаем это кликом.
        shouldClickFromAirMoveGrace = dt < AIR_MOVE_TAP_GRACE_MS && dist < AIR_MOVE_TAP_GRACE_MOVE;
    }

    // Выход из режима AIR_MOVE
    if (airState === 'AIR_MOVE') {
        exitAirMove();
    }

    // Завершение свайп-жеста
    if (airState === 'GESTURE_SWIPE') {
        log('Air: swipe gesture ended');
    }

    // Обработка тапа (короткое нажатие без движения = клик)
    if (airState === 'WAIT_TAP_OR_HOLD') {
        if (airDownPos && dt < TAP_THRESHOLD) {
            const dx = pointerUpX - airDownPos.x;
            const dy = pointerUpY - airDownPos.y;
            const dist = Math.hypot(dx, dy);

            if (dist < TAP_MOVE_FORGIVENESS) {
                // Это чистый tap!
                wasCleanTap = true;

                // Если это был "второй tap" для drag, но пользователь не удержал —
                // просто делаем обычный клик
                if (!pendingDragOnHold) {
                    sendAirPadIntent({ type: 'pointer.click', button: 'left' });
                    log('Air: tap → click');
                } else {
                    // Пользователь сделал tap-tap (без hold) — делаем double-click
                    sendAirPadIntent({ type: 'pointer.click', button: 'left', count: 2 });
                    log('Air: tap-tap → double-click');
                    wasCleanTap = false; // Не считаем это за начало нового drag-sequence
                }
            }
        }
    }

    if (shouldClickFromAirMoveGrace) {
        sendAirPadIntent({ type: 'pointer.click', button: 'left' });
        log('Air: short hold + small move → click (grace)');
        wasCleanTap = true;
    }

    // Запоминаем информацию о tap для следующего нажатия
    lastTapEndTime = now;
    lastTapWasClean = wasCleanTap;

    if (wasCleanTap) {
        log(`Air: clean tap recorded, next tap+hold within ${DOUBLE_TAP_WINDOW}ms will start drag`);
    }

    dragActive = false;
    resetAirState();
}

// ========== Swipe Gestures (Scroll) ==========

function handleAirSurfaceMove(x: number, y: number) {
    if (!airDownPos) return;

    const dxSurf = x - airDownPos.x;
    const dySurf = y - airDownPos.y;

    if (airState === 'WAIT_TAP_OR_HOLD') {
        const dist = Math.hypot(dxSurf, dySurf);

        // Если движение превысило порог — это свайп
        if (dist > SWIPE_THRESHOLD) {
            // Отменяем таймер перехода в AIR_MOVE
            if (airMoveTimer !== null) {
                clearTimeout(airMoveTimer);
                airMoveTimer = null;
            }

            // Движение отменяет "чистый tap" — это уже не tap-tap-hold для drag
            pendingDragOnHold = false;
            lastTapWasClean = false;

            setAirStatus('GESTURE_SWIPE');
            startSwipeGesture(dxSurf, dySurf);
        }
    } else if (airState === 'GESTURE_SWIPE') {
        continueSwipeGesture(x, y);
    }
}

function startSwipeGesture(dxSurf: number, dySurf: number) {
    const absX = Math.abs(dxSurf);
    const absY = Math.abs(dySurf);

    if (absY > absX) {
        // Вертикальный свайп — скролл
        swipeDirection = 'vertical';
        lastSwipePos = { x: airDownPos!.x, y: airDownPos!.y };

        const initialDelta = Math.round(dySurf * 0.8);
        sendAirPadIntent({ type: 'pointer.scroll', dx: 0, dy: initialDelta });
        log(`Air: swipe ${dySurf > 0 ? 'down' : 'up'} → scroll`);
    } else {
        // Горизонтальный свайп — жест
        swipeDirection = 'horizontal';
        const direction = dxSurf > 0 ? 'right' : 'left';

        log(`Air: swipe ${direction}`);
        sendAirPadIntent({ type: 'gesture.swipe', direction });

        resetAirState();
    }
}

function continueSwipeGesture(x: number, y: number) {
    if (!lastSwipePos || !airDownPos || swipeDirection !== 'vertical') return;

    const dy = y - lastSwipePos.y;

    if (Math.abs(dy) > 2) {
        const delta = Math.round(dy * 0.8);
        sendAirPadIntent({ type: 'pointer.scroll', dx: 0, dy: delta });
        lastSwipePos = { x, y };
    }
}


// ========== Context Menu & Middle-Click Scroll (Neighbor Button) ==========

let neighborState: 'IDLE' | 'WAIT_TAP_OR_HOLD' | 'MIDDLE_SCROLL' = 'IDLE';
let neighborDownTime = 0;
let neighborDownPos: { x: number; y: number } | null = null;
let neighborHoldTimer: number | null = null;
let neighborPointerId: number | null = null;

const NEIGHBOR_HOLD_DELAY = 250; // ms для активации middle-scroll
const NEIGHBOR_TAP_THRESHOLD = 200; // ms
const NEIGHBOR_MOVE_THRESHOLD = 15; // px

function enterMiddleScrollMode() {
    neighborState = 'MIDDLE_SCROLL';

    // Активируем датчики для управления курсором
    resetAirState();

    // Middle mouse down
    sendAirPadIntent({ type: 'pointer.down', button: 'middle' });
    log('Neighbor: MIDDLE_SCROLL started (sensors active)');

    // Визуальная индикация
    const neighborButton = getAirNeighborButton();
    neighborButton?.classList.add('middle-scroll-active', 'active');

    //
    enterAirMove();
}

function exitMiddleScrollMode() {
    if (neighborState !== 'MIDDLE_SCROLL') return;

    // Middle mouse up
    sendAirPadIntent({ type: 'pointer.up', button: 'middle' });
    log('Neighbor: MIDDLE_SCROLL ended');

    //
    neighborState = 'IDLE';
    resetAirState();

    // Убираем визуальную индикацию
    const neighborButton = getAirNeighborButton();
    neighborButton?.classList.remove('middle-scroll-active', 'active');
}

function resetNeighborState() {
    if (neighborHoldTimer !== null) {
        clearTimeout(neighborHoldTimer);
        neighborHoldTimer = null;
    }
    neighborDownPos = null;
    neighborState = 'IDLE';

    const neighborButton = getAirNeighborButton();
    neighborButton?.classList.remove('middle-scroll-active', 'active');

    resetAirState();
}

function initNeighborButton() {
    const neighborButton = getAirNeighborButton();
    if (!neighborButton) return;
    if (neighborPointerHandlersBound.has(neighborButton)) return;
    neighborPointerHandlersBound.add(neighborButton);

    neighborButton.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (neighborPointerId !== null && neighborPointerId !== e.pointerId) return;

        connectAirPadSession();
        if (checkIsAiModeActive()) return;

        neighborPointerId = e.pointerId;
        neighborButton.setPointerCapture(neighborPointerId);
        neighborDownTime = Date.now();
        neighborDownPos = { x: e.clientX, y: e.clientY };
        neighborState = 'WAIT_TAP_OR_HOLD';

        neighborButton.classList.add('active');

        // Таймер для активации middle-scroll режима
        neighborHoldTimer = globalThis?.setTimeout?.(() => {
            neighborHoldTimer = null;
            if (neighborState === 'WAIT_TAP_OR_HOLD') {
                enterMiddleScrollMode();
            }
        }, NEIGHBOR_HOLD_DELAY) as any;
    });

    neighborButton.addEventListener('pointermove', (e) => {
        if (e.pointerId !== neighborPointerId || !neighborDownPos) return;
        e.preventDefault();

        // Если движение по экрану до hold — отменяем (это не наш паттерн)
        if (neighborState === 'WAIT_TAP_OR_HOLD') {
            const dx = e.clientX - neighborDownPos.x;
            const dy = e.clientY - neighborDownPos.y;
            const dist = Math.hypot(dx, dy);

            if (dist > NEIGHBOR_MOVE_THRESHOLD) {
                // Слишком много движения — отменяем hold
                if (neighborHoldTimer !== null) {
                    clearTimeout(neighborHoldTimer);
                    neighborHoldTimer = null;
                }
                // Можно здесь добавить другую логику, например swipe
            }
        }

        // В режиме MIDDLE_SCROLL движение курсора идёт через датчики,
        // а не через pointermove — здесь ничего не делаем
    });

    neighborButton.addEventListener('pointerup', (e) => {
        if (e.pointerId !== neighborPointerId) return;
        e.preventDefault();

        const dt = Date.now() - neighborDownTime;

        // Выход из middle-scroll режима
        if (neighborState === 'MIDDLE_SCROLL') {
            exitMiddleScrollMode();
        }
        // Короткий tap — context menu (right click)
        else if (neighborState === 'WAIT_TAP_OR_HOLD' && dt < NEIGHBOR_TAP_THRESHOLD) {
            if (neighborDownPos) {
                const dx = e.clientX - neighborDownPos.x;
                const dy = e.clientY - neighborDownPos.y;
                const dist = Math.hypot(dx, dy);

                if (dist < NEIGHBOR_MOVE_THRESHOLD) {
                    sendAirPadIntent({ type: 'pointer.click', button: 'right' });
                    log('Neighbor: tap → right-click (context menu)');
                }
            }
        }

        if (neighborPointerId !== null) {
            neighborButton.releasePointerCapture(neighborPointerId);
            neighborPointerId = null;
        }
        resetNeighborState();
    });

    neighborButton.addEventListener('pointercancel', (e) => {
        if (e?.pointerId === neighborPointerId || e?.pointerId == null) {
            if (neighborState === 'MIDDLE_SCROLL') {
                sendAirPadIntent({ type: 'pointer.up', button: 'middle' });
                log('Neighbor: middle-scroll cancelled');
            }

            if (neighborPointerId !== null) {
                neighborButton.releasePointerCapture(neighborPointerId);
                neighborPointerId = null;
            }
            resetNeighborState();
        }
    });

    // Предотвращаем стандартное контекстное меню браузера
    neighborButton.addEventListener('contextmenu', (e) => {
        e.preventDefault();
    });

    log('Neighbor button initialized (tap: right-click, hold: middle-scroll via sensors)');
}

// ========== Экспорт состояния для gyroscope.ts / accelerometer.ts ==========

export function isMiddleScrollActive(): boolean {
    return neighborState === 'MIDDLE_SCROLL';
}

// ========== Initialization ==========

export function initAirButton() {
    const airButton = getAirButton();
    if (!airButton) return;

    initNeighborButton();

    if (!airPointerDownBound.has(airButton)) {
        airPointerDownBound.add(airButton);
        airButton.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            if (airSurfacePointerId !== null && airSurfacePointerId !== e.pointerId) return;

            airSurfacePointerId = e.pointerId;
            airSurfaceCaptureTarget = airButton;
            airSurfaceCaptureTarget.setPointerCapture(airSurfacePointerId);
            airOnDown(e);
        });
    }

    if (!airSurfaceDocumentRoutingAttached) {
        airSurfaceDocumentRoutingAttached = true;

        const routingDoc = airButton.ownerDocument;
        routingDoc.addEventListener('pointermove', (e) => {
            if (e.pointerId !== airSurfacePointerId) return;
            e.preventDefault();

            if (!airDownPos) return;
            if (checkIsAiModeActive()) return;

            handleAirSurfaceMove(e.clientX, e.clientY);
        });

        routingDoc.addEventListener('pointerup', (e) => {
            if (e.pointerId !== airSurfacePointerId) return;
            e.preventDefault();

            if (airSurfacePointerId !== null && airSurfaceCaptureTarget) {
                try {
                    airSurfaceCaptureTarget.releasePointerCapture(airSurfacePointerId);
                } catch {
                    /* ignore */
                }
            }
            airSurfacePointerId = null;
            airSurfaceCaptureTarget = null;
            airOnUp(e);
        });

        routingDoc.addEventListener('pointercancel', (e) => {
            if (e?.pointerId !== airSurfacePointerId && e?.pointerId != null) return;

            if (airSurfacePointerId !== null && airSurfaceCaptureTarget) {
                try {
                    airSurfaceCaptureTarget.releasePointerCapture(airSurfacePointerId);
                } catch {
                    /* ignore */
                }
            }
            airSurfacePointerId = null;
            airSurfaceCaptureTarget = null;

            if (dragActive) {
                sendAirPadIntent({ type: 'pointer.up', button: 'left' });
                dragActive = false;
                log('Air: drag cancelled (mouse up)');
            }

            resetAirState();
        });
    }

    log('Air button initialized');
}
