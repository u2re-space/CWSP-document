const $ = (id) => document.querySelector(id);
const ls = {
    save(key, value) { localStorage.setItem(key, JSON.stringify(value)); },
    load(key, fallback = null) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; } }
};

const resolveEndpointUrl = () => {
    const explicit = $("#endpointUrl")?.value?.trim?.() || "";
    if (explicit) return explicit;

    const { protocol, hostname, port } = window.location;
    return port ? `${protocol}//${hostname}:${port}` : `${protocol}//${hostname}`;
};

const state = {
    get creds() {
        return {
            userId: $("#userId").value.trim(),
            userKey: $("#userKey").value.trim(),
            endpointUrl: resolveEndpointUrl(),
            encrypt: $("#encrypt").value === "true"
        };
    }
};

const setStatus = (el, msg) => { if (el) el.textContent = msg; };

const fetchJSON = async (path, body = {}) => {
    const { endpointUrl, userId, userKey } = state.creds;
    const url = new URL(path, endpointUrl).toString();
    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, userKey, ...body })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
};

const getSettingsPayload = () => {
    const mcpText = $("#mcpJson").value.trim();
    let mcp = [];
    if (mcpText) {
        try { mcp = JSON.parse(mcpText); } catch (e) { console.warn(e); }
    }
    const coreRoles = $("#coreRoles").value
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
    const upstreamReconnect = Number($("#upstreamReconnectMs").value);

    return {
        core: {
            mode: "endpoint",
            endpointUrl: $("#endpointUrl").value.trim(),
            userId: $("#userId").value.trim(),
            userKey: $("#userKey").value.trim(),
            encrypt: $("#encrypt").value === "true",
            preferBackendSync: $("#preferBackendSync").value === "true",
            roles: coreRoles,
            upstream: {
                enabled: $("#upstreamEnabled").value === "true",
                endpointUrl: $("#upstreamUrl").value.trim(),
                userId: $("#upstreamUserId").value.trim(),
                userKey: $("#upstreamUserKey").value.trim(),
                upstreamMasterKey: $("#upstreamMasterKey").value.trim(),
                upstreamSigningPrivateKeyPem: $("#upstreamSigningPrivateKeyPem").value.trim(),
                upstreamPeerPublicKeyPem: $("#upstreamPeerPublicKeyPem").value.trim(),
                deviceId: $("#upstreamDeviceId").value.trim(),
                namespace: $("#upstreamNamespace").value.trim() || "default",
                reconnectMs: Number.isFinite(upstreamReconnect) && upstreamReconnect > 0 ? upstreamReconnect : 5000
            }
        },
        ai: {
            baseUrl: $("#aiBaseUrl").value.trim(),
            apiKey: $("#aiApiKey").value.trim(),
            model: $("#aiModel").value.trim(),
            customModel: $("#aiCustomModel").value.trim(),
            shareTargetMode: $("#aiShareTarget").value
        },
        webdav: {
            url: $("#webdavUrl").value.trim(),
            username: $("#webdavUser").value.trim(),
            password: $("#webdavPass").value.trim(),
            token: $("#webdavToken").value.trim()
        },
        timeline: {},
        appearance: {},
        speech: {},
        grid: {},
        mcp
    };
};

