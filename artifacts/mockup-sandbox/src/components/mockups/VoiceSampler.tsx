import { useEffect, useState, useRef } from "react";

const SAMPLES = [
  "In 300 metres, turn left onto Uhuru Highway.",
  "Speed camera ahead. Reduce your speed.",
  "Police checkpoint ahead.",
  "You have arrived at your destination.",
  "In 500 metres, at the roundabout, take the 2nd exit onto Mombasa Road.",
];

type VoiceEntry = {
  id: string;
  label: string;
  flag: string;
  accent: string;
  lang: string;
  /** Matches against voice.name (case-insensitive substring) */
  nameHints: string[];
  /** Fallback: match by lang prefix if no nameHint matches */
  langPrefix: string;
};

const IOS_VOICES: VoiceEntry[] = [
  {
    id: "daniel",
    label: "Daniel",
    flag: "🇬🇧",
    accent: "British English",
    lang: "en-GB",
    nameHints: ["daniel"],
    langPrefix: "en-GB",
  },
  {
    id: "samantha",
    label: "Samantha",
    flag: "🇺🇸",
    accent: "American English",
    lang: "en-US",
    nameHints: ["samantha"],
    langPrefix: "en-US",
  },
  {
    id: "tessa",
    label: "Tessa",
    flag: "🇿🇦",
    accent: "South African English",
    lang: "en-ZA",
    nameHints: ["tessa"],
    langPrefix: "en-ZA",
  },
  {
    id: "karen",
    label: "Karen",
    flag: "🇦🇺",
    accent: "Australian English",
    lang: "en-AU",
    nameHints: ["karen"],
    langPrefix: "en-AU",
  },
  {
    id: "veena",
    label: "Veena",
    flag: "🇮🇳",
    accent: "Indian English",
    lang: "en-IN",
    nameHints: ["veena"],
    langPrefix: "en-IN",
  },
];

const ANDROID_VOICES: VoiceEntry[] = [
  {
    id: "android-us-female",
    label: "Google US English",
    flag: "🇺🇸",
    accent: "American English",
    lang: "en-US",
    nameHints: ["google us english", "google english us"],
    langPrefix: "en-US",
  },
  {
    id: "android-gb-female",
    label: "Google UK English Female",
    flag: "🇬🇧",
    accent: "British English — Female",
    lang: "en-GB",
    nameHints: ["google uk english female", "en-gb-x-gbb", "en-gb-x-gbd"],
    langPrefix: "en-GB",
  },
  {
    id: "android-gb-male",
    label: "Google UK English Male",
    flag: "🇬🇧",
    accent: "British English — Male",
    lang: "en-GB",
    nameHints: ["google uk english male", "en-gb-x-gbm", "en-gb-x-gbc"],
    langPrefix: "en-GB",
  },
  {
    id: "android-au",
    label: "Google Australian English",
    flag: "🇦🇺",
    accent: "Australian English",
    lang: "en-AU",
    nameHints: ["google australian", "en-au"],
    langPrefix: "en-AU",
  },
  {
    id: "android-in",
    label: "Google Indian English",
    flag: "🇮🇳",
    accent: "Indian English",
    lang: "en-IN",
    nameHints: ["google indian", "en-in"],
    langPrefix: "en-IN",
  },
  {
    id: "android-za",
    label: "Google South African English",
    flag: "🇿🇦",
    accent: "South African English",
    lang: "en-ZA",
    nameHints: ["south african", "en-za"],
    langPrefix: "en-ZA",
  },
];

function resolveVoice(entry: VoiceEntry, voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  // Try exact name match first
  for (const hint of entry.nameHints) {
    const v = voices.find((v) => v.name.toLowerCase().includes(hint));
    if (v) return v;
  }
  // Fallback: enhanced/premium by lang
  const enhanced = voices.find(
    (v) => v.lang.startsWith(entry.langPrefix) && v.name.toLowerCase().includes("enhanced"),
  );
  if (enhanced) return enhanced;
  // Fallback: any by lang
  return voices.find((v) => v.lang.startsWith(entry.langPrefix)) ?? null;
}

function VoiceButton({
  entry,
  voices,
  speaking,
  onPlay,
  onStop,
}: {
  entry: VoiceEntry;
  voices: SpeechSynthesisVoice[];
  speaking: string | null;
  onPlay: (entry: VoiceEntry) => void;
  onStop: () => void;
}) {
  const resolved = resolveVoice(entry, voices);
  const available = resolved !== null;
  const isPlaying = speaking === entry.id;

  return (
    <button
      onClick={() => (isPlaying ? onStop() : onPlay(entry))}
      disabled={!available}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.85rem",
        background: isPlaying ? "#1a2e1f" : "#161820",
        border: `1px solid ${isPlaying ? "#3d7a52" : available ? "#242630" : "#1a1c22"}`,
        borderRadius: "10px",
        padding: "0.85rem 1rem",
        cursor: available ? "pointer" : "default",
        transition: "border-color 0.15s, background 0.15s",
        opacity: available ? 1 : 0.38,
        width: "100%",
        textAlign: "left",
      }}
    >
      <span style={{ fontSize: "1.5rem", flexShrink: 0 }}>{entry.flag}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.45rem", flexWrap: "wrap" }}>
          <span style={{ fontWeight: 600, fontSize: "0.9rem", color: "#e8e8e8" }}>
            {entry.label}
          </span>
          <span
            style={{
              fontSize: "0.62rem",
              padding: "0.1rem 0.45rem",
              borderRadius: "99px",
              background: available ? "#16291e" : "#1f1618",
              color: available ? "#4db87a" : "#7a4040",
              fontWeight: 600,
              letterSpacing: "0.02em",
              flexShrink: 0,
            }}
          >
            {available ? `✓ ${resolved!.name.slice(0, 28)}` : "not installed"}
          </span>
        </div>
        <div style={{ fontSize: "0.75rem", color: "#555", marginTop: "0.1rem" }}>
          {entry.accent}
        </div>
      </div>
      <div
        style={{
          width: "30px",
          height: "30px",
          borderRadius: "50%",
          background: isPlaying ? "#2d6640" : "#1e2028",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "0.75rem",
          flexShrink: 0,
          transition: "background 0.15s",
          color: isPlaying ? "#6ddda0" : "#555",
        }}
      >
        {isPlaying ? "⏹" : "▶"}
      </div>
    </button>
  );
}

