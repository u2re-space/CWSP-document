// ahk-service.ts
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { pickEnvStringLegacy } from "../lib/env.ts";

const DEFAULT_AHK_PATH = "C:\\Program Files\\AutoHotkey\\v2\\AutoHotkey64.exe";
const getAhkPath = () => (pickEnvStringLegacy("CWS_AUTOHOTKEY_PATH") || DEFAULT_AHK_PATH).trim();

class AHKService {
    private process: any = null;
    private scriptPath: string;
    private ready: boolean = false;
    private queue: Array<{ resolve: () => void; reject: (err: Error) => void }> = [];
    private responseBuffer: string = "";

    constructor() {
        this.scriptPath = path.join(os.tmpdir(), "ahk_service.ahk");
    }

    private createServiceScript() {
        // AHK v2 скрипт с правильной поддержкой UTF-8
        const script = `#Requires AutoHotkey v2.0
#SingleInstance Force
#Warn All, Off

; Устанавливаем кодировку stdin/stdout на UTF-8
FileEncoding("UTF-8")

; Глобальный stdin
global stdin := FileOpen("*", "r", "UTF-8")

; Главный цикл
Loop {
    try {
        line := stdin.ReadLine()
        if (line = "")
            continue

        line := RTrim(line, "\`r\`n")

        ; Парсим команду
        if (SubStr(line, 1, 5) = "TEXT:") {
            ; Декодируем Base64 -> UTF-8 текст
            encoded := SubStr(line, 6)
            text := Base64DecodeUTF8(encoded)
            if (text != "") {
                ; SendText отправляет Unicode символы напрямую
                ; без интерпретации как клавиши
                SendText(text)
            }
        } else if (SubStr(line, 1, 4) = "RAW:") {
            ; RAW: для прямой отправки без Base64 (простые ASCII)
            text := SubStr(line, 5)
            SendText(text)
        } else if (SubStr(line, 1, 4) = "KEY:") {
            ; Специальные клавиши
            key := SubStr(line, 5)
            Send(key)
        } else if (SubStr(line, 1, 5) = "MOVE:") {
            ; Относительное перемещение мыши
            payload := SubStr(line, 6)
            parts := StrSplit(payload, ",")
            dx := (parts.Length >= 1) ? (parts[1] + 0) : 0
            dy := (parts.Length >= 2) ? (parts[2] + 0) : 0
            if (dx != 0 || dy != 0) {
                MouseMove(dx, dy, 0, "R")
            }
        } else if (SubStr(line, 1, 7) = "MCLICK:") {
            ; Клик мышью (single/double)
            payload := SubStr(line, 8)
            parts := StrSplit(payload, ",")
            btn := (parts.Length >= 1) ? StrLower(parts[1]) : "left"
            dbl := (parts.Length >= 2) ? (parts[2] + 0) : 0
            if (btn != "left" && btn != "right" && btn != "middle") {
                btn := "left"
            }
            if (dbl > 0) {
                Click(btn), Click(btn)
            } else {
                Click(btn)
            }
        } else if (SubStr(line, 1, 8) = "MTOGGLE:") {
            ; Нажатие/отпускание кнопки мыши
            payload := SubStr(line, 9)
            parts := StrSplit(payload, ",")
            state := (parts.Length >= 1) ? StrLower(parts[1]) : "down"
            btn := (parts.Length >= 2) ? StrLower(parts[2]) : "left"
            if (btn != "left" && btn != "right" && btn != "middle") {
                btn := "left"
            }
            if (state = "up") {
                Click("Up " . btn)
            } else {
                Click("Down " . btn)
            }
        } else if (SubStr(line, 1, 8) = "MSCROLL:") {
            ; Вертикальный скролл колесом
            payload := SubStr(line, 9)
            parts := StrSplit(payload, ",")
            dy := (parts.Length >= 2) ? (parts[2] + 0) : 0
            steps := Abs(Round(dy))
            if (steps > 24) {
                steps := 24
            }
            if (steps > 0) {
                wheel := (dy > 0) ? "WheelUp" : "WheelDown"
                Loop steps {
                    Click(wheel)
                }
            }
        } else if (SubStr(line, 1, 6) = "PASTE:") {
            ; Вставка через буфер обмена (для длинных текстов)
            encoded := SubStr(line, 7)
            text := Base64DecodeUTF8(encoded)
            if (text != "") {
                PasteText(text)
            }
        } else if (line = "QUIT") {
            ExitApp
        } else if (line = "PING") {
            ; Проверка связи
        }

        ; Отправляем подтверждение
        FileAppend("OK\`n", "*", "UTF-8")
    } catch as e {
        ; При ошибке всё равно отвечаем
        FileAppend("ERR:" e.Message "\`n", "*", "UTF-8")
    }
}

; Вставка через буфер обмена (быстрее для длинных текстов)
PasteText(text) {
    oldClip := A_Clipboard
    A_Clipboard := text
    ClipWait(1)
    Send("^v")
    Sleep(50)
    A_Clipboard := oldClip
}

; Base64 декодирование с поддержкой UTF-8
Base64DecodeUTF8(b64) {
    static b64chars := "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

    ; Убираем padding и лишние символы
    b64 := RegExReplace(b64, "[^A-Za-z0-9+/]", "")

    ; Декодируем в массив байтов
    bytes := []
    buffer := 0
    bits := 0

    Loop Parse, b64 {
        val := InStr(b64chars, A_LoopField, true) - 1
        if (val < 0)
            continue

        buffer := (buffer << 6) | val
        bits += 6

        if (bits >= 8) {
            bits -= 8
            bytes.Push((buffer >> bits) & 0xFF)
        }
    }

    ; Конвертируем UTF-8 байты в строку
    return UTF8BytesToString(bytes)
}

; Конвертация UTF-8 байтов в Unicode строку
UTF8BytesToString(bytes) {
    if (bytes.Length = 0)
        return ""

    result := ""
    i := 1

    while (i <= bytes.Length) {
        b1 := bytes[i]

        if (b1 < 0x80) {
            ; ASCII (1 байт)
            result .= Chr(b1)
            i += 1
        } else if ((b1 & 0xE0) = 0xC0) {
            ; 2 байта (латиница расширенная, кириллица)
            if (i + 1 <= bytes.Length) {
                b2 := bytes[i + 1]
                codePoint := ((b1 & 0x1F) << 6) | (b2 & 0x3F)
                result .= Chr(codePoint)
            }
            i += 2
        } else if ((b1 & 0xF0) = 0xE0) {
            ; 3 байта (китайский, японский, базовые эмодзи)
            if (i + 2 <= bytes.Length) {
                b2 := bytes[i + 1]
                b3 := bytes[i + 2]
                codePoint := ((b1 & 0x0F) << 12) | ((b2 & 0x3F) << 6) | (b3 & 0x3F)
                result .= Chr(codePoint)
            }
            i += 3
        } else if ((b1 & 0xF8) = 0xF0) {
            ; 4 байта (эмодзи, редкие символы)
            if (i + 3 <= bytes.Length) {
                b2 := bytes[i + 1]
                b3 := bytes[i + 2]
                b4 := bytes[i + 3]
                codePoint := ((b1 & 0x07) << 18) | ((b2 & 0x3F) << 12) | ((b3 & 0x3F) << 6) | (b4 & 0x3F)
                result .= Chr(codePoint)
            }
            i += 4
        } else {
            ; Невалидный байт - пропускаем
            i += 1
        }
    }

    return result
}
`;
        fs.writeFileSync(this.scriptPath, script, "utf8");
    }

