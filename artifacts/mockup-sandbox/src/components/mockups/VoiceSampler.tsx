import { useEffect, useState, useRef } from "react";

const SAMPLES = [
  "In 300 metres, turn left onto Uhuru Highway.",
  "Speed camera ahead. Reduce your speed.",
  "Police checkpoint ahead.",
  "You have arrived at your destination.",
  "In 500 metres, at the roundabout, take the 2nd exit onto Mombasa Road.",
];

type VoiceOption = {
  label: string;
  match: (v: SpeechSynthesisVoice) => boolean;
  description: string;
  flag: string;
};

const VOICE_OPTIONS: VoiceOption[] = [
  {
    label: "Tessa",
    flag: "🇿🇦",
    description: "South African English — closest African accent",
    match: (v) =>
      v.name.toLowerCase().includes("tessa") ||
      (v.lang.startsWith("en-ZA") && v.name.toLowerCase().includes("enhanced")),
  },
  {
    label: "Samantha",
    flag: "🇺🇸",
    description: "American English — familiar GPS voice",
    match: (v) =>
      v.name.toLowerCase().includes("samantha") ||
      (v.lang === "en-US" && v.name.toLowerCase().includes("enhanced")),
  },
  {
    label: "Daniel",
    flag: "🇬🇧",
    description: "British English — clear & neutral",
    match: (v) =>
      v.name.toLowerCase().includes("daniel") ||
      (v.lang === "en-GB" && v.name.toLowerCase().includes("enhanced")),
  },
];

export default function VoiceSampler() {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [currentSample, setCurrentSample] = useState(0);
  const [speaking, setSpeaking] = useState<string | null>(null);
  const [voicesLoaded, setVoicesLoaded] = useState(false);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    function loadVoices() {
      const v = window.speechSynthesis.getVoices();
      if (v.length > 0) {
        setVoices(v);
        setVoicesLoaded(true);
      }
    }
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
    return () => { window.speechSynthesis.onvoiceschanged = null; };
  }, []);

  function resolveVoice(option: VoiceOption): SpeechSynthesisVoice | null {
    return voices.find(option.match) ?? null;
  }

  function play(option: VoiceOption) {
    window.speechSynthesis.cancel();
    setSpeaking(null);

    const voice = resolveVoice(option);
    const text = SAMPLES[currentSample];

    const utt = new SpeechSynthesisUtterance(text);
    if (voice) utt.voice = voice;
    else {
      // Best-effort fallback by lang
      const fallback =
        option.label === "Tessa"
          ? voices.find((v) => v.lang.startsWith("en-ZA"))
          : option.label === "Daniel"
          ? voices.find((v) => v.lang.startsWith("en-GB"))
          : voices.find((v) => v.lang.startsWith("en-US"));
      if (fallback) utt.voice = fallback;
    }

    utt.rate = 0.95;
    utt.pitch = 1;
    utt.onstart = () => setSpeaking(option.label);
    utt.onend = () => setSpeaking(null);
    utt.onerror = () => setSpeaking(null);
    utteranceRef.current = utt;
    window.speechSynthesis.speak(utt);
  }

  function stop() {
    window.speechSynthesis.cancel();
    setSpeaking(null);
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0f1117",
        color: "#f0f0f0",
        fontFamily: "'Inter', system-ui, sans-serif",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "2rem",
        gap: "2rem",
      }}
    >
      {/* Header */}
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: "2rem", marginBottom: "0.4rem" }}>🔊</div>
        <h1 style={{ fontSize: "1.4rem", fontWeight: 700, margin: 0, color: "#fff" }}>
          Navigation Voice Sampler
        </h1>
        <p style={{ margin: "0.5rem 0 0", fontSize: "0.85rem", color: "#888" }}>
          Uses your device's built-in voices — exactly what the app will sound like
        </p>
      </div>

      {/* Sample text picker */}
      <div
        style={{
          background: "#1a1d27",
          borderRadius: "12px",
          padding: "1.2rem 1.5rem",
          maxWidth: "480px",
          width: "100%",
          border: "1px solid #2a2d3a",
        }}
      >
        <p style={{ margin: "0 0 0.8rem", fontSize: "0.75rem", color: "#666", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Sample phrase
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
          {SAMPLES.map((s, i) => (
            <button
              key={i}
              onClick={() => setCurrentSample(i)}
              style={{
                background: currentSample === i ? "#2a3a5c" : "transparent",
                border: `1px solid ${currentSample === i ? "#4a7adc" : "#2a2d3a"}`,
                borderRadius: "8px",
                padding: "0.6rem 0.9rem",
                color: currentSample === i ? "#a8c4ff" : "#aaa",
                fontSize: "0.82rem",
                cursor: "pointer",
                textAlign: "left",
                transition: "all 0.15s",
              }}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Voice buttons */}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.8rem", width: "100%", maxWidth: "480px" }}>
        {VOICE_OPTIONS.map((opt) => {
          const resolved = voicesLoaded ? resolveVoice(opt) : null;
          const available = resolved !== null;
          const isPlaying = speaking === opt.label;

          return (
            <button
              key={opt.label}
              onClick={() => (isPlaying ? stop() : play(opt))}
              disabled={!voicesLoaded}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "1rem",
                background: isPlaying ? "#1e3a2a" : "#1a1d27",
                border: `1px solid ${isPlaying ? "#3a8a5a" : available ? "#2a2d3a" : "#222"}`,
                borderRadius: "12px",
                padding: "1rem 1.2rem",
                cursor: voicesLoaded ? "pointer" : "default",
                transition: "all 0.15s",
                opacity: !voicesLoaded || !available ? 0.5 : 1,
              }}
            >
              <div style={{ fontSize: "1.8rem" }}>{opt.flag}</div>
              <div style={{ flex: 1, textAlign: "left" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <span style={{ fontWeight: 600, fontSize: "0.95rem", color: "#fff" }}>
                    {opt.label}
                  </span>
                  {voicesLoaded && (
                    <span
                      style={{
                        fontSize: "0.65rem",
                        padding: "0.15rem 0.5rem",
                        borderRadius: "99px",
                        background: available ? "#1a3a2a" : "#2a1a1a",
                        color: available ? "#4dbb7a" : "#884444",
                        fontWeight: 500,
                      }}
                    >
                      {available ? `✓ ${resolved!.name}` : "not on this device"}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: "0.78rem", color: "#666", marginTop: "0.15rem" }}>
                  {opt.description}
                </div>
              </div>
              <div
                style={{
                  width: "32px",
                  height: "32px",
                  borderRadius: "50%",
                  background: isPlaying ? "#3a8a5a" : "#252830",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "0.9rem",
                  flexShrink: 0,
                  transition: "background 0.15s",
                }}
              >
                {isPlaying ? "⏹" : "▶"}
              </div>
            </button>
          );
        })}
      </div>

      {!voicesLoaded && (
        <p style={{ fontSize: "0.8rem", color: "#555" }}>Loading voices…</p>
      )}

      <p style={{ fontSize: "0.72rem", color: "#444", textAlign: "center", maxWidth: "380px", lineHeight: 1.6 }}>
        Voice availability depends on your OS and browser. On macOS/iOS you'll have Tessa and Samantha. On Windows or Linux, you may only see the fallback voice.
      </p>
    </div>
  );
}
