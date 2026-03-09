import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomUUID, createHash, scryptSync, randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import path from "node:path";

import { USERS_FILE, USER_STORAGE_DIR, ensureDataDirs, safeJoin } from "./paths.ts";
import { mergeSettings } from "../config/config.ts";
import { DEFAULT_SETTINGS, type Settings } from "../config/config.ts";

export type UserRecord = {
    userId: string;
    userKeyHash: string;
    encrypt: boolean;
    createdAt: number;
};

export type UsersIndex = Record<string, UserRecord>;

const hashKey = (key: string) => createHash("sha256").update(key).digest("hex");

const DEFAULT_USER_ID = "test";
const DEFAULT_USER_KEY = "developer123";

const ensureDefaultUser = (users: UsersIndex) => {
    if (users[DEFAULT_USER_ID]) return users;
    return {
        ...users,
        [DEFAULT_USER_ID]: {
            userId: DEFAULT_USER_ID,
            userKeyHash: hashKey(DEFAULT_USER_KEY),
            encrypt: false,
            createdAt: Date.now()
        }
    };
};

const deriveKey = (userKey: string, userId: string) => {
    const salt = createHash("sha256").update(userId).digest();
    return scryptSync(userKey, salt, 32);
};

const encryptBuffer = (buffer: Buffer, userKey: string, userId: string) => {
    const key = deriveKey(userKey, userId);
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const enc = Buffer.concat([cipher.update(buffer), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, enc]);
};

const decryptBuffer = (buffer: Buffer, userKey: string, userId: string) => {
    if (buffer.byteLength < 28) return buffer;
    const key = deriveKey(userKey, userId);
    const iv = buffer.subarray(0, 12);
    const tag = buffer.subarray(12, 28);
    const data = buffer.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]);
};

const loadJson = async <T>(filePath: string, fallback: T): Promise<T> => {
    try {
        const raw = await readFile(filePath, "utf-8");
        return JSON.parse(raw) as T;
    } catch {
        return fallback;
    }
};

export const loadUsers = async (): Promise<UsersIndex> => {
    const loaded = await loadJson<UsersIndex>(USERS_FILE, {});
    const users = ensureDefaultUser(loaded);
    if (users !== loaded) await saveUsers(users);
    return users;
};

export const saveUsers = async (users: UsersIndex) => {
    await ensureDataDirs();
    await writeFile(USERS_FILE, JSON.stringify(users, null, 2), "utf-8");
};

export const getUser = async (userId: string) => {
    const users = await loadUsers();
    return users[userId];
};

export const verifyUser = async (userId: string, userKey: string) => {
    const record = await getUser(userId);
    if (!record) return null;
    if (record.userKeyHash !== hashKey(userKey)) return null;
    return record;
};

export const ensureUserDir = async (userId: string) => {
    const dir = safeJoin(USER_STORAGE_DIR, userId);
    await mkdir(dir, { recursive: true });
    return dir;
};

export const writeUserFile = async (userId: string, relPath: string, contents: Buffer, encrypt: boolean, userKey?: string) => {
    const dir = await ensureUserDir(userId);
    const destination = safeJoin(dir, relPath);
    await mkdir(path.dirname(destination), { recursive: true });
    const data = encrypt && userKey ? encryptBuffer(contents, userKey, userId) : contents;
    await writeFile(destination, data);
    return destination;
};

export const readUserFile = async (userId: string, relPath: string, encrypt: boolean, userKey?: string) => {
    const dir = await ensureUserDir(userId);
    const destination = safeJoin(dir, relPath);
    const buf = await readFile(destination);
    if (encrypt && userKey) {
        try {
            return decryptBuffer(buf, userKey, userId);
        } catch {
            return buf;
        }
    }
    return buf;
};

export const loadUserSettings = async (userId: string, userKey: string): Promise<Settings> => {
    const record = await verifyUser(userId, userKey);
    if (!record) throw new Error("Invalid credentials");
    try {
        const buf = await readUserFile(userId, "settings.json", record.encrypt, userKey);
        const parsed = JSON.parse(buf.toString("utf-8")) as Settings;
        return mergeSettings(DEFAULT_SETTINGS, parsed);
    } catch {
        return mergeSettings(DEFAULT_SETTINGS, {});
    }
};

export const registerUser = async (userId: string | undefined, encrypt = false, userKey?: string) => {
    const users = await loadUsers();
    const resolved = userId?.trim() || randomUUID();
    const resolvedUserKey = (typeof userKey === "string" ? userKey.trim() : "") || randomBytes(24).toString("base64url");
    users[resolved] = {
        userId: resolved,
        userKeyHash: hashKey(resolvedUserKey),
        encrypt: Boolean(encrypt),
        createdAt: Date.now()
    };
    await saveUsers(users);
    await ensureUserDir(resolved);
    return { userId: resolved, userKey: resolvedUserKey, encrypt: users[resolved].encrypt };
};

export const rotateUserKey = async (userId: string, userKey: string, encrypt?: boolean) => {
    const users = await loadUsers();
    const record = users[userId];
    if (!record || record.userKeyHash !== hashKey(userKey)) return null;
    const nextKey = randomBytes(24).toString("base64url");
    record.userKeyHash = hashKey(nextKey);
    if (typeof encrypt === "boolean") record.encrypt = encrypt;
    users[userId] = record;
    await saveUsers(users);
    return { userId, userKey: nextKey, encrypt: record.encrypt };
};

export const listUsers = async () => {
    const users = await loadUsers();
    return Object.values(users).map(({ userId, encrypt, createdAt }) => ({ userId, encrypt, createdAt }));
};

export const deleteUser = async (userId: string) => {
    const users = await loadUsers();
    if (!users[userId]) return false;
    delete users[userId];
    await saveUsers(users);
    return true;
};