    async start(): Promise<void> {
        if (this.process) return;
        if (process.platform !== "win32") {
            throw new Error("AutoHotKey is only supported on Windows");
        }
        const ahkPath = getAhkPath();
        if (!ahkPath || !fs.existsSync(ahkPath)) {
            throw new Error(`AutoHotKey executable not found: ${ahkPath || "(empty path)"}`);
        }

        // Создаём скрипт перед запуском
        this.createServiceScript();

        return new Promise((resolve, reject) => {
            this.process = spawn(ahkPath, [this.scriptPath], {
                stdio: ["pipe", "pipe", "pipe"],
                windowsHide: true
            });

            // Обработка ответов с буферизацией
            this.process.stdout?.on("data", (data: Buffer) => {
                this.responseBuffer += data.toString("utf8");

                // Обрабатываем все полные строки
                let newlineIndex;
                while ((newlineIndex = this.responseBuffer.indexOf("\n")) !== -1) {
                    const line = this.responseBuffer.slice(0, newlineIndex).trim();
                    this.responseBuffer = this.responseBuffer.slice(newlineIndex + 1);

                    if (line === "OK" || line.startsWith("ERR:")) {
                        if (this.queue.length > 0) {
                            const task = this.queue.shift()!;
                            if (line === "OK") {
                                task.resolve();
                            } else {
                                task.reject(new Error(line.slice(4)));
                            }
                        }
                    }
                }
            });

            this.process.stderr?.on("data", (data: Buffer) => {
                console.error("AHK Error:", data.toString());
            });

            this.process.on("error", (err: Error) => {
                this.ready = false;
                reject(err);
            });

            this.process.on("close", (code: number) => {
                this.ready = false;
                this.process = null;
                // Reject all pending tasks
                while (this.queue.length > 0) {
                    const task = this.queue.shift()!;
                    task.reject(new Error(`AHK process closed with code ${code}`));
                }
            });

            // Проверяем готовность через ping
            setTimeout(() => {
                this.ready = true;
                resolve();
            }, 200);
        });
    }

