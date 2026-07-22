import { Car, Bike, Bus, Truck, CheckCircle2 } from "lucide-react";
import iconPng from "/icon.png";

const ACCENT = "#BB0000";
const ACCENT_LIGHT = "#BB000015";

const VEHICLES = [
  { icon: <Car size={26} />, label: "Car / SUV", limit: "110 km/h" },
  { icon: <Bike size={26} />, label: "Motorbike", limit: "80 km/h" },
  { icon: <Bus size={26} />, label: "Matatu / PSV", limit: "80 km/h" },
  { icon: <Truck size={26} />, label: "Truck", limit: "80 km/h" },
  { icon: <Bus size={26} />, label: "Bus", limit: "80 km/h" },
  { icon: <Car size={26} />, label: "Tuk-tuk", limit: "50 km/h" },
];

export function Slide5Vehicle() {
  const selected = 0;

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
      <div className="flex items-center px-5 py-2">
        <div className="flex-1" />
        <div className="flex items-center gap-2">
          <img src={iconPng} className="w-8 h-8 rounded-xl object-cover" alt="Msafiri Kenya" />
          <span className="text-[15px] font-bold text-gray-900 tracking-tight">
            Msafiri <span style={{ color: "#BB0000" }}>Kenya</span>
          </span>
        </div>
        <div className="flex-1 flex justify-end">
          <span className="text-[13px] text-gray-400 font-medium">Skip</span>
        </div>
      </div>
      <div className="mx-5 h-px bg-gray-100" />

      {/* Accent label */}
      <div className="px-5 pt-4 flex justify-center">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border" style={{ backgroundColor: ACCENT_LIGHT, borderColor: ACCENT + "44" }}>
          <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: ACCENT }} />
          <span className="text-[11px] font-bold tracking-widest uppercase" style={{ color: ACCENT }}>Your Vehicle</span>
        </div>
      </div>

      {/* Hero icon */}
      <div className="flex justify-center pt-4">
        <div className="relative w-28 h-28 rounded-[32px] flex items-center justify-center shadow-sm" style={{ backgroundColor: ACCENT_LIGHT }}>
          <Car size={58} color={ACCENT} strokeWidth={1.5} />
          <div className="absolute -top-2 -right-2 w-8 h-8 rounded-full flex items-center justify-center shadow-md border-2 border-white" style={{ backgroundColor: ACCENT }}>
            <CheckCircle2 size={16} color="white" strokeWidth={2.5} />
          </div>
        </div>
      </div>

      {/* Vehicle grid */}
      <div className="grid grid-cols-3 gap-3 px-5 pt-4">
        {VEHICLES.map((v, i) => {
          const isSel = i === selected;
          return (
            <div key={i} className="rounded-2xl p-3 flex flex-col items-center gap-1 border transition-all"
              style={{
                backgroundColor: isSel ? ACCENT + "12" : "#F8F8F8",
                borderColor:     isSel ? ACCENT + "88" : "#E8E8E8",
                borderWidth:     isSel ? 2 : 1,
              }}>
              <span style={{ color: isSel ? ACCENT : "#777" }}>{v.icon}</span>
              <span className="text-[11px] font-bold text-center leading-tight" style={{ color: isSel ? ACCENT : "#333" }}>{v.label}</span>
              <span className="text-[10px] text-center leading-tight" style={{ color: isSel ? ACCENT + "BB" : "#AAA" }}>{v.limit}</span>
            </div>
          );
        })}
      </div>

      {/* Text content */}
      <div className="flex flex-col flex-1 px-5 pt-4 pb-6">
        <h1 className="text-[22px] font-black leading-tight tracking-tight mb-2 text-center">
          <span style={{ color: ACCENT }}>Your Vehicle,</span>{"\n"}
          <span className="text-gray-900">Your Speed Limit</span>
        </h1>
        <p className="text-[13px] text-gray-500 leading-relaxed text-center">
          Speed limits vary by vehicle class in Kenya. Set yours once and we always show the right limit.
        </p>
        <div className="mt-auto">
          <div className="flex items-center gap-2 justify-center mb-4">
            {[0,1,2,3].map(i => <div key={i} className="h-2 w-2 rounded-full bg-gray-200" />)}
            <div className="h-2 w-7 rounded-full" style={{ backgroundColor: ACCENT }} />
          </div>
          <button className="w-full py-4 rounded-2xl font-bold text-white text-[16px] flex items-center justify-center gap-2 shadow-lg" style={{ backgroundColor: ACCENT, boxShadow: `0 8px 24px ${ACCENT}44` }}>
            Get Started
            <CheckCircle2 size={20} color="white" strokeWidth={2.5} />
          </button>
        </div>
      </div>
    </div>
  );
}
