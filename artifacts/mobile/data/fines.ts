export interface Fine {
  id: string;
  offence: string;
  amount: number;
  section: string;
  points?: number;
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

export const FINE_CATEGORIES: FineCategory[] = [
  {
    id: "speeding",
    title: "Speeding",
    fines: [
      { id: "f001", offence: "Exceeding limit by 1–10 km/h", amount: 5000, section: "Traffic Act S.5", points: 3 },
      { id: "f002", offence: "Exceeding limit by 11–20 km/h", amount: 10000, section: "Traffic Act S.5", points: 6 },
      { id: "f003", offence: "Exceeding limit by 21–30 km/h", amount: 20000, section: "Traffic Act S.5", points: 9 },
      { id: "f004", offence: "Exceeding limit by 31–50 km/h", amount: 30000, section: "Traffic Act S.5", points: 12 },
      { id: "f005", offence: "Exceeding limit by more than 50 km/h", amount: 50000, section: "Traffic Act S.5", points: 15 },
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

export const PAYMENT_METHODS: PaymentMethod[] = [
  {
    name: "eCitizen Portal",
    details: "Pay online via the official Kenya government platform",
    steps: [
      "Visit ecitizen.go.ke in your browser",
      "Log in or create a free account",
      'Select "NTSA" → "Traffic Fines"',
      "Enter your National ID or fine case number",
      "Choose payment method: M-Pesa, credit/debit card",
      "Complete payment and save the receipt",
    ],
  },
  {
    name: "M-Pesa Paybill",
    details: "Pay directly via M-Pesa — no internet needed",
    steps: [
      "Open M-Pesa on your phone",
      'Go to "Lipa Na M-Pesa" → "Pay Bill"',
      "Business Number: 222 222",
      "Account Number: Your National ID Number",
      "Enter the fine amount in Ksh",
      "Confirm with your M-Pesa PIN and save the SMS",
    ],
  },
  {
    name: "NTSA Office / Huduma Centre",
    details: "Pay in person at any NTSA office or Huduma Centre nationwide",
    steps: [
      "Visit the nearest NTSA office or Huduma Centre",
      "Carry your National ID and vehicle documents",
      "Present the fine notice or case number at the counter",
      "Pay cash or use mobile money at the counter",
      "Collect your official payment receipt",
    ],
  },
];

export const CONTEST_STEPS: string[] = [
  "Obtain a copy of the offence report from the issuing officer or NTSA",
  "File a Notice of Intention to Contest within 14 days of receiving the fine",
  "Appear at the relevant Traffic Court on the date specified",
  "Present your defence with supporting evidence (dashcam footage, witnesses)",
  "The Traffic Magistrate will determine the outcome",
  "If dismissed, collect an official clearance letter from the court",
  "If convicted, pay the determined penalty within the set timeframe",
];