    stop() {
        if (this.process?.stdin) {
            try {
                this.process.stdin.write("QUIT\n");
            } catch (e) {
                // Ignore write errors during shutdown
            }
        }
        this.process?.kill();
        this.process = null;
        this.ready = false;
        this.queue = [];
    }

    isReady(): boolean {
        return this.ready && this.process !== null;
    }

    private base64Encode(str: string): string {
        return Buffer.from(str, "utf8").toString("base64");
    }

    private sendCommand(command: string): Promise<void> {
        return new Promise((resolve, reject) => {
            if (!this.ready || !this.process?.stdin) {
                reject(new Error("AHK service not ready"));
                return;
            }

            this.queue.push({ resolve, reject });
            this.process.stdin.write(`${command}\n`);
        });
    }

    /**
     * Отправляет текст через SendText (любые Unicode символы)
     */
    sendText(text: string): Promise<void> {
        // Кодируем в Base64 для безопасной передачи UTF-8
        const encoded = this.base64Encode(text);
        return this.sendCommand(`TEXT:${encoded}`);
    }

    /**
     * Отправляет простой ASCII текст без Base64 (быстрее)
     */
    sendRawText(text: string): Promise<void> {
        // Проверяем что текст ASCII
        if (!/^[\x00-\x7F]*$/.test(text)) {
            // Если не ASCII, используем Base64
            return this.sendText(text);
        }
        return this.sendCommand(`RAW:${text}`);
    }

    /**
     * Отправляет специальную клавишу (Backspace, Enter, etc.)
     */
    sendKey(key: string): Promise<void> {
        return this.sendCommand(`KEY:${key}`);
    }

    /**
     * Вставляет текст через буфер обмена (быстрее для длинных строк)
     */
    pasteText(text: string): Promise<void> {
        const encoded = this.base64Encode(text);
        return this.sendCommand(`PASTE:${encoded}`);
    }

    moveMouseBy(dx: number, dy: number): Promise<void> {
        return this.sendCommand(`MOVE:${Math.round(dx)},${Math.round(dy)}`);
    }

    mouseClick(button: "left" | "right" | "middle" = "left", double: boolean = false): Promise<void> {
        return this.sendCommand(`MCLICK:${button},${double ? 1 : 0}`);
    }

    mouseToggle(state: "down" | "up", button: "left" | "right" | "middle" = "left"): Promise<void> {
        return this.sendCommand(`MTOGGLE:${state},${button}`);
    }

    scrollMouse(dx: number, dy: number): Promise<void> {
        return this.sendCommand(`MSCROLL:${Math.round(dx)},${Math.round(dy)}`);
    }
}

// Singleton
export const ahkService = new AHKService();
export { AHKService };