const applySettingsToForm = (settings) => {
    const core = settings?.core || {};
    $("#endpointUrl").value = core.endpointUrl || "";
    $("#userId").value = core.userId || "";
    $("#userKey").value = core.userKey || "";
    $("#encrypt").value = core.encrypt ? "true" : "false";
    $("#preferBackendSync").value = core.preferBackendSync ? "true" : "false";
    const upstream = core.upstream || {};
    const roles = Array.isArray(core.roles) ? core.roles : [];
    $("#coreRoles").value = roles.join(", ");
    $("#upstreamEnabled").value = upstream.enabled ? "true" : "false";
    $("#upstreamUrl").value = upstream.endpointUrl || "";
    $("#upstreamUserId").value = upstream.userId || "";
    $("#upstreamUserKey").value = upstream.userKey || "";
    $("#upstreamMasterKey").value = upstream.upstreamMasterKey || "";
    $("#upstreamSigningPrivateKeyPem").value = upstream.upstreamSigningPrivateKeyPem || "";
    $("#upstreamPeerPublicKeyPem").value = upstream.upstreamPeerPublicKeyPem || "";
    $("#upstreamDeviceId").value = upstream.deviceId || "";
    $("#upstreamNamespace").value = upstream.namespace || "default";
    $("#upstreamReconnectMs").value = `${Number.isFinite(Number(upstream.reconnectMs)) && Number(upstream.reconnectMs) > 0 ? Number(upstream.reconnectMs) : 5000}`;

    const ai = settings?.ai || {};
    $("#aiBaseUrl").value = ai.baseUrl || "";
    $("#aiApiKey").value = ai.apiKey || "";
    $("#aiModel").value = ai.model || "";
    $("#aiCustomModel").value = ai.customModel || "";
    $("#aiShareTarget").value = ai.shareTargetMode || "analyze";

    const webdav = settings?.webdav || {};
    $("#webdavUrl").value = webdav.url || "";
    $("#webdavUser").value = webdav.username || "";
    $("#webdavPass").value = webdav.password || "";
    $("#webdavToken").value = webdav.token || "";

    const mcp = ai.mcp || settings?.mcp || [];
    if (Array.isArray(mcp)) {
        $("#mcpJson").value = JSON.stringify(mcp, null, 2);
    }
};

