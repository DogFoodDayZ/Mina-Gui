import React, { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import "./crt.css";
import avatarIdle from "./assets/avatar_idle.png";
import avatarTalk from "./assets/avatar_talk.png";
import avatarTalk2 from "./assets/avatar_talk_2.png";
import avatarSmirk from "./assets/avatar_smirk.png";

const API_BASE = "http://127.0.0.1:8000";
const GUI_VOICE_HINT = "en-US-AnaNeural";

const COMMANDS = [
    "/help",
    "/diag",
    "/clear",
    "/system",
    "/core",
    "/echo",
    "/time",
    "/about",
];

export default function App() {
    const [input, setInput] = useState("");
    const [messages, setMessages] = useState([
        {
            from: "SYSTEM",
            text: "MK1 LINK STABILIZED. LOCAL CORE AND MEMORY ENDPOINTS ARE LIVE.",
        },
    ]);
    const [statusNote, setStatusNote] = useState("Waiting for core telemetry...");

    const [showEmoji, setShowEmoji] = useState(false);
    const [emojiPos, setEmojiPos] = useState({ x: 0, y: 0 });

    const [systemStatus, setSystemStatus] = useState(null);
    const [dbStatus, setDbStatus] = useState(null);
    const [memoryQuery, setMemoryQuery] = useState("what is my name");
    const [memoryWriteText, setMemoryWriteText] = useState("");
    const [memoryDeleteText, setMemoryDeleteText] = useState("");
    const [memoryResult, setMemoryResult] = useState("");
    const [imageAttachments, setImageAttachments] = useState([]);
    const [activeImageIndex, setActiveImageIndex] = useState(0);
    const [imageStatus, setImageStatus] = useState("Paste, drop, or choose an image.");
    const [modelStatus, setModelStatus] = useState({
        model: "unknown",
        supportsVision: false,
        mode: "TEXT_ONLY",
        ready: false,
    });
    const [isCoreSpeaking, setIsCoreSpeaking] = useState(false);
    const [talkFrameAlt, setTalkFrameAlt] = useState(false);
    const [avatarMood, setAvatarMood] = useState("idle");
    const [apiServiceUp, setApiServiceUp] = useState(true);
    const [fancyGuiServiceUp, setFancyGuiServiceUp] = useState(true);

    const consoleRef = useRef(null);
    const emojiBtnRef = useRef(null);
    const emojiPanelRef = useRef(null);
    const imageInputRef = useRef(null);
    const lastVoiceEventIdRef = useRef(0);
    const speakTimeoutRef = useRef(null);
    const attachmentsRef = useRef([]);

    useEffect(() => {
        attachmentsRef.current = imageAttachments;
    }, [imageAttachments]);

    useEffect(() => {
        return () => {
            for (const item of attachmentsRef.current || []) {
                if (item?.objectUrl) {
                    URL.revokeObjectURL(item.objectUrl);
                }
            }
        };
    }, []);

    useEffect(() => {
        return () => {
            if (speakTimeoutRef.current) {
                clearTimeout(speakTimeoutRef.current);
            }
        };
    }, []);

    useEffect(() => {
        if (!isCoreSpeaking) return;

        const id = setInterval(() => {
            setTalkFrameAlt((prev) => !prev);
        }, 220);

        return () => clearInterval(id);
    }, [isCoreSpeaking]);

    async function requestJson(path, options = {}) {
        const res = await fetch(`${API_BASE}${path}`, options);
        const text = await res.text();
        let data = null;

        if (text) {
            try {
                data = JSON.parse(text);
            } catch {
                data = text;
            }
        }

        if (!res.ok) {
            const message =
                typeof data === "string"
                    ? data
                    : data?.detail ?? data?.error ?? `HTTP ${res.status}`;

            throw new Error(message);
        }

        return data;
    }

    function appendMessage(from, text) {
        setMessages((prev) => [...prev, { from, text }]);
    }

    function triggerAvatarSpeechPulse(ms = 2200) {
        if (speakTimeoutRef.current) {
            clearTimeout(speakTimeoutRef.current);
        }
        setAvatarMood("talk");
        setIsCoreSpeaking(true);
        speakTimeoutRef.current = setTimeout(() => {
            setIsCoreSpeaking(false);
            setAvatarMood("smirk");
            setTimeout(() => setAvatarMood("idle"), 900);
        }, ms);
    }

    function clearImageAttachment(indexToRemove = activeImageIndex) {
        setImageAttachments((prev) => {
            if (!prev.length) return prev;
            const idx = Math.max(0, Math.min(indexToRemove, prev.length - 1));
            const removed = prev[idx];
            if (removed?.objectUrl) {
                URL.revokeObjectURL(removed.objectUrl);
            }
            const next = prev.filter((_, i) => i !== idx);
            const nextActive = Math.max(0, Math.min(idx, next.length - 1));
            setActiveImageIndex(nextActive);
            if (!next.length) {
                setImageStatus("Paste, drop, or choose an image.");
            } else {
                setImageStatus(`Active image: ${next[nextActive].name}`);
            }
            return next;
        });
    }

    async function fileToAttachment(file) {
        if (!file || !file.type?.startsWith("image/")) {
            throw new Error("Please use an image file.");
        }

        const objectUrl = URL.createObjectURL(file);
        const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onload = () => resolve(String(reader.result || ""));
            reader.onerror = () => reject(new Error("Could not read image file."));
            reader.readAsDataURL(file);
        });

        return {
            name: file.name || "pasted-image",
            type: file.type || "image/*",
            size: file.size || 0,
            objectUrl,
            dataUrl,
        };
    }

    async function acceptImageFiles(fileList) {
        const files = Array.from(fileList || []);
        if (!files.length) return;

        const imageFiles = files.filter((f) => f?.type?.startsWith("image/"));
        if (!imageFiles.length) {
            setImageStatus("Please use image files.");
            return;
        }

        try {
            const currentCount = imageAttachments.length;
            const availableSlots = Math.max(0, 3 - currentCount);
            if (availableSlots <= 0) {
                setImageStatus("Image slots full (3/3). Remove one to add another.");
                return;
            }

            const selected = imageFiles.slice(0, availableSlots);
            const built = [];
            for (const file of selected) {
                built.push(await fileToAttachment(file));
            }

            if (!built.length) return;

            setImageAttachments((prev) => {
                const next = [...prev, ...built].slice(0, 3);
                setActiveImageIndex(next.length - 1);
                return next;
            });

            const loadedNames = built.map((x) => x.name).join(", ");
            const total = Math.min(3, currentCount + built.length);
            setImageStatus(`Loaded ${built.length} image(s): ${loadedNames}. Slots used: ${total}/3`);
            appendMessage("SYSTEM", `Image staged: ${loadedNames}`);
        } catch (err) {
            setImageStatus(`Image load failed: ${err.message}`);
        }
    }

    function handleImageFiles(files) {
        if (!files?.length) return;
        acceptImageFiles(files);
    }

    function handleImagePaste(event) {
        const clipboard = event.clipboardData;
        const plainText = String(clipboard?.getData("text/plain") || "").trim();
        const htmlText = String(clipboard?.getData("text/html") || "").trim();

        // If clipboard includes text (including emoji glyph text), do not auto-stage images.
        if (plainText || htmlText) {
            return;
        }

        const items = clipboard?.items;
        if (!items?.length) return;

        for (const item of items) {
            if (item.type?.startsWith("image/")) {
                const file = item.getAsFile();
                if (file) {
                    event.preventDefault();
                    acceptImageFiles([file]);
                    return;
                }
            }
        }
    }

    function handleImageDrop(event) {
        event.preventDefault();
        const files = event.dataTransfer?.files;
        if (!files?.length) return;
        handleImageFiles(files);
    }

    function openImagePicker() {
        imageInputRef.current?.click();
    }

    function setActivity(text) {
        setStatusNote(text);
    }

    useEffect(() => {
        if (consoleRef.current) {
            consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
        }
    }, [messages]);

    useEffect(() => {
        function handleOutside(e) {
            if (!showEmoji) return;
            if (emojiBtnRef.current?.contains(e.target)) return;
            if (emojiPanelRef.current?.contains(e.target)) return;
            setShowEmoji(false);
        }

        document.addEventListener("mousedown", handleOutside);

        return () => {
            document.removeEventListener("mousedown", handleOutside);
        };
    }, [showEmoji]);

    async function refreshSystemStatus() {
        try {
            const data = await requestJson("/status");

            setSystemStatus({
                coreTemp: data.core_temp ?? "UNKNOWN",
                memoryBus: data.memory_bus ?? "UNKNOWN",
                neuralCache: data.neural_cache ?? "UNKNOWN",
                ioChannels: data.io_channels ?? "UNKNOWN",
                level: data.level ?? "NORMAL",
            });

            setActivity("Core telemetry refreshed.");
        } catch (err) {
            setSystemStatus((prev) =>
                prev ?? {
                    coreTemp: "WAITING FOR CORE...",
                    memoryBus: "WAITING FOR CORE...",
                    neuralCache: "WAITING FOR CORE...",
                    ioChannels: "WAITING FOR CORE...",
                    level: "WARN",
                }
            );
            setActivity(`Status refresh failed: ${err.message}`);
        }
    }

    async function refreshDbStatus() {
        try {
            const data = await requestJson("/db/status");

            setDbStatus({
                link: data.db_link ?? "UNKNOWN",
                sync: data.db_sync ?? "UNKNOWN",
                latency: data.db_latency ?? "UNKNOWN",
                activeConnections: data.active_connections ?? "UNKNOWN",
                readOps: data.read_ops ?? "UNKNOWN",
                writeOps: data.write_ops ?? "UNKNOWN",
                cacheState: data.cache_state ?? "UNKNOWN",
                lastCommit: data.last_commit ?? "UNKNOWN",
                level: data.level ?? "NORMAL",
            });

            setActivity("Database telemetry refreshed.");
        } catch (err) {
            setDbStatus((prev) =>
                prev ?? {
                    link: "WAITING FOR DB...",
                    sync: "WAITING FOR DB...",
                    latency: "WAITING FOR DB...",
                    activeConnections: "WAITING FOR DB...",
                    readOps: "WAITING FOR DB...",
                    writeOps: "WAITING FOR DB...",
                    cacheState: "WAITING FOR DB...",
                    lastCommit: "WAITING FOR DB...",
                    level: "WARN",
                }
            );
            setActivity(`DB refresh failed: ${err.message}`);
        }
    }

    async function refreshAllStatus() {
        await Promise.all([refreshSystemStatus(), refreshDbStatus()]);
    }

    useEffect(() => {
        let cancelled = false;

        async function pollStatus() {
            try {
                const data = await requestJson("/status");

                if (cancelled) return;

                setSystemStatus({
                    coreTemp: data.core_temp ?? "UNKNOWN",
                    memoryBus: data.memory_bus ?? "UNKNOWN",
                    neuralCache: data.neural_cache ?? "UNKNOWN",
                    ioChannels: data.io_channels ?? "UNKNOWN",
                    level: data.level ?? "NORMAL",
                });
                setApiServiceUp(true);
            } catch {
                if (cancelled) return;

                setSystemStatus((prev) =>
                    prev ?? {
                        coreTemp: "WAITING FOR CORE...",
                        memoryBus: "WAITING FOR CORE...",
                        neuralCache: "WAITING FOR CORE...",
                        ioChannels: "WAITING FOR CORE...",
                        level: "WARN",
                    }
                );
                setApiServiceUp(false);
            }
        }

        pollStatus();

        const id = setInterval(pollStatus, 2000);

        return () => {
            cancelled = true;
            clearInterval(id);
        };
    }, []);

    useEffect(() => {
        let cancelled = false;

        async function pollVoiceEvents() {
            try {
                const events = await requestJson(
                    `/events/recent?since_id=${lastVoiceEventIdRef.current}&source=voice&limit=25`
                );

                if (cancelled || !Array.isArray(events) || events.length === 0) {
                    return;
                }

                for (const ev of events) {
                    const evId = Number(ev?.id || 0);
                    if (evId > lastVoiceEventIdRef.current) {
                        lastVoiceEventIdRef.current = evId;
                    }

                    const said = String(ev?.input_text || "").trim();
                    const reply = String(ev?.reply || "").trim();
                    const toolOutput = String(ev?.tool_output || "").trim();

                    if (said) {
                        appendMessage("VOICE", said);
                    }
                    if (reply) {
                        appendMessage("CORE", reply);
                        triggerAvatarSpeechPulse();
                    }
                    if (toolOutput) {
                        appendMessage("TOOL", toolOutput);
                    }
                }
            } catch {
                // Keep polling quietly; voice sync is best-effort.
            }
        }

        pollVoiceEvents();
        const id = setInterval(pollVoiceEvents, 1500);

        return () => {
            cancelled = true;
            clearInterval(id);
        };
    }, []);

    useEffect(() => {
        let cancelled = false;

        async function pollModelStatus() {
            try {
                const data = await requestJson("/model/status");
                if (cancelled) return;

                setModelStatus({
                    model: data?.model ?? "unknown",
                    supportsVision: Boolean(data?.supports_vision),
                    mode: data?.mode ?? "TEXT_ONLY",
                    ready: true,
                });
            } catch {
                if (cancelled) return;

                setModelStatus((prev) => ({
                    ...prev,
                    ready: false,
                }));
            }
        }

        pollModelStatus();
        const id = setInterval(pollModelStatus, 5000);

        return () => {
            cancelled = true;
            clearInterval(id);
        };
    }, []);

    useEffect(() => {
        let cancelled = false;

        async function pollDbStatus() {
            try {
                const data = await requestJson("/db/status");

                if (cancelled) return;

                setDbStatus({
                    link: data.db_link ?? "UNKNOWN",
                    sync: data.db_sync ?? "UNKNOWN",
                    latency: data.db_latency ?? "UNKNOWN",
                    activeConnections: data.active_connections ?? "UNKNOWN",
                    readOps: data.read_ops ?? "UNKNOWN",
                    writeOps: data.write_ops ?? "UNKNOWN",
                    cacheState: data.cache_state ?? "UNKNOWN",
                    lastCommit: data.last_commit ?? "UNKNOWN",
                    level: data.level ?? "NORMAL",
                });
            } catch {
                if (cancelled) return;

                setDbStatus((prev) =>
                    prev ?? {
                        link: "WAITING FOR DB...",
                        sync: "WAITING FOR DB...",
                        latency: "WAITING FOR DB...",
                        activeConnections: "WAITING FOR DB...",
                        readOps: "WAITING FOR DB...",
                        writeOps: "WAITING FOR DB...",
                        cacheState: "WAITING FOR DB...",
                        lastCommit: "WAITING FOR DB...",
                        level: "WARN",
                    }
                );
            }
        }

        pollDbStatus();

        const id = setInterval(pollDbStatus, 2000);

        return () => {
            cancelled = true;
            clearInterval(id);
        };
    }, []);

    async function sendToCore(userText, options = {}) {
        try {
            const payload = {
                input: userText,
                speak_response: true,
                voice_hint: GUI_VOICE_HINT,
            };

            const includeImage = Boolean(options.includeImage);

            const activeAttachment = imageAttachments[activeImageIndex] || imageAttachments[0] || null;
            if (includeImage && activeAttachment?.dataUrl) {
                payload.image_attachment = {
                    name: activeAttachment.name,
                    type: activeAttachment.type,
                    size: activeAttachment.size,
                    data_url: activeAttachment.dataUrl,
                };
            }

            const reply = await requestJson("/process", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(payload),
            });

            let replyText = "(no reply)";

            if (reply) {
                if (typeof reply.reply === "string") {
                    replyText = reply.reply;
                } else if (typeof reply.reply === "object") {
                    replyText = JSON.stringify(reply.reply, null, 2);
                } else if (typeof reply.output === "string") {
                    replyText = reply.output;
                } else if (reply.choices?.[0]?.message?.content) {
                    replyText = reply.choices[0].message.content;
                }
            }

            return {
                text: replyText,
                image: reply?.image ?? null,
                raw: reply,
            };
        } catch (err) {
            console.error(err);
            return {
                text: `(error contacting core: ${err.message})`,
                image: null,
                raw: null,
            };
        }
    }

    async function readMemory() {
        const query = memoryQuery.trim();

        if (!query) {
            setMemoryResult("Enter a memory query first.");
            return;
        }

        try {
            const data = await requestJson(
                `/memory/read?query=${encodeURIComponent(query)}`
            );

            const resultText =
                typeof data?.reply === "string"
                    ? data.reply
                    : typeof data?.result === "string"
                        ? data.result
                        : JSON.stringify(data, null, 2);

            setMemoryResult(resultText);
            appendMessage("MEMORY", resultText);
            setActivity(`Memory read for: ${query}`);
        } catch (err) {
            const message = `Memory read failed: ${err.message}`;
            setMemoryResult(message);
            appendMessage("MEMORY", message);
            setActivity(message);
        }
    }

    async function writeMemory() {
        const text = memoryWriteText.trim();

        if (!text) {
            setMemoryResult("Enter a memory fact first.");
            return;
        }

        try {
            const data = await requestJson("/memory/write", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    text,
                    kind: "fact",
                    tags: ["gui"],
                }),
            });

            const message =
                data?.status ?? data?.reply ?? "Memory write completed.";

            setMemoryResult(message);
            appendMessage("MEMORY", message);
            setActivity(`Saved memory fact: ${text}`);
            setMemoryWriteText("");
        } catch (err) {
            const message = `Memory write failed: ${err.message}`;
            setMemoryResult(message);
            appendMessage("MEMORY", message);
            setActivity(message);
        }
    }

    async function deleteMemory() {
        const text = memoryDeleteText.trim();

        if (!text) {
            setMemoryResult("Enter text to delete first.");
            return;
        }

        try {
            const data = await requestJson("/memory/delete", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    text,
                }),
            });

            const message =
                data?.status ?? data?.reply ?? "Memory delete completed.";

            setMemoryResult(message);
            appendMessage("MEMORY", message);
            setActivity(`Deleted memory rows matching: ${text}`);
            setMemoryDeleteText("");
        } catch (err) {
            const message = `Memory delete failed: ${err.message}`;
            setMemoryResult(message);
            appendMessage("MEMORY", message);
            setActivity(message);
        }
    }

    function streamCoreReply(text) {
        const speed = 18;
        const streamId = `core-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        setAvatarMood("talk");
        setIsCoreSpeaking(true);

        setMessages((prev) => [...prev, { id: streamId, from: "CORE", text: "" }]);

        let i = 0;

        const interval = setInterval(() => {
            i++;

            const slice = text.slice(0, i);

            setMessages((prev) => {
                if (prev.length === 0) return prev;

                const targetIndex = prev.findIndex((m) => m.id === streamId);
                if (targetIndex < 0) {
                    return prev;
                }

                const copy = [...prev];
                const target = copy[targetIndex];

                copy[targetIndex] = {
                    ...target,
                    text: slice,
                };

                return copy;
            });

            if (i >= text.length) {
                clearInterval(interval);
                setIsCoreSpeaking(false);
                setAvatarMood("smirk");
                setTimeout(() => setAvatarMood("idle"), 900);
            }
        }, speed);
    }

    function handleCommand(cmd) {
        const parts = cmd.split(" ");
        const base = parts[0].toLowerCase();
        const arg = parts.slice(1).join(" ");

        switch (base) {
            case "/help":
                return {
                    from: "CMD",
                    text:
                        "Available commands:\n" +
                        "/help - show commands\n" +
                        "/diag - refresh telemetry snapshot\n" +
                        "/clear - clear console\n" +
                        "/system <msg> - local status note\n" +
                        "/core <msg> - send prompt to core\n" +
                        "/echo <msg> - echo text\n" +
                        "/time - show local time\n" +
                        "/about - system info\n" +
                        "Memory controls live in the right panel.",
                };

            case "/diag":
                return {
                    from: "CMD",
                    text: "Telemetry is read from the live status panels.",
                };

            case "/clear":
                setMessages([]);
                return null;

            case "/system":
                return {
                    from: "SYSTEM",
                    text: arg || "(empty)",
                };

            case "/core":
                return null;

            case "/echo":
                return {
                    from: "CMD",
                    text: arg || "(empty)",
                };

            case "/time":
                return {
                    from: "CMD",
                    text: new Date().toLocaleString(),
                };

            case "/about":
                return {
                    from: "CMD",
                    text: "MK1 Bunker Terminal v7 - Gremlin Haven Systems",
                };

            default:
                return {
                    from: "CMD",
                    text: "Unknown command. Type /help",
                };
        }
    }

    function triggerCommand(cmd) {
        setMessages((prev) => [...prev, { from: "YOU", text: cmd }]);

        const result = handleCommand(cmd);

        if (result) {
            setMessages((prev) => [...prev, result]);
        }
    }

    async function askCoreSummary() {
        const coreReply = await sendToCore(
            "Give me a concise current status summary for the core, database, and memory state."
        );
        streamCoreReply(coreReply.text);
        setActivity("Requested a live core summary.");
    }

    async function openRestoreGui() {
        try {
            const result = await requestJson("/restore/open", {
                method: "POST",
            });

            if (result?.ok) {
                appendMessage("SYSTEM", "Restore utility launched.");
                setActivity("Restore utility opened in a new window.");
            } else {
                const err = result?.error || "unknown_error";
                appendMessage("SYSTEM", `Restore utility failed to launch: ${err}`);
                setActivity(`Restore launch failed: ${err}`);
            }
        } catch (err) {
            appendMessage("SYSTEM", `Restore utility failed to launch: ${err.message}`);
            setActivity(`Restore launch failed: ${err.message}`);
        }
    }

    async function startApiService() {
        try {
            const result = await requestJson("/service/start_api", {
                method: "POST",
            });

            if (result?.ok) {
                appendMessage("SYSTEM", "API start signal sent.");
                setActivity("API start requested.");
            } else {
                const err = result?.error || "unknown_error";
                appendMessage("SYSTEM", `API start failed: ${err}`);
                setActivity(`API start failed: ${err}`);
            }
        } catch (err) {
            setApiServiceUp(false);
            appendMessage("SYSTEM", `API start failed: ${err.message}`);
            setActivity(`API start failed: ${err.message}`);
        }
    }

    async function openFancyGuiWindow() {
        try {
            const result = await requestJson("/service/open_fancy_gui", {
                method: "POST",
            });

            if (result?.ok) {
                setFancyGuiServiceUp(true);
                appendMessage("SYSTEM", "Fancy GUI launch requested.");
                setActivity("Fancy GUI launch requested.");
            } else {
                const err = result?.error || "unknown_error";
                setFancyGuiServiceUp(false);
                appendMessage("SYSTEM", `Fancy GUI launch failed: ${err}`);
                setActivity(`Fancy GUI launch failed: ${err}`);
            }
        } catch (err) {
            setFancyGuiServiceUp(false);
            appendMessage("SYSTEM", `Fancy GUI launch failed: ${err.message}`);
            setActivity(`Fancy GUI launch failed: ${err.message}`);
        }
    }

    function handleAutocomplete() {
        const trimmed = input.trim();

        if (!trimmed.startsWith("/")) return;

        const parts = trimmed.split(" ");
        const base = parts[0];

        const match = COMMANDS.find((c) => c.startsWith(base) && c !== base);

        if (match) {
            parts[0] = match;

            const rest = parts.slice(1).join(" ");

            const newVal = rest ? `${match} ${rest}` : `${match} `;

            setInput(newVal);
        }
    }

    async function handleSubmit() {
        const payload = input.trim();

        if (!payload) return;

        setMessages((prev) => [
            ...prev,
            {
                from: "YOU",
                text: payload,
            },
        ]);

        setInput("");

        if (payload.startsWith("/core")) {
            const corePrompt = payload.slice(5).trim();
            const coreReply = await sendToCore(
                corePrompt || "Respond briefly with the current core summary."
            );
            streamCoreReply(coreReply.text);
            setActivity("Sent a direct prompt to the core.");
            return;
        }

        if (payload.startsWith("/")) {
            const result = handleCommand(payload);

            if (result) {
                setMessages((prev) => [...prev, result]);
            }

            return;
        }

        const coreReply = await sendToCore(payload);

        streamCoreReply(coreReply.text);

        if (imageAttachments.length) {
            const activeAttachment = imageAttachments[activeImageIndex] || imageAttachments[0];
            if (activeAttachment) {
                setImageStatus(`Active image kept ready: ${activeAttachment.name}`);
            }
        }
    }

    async function handleSendImage() {
        if (!modelStatus.ready || !modelStatus.supportsVision) {
            setImageStatus("SEND>IMG is disabled until a vision-capable model is active.");
            appendMessage("SYSTEM", "SEND>IMG blocked: active model is not image-capable.");
            return;
        }

        const activeAttachment = imageAttachments[activeImageIndex] || imageAttachments[0] || null;
        if (!activeAttachment?.dataUrl) {
            setImageStatus("Stage an image first, then use SEND>IMG.");
            appendMessage("SYSTEM", "No staged image available for SEND>IMG.");
            return;
        }

        const textPrompt = input.trim();
        const composedPrompt = textPrompt || "Analyze the staged image and summarize key details.";

        setMessages((prev) => [
            ...prev,
            {
                from: "YOU",
                text: `[IMG] ${composedPrompt}`,
            },
        ]);

        if (textPrompt) {
            setInput("");
        }

        setImageStatus(`Sending image: ${activeAttachment.name}`);
        appendMessage("SYSTEM", `Dispatching staged image: ${activeAttachment.name}`);

        const coreReply = await sendToCore(composedPrompt, { includeImage: true });
        streamCoreReply(coreReply.text);

        const imageMeta = coreReply.image;
        if (imageMeta?.received) {
            setModelStatus((prev) => ({
                ...prev,
                supportsVision: Boolean(imageMeta.vision_model),
                mode: imageMeta.vision_model ? "VISION_READY" : "TEXT_ONLY",
                ready: true,
            }));

            if (imageMeta.forwarded_to_model) {
                appendMessage("SYSTEM", `Image sent to vision model: ${imageMeta.name}`);
                setImageStatus(`Image sent: ${imageMeta.name}`);
            } else {
                appendMessage("SYSTEM", "Image received by backend. Active model appears text-only; upgrade to a vision model for pixel-level analysis.");
                setImageStatus("Image reached backend; active model is text-only.");
            }
        } else {
            appendMessage("SYSTEM", "Image dispatch completed, but backend did not confirm attachment metadata.");
        }
    }

    function handleKeyDown(e) {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSubmit();
        } else if (e.key === "Tab") {
            e.preventDefault();
            handleAutocomplete();
        }
    }

    function insertEmoji(emoji) {
        setInput((prev) => prev + emoji);
        setShowEmoji(false);
    }

    const emojiList = [
        "🙂",
        "🤖",
        "⚠️",
        "🔥",
        "💀",
        "🚨",
        "📡",
        "🔧",
        "🛠️",
        "💾",
        "📁",
        "📦",
        "🔒",
        "🔓",
        "🧪",
        "⚙️",
        "🛰️",
        "🧱",
        "🕳️",
        "🗜️",
        "🧲",
        "🛡️",
        "⚡",
        "💡",
        "📜",
        "🧰",
        "🕹️",
        "📟",
        "🖥️",
        "🔭",
        "📡",
        "🧯",
        "🧵",
        "🪛",
        "🔩",
        "🔨",
        "🪓",
        "🧱",
        "🧬",
        "🧫",
    ];

    function toggleEmoji() {
        if (!emojiBtnRef.current) return;

        const rect = emojiBtnRef.current.getBoundingClientRect();

        setEmojiPos({
            x: rect.left + rect.width / 2,
            y: rect.top,
        });

        setShowEmoji((prev) => !prev);
    }

    const trimmed = input.trim();
    const currentCmd = trimmed.startsWith("/") ? trimmed.split(" ")[0] : "";
    const suggestion = currentCmd
        ? COMMANDS.find((c) => c.startsWith(currentCmd) && c !== currentCmd)
        : null;

    function getColorForSender(from) {
        if (from === "SYSTEM") return "#ffb000";
        if (from === "CORE") return "#00ff88";
        if (from === "CMD") return "#00e0ff";
        if (from === "MEMORY") return "#ff8c00";
        if (from === "VOICE") return "#9ad1ff";
        if (from === "TOOL") return "#ffd27d";
        if (from === "YOU") return "#e0e0e0";

        return "#e0e0e0";
    }

    function getStatusColor(level) {
        switch (level) {
            case "CRITICAL":
                return "#ff0033";

            case "ERROR":
                return "#ff3300";

            case "WARN":
                return "#ffb000";

            case "NORMAL":
            default:
                return "#00ff88";
        }
    }

    const coreTempText = systemStatus?.coreTemp ?? "WAITING FOR CORE...";
    const memoryBusText = systemStatus?.memoryBus ?? "WAITING FOR CORE...";
    const neuralCacheText = systemStatus?.neuralCache ?? "WAITING FOR CORE...";
    const ioChannelsText = systemStatus?.ioChannels ?? "WAITING FOR CORE...";
    const statusLevel = systemStatus?.level ?? "WARN";
    const statusColor = getStatusColor(statusLevel);

    const dbLinkText = dbStatus?.link ?? "WAITING FOR DB...";
    const dbSyncText = dbStatus?.sync ?? "WAITING FOR DB...";
    const dbLatencyText = dbStatus?.latency ?? "WAITING FOR DB...";
    const dbActiveConnText = dbStatus?.activeConnections ?? "WAITING FOR DB...";
    const dbReadOpsText = dbStatus?.readOps ?? "WAITING FOR DB...";
    const dbWriteOpsText = dbStatus?.writeOps ?? "WAITING FOR DB...";
    const dbCacheStateText = dbStatus?.cacheState ?? "WAITING FOR DB...";
    const dbLastCommitText = dbStatus?.lastCommit ?? "WAITING FOR DB...";
    const dbLevel = dbStatus?.level ?? "WARN";
    const dbColor = getStatusColor(dbLevel);
    const hasVisionCapability = modelStatus.ready && modelStatus.supportsVision;
    const textOnlyBadgeClass = hasVisionCapability
        ? "mk1-vision-badge mk1-vision-muted"
        : "mk1-vision-badge mk1-vision-off";
    const imageCapableBadgeClass = hasVisionCapability
        ? "mk1-vision-badge mk1-vision-on"
        : "mk1-vision-badge mk1-vision-muted";
    const apiServiceClass = apiServiceUp ? "mk1-service-badge mk1-service-up" : "mk1-service-badge mk1-service-down";
    const fancyServiceClass = fancyGuiServiceUp ? "mk1-service-badge mk1-service-up" : "mk1-service-badge mk1-service-down";

    const avatarSrc = isCoreSpeaking
        ? (talkFrameAlt ? avatarTalk2 : avatarTalk)
        : (avatarMood === "smirk" ? avatarSmirk : avatarIdle);

    return (
        <>
            <div className="mk1-root">
                <main className="mk1-main">
                    <div className="mk1-left-stack">
                        <section
                            className="mk1-panel mk1-crt-amber mk1-image-panel"
                            onPaste={handleImagePaste}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={handleImageDrop}
                        >
                            <div className="mk1-panel-title">IMAGE STAGING</div>

                            <div className="mk1-image-model-row">
                                <div className="mk1-image-mode-badges">
                                    <span className={textOnlyBadgeClass}>TEXT ONLY</span>
                                    <span className={imageCapableBadgeClass}>IMAGE CAPABLE</span>
                                </div>
                                <span className="mk1-image-model-name">{modelStatus.model}</span>
                            </div>

                            <div className="mk1-panel-body mk1-image-body">
                                <input
                                    ref={imageInputRef}
                                    type="file"
                                    accept="image/*"
                                    multiple
                                    className="mk1-hidden-file"
                                    onChange={(e) => handleImageFiles(e.target.files)}
                                />

                                <div className="mk1-image-actions">
                                    <button className="mk1-file-btn" type="button" onClick={openImagePicker}>
                                        CHOOSE IMAGE
                                    </button>

                                    <button
                                        className="mk1-send-img-btn"
                                        type="button"
                                        onClick={handleSendImage}
                                        disabled={!hasVisionCapability}
                                        title={hasVisionCapability ? "Send staged image to model" : "Load a vision-capable model to enable SEND>IMG"}
                                    >
                                        SEND&gt;IMG
                                    </button>
                                </div>

                                {imageAttachments.length ? (
                                    <div className="mk1-image-grid">
                                        {imageAttachments.map((att, idx) => {
                                            const isActive = idx === activeImageIndex;
                                            return (
                                                <div
                                                    key={att.objectUrl || `${att.name}-${idx}`}
                                                    className={`mk1-image-slot ${isActive ? "is-active" : ""}`}
                                                    onClick={() => {
                                                        setActiveImageIndex(idx);
                                                        setImageStatus(`Active image: ${att.name}`);
                                                    }}
                                                    role="button"
                                                    tabIndex={0}
                                                    onKeyDown={(e) => {
                                                        if (e.key === "Enter" || e.key === " ") {
                                                            e.preventDefault();
                                                            setActiveImageIndex(idx);
                                                            setImageStatus(`Active image: ${att.name}`);
                                                        }
                                                    }}
                                                    title={isActive ? "Currently selected for SEND>IMG" : "Click to set as SEND>IMG target"}
                                                >
                                                    <img className="mk1-image-slot-preview" src={att.objectUrl} alt={att.name} />
                                                    <div className="mk1-image-slot-name">{att.name}</div>
                                                    <div className="mk1-image-slot-meta">{Math.max(1, Math.round(att.size / 1024))} KB</div>
                                                    <div className="mk1-image-slot-row">
                                                        {isActive && <span className="mk1-image-slot-active">ACTIVE</span>}
                                                        <button
                                                            className="mk1-image-slot-remove"
                                                            type="button"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                clearImageAttachment(idx);
                                                            }}
                                                        >
                                                            REMOVE
                                                        </button>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <button
                                        className="mk1-image-empty-target"
                                        type="button"
                                        onClick={openImagePicker}
                                        title="Choose, paste, or drop an image"
                                    >
                                        <span className="mk1-image-empty-title">No image loaded.</span>
                                        <span className="mk1-image-empty-copy">Paste or drop anywhere in this panel, or click here to choose an image.</span>
                                    </button>
                                )}

                                <div className="mk1-avatar-stage">
                                    <img className="mk1-avatar-image" src={avatarSrc} alt="Mina avatar" />
                                    <div className="mk1-avatar-state">
                                        AVATAR STATE: {isCoreSpeaking ? "TALK" : avatarMood.toUpperCase()}
                                    </div>
                                </div>

                                <div className="mk1-panel-note">{imageStatus}</div>
                            </div>
                        </section>
                    </div>

                    <div className="mk1-center-stack">
                        <section className="mk1-panel mk1-crt-green mk1-console-panel">
                            <div className="mk1-console-header">
                                <span className="mk1-chat-label">MK1</span>

                                <span className="mk1-chat-text">
                                    {systemStatus?.level === "NORMAL" && " CORE ONLINE"}
                                    {systemStatus?.level === "WARN" && " CORE DEGRADED"}
                                    {systemStatus?.level === "ERROR" && " CORE ERROR"}
                                    {systemStatus?.level === "CRITICAL" && " CORE FAILURE"}
                                    {!systemStatus?.level && " WAITING FOR CORE..."}
                                </span>
                            </div>

                            <div className="mk1-console-scroll" ref={consoleRef}>
                                {messages.map((m, idx) => (
                                    <div className="mk1-chat-line" key={idx}>
                                        <span
                                            className="mk1-chat-label"
                                            style={{
                                                color: getColorForSender(m.from),
                                            }}
                                        >
                                            {m.from}
                                        </span>

                                        <span className="mk1-chat-text"> {m.text}</span>
                                    </div>
                                ))}
                            </div>
                        </section>

                        <section className="mk1-panel mk1-chat-input-panel">
                            <button
                                ref={emojiBtnRef}
                                className="mk1-emoji-toggle"
                                type="button"
                                onClick={toggleEmoji}
                            >
                                EMOJI
                            </button>

                            <div className="mk1-input-wrap">
                                <div className="mk1-lcd-shell">
                                    <textarea
                                        className="mk1-input"
                                        value={input}
                                        onChange={(e) => setInput(e.target.value)}
                                        onKeyDown={handleKeyDown}
                                        placeholder="> ENTER COMMAND..."
                                    />

                                    {suggestion && (
                                        <div
                                            className="mk1-chat-label"
                                            style={{
                                                opacity: 0.6,
                                                marginTop: 2,
                                            }}
                                        >
                                            Suggest: {suggestion} (Tab)
                                        </div>
                                    )}
                                </div>

                                <button className="mk1-send-btn" type="button" onClick={handleSubmit}>
                                    SEND
                                </button>
                            </div>
                        </section>
                    </div>

                    <section className="mk1-right-stack">
                        <div className="mk1-panel mk1-crt-amber mk1-right-top">
                            <div className="mk1-panel-title">CORE ACTIONS</div>

                            <div className="mk1-panel-body">
                                <button className="mk1-btn" onClick={refreshAllStatus}>
                                    REFRESH STATUS
                                </button>

                                <button className="mk1-btn" onClick={askCoreSummary}>
                                    ASK CORE FOR SUMMARY
                                </button>

                                <button className="mk1-btn" onClick={readMemory}>
                                    READ MEMORY QUERY
                                </button>

                                <div className="mk1-service-row">
                                    <span className={fancyServiceClass}>{fancyGuiServiceUp ? "FANCY GUI ACTIVE" : "FANCY GUI DOWN"}</span>
                                    <button className="mk1-mini-action" type="button" onClick={openFancyGuiWindow}>
                                        START FANCY GUI
                                    </button>
                                </div>

                                <div className="mk1-service-row">
                                    <span className={apiServiceClass}>{apiServiceUp ? "API ACTIVE" : "API DOWN"}</span>
                                    <button className="mk1-mini-action" type="button" onClick={startApiService}>
                                        START API
                                    </button>
                                </div>

                                <div className="mk1-mini-field">
                                    <div className="mk1-mini-label">Memory query</div>

                                    <textarea
                                        className="mk1-mini-input"
                                        value={memoryQuery}
                                        onChange={(e) => setMemoryQuery(e.target.value)}
                                        placeholder="ask about name, workspace, last project, or a fact"
                                        rows={3}
                                    />
                                </div>

                                <div className="mk1-mini-field">
                                    <div className="mk1-mini-label">Write memory</div>

                                    <textarea
                                        className="mk1-mini-input"
                                        value={memoryWriteText}
                                        onChange={(e) => setMemoryWriteText(e.target.value)}
                                        placeholder="my favorite editor is..."
                                        rows={3}
                                    />
                                </div>

                                <button className="mk1-btn" onClick={writeMemory}>
                                    SAVE MEMORY FACT
                                </button>

                                <div className="mk1-mini-field">
                                    <div className="mk1-mini-label">Delete memory text</div>

                                    <textarea
                                        className="mk1-mini-input"
                                        value={memoryDeleteText}
                                        onChange={(e) => setMemoryDeleteText(e.target.value)}
                                        placeholder="text to remove from memory"
                                        rows={2}
                                    />
                                </div>

                                <button className="mk1-btn" onClick={deleteMemory}>
                                    DELETE MEMORY TEXT
                                </button>

                                <button className="mk1-btn" onClick={() => triggerCommand("/time")}>
                                    SHOW LOCAL TIME
                                </button>

                                <button className="mk1-btn" onClick={() => triggerCommand("/clear")}>
                                    CLEAR CONSOLE
                                </button>

                                <div className="mk1-panel-note">{statusNote}</div>

                                {memoryResult && <div className="mk1-mini-output">{memoryResult}</div>}
                            </div>
                        </div>

                        <div className="mk1-panel mk1-crt-amber mk1-right-bottom">
                            <div className="mk1-panel-title">SYSTEM</div>

                            <div className="mk1-panel-body">
                                <div className="mk1-kv">
                                    <span className="mk1-k">CORE TEMP</span>

                                    <span className="mk1-v" style={{ color: statusColor }}>
                                        {coreTempText}
                                    </span>
                                </div>

                                <div className="mk1-kv">
                                    <span className="mk1-k">MEMORY BUS</span>

                                    <span className="mk1-v" style={{ color: statusColor }}>
                                        {memoryBusText}
                                    </span>
                                </div>

                                <div className="mk1-kv">
                                    <span className="mk1-k">NEURAL CACHE</span>

                                    <span className="mk1-v" style={{ color: statusColor }}>
                                        {neuralCacheText}
                                    </span>
                                </div>

                                <div className="mk1-kv">
                                    <span className="mk1-k">IO CHANNELS</span>

                                    <span className="mk1-v" style={{ color: statusColor }}>
                                        {ioChannelsText}
                                    </span>
                                </div>

                                <div className="mk1-panel-note">DB STATUS</div>

                                <div className="mk1-kv">
                                    <span className="mk1-k">DB LINK</span>

                                    <span className="mk1-v" style={{ color: dbColor }}>
                                        {dbLinkText}
                                    </span>
                                </div>

                                <div className="mk1-kv">
                                    <span className="mk1-k">DB SYNC</span>

                                    <span className="mk1-v" style={{ color: dbColor }}>
                                        {dbSyncText}
                                    </span>
                                </div>

                                <div className="mk1-kv">
                                    <span className="mk1-k">DB LATENCY</span>

                                    <span className="mk1-v" style={{ color: dbColor }}>
                                        {dbLatencyText}
                                    </span>
                                </div>

                                <div className="mk1-kv">
                                    <span className="mk1-k">ACTIVE CONNECTIONS</span>

                                    <span className="mk1-v" style={{ color: dbColor }}>
                                        {dbActiveConnText}
                                    </span>
                                </div>

                                <div className="mk1-kv">
                                    <span className="mk1-k">READ OPS</span>

                                    <span className="mk1-v" style={{ color: dbColor }}>
                                        {dbReadOpsText}
                                    </span>
                                </div>

                                <div className="mk1-kv">
                                    <span className="mk1-k">WRITE OPS</span>

                                    <span className="mk1-v" style={{ color: dbColor }}>
                                        {dbWriteOpsText}
                                    </span>
                                </div>

                                <div className="mk1-kv">
                                    <span className="mk1-k">CACHE STATE</span>

                                    <span className="mk1-v" style={{ color: dbColor }}>
                                        {dbCacheStateText}
                                    </span>
                                </div>

                                <div className="mk1-kv">
                                    <span className="mk1-k">LAST COMMIT</span>

                                    <span className="mk1-v" style={{ color: dbColor }}>
                                        {dbLastCommitText}
                                    </span>
                                </div>
                            </div>

                            <div className="mk1-corner-actions">
                                <button className="mk1-restore-btn" type="button" onClick={openRestoreGui}>
                                    OPEN RESTORE
                                </button>
                            </div>
                        </div>
                    </section>
                </main>
            </div>

            {showEmoji &&
                createPortal(
                    <div
                        ref={emojiPanelRef}
                        className="mk1-emoji-slideup animated-slideup"
                        onMouseDown={(e) => e.stopPropagation()}
                        style={{
                            left: emojiPos.x,
                            top: emojiPos.y,
                            transform: "translate(-50%, -100%)",
                        }}
                    >
                        {emojiList.map((emoji, idx) => (
                            <button
                                key={idx}
                                className="mk1-emoji-item"
                                type="button"
                                onClick={() => insertEmoji(emoji)}
                            >
                                {emoji}
                            </button>
                        ))}
                    </div>,
                    document.body
                )}
        </>
    );
}