export default function VoiceSampler() {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [currentSample, setCurrentSample] = useState(0);
  const [speaking, setSpeaking] = useState<string | null>(null);
  const [tab, setTab] = useState<"ios" | "android">("ios");

  useEffect(() => {
    function load() {
      const v = window.speechSynthesis.getVoices();
      if (v.length > 0) { setVoices(v); setLoaded(true); }
    }
    load();
    window.speechSynthesis.onvoiceschanged = load;
    return () => { window.speechSynthesis.onvoiceschanged = null; };
  }, []);

  function play(entry: VoiceEntry) {
    window.speechSynthesis.cancel();
    setSpeaking(null);
    const voice = resolveVoice(entry, voices);
    if (!voice) return;
    const utt = new SpeechSynthesisUtterance(SAMPLES[currentSample]);
    utt.voice = voice;
    utt.rate = 0.95;
    utt.onstart = () => setSpeaking(entry.id);
    utt.onend = () => setSpeaking(null);
    utt.onerror = () => setSpeaking(null);
    window.speechSynthesis.speak(utt);
  }

  function stop() {
    window.speechSynthesis.cancel();
    setSpeaking(null);
  }

  const activeVoices = tab === "ios" ? IOS_VOICES : ANDROID_VOICES;

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0d0f14",
        color: "#e0e0e0",
        fontFamily: "'Inter', system-ui, sans-serif",
        display: "flex",
        flexDirection: "column",
        padding: "1.5rem 1.25rem",
        gap: "1.25rem",
        maxWidth: "520px",
        margin: "0 auto",
      }}
    >
      {/* Header */}
      <div>
        <h1 style={{ fontSize: "1.15rem", fontWeight: 700, margin: 0, color: "#fff" }}>
          🔊 Navigation Voice Sampler
        </h1>
        <p style={{ margin: "0.3rem 0 0", fontSize: "0.78rem", color: "#555", lineHeight: 1.4 }}>
          Your browser's actual speech engine — exactly what the app sounds like
        </p>
      </div>

      {/* Sample picker */}
      <div>
        <p style={{ margin: "0 0 0.5rem", fontSize: "0.68rem", color: "#444", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 600 }}>
          Phrase to test
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
          {SAMPLES.map((s, i) => (
            <button
              key={i}
              onClick={() => setCurrentSample(i)}
              style={{
                background: currentSample === i ? "#1c2540" : "transparent",
                border: `1px solid ${currentSample === i ? "#3d5cb8" : "#1e2028"}`,
                borderRadius: "7px",
                padding: "0.5rem 0.75rem",
                color: currentSample === i ? "#8eaaff" : "#555",
                fontSize: "0.78rem",
                cursor: "pointer",
                textAlign: "left",
                transition: "all 0.12s",
              }}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Platform tabs */}
      <div style={{ display: "flex", gap: "0.4rem" }}>
        {(["ios", "android"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              flex: 1,
              padding: "0.5rem",
              borderRadius: "8px",
              border: `1px solid ${tab === t ? "#3d5cb8" : "#1e2028"}`,
              background: tab === t ? "#1c2540" : "transparent",
              color: tab === t ? "#8eaaff" : "#444",
              fontWeight: 600,
              fontSize: "0.82rem",
              cursor: "pointer",
              transition: "all 0.12s",
            }}
          >
            {t === "ios" ? "🍎 iOS" : "🤖 Android"}
          </button>
        ))}
      </div>

      {/* Voice list */}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        {loaded ? (
          activeVoices.map((entry) => (
            <VoiceButton
              key={entry.id}
              entry={entry}
              voices={voices}
              speaking={speaking}
              onPlay={play}
              onStop={stop}
            />
          ))
        ) : (
          <p style={{ color: "#333", fontSize: "0.8rem" }}>Loading voices…</p>
        )}
      </div>

      <p style={{ fontSize: "0.68rem", color: "#333", lineHeight: 1.6, marginTop: "auto", paddingTop: "0.5rem" }}>
        {tab === "ios"
          ? "iOS voices depend on which language packs are installed in Settings → Accessibility → Spoken Content."
          : "Android voices depend on the Google TTS engine version installed. Not all voices appear in-browser — they may still be available in the app."}
      </p>
    </div>
  );
}