const renderUsers = (users = []) => {
    const tbody = document.querySelector("#usersTable tbody");
    if (!tbody) return;
    tbody.innerHTML = "";
    users.forEach((user) => {
        const tr = document.createElement("tr");
        const created = user.createdAt ? new Date(user.createdAt).toLocaleString() : "";
        tr.innerHTML = `
            <td>${user.userId}</td>
            <td>${user.encrypt ? "yes" : "no"}</td>
            <td>${created}</td>
            <td>
                <button class="btn-apply" data-user="${user.userId}">Use</button>
                <button class="btn-delete" data-user="${user.userId}">Delete</button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    tbody.querySelectorAll(".btn-apply").forEach((btn) => {
        btn.addEventListener("click", () => {
            const userId = btn.getAttribute("data-user") || "";
            $("#userId").value = userId;
            setStatus($("#accessMsg"), `Applied user ${userId}. Set key manually or rotate.`);
        });
    });

    tbody.querySelectorAll(".btn-delete").forEach((btn) => {
        btn.addEventListener("click", async () => {
            const userId = btn.getAttribute("data-user");
            if (!userId) return;
            if (!confirm(`Delete user ${userId}?`)) return;
            try {
                const res = await fetchJSON("/core/auth/delete", { targetId: userId });
                if (res?.ok) {
                    setStatus($("#accessMsg"), `Deleted ${userId}`);
                    $("#btnLoadUsers").click();
                } else {
                    setStatus($("#accessMsg"), res?.error || "Delete failed");
                }
            } catch (e) {
                console.warn(e);
                setStatus($("#accessMsg"), "Delete failed");
            }
        });
    });
};

const main = () => {
    $("#btnHealth").onclick = async () => {
        try {
            const url = new URL("/health", resolveEndpointUrl()).toString();
            const res = await fetch(url);
            const json = await res.json();
            const roles = Array.isArray(json?.roles) ? json.roles.join(", ") : "-";
            const upstream = json?.upstreamEnabled ? "on" : "off";
            setStatus($("#healthStatus"), `Health: ${json?.ok ? "ok" : "fail"} (mode: ${json?.mode || "-"}, roles: ${roles}, upstream: ${upstream})`);
        } catch (e) {
            setStatus($("#healthStatus"), `Health: error`);
            console.warn(e);
        }
    };

    $("#btnRegister").onclick = async () => {
        try {
            const { endpointUrl, encrypt } = state.creds;
            const body = {
                userId: $("#userId").value.trim() || undefined,
                userKey: $("#userKey").value.trim() || undefined,
                encrypt
            };
            const res = await fetch(new URL("/core/auth/register", endpointUrl).toString(), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body)
            });
            const json = await res.json();
            if (json?.ok) {
                $("#userId").value = json.userId;
                $("#userKey").value = json.userKey;
                $("#encrypt").value = json.encrypt ? "true" : "false";
                setStatus($("#accessMsg"), `Registered user ${json.userId}`);
            } else {
                setStatus($("#accessMsg"), json?.error || "Failed");
            }
        } catch (e) {
            console.warn(e);
            setStatus($("#accessMsg"), "Register failed");
        }
    };

    $("#btnRotate").onclick = async () => {
        try {
            const { endpointUrl } = state.creds;
            const res = await fetch(new URL("/core/auth/rotate", endpointUrl).toString(), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    userId: $("#userId").value.trim(),
                    userKey: $("#userKey").value.trim(),
                    encrypt: $("#encrypt").value === "true"
                })
            });
            const json = await res.json();
            if (json?.ok) {
                $("#userKey").value = json.userKey;
                setStatus($("#accessMsg"), `Rotated key for ${json.userId}`);
            } else {
                setStatus($("#accessMsg"), json?.error || "Failed");
            }
        } catch (e) {
            console.warn(e);
            setStatus($("#accessMsg"), "Rotate failed");
        }
    };

    $("#btnSaveLocal").onclick = async () => {
        try {
            const prefs = {
                userId: $("#userId").value.trim(),
                userKey: $("#userKey").value.trim(),
                endpointUrl: $("#endpointUrl").value.trim(),
                encrypt: $("#encrypt").value
            };
            const res = await fetch("/core/admin/prefs", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ prefs })
            });
            const json = await res.json();
            if (json?.ok) {
                setStatus($("#accessMsg"), "Saved to server config");
            } else {
                setStatus($("#accessMsg"), json?.error || "Save failed");
            }
        } catch (e) {
            console.warn(e);
            setStatus($("#accessMsg"), "Save to config failed");
        }
    };
    $("#btnLoadLocal").onclick = async () => {
        try {
            const res = await fetch("/core/admin/prefs");
            const json = await res.json();
            if (json?.ok && json.prefs) {
                const v = json.prefs;
                $("#userId").value = v.userId || "";
                $("#userKey").value = v.userKey || "";
                $("#endpointUrl").value = v.endpointUrl || "";
                $("#encrypt").value = v.encrypt || "false";
                setStatus($("#accessMsg"), "Loaded from server config");
            }
        } catch (e) {
            console.warn(e);
            setStatus($("#accessMsg"), "Load from config failed");
        }
    };

    $("#btnLoadSettings").onclick = async () => {
        try {
            const qs = new URLSearchParams({
                userId: $("#userId").value.trim(),
                userKey: $("#userKey").value.trim()
            });
            const url = new URL(`/core/user/settings?${qs.toString()}`, resolveEndpointUrl()).toString();
            const res = await fetch(url);
            const json = await res.json();
            if (json?.ok) {
                applySettingsToForm(json.settings);
                setStatus($("#settingsMsg"), "Settings loaded");
            } else {
                setStatus($("#settingsMsg"), json?.error || "Failed");
            }
        } catch (e) {
            console.warn(e);
            setStatus($("#settingsMsg"), "Load failed");
        }
    };

    $("#btnSaveSettings").onclick = async () => {
        try {
            const payload = getSettingsPayload();
            const res = await fetchJSON("/core/user/settings", { settings: payload });
            if (res?.ok) {
                setStatus($("#settingsMsg"), "Saved settings");
            } else {
                setStatus($("#settingsMsg"), res?.error || "Failed");
            }
        } catch (e) {
            console.warn(e);
            setStatus($("#settingsMsg"), "Save failed");
        }
    };

    $("#btnLoadUsers").onclick = async () => {
        try {
            const qs = new URLSearchParams({
                userId: $("#userId").value.trim(),
                userKey: $("#userKey").value.trim()
            });
            const url = new URL(`/core/auth/users?${qs.toString()}`, resolveEndpointUrl()).toString();
            const res = await fetch(url);
            const json = await res.json();
            if (json?.ok) {
                renderUsers(json.users || []);
                setStatus($("#accessMsg"), "Loaded users");
            } else {
                setStatus($("#accessMsg"), json?.error || "Load users failed");
            }
        } catch (e) {
            console.warn(e);
            setStatus($("#accessMsg"), "Load users failed");
        }
    };

    $("#btnListStorage").onclick = async () => {
        try {
            const res = await fetchJSON("/core/storage/list", { dir: "." });
            $("#storageOutput").textContent = JSON.stringify(res?.files || res, null, 2);
        } catch (e) {
            console.warn(e);
            $("#storageOutput").textContent = "List failed";
        }
    };

    // load local on start
    $("#btnLoadLocal").click();
    $("#btnHealth").click();
};

document.addEventListener("DOMContentLoaded", main);
