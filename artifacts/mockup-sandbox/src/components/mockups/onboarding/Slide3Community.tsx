import { Users } from "lucide-react";
import iconPng from "/icon.png";

const ACCENT = "#006B3C";
const ACCENT_LIGHT = "#006B3C15";

const INCIDENTS = [
  { emoji: "📷", label: "Speed Camera", color: "#BB0000" },
  { emoji: "👮", label: "Police",        color: "#1565C0" },
  { emoji: "🍺", label: "Alcoblow",      color: "#E65100" },
  { emoji: "💥", label: "Accident",      color: "#C62828" },
  { emoji: "🚧", label: "Roadblock",     color: "#F57C00" },
  { emoji: "🚦", label: "Traffic Jam",   color: "#006B3C" },
];

export function Slide3Community() {
  return (
    <div className="w-[390px] h-[844px] bg-white flex flex-col overflow-hidden select-none">
      {/* Status bar */}
      <div className="flex justify-between items-center px-6 pt-4 pb-1">
        <span className="text-[13px] font-bold text-gray-900">9:41</span>
        <div className="flex items-center gap-1">
          <div className="flex gap-[3px] items-end h-3">
            {[3,5,7,9].map(h => <div key={h} style={{height: h}} className="w-[3px] bg-gray-800 rounded-sm" />)}
          </div>
          <svg width="16" height="12" viewBox="0 0 16 12" fill="none">
            <path d="M8 2.5C10.2 2.5 12.2 3.4 13.6 4.9L15 3.4C13.2 1.5 10.7 0.4 8 0.4C5.3 0.4 2.8 1.5 1 3.4L2.4 4.9C3.8 3.4 5.8 2.5 8 2.5Z" fill="#1a1a1a"/>
            <path d="M8 5.5C9.4 5.5 10.7 6.1 11.6 7L13 5.5C11.7 4.1 9.9 3.2 8 3.2C6.1 3.2 4.3 4.1 3 5.5L4.4 7C5.3 6.1 6.6 5.5 8 5.5Z" fill="#1a1a1a"/>
            <circle cx="8" cy="10" r="1.5" fill="#1a1a1a"/>
          </svg>
          <div className="text-[11px] font-semibold text-gray-800">84%</div>
        </div>
      </div>

      {/* Brand header */}
      <div className="flex items-center justify-between px-5 py-2">
        <div className="flex items-center gap-2">
          <img src={iconPng} className="w-8 h-8 rounded-xl object-cover" alt="Msafiri Kenya" />
          <span className="text-[15px] font-bold text-gray-900 tracking-tight">
            Msafiri <span style={{ color: "#BB0000" }}>Kenya</span>
          </span>
        </div>
        <span className="text-[13px] text-gray-400 font-medium">Skip</span>
      </div>
      <div className="mx-5 h-px bg-gray-100" />

      {/* Accent label */}
      <div className="px-5 pt-4 flex">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border" style={{ backgroundColor: ACCENT_LIGHT, borderColor: ACCENT + "44" }}>
          <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: ACCENT }} />
          <span className="text-[11px] font-bold tracking-widest uppercase" style={{ color: ACCENT }}>Community Map</span>
        </div>
      </div>

      {/* Hero icon */}
      <div className="flex justify-center pt-5">
        <div className="w-28 h-28 rounded-[32px] flex items-center justify-center shadow-sm" style={{ backgroundColor: ACCENT_LIGHT }}>
          <Users size={58} color={ACCENT} strokeWidth={1.5} />
        </div>
      </div>

      {/* Incident grid */}
      <div className="grid grid-cols-3 gap-3 px-5 pt-5">
        {INCIDENTS.map((inc, i) => (
          <div key={i} className="rounded-2xl p-3 flex flex-col items-center gap-1.5 border" style={{ backgroundColor: inc.color + "0D", borderColor: inc.color + "33" }}>
            <span className="text-2xl">{inc.emoji}</span>
            <span className="text-[11px] font-bold text-center leading-tight" style={{ color: inc.color }}>{inc.label}</span>
          </div>
        ))}
      </div>

      {/* Text content */}
      <div className="px-5 pt-5 flex-1 flex flex-col justify-end pb-6">
        <h1 className="text-[26px] font-black leading-[1.15] tracking-tight mb-3">
          <span style={{ color: ACCENT }}>Kenyan Drivers</span>{"\n"}
          <span className="text-gray-900">Are Watching for You</span>
        </h1>
        <p className="text-[14px] text-gray-500 leading-relaxed mb-6">
          Police checkpoints, alcoblows, accidents, and road works — all reported live by drivers just like you.
        </p>
        <div className="flex items-center gap-2 justify-center mb-5">
          {[0,1].map(i => <div key={i} className="h-2 w-2 rounded-full bg-gray-200" />)}
          <div className="h-2 w-7 rounded-full" style={{ backgroundColor: ACCENT }} />
          {[0,1].map(i => <div key={i} className="h-2 w-2 rounded-full bg-gray-200" />)}
        </div>
        <button className="w-full py-4 rounded-2xl font-bold text-white text-[16px] flex items-center justify-center gap-2 shadow-lg" style={{ backgroundColor: ACCENT, boxShadow: `0 8px 24px ${ACCENT}44` }}>
          Next
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
        </button>
      </div>
    </div>
  );
}
