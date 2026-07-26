import React, { useEffect, useRef, useState } from "react";
import "./OstranautsCompanion.css";

const API_BASE = "http://127.0.0.1:8000";
const MUSIC_REQUEST = /\b(spotify|music|song|track|album|artist|playlist|play\s+list)\b/i;

function formatAge(value) {
    const age = Number(value);
    if (!Number.isFinite(age)) return "NO SIGNAL";
    return age < 1 ? "LIVE" : `${Math.round(age)}s AGO`;
}

export default function OstranautsCompanion({
    avatarSrc,
    askMina,
    onClose,
}) {
    const [status, setStatus] = useState(null);
    const [input, setInput] = useState("");
    const [busy, setBusy] = useState(false);
    const [messages, setMessages] = useState([
        { from: "MINA", text: "Companion station ready. Launch Ostranauts to establish live telemetry." },
    ]);
    const logRef = useRef(null);

    useEffect(() => {
        let stopped = false;
        let timer = null;

        async function poll() {
            try {
                const response = await fetch(`${API_BASE}/games/ostranauts/status`);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const payload = await response.json();
                if (!stopped) setStatus(payload);
            } catch (error) {
                if (!stopped) {
                    setStatus({ ok: false, error: error.message, telemetry_online: false });
                }
            } finally {
                if (!stopped) timer = setTimeout(poll, 2000);
            }
        }

        void poll();
        return () => {
            stopped = true;
            if (timer) clearTimeout(timer);
        };
    }, []);

    useEffect(() => {
        if (logRef.current) {
            logRef.current.scrollTop = logRef.current.scrollHeight;
        }
    }, [messages]);

    async function submit(prompt = input) {
        const question = String(prompt || "").trim();
        if (!question || busy) return;

        setInput("");
        setBusy(true);
        setMessages((current) => [...current, { from: "TRAVIS", text: question }]);

        const telemetry = status?.telemetry && typeof status.telemetry === "object"
            ? JSON.stringify(status.telemetry)
            : "unavailable";
        const request = MUSIC_REQUEST.test(question)
            ? question
            : [
                "You are Mina acting as my Ostranauts co-pilot.",
                "Use only the verified live telemetry below for current game state; clearly say when a requested detail is unavailable.",
                "Keep the answer concise and practical for active play, with no roleplay stage directions.",
                `Verified telemetry: ${telemetry}`,
                `Question: ${question}`,
            ].join("\n");

        try {
            const result = await askMina(request);
            setMessages((current) => [...current, { from: "MINA", text: result?.text || "No response received." }]);
        } catch (error) {
            setMessages((current) => [...current, { from: "SYSTEM", text: `Companion link failed: ${error.message}` }]);
        } finally {
            setBusy(false);
        }
    }

    const telemetry = status?.telemetry || {};
    const online = Boolean(status?.telemetry_online);
    const capabilities = Array.isArray(telemetry.capabilities) ? telemetry.capabilities : [];

    return (
        <main className="ost-root">
            <header className="ost-header">
                <div className="ost-wordmark">
                    <span className="ost-kicker">SALVAGE COMPANION // MK1</span>
                    <h1>MINA // OSTRANAUTS</h1>
                </div>
                <div className="ost-header-actions">
                    <span className={`ost-link-state ${online ? "is-online" : ""}`}>
                        {online ? "TELEMETRY LOCK" : "AWAITING GAME"}
                    </span>
                    <button className="ost-exit" type="button" onClick={onClose} title="Close companion and return to Mina">
                        CLOSE COMPANION
                    </button>
                </div>
            </header>

            <section className="ost-workspace">
                <aside className="ost-mina-bay">
                    <div className="ost-avatar-frame">
                        <img src={avatarSrc} alt="Mina companion avatar" />
                        <div className="ost-scanline" />
                    </div>
                    <div className="ost-ident">
                        <span>CO-PILOT</span>
                        <strong>MINA</strong>
                        <small>{online ? "LINKED TO VESSEL DATA" : "STANDING BY"}</small>
                    </div>
                    <div className="ost-orbit-display" aria-label="Local orbital plot">
                        <span className="ost-orbit ost-orbit-one" />
                        <span className="ost-orbit ost-orbit-two" />
                        <span className="ost-orbit-core" />
                        <span className="ost-sweep" />
                    </div>
                </aside>

                <section className="ost-conversation">
                    <div className="ost-section-label">OPEN COMMS</div>
                    <div className="ost-log" ref={logRef}>
                        {messages.map((message, index) => (
                            <div className={`ost-message is-${message.from.toLowerCase()}`} key={`${message.from}-${index}`}>
                                <span>{message.from}</span>
                                <p>{message.text}</p>
                            </div>
                        ))}
                    </div>
                    <div className="ost-quick-row">
                        {["What can you verify right now?", "Give me a session check.", "What scene am I in?"].map((prompt) => (
                            <button key={prompt} type="button" onClick={() => submit(prompt)} disabled={busy}>
                                {prompt}
                            </button>
                        ))}
                    </div>
                    <div className="ost-input-row">
                        <textarea
                            value={input}
                            onChange={(event) => setInput(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === "Enter" && !event.shiftKey) {
                                    event.preventDefault();
                                    void submit();
                                }
                            }}
                            placeholder="Ask Mina about the current run..."
                        />
                        <button type="button" onClick={() => submit()} disabled={busy || !input.trim()}>
                            {busy ? "THINKING" : "TRANSMIT"}
                        </button>
                    </div>
                </section>

                <aside className="ost-telemetry">
                    <div className="ost-section-label">VESSEL DATA</div>
                    <dl>
                        <div><dt>GAME</dt><dd>{status?.installed ? "FOUND" : "NOT FOUND"}</dd></div>
                        <div><dt>BEPINEX</dt><dd>{status?.bepinex_installed ? "READY" : "MISSING"}</dd></div>
                        <div><dt>MINA BRIDGE</dt><dd>{status?.plugin_installed ? "INSTALLED" : "MISSING"}</dd></div>
                        <div><dt>SIGNAL</dt><dd className={online ? "is-good" : "is-warn"}>{formatAge(status?.telemetry_age_seconds)}</dd></div>
                        <div><dt>SCENE</dt><dd>{telemetry.scene || "UNKNOWN"}</dd></div>
                        <div><dt>GAME VERSION</dt><dd>{telemetry.game_version || "--"}</dd></div>
                        <div><dt>SESSION</dt><dd>{telemetry.session_uptime_seconds != null ? `${telemetry.session_uptime_seconds}s` : "--"}</dd></div>
                        <div><dt>FOCUS</dt><dd>{telemetry.game_focused == null ? "--" : telemetry.game_focused ? "ACTIVE" : "BACKGROUND"}</dd></div>
                    </dl>
                    <div className="ost-capabilities">
                        <span>ACTIVE SENSORS</span>
                        {capabilities.length ? capabilities.map((item) => <b key={item}>{String(item).replaceAll("_", " ")}</b>) : <em>NO LIVE SENSORS</em>}
                    </div>
                    <div className="ost-path">{status?.game_dir || status?.error || "Scanning Steam libraries..."}</div>
                </aside>
            </section>
        </main>
    );
}