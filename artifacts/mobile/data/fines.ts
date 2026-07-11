export interface Fine {
  id: string;
  offence: string;
  amount: number;
  section: string;
  points?: number;
  note?: string;
  isWarning?: boolean;
  isCourt?: boolean;
}

export interface FineCategory {
  id: string;
  title: string;
  fines: Fine[];
}

export interface PaymentMethod {
  name: string;
  details: string;
  steps: string[];
}

export interface EnforcementStep {
  icon: string;
  title: string;
  detail: string;
}

export const FINE_CATEGORIES: FineCategory[] = [
  {
    id: "speeding",
    title: "Speeding",
    fines: [
      {
        id: "f001",
        offence: "Exceeding limit by 1–10 km/h",
        amount: 10000,
        section: "Traffic Act / NTSA 2025 Schedule",
        points: 0,
        note: "Instant fine of KSH 10,000. Warning logged on your TIMS / Aviator record. Pay within 7 days at a KCB branch or authorized KCB agent.",
      },
      {
        id: "f002",
        offence: "Exceeding limit by 11–20 km/h",
        amount: 20000,
        section: "Traffic Act / NTSA 2025 Schedule",
        points: 3,
        note: "Instant fine of KSH 20,000 + 3 demerit points on licence. Pay within 7 days or dispute at Traffic Court.",
      },
      {
        id: "f003",
        offence: "Exceeding limit by 21–30 km/h",
        amount: 30000,
        section: "Traffic Act / NTSA 2025 Schedule",
        points: 6,
        note: "Instant fine of KSH 30,000 + 6 demerit points on licence. Pay within 7 days or dispute at Traffic Court.",
      },
      {
        id: "f004",
        offence: "Exceeding limit by 31 km/h or more",
        amount: 30000,
        section: "Traffic Act / NTSA 2025 Schedule",
        isCourt: true,
        note: "KSH 30,000 fine + mandatory court appearance. Risk of licence suspension and vehicle impoundment.",
      },
      {
        id: "f005",
        offence: "Speeding in a school zone",
        amount: 30000,
        section: "Traffic Act / NTSA 2025 Schedule",
        isCourt: true,
        note: "Minimum KSH 30,000 + mandatory court appearance. School zones (within 300 m of a gazetted school) carry the strictest penalties.",
      },
      {
        id: "f005b",
        offence: "Speeding causing an accident",
        amount: 0,
        section: "Traffic Act S.44A",
        isCourt: true,
        note: "Penalty determined by court. Criminal charges possible. Applies regardless of the speed bracket.",
      },
      {
        id: "f005c",
        offence: "Refusing to stop at a camera checkpoint",
        amount: 20000,
        section: "Traffic Act / NTSA 2025 Schedule",
        note: "KSH 20,000 fine + immediate arrest. Officers are authorised to pursue and detain.",
      },
    ],
  },
  {
    id: "documents",
    title: "Documents",
    fines: [
      { id: "f006", offence: "Driving without valid driving licence", amount: 20000, section: "Traffic Act S.7" },
      { id: "f007", offence: "Driving without valid insurance", amount: 50000, section: "Traffic Act S.10" },
      { id: "f008", offence: "Expired vehicle inspection sticker", amount: 20000, section: "Traffic Act S.17" },
      { id: "f009", offence: "Driving without logbook / registration", amount: 10000, section: "Traffic Act S.12" },
      { id: "f010", offence: "Expired road licence (road tax)", amount: 10000, section: "Traffic Act S.13" },
    ],
  },
  {
    id: "traffic",
    title: "Traffic",
    fines: [
      { id: "f011", offence: "Jumping red light / signal violation", amount: 10000, section: "Traffic Act S.45" },
      { id: "f012", offence: "Failure to wear seat belt", amount: 2000, section: "Traffic Act S.42" },
      { id: "f013", offence: "Using mobile phone while driving", amount: 10000, section: "Traffic Act S.44" },
      { id: "f014", offence: "Dangerous / reckless driving", amount: 30000, section: "Traffic Act S.44A" },
      { id: "f015", offence: "Drunk driving (DUI)", amount: 50000, section: "Traffic Act S.44" },
      { id: "f016", offence: "Driving against traffic (wrong side)", amount: 10000, section: "Traffic Act S.45" },
      { id: "f017", offence: "Illegal U-turn", amount: 5000, section: "Traffic Act S.45" },
      { id: "f018", offence: "Overloading passengers or goods", amount: 20000, section: "Traffic Act S.56" },
      { id: "f019", offence: "Failure to give way to emergency vehicle", amount: 5000, section: "Traffic Act S.48" },
    ],
  },
  {
    id: "parking",
    title: "Parking",
    fines: [
      { id: "f020", offence: "Parking in a no-parking zone", amount: 2000, section: "Traffic Act S.60" },
      { id: "f021", offence: "Obstruction of road or traffic", amount: 5000, section: "Traffic Act S.61" },
      { id: "f022", offence: "Defective brakes or lights", amount: 5000, section: "Traffic Act S.62" },
    ],
  },
];

export const ENFORCEMENT_STEPS: EnforcementStep[] = [
  {
    icon: "camera-outline",
    title: "Automated Detection",
    detail: "Smart roadside cameras photograph your vehicle's number plate and record the exact speed violation.",
  },
  {
    icon: "phone-portrait-outline",
    title: "Digital Alert via TIMS",
    detail: "NTSA matches the plate to the TIMS / Aviator registry and sends a Police Notification of Traffic Offence by SMS or email.",
  },
  {
    icon: "checkmark-circle-outline",
    title: "7-Day Resolution Window",
    detail: "You have 7 days to either admit liability and pay electronically, or dispute the allegation to be heard in Traffic Court.",
  },
  {
    icon: "alert-circle-outline",
    title: "Demerit Points",
    detail: "Unpaid or recurrent speeding offences accumulate demerit points on your licence, eventually triggering automatic suspension.",
  },
];

export const PAYMENT_METHODS: PaymentMethod[] = [
  {
    name: "KCB Bank Branches",
    details: "Pay directly at any Kenya Commercial Bank (KCB) branch",
    steps: [
      "Wait for the official NTSA notification (SMS or email) with your offence and payment reference details",
      "Visit any KCB branch nationwide",
      "Present the payment reference and amount from the NTSA notification",
      "Pay the fine in cash or via your KCB account at the counter",
      "Collect your official payment receipt as proof of payment",
    ],
  },
  {
    name: "Authorized KCB Agents",
    details: "Pay through approved KCB banking agents using the details in your NTSA notification",
    steps: [
      "Locate an authorized KCB banking agent near you",
      "Provide the payment reference and amount from your NTSA notification",
      "Confirm the agent is an official KCB agent before paying",
      "Complete the payment and keep the agent's receipt/confirmation",
    ],
  },
];

export const CONTEST_STEPS: string[] = [
  "Obtain a copy of the offence report from the issuing officer or NTSA",
  "File a Notice of Intention to Contest within 7 days of receiving the fine",
  "Appear at the relevant Traffic Court on the date specified",
  "Present your defence with supporting evidence (dashcam footage, witnesses)",
  "The Traffic Magistrate will determine the outcome",
  "If dismissed, collect an official clearance letter from the court",
  "If convicted, pay the determined penalty within the set timeframe",
];
