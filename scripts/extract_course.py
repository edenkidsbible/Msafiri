#!/usr/bin/env python3
"""
Extract structured course content from the Kenya Learner Driver Handbook PDF.
Outputs one JSON file per chapter + an index.json manifest to lib/db/src/data/course/
"""

import fitz  # PyMuPDF
import json
import re
import os

PDF_PATH = "attached_assets/0_KENYA-LEARNER-DRIVER-HANDBOOK-Light-Motor-Vehicle_1784300816964.pdf"
OUT_DIR = "lib/db/src/data/course"

# ---------------------------------------------------------------------------
# TOC — derived by inspection of page 4 (0-indexed: 3)
# Each tuple: (unit_number, title, start_page_1indexed, end_page_exclusive_1indexed)
# ---------------------------------------------------------------------------
CHAPTERS_TOC = [
    (0,  "Foreword",                           5,  6),
    (1,  "Introduction to Driving",             6,  9),
    (2,  "Fundamental Driving Rules",           7,  9),
    (3,  "Model Town",                          9,  14),
    (4,  "Human Factors in Traffic",           14,  21),
    (5,  "Vehicle Constructions and Controls",  21, 28),
    (6,  "Self-Inspection of Vehicle",          28, 31),
    (7,  "Observation",                         31, 33),
    (8,  "Vehicle Control",                     33, 38),
    (9,  "Communication on the Road",           38, 43),
    (10, "Speed Management",                    43, 46),
    (11, "Space Management",                    46, 48),
    (12, "Emergency Manoeuvres",                48, 50),
    (13, "Skid Control and Recovery",           50, 52),
    (14, "Adverse Driving Conditions",          52, 57),
    (15, "Preventive Maintenance",              57, 58),
    (16, "Conditions of Carriage",              58, 59),
    (17, "Hazardous Materials",                 59, 61),
    (18, "Emergency Procedures",               61,  66),
    (19, "Work Planning",                       66, 68),
    (20, "Customer Care",                       68, 71),
    (21, "The Examination",                     71, 72),
    (22, "Traffic Signs",                       72, 80),
    (23, "Model Town Illustrations",            80, 85),
]


def slugify(text):
    text = text.lower().strip()
    text = re.sub(r"[^\w\s-]", "", text)
    text = re.sub(r"[\s_-]+", "-", text)
    text = re.sub(r"^-+|-+$", "", text)
    return text[:80]


def classify_span(span):
    """Return (kind, text). Kinds: heading_lesson, heading_section, bullet_marker, body, image."""
    size = round(span["size"], 1)
    font = span["font"]
    text = span["text"].strip()
    if not text:
        return None, None
    # Size-11+ FuturaBT-Heavy = lesson-level heading (split on these)
    if font == "FuturaBT-Heavy" and size >= 10.5:
        return "heading_lesson", text
    # Size-10 FuturaBT-Heavy = chapter heading (skip — already handled by TOC)
    if font == "FuturaBT-Heavy" and size >= 9.5:
        return "heading_section", text
    # Bold text = sub-section callout within lesson
    if font in ("FuturaBT-Bold",) and size >= 9:
        return "heading_section", text
    # Bullet markers
    if text in ("•", "-", "–", "—"):
        return "bullet_marker", text
    return "body", text


def extract_page_spans(page):
    """Return list of (kind, text) from a page in reading order."""
    result = []
    blocks = page.get_text("dict", sort=True)["blocks"]
    for b in blocks:
        if b.get("type") != 0:
            result.append(("image", "[Figure/Diagram]"))
            continue
        for line in b.get("lines", []):
            for span in line.get("spans", []):
                kind, text = classify_span(span)
                if kind:
                    result.append((kind, text))
    return result


def spans_to_lesson_content(spans):
    """
    Convert a flat span list into structured content blocks for a single lesson.
    heading_section becomes a callout block.
    Bullet sequences become list blocks.
    """
    blocks = []
    current_list = []
    current_para = []
    bullet_pending = False

    def flush_para():
        nonlocal current_para
        if current_para:
            text = " ".join(current_para).strip()
            if text:
                blocks.append({"type": "paragraph", "text": text})
            current_para = []

    def flush_list():
        nonlocal current_list
        if current_list:
            blocks.append({"type": "list", "items": current_list[:]})
            current_list = []

    for kind, text in spans:
        # Skip bare page numbers
        if re.fullmatch(r"\d{1,3}", text):
            continue
        if kind == "heading_section":
            flush_para()
            flush_list()
            bullet_pending = False
            blocks.append({"type": "callout", "text": text})
        elif kind == "bullet_marker":
            flush_para()
            bullet_pending = True
        elif kind == "body":
            if bullet_pending:
                current_list.append(text)
                bullet_pending = False
            elif current_list:
                # Continuation of the last bullet item
                current_list[-1] = current_list[-1] + " " + text
            else:
                current_para.append(text)
        elif kind == "image":
            flush_para()
            flush_list()
            bullet_pending = False
            blocks.append({"type": "callout", "text": text})

    flush_para()
    flush_list()
    return blocks


def split_by_lesson_headings(all_spans, chapter_title):
    """
    Split flat spans into (lesson_title, [spans]) using heading_lesson markers.
    If no heading_lesson markers exist, treat the whole chapter as one lesson.
    Empty-body lessons are merged forward into the next lesson (the heading
    becomes a section callout in the following lesson's content).
    """
    raw = []
    current_title = None
    current_spans = []

    for kind, text in all_spans:
        if kind == "heading_lesson" and text:
            if current_spans or current_title:
                raw.append((current_title or chapter_title, current_spans))
            current_title = text
            current_spans = []
        else:
            current_spans.append((kind, text))

    # Final group
    if current_spans or current_title:
        raw.append((current_title or chapter_title, current_spans))

    if not raw:
        return [(chapter_title, all_spans)]

    # Merge empty-body lessons:
    #  - Forward pass: empty non-final lessons carry their heading into the next lesson.
    #  - Backward pass: an empty final lesson gets its heading absorbed into the previous one.
    merged = []
    pending_headings: list[str] = []

    for idx, (title, spans) in enumerate(raw):
        has_content = any(k in ("body", "bullet_marker", "image") for k, _ in spans)
        is_last = (idx == len(raw) - 1)

        if not has_content and not is_last:
            # Carry heading forward as a section marker in the next lesson
            pending_headings.append(title)
        else:
            injected = [("heading_section", h) for h in pending_headings]
            pending_headings = []
            merged.append((title, injected + spans))

    # Handle empty trailing lesson (forward pass left it intact because it was last)
    if merged and not any(k in ("body", "bullet_marker", "image") for k, _ in merged[-1][1]):
        empty_title, _ = merged.pop()
        if merged:
            prev_title, prev_spans = merged[-1]
            merged[-1] = (prev_title, prev_spans + [("heading_section", empty_title)])

    # If pending_headings still exist (all lessons were empty), collapse to one
    if pending_headings and merged:
        last_title, last_spans = merged[-1]
        merged[-1] = (last_title, last_spans + [("heading_section", h) for h in pending_headings])
    elif pending_headings:
        merged = [(pending_headings[0], [])]

    return merged if merged else [(chapter_title, all_spans)]


def estimate_minutes(blocks):
    words = sum(
        len(b["text"].split()) if b["type"] in ("paragraph", "callout") else
        sum(len(i.split()) for i in b["items"])
        for b in blocks
    )
    return max(1, round(words / 200))


def build_key_points(blocks, max_points=5):
    """Extract key sentences from content as key learning points."""
    key_points = []
    for b in blocks:
        if b["type"] == "paragraph":
            text = b["text"].strip()
            if len(text) > 40:
                sentences = re.split(r'(?<=[.!?])\s+', text)
                first = sentences[0].strip()
                if first and first not in key_points:
                    key_points.append(first)
        elif b["type"] == "list":
            for item in b["items"][:3]:
                if item and item not in key_points:
                    key_points.append(item)
        if len(key_points) >= max_points:
            break
    return key_points[:max_points] if key_points else [
        f"Review the {b['text'][:60] if blocks and blocks[0]['type']=='callout' else 'key'} concepts carefully."
    ]


# ---------------------------------------------------------------------------
# Curated quiz questions per unit — 5 per chapter
# ---------------------------------------------------------------------------
QUIZ_BANK = {
    0: [  # Foreword
        {"question": "What is the primary purpose of the Kenya Learner Driver Handbook?",
         "options": ["To replace the Traffic Act", "To serve as a guide for safe driving on Kenyan roads",
                     "To outline licensing officer procedures", "To provide a map of Kenyan roads"],
         "correctIndex": 1},
        {"question": "Who bears prime responsibility for your safety on the road?",
         "options": ["The police", "The traffic authority", "Yourself", "Your driving instructor"],
         "correctIndex": 2},
        {"question": "Which legislation should every road user read alongside this handbook?",
         "options": ["The Penal Code", "The Traffic Act and Highway Code", "The Finance Act", "The Environmental Act"],
         "correctIndex": 1},
        {"question": "When may you use your car horn while stationary?",
         "options": ["When another driver is at fault", "To alert pedestrians at a crossing",
                     "You may not use the horn when stationary", "Only in emergencies"],
         "correctIndex": 2},
        {"question": "Safe driving requires which key personal qualities?",
         "options": ["Speed and confidence", "Patience, courtesy, and responsibility",
                     "Aggression to assert rights", "Experience only"],
         "correctIndex": 1},
    ],
    1: [  # Introduction to Driving
        {"question": "What document must you carry at all times when driving in Kenya?",
         "options": ["Insurance certificate only", "A valid driving licence", "Logbook only", "National ID only"],
         "correctIndex": 1},
        {"question": "A defensive driver is best described as one who:",
         "options": ["Always drives at maximum speed", "Anticipates hazards and takes steps to avoid them",
                     "Follows other vehicles closely", "Only drives on familiar roads"],
         "correctIndex": 1},
        {"question": "Before starting a journey, a driver should first:",
         "options": ["Check fuel level only", "Perform a pre-drive inspection of the vehicle",
                     "Inform the traffic authority", "Check the weather forecast"],
         "correctIndex": 1},
        {"question": "The minimum age to apply for a Class B driving licence in Kenya is:",
         "options": ["16 years", "17 years", "18 years", "21 years"],
         "correctIndex": 2},
        {"question": "This handbook applies to which category of vehicle?",
         "options": ["Motorcycles", "Light motor vehicles", "Heavy trucks", "Buses only"],
         "correctIndex": 1},
    ],
    2: [  # Fundamental Driving Rules
        {"question": "In Kenya, vehicles drive on which side of the road?",
         "options": ["Left side", "Right side", "Centre", "Either side"],
         "correctIndex": 0},
        {"question": "Which vehicles must you always give right-of-way to?",
         "options": ["Buses and taxis", "Emergency vehicles sounding their sirens",
                     "Vehicles carrying heavy loads", "Vehicles with hazard lights on"],
         "correctIndex": 1},
        {"question": "Traffic signs shaped as triangles generally:",
         "options": ["Give information", "Give an order", "Warn of a hazard", "Mark a route"],
         "correctIndex": 2},
        {"question": "Circular traffic signs are used to:",
         "options": ["Warn", "Give an order", "Provide information", "Indicate distance"],
         "correctIndex": 1},
        {"question": "You should NOT use your horn:",
         "options": ["To warn road users of your presence", "When moving in traffic",
                     "Aggressively when other road users are at fault", "Before overtaking on a clear road"],
         "correctIndex": 2},
    ],
    3: [  # Model Town
        {"question": "What is the purpose of the model town in driver training?",
         "options": ["To simulate real traffic situations in a controlled environment",
                     "To test the vehicle's engine performance", "To practice parking only",
                     "To learn road sign colours"],
         "correctIndex": 0},
        {"question": "At a T-junction, which vehicle has right of way?",
         "options": ["The vehicle on the minor road", "The vehicle on the major road",
                     "The vehicle turning left", "The vehicle that arrives first"],
         "correctIndex": 1},
        {"question": "A zebra crossing is a designated area for:",
         "options": ["Cyclists", "Pedestrians", "Emergency vehicles", "Motorcyclists"],
         "correctIndex": 1},
        {"question": "When approaching a roundabout, you must give way to traffic:",
         "options": ["On your left", "On your right", "Already in the roundabout", "Coming from straight ahead"],
         "correctIndex": 2},
        {"question": "A continuous yellow centre line on the road means:",
         "options": ["Safe to overtake at any time", "Overtaking is prohibited",
                     "The road is one-way", "The road is a highway"],
         "correctIndex": 1},
    ],
    4: [  # Human Factors in Traffic
        {"question": "Which human factor most significantly impairs driving ability?",
         "options": ["Hunger", "Alcohol consumption", "Mild fatigue", "Listening to music"],
         "correctIndex": 1},
        {"question": "How does fatigue affect driving?",
         "options": ["It improves concentration", "It reduces reaction time and awareness",
                     "It has no effect on safe driving", "It makes drivers drive slower but safer"],
         "correctIndex": 1},
        {"question": "The legal Blood Alcohol Concentration (BAC) limit for drivers in Kenya is:",
         "options": ["0.08%", "0.05%", "0.10%", "0.00%"],
         "correctIndex": 0},
        {"question": "Which of the following is a sign of driver fatigue?",
         "options": ["Increased alertness", "Frequent yawning and heavy eyelids",
                     "Faster reaction times", "Improved night vision"],
         "correctIndex": 1},
        {"question": "Wearing a seatbelt is:",
         "options": ["Only a recommendation", "A legal requirement that saves lives",
                     "Only for front-seat passengers", "Only required on highways"],
         "correctIndex": 1},
    ],
    5: [  # Vehicle Constructions and Controls
        {"question": "What is the function of the steering wheel?",
         "options": ["To control engine speed", "To change direction or maintain a straight course",
                     "To operate the braking system", "To regulate the fuel supply"],
         "correctIndex": 1},
        {"question": "The clutch pedal is used to:",
         "options": ["Slow the vehicle down", "Increase engine speed",
                     "Engage and disengage the engine from the gearbox", "Control the air conditioning"],
         "correctIndex": 2},
        {"question": "The handbrake is primarily used to:",
         "options": ["Stop the vehicle quickly in an emergency", "Keep the vehicle stationary when parked",
                     "Slow down on steep descents", "Replace the footbrake"],
         "correctIndex": 1},
        {"question": "The oil pressure warning light indicates:",
         "options": ["Low engine oil pressure — stop and investigate", "Engine overheating",
                     "Low fuel level", "Brakes need servicing"],
         "correctIndex": 0},
        {"question": "Category B (light motor vehicles) have a maximum permissible mass of:",
         "options": ["1,500 kg", "2,500 kg", "3,500 kg", "5,000 kg"],
         "correctIndex": 2},
    ],
    6: [  # Self-Inspection of Vehicle
        {"question": "Which item should be checked BEFORE starting any journey?",
         "options": ["Tyre pressure and condition", "The radio channel",
                     "Seat cover cleanliness", "Dashboard light colours"],
         "correctIndex": 0},
        {"question": "Engine oil level should be checked:",
         "options": ["Only during annual service", "Regularly — ideally before long trips",
                     "Every 10,000 km", "Only when the warning light comes on"],
         "correctIndex": 1},
        {"question": "A reflector triangle must be placed:",
         "options": ["Inside the boot", "Behind the vehicle when broken down to warn drivers",
                     "On the dashboard when parking", "Only required for trucks"],
         "correctIndex": 1},
        {"question": "Worn brake pads typically produce:",
         "options": ["Engine overheating", "Unusual squealing or grinding noise when braking",
                     "Increased fuel consumption", "Steering wheel vibration"],
         "correctIndex": 1},
        {"question": "The minimum legal tyre tread depth is:",
         "options": ["0.5 mm", "1.0 mm", "1.6 mm", "3.0 mm"],
         "correctIndex": 2},
    ],
    7: [  # Observation
        {"question": "What is a vehicle's 'blind spot'?",
         "options": ["The area directly in front of the vehicle",
                     "An area around the vehicle not visible through mirrors",
                     "The area illuminated by headlights at night",
                     "The space behind the vehicle when reversing"],
         "correctIndex": 1},
        {"question": "Before changing lanes you should:",
         "options": ["Use mirrors only", "Check mirrors AND look over your shoulder to cover blind spots",
                     "Only use door mirrors", "Sound the horn and proceed"],
         "correctIndex": 1},
        {"question": "The MSM routine stands for:",
         "options": ["Mirror, Signal, Manoeuvre", "Move, Slow, Merge",
                     "Mirror, Speed, Manage", "Merge, Signal, Move"],
         "correctIndex": 0},
        {"question": "You should use your vehicle's mirrors:",
         "options": ["Only when overtaking", "Continuously and before every manoeuvre",
                     "Only when reversing", "Only when parking"],
         "correctIndex": 1},
        {"question": "Night driving visibility is mainly limited by:",
         "options": ["Wind speed", "The range of the headlights",
                     "Road surface condition", "Vehicle speed only"],
         "correctIndex": 1},
    ],
    8: [  # Vehicle Control
        {"question": "The correct technique for smooth braking is:",
         "options": ["Apply maximum force immediately", "Apply firm progressive pressure, ease off as vehicle slows",
                     "Pump brakes rapidly", "Use only the handbrake"],
         "correctIndex": 1},
        {"question": "When should you use the highest available gear?",
         "options": ["When driving slowly in traffic", "When cruising at steady speed to save fuel",
                     "When going downhill", "When the road is wet"],
         "correctIndex": 1},
        {"question": "A J-turn is best described as:",
         "options": ["A three-point turn at a junction",
                     "A reversing manoeuvre where the vehicle turns 180° then continues forward",
                     "An emergency stop technique", "A way to join a roundabout"],
         "correctIndex": 1},
        {"question": "'Coasting' (clutch depressed while moving) is dangerous because:",
         "options": ["It wears out the engine faster", "It reduces engine braking and overall vehicle control",
                     "It increases fuel consumption only", "It is only dangerous on motorways"],
         "correctIndex": 1},
        {"question": "Hill starts require balancing which two pedals?",
         "options": ["Accelerator and brake", "Clutch and brake",
                     "Clutch and accelerator", "Brake and handbrake"],
         "correctIndex": 2},
    ],
    9: [  # Communication on the Road
        {"question": "Which hand signal indicates an intention to turn left?",
         "options": ["Right arm extended horizontally", "Left arm extended horizontally",
                     "Left arm raised with elbow bent upward", "Right arm waved forward"],
         "correctIndex": 1},
        {"question": "Hazard lights should be used when:",
         "options": ["Driving in rain", "The vehicle is stationary and poses a hazard to others",
                     "You are late and driving fast", "Overtaking on a highway"],
         "correctIndex": 1},
        {"question": "Flashing headlights generally serve as:",
         "options": ["A greeting between drivers", "A warning or alert to other road users",
                     "Permission to overtake", "Confirmation the road ahead is clear"],
         "correctIndex": 1},
        {"question": "Dipped (low-beam) headlights should be used:",
         "options": ["Only in fog", "During bright daytime sunshine",
                     "At night or in poor visibility — especially when meeting oncoming traffic",
                     "Only on motorways"],
         "correctIndex": 2},
        {"question": "The primary purpose of a vehicle's horn is to:",
         "options": ["Express frustration at other drivers", "Warn other road users of your presence",
                     "Signal turns at intersections", "Alert passengers to board"],
         "correctIndex": 1},
    ],
    10: [  # Speed Management
        {"question": "The general urban speed limit in Kenya is:",
         "options": ["40 km/h", "50 km/h", "60 km/h", "80 km/h"],
         "correctIndex": 2},
        {"question": "Stopping distance increases when:",
         "options": ["Roads are dry and the vehicle is well maintained",
                     "Speed increases or the road surface is wet or slippery",
                     "It is daytime", "The vehicle is lightly loaded"],
         "correctIndex": 1},
        {"question": "'Thinking distance' in total stopping distance refers to:",
         "options": ["The distance covered while brakes are applied",
                     "The distance travelled while the driver perceives and reacts to a hazard",
                     "The gap between your vehicle and the car ahead",
                     "The minimum following distance on a highway"],
         "correctIndex": 1},
        {"question": "The 4-second rule is used to:",
         "options": ["Determine how long to signal before turning",
                     "Maintain a safe following distance from the vehicle ahead",
                     "Calculate a safe overtaking gap", "Judge a safe parking space"],
         "correctIndex": 1},
        {"question": "The maximum highway speed limit for light motor vehicles outside urban areas in Kenya is:",
         "options": ["80 km/h", "100 km/h", "110 km/h", "120 km/h"],
         "correctIndex": 1},
    ],
    11: [  # Space Management
        {"question": "The two-second (or four-second) following-distance rule helps you to:",
         "options": ["Determine how long to indicate before turning",
                     "Maintain a safe gap from the vehicle ahead",
                     "Calculate overtaking distance", "Judge a safe parking gap"],
         "correctIndex": 1},
        {"question": "On a wet road the recommended following distance should be:",
         "options": ["The same as on a dry road", "At least doubled compared to a dry road",
                     "Reduced to save time", "Eliminated if you have ABS"],
         "correctIndex": 1},
        {"question": "It is safe to overtake only when:",
         "options": ["You are confident you are faster", "The road ahead is clear and you have sufficient space",
                     "On blind corners if you drive quickly", "The vehicle ahead is slow"],
         "correctIndex": 1},
        {"question": "You must not overtake within how many metres of a pedestrian crossing?",
         "options": ["5 m", "10 m", "15 m", "30 m"],
         "correctIndex": 2},
        {"question": "Being in the correct 'see and be seen' position means:",
         "options": ["Driving in the centre of the road", "Positioning so you can see ahead and be visible to others",
                     "Using full headlights at all times", "Driving as close to the kerb as possible"],
         "correctIndex": 1},
    ],
    12: [  # Emergency Manoeuvres
        {"question": "When a tyre blows out at speed, you should first:",
         "options": ["Brake hard immediately", "Grip the wheel firmly, steer straight, then slow gradually",
                     "Swerve to the hard shoulder immediately", "Accelerate to maintain control"],
         "correctIndex": 1},
        {"question": "A three-point turn is performed when:",
         "options": ["You want to overtake", "You need to reverse direction in a narrow road",
                     "Parking in a bay", "Joining a motorway"],
         "correctIndex": 1},
        {"question": "Emergency braking on a vehicle without ABS should involve:",
         "options": ["Pressing the brake to the floor and holding",
                     "Threshold braking — firm pressure just before wheels lock, ease off slightly",
                     "Using only the handbrake", "Pumping the brake rapidly"],
         "correctIndex": 1},
        {"question": "A U-turn should only be performed when:",
         "options": ["You are in a hurry", "It is safe, legal, and you have sufficient space",
                     "Traffic is light at night", "Other road users signal you to do so"],
         "correctIndex": 1},
        {"question": "Defensive driving means:",
         "options": ["Driving very slowly at all times", "Anticipating and responding safely to hazards created by others",
                     "Using the horn frequently to warn others", "Always driving in the left lane"],
         "correctIndex": 1},
    ],
    13: [  # Skid Control and Recovery
        {"question": "The most common cause of skidding is:",
         "options": ["Strong crosswinds", "Driving too fast for road conditions",
                     "Overinflated tyres", "A full fuel tank"],
         "correctIndex": 1},
        {"question": "If your rear wheels skid to the right, you should steer:",
         "options": ["Hard left", "Right (into the direction of the skid)",
                     "Straight ahead and brake", "Left (into the skid)"],
         "correctIndex": 1},
        {"question": "Aquaplaning occurs when:",
         "options": ["The engine overheats", "A layer of water prevents tyre contact with the road",
                     "The road is covered with gravel", "Driving through fog"],
         "correctIndex": 1},
        {"question": "To recover from a skid you should:",
         "options": ["Apply maximum braking", "Steer in the direction you want to go and ease off the throttle",
                     "Turn the wheel sharply in the opposite direction", "Use the handbrake"],
         "correctIndex": 1},
        {"question": "A front-wheel skid is typically caused by:",
         "options": ["Too much acceleration", "Braking too hard causing the front wheels to lock",
                     "Steering too slowly", "Engine failure"],
         "correctIndex": 1},
    ],
    14: [  # Adverse Driving Conditions
        {"question": "When driving in heavy rain, you should:",
         "options": ["Increase speed to get through quickly", "Reduce speed and increase following distance",
                     "Drive with hazard lights on at all times", "Switch to high-beam headlights"],
         "correctIndex": 1},
        {"question": "When driving through flood water, you should:",
         "options": ["Accelerate to cross quickly", "Drive slowly and test brakes afterwards",
                     "Avoid it completely at all costs", "Use a high gear to stay smooth"],
         "correctIndex": 1},
        {"question": "In fog you should use:",
         "options": ["High-beam headlights", "Hazard lights only",
                     "Dipped headlights and fog lights if available",
                     "No lights — they reflect back and reduce visibility"],
         "correctIndex": 2},
        {"question": "Night driving is more dangerous primarily because:",
         "options": ["Roads are busier", "Visibility is reduced and hazards are harder to detect",
                     "Other drivers are more aggressive", "Speed limits are lower"],
         "correctIndex": 1},
        {"question": "On a loose gravel road you should:",
         "options": ["Accelerate hard to avoid sliding",
                     "Drive at reduced speed and avoid sudden steering or braking inputs",
                     "Use high gears to reduce wheel spin", "Inflate tyres to maximum pressure"],
         "correctIndex": 1},
    ],
    15: [  # Preventive Maintenance
        {"question": "Engine oil should typically be changed:",
         "options": ["Every 500 km", "As per the manufacturer's schedule — typically every 5,000–10,000 km",
                     "Every 50,000 km", "Only when the oil pressure light comes on"],
         "correctIndex": 1},
        {"question": "The temperature gauge rising into the red zone means:",
         "options": ["Normal operating condition", "The engine is overheating — stop safely and investigate",
                     "The air conditioning is working too hard", "The vehicle needs a gear change"],
         "correctIndex": 1},
        {"question": "A sign of a failing battery is:",
         "options": ["Engine runs roughly", "Difficulty starting, especially in cold weather",
                     "Excessive tyre wear", "High fuel consumption"],
         "correctIndex": 1},
        {"question": "Wheel alignment should be checked:",
         "options": ["Every 1,000 km regardless",
                     "After hitting a significant pothole or if the vehicle pulls to one side",
                     "Only at annual vehicle inspection", "Only after replacing the engine"],
         "correctIndex": 1},
        {"question": "The purpose of the vehicle's cooling system is to:",
         "options": ["Lubricate engine parts", "Maintain the engine at its optimal operating temperature",
                     "Filter fuel before combustion", "Power the air conditioning"],
         "correctIndex": 1},
    ],
    16: [  # Conditions of Carriage
        {"question": "It is illegal to carry passengers in a vehicle if:",
         "options": ["You have fewer than 5 passengers",
                     "The number of passengers exceeds the vehicle's licensed capacity",
                     "Passengers do not have identification", "The journey is under 5 km"],
         "correctIndex": 1},
        {"question": "All occupants of a vehicle must:",
         "options": ["Only sit in designated seating areas", "Wear seatbelts at all times",
                     "Hold onto a handle", "Remain silent to avoid distracting the driver"],
         "correctIndex": 1},
        {"question": "A load on a vehicle must be secured so that it:",
         "options": ["Hangs slightly over the sides for easy access",
                     "Does not fall, shift, or pose danger to other road users",
                     "Is covered only when travelling on highways",
                     "Weighs at least 100 kg for stability"],
         "correctIndex": 1},
        {"question": "Who is responsible for ensuring the vehicle is not overloaded?",
         "options": ["The vehicle owner only", "The traffic police",
                     "The driver of the vehicle", "The passengers collectively"],
         "correctIndex": 2},
        {"question": "Children must use an appropriate child restraint until approximately:",
         "options": ["3 years", "8 years", "10 years", "12 years"],
         "correctIndex": 1},
    ],
    17: [  # Hazardous Materials
        {"question": "Vehicles carrying hazardous materials must display:",
         "options": ["A red flag at the front", "Approved hazard warning placards or panels",
                     "A yellow roof light", "The driver's name on the windscreen"],
         "correctIndex": 1},
        {"question": "If you witness a vehicle leaking hazardous chemicals on the road, you should:",
         "options": ["Drive past quickly", "Keep a safe distance and call emergency services",
                     "Try to plug the leak yourself", "Park and direct traffic away"],
         "correctIndex": 1},
        {"question": "Hazardous materials are classified using:",
         "options": ["IATA codes", "UN hazard class numbers and labels",
                     "ISO 9001 standards", "Colour-coded stickers only"],
         "correctIndex": 1},
        {"question": "Smoking near a vehicle carrying flammable materials is:",
         "options": ["Permitted in open areas", "Strictly prohibited",
                     "Allowed if windows are open", "Only prohibited when refuelling"],
         "correctIndex": 1},
        {"question": "A driver transporting hazardous goods must carry:",
         "options": ["Extra fuel only",
                     "Emergency response documentation, appropriate PPE, and spill containment equipment",
                     "A fire extinguisher only", "A first aid kit only"],
         "correctIndex": 1},
    ],
    18: [  # Emergency Procedures
        {"question": "When approaching a road crash scene, the first action is to:",
         "options": ["Move injured people to the roadside immediately",
                     "Assess the scene for safety before approaching",
                     "Begin CPR on all casualties", "Take photos for insurance purposes"],
         "correctIndex": 1},
        {"question": "The emergency number to call after an accident in Kenya is:",
         "options": ["999", "112", "911", "0800"],
         "correctIndex": 1},
        {"question": "You should NOT move an injured crash victim unless:",
         "options": ["They are unconscious", "There is immediate danger such as fire or oncoming traffic",
                     "They are bleeding", "They ask you to"],
         "correctIndex": 1},
        {"question": "The recovery position is used for a casualty who is:",
         "options": ["Conscious and able to stand",
                     "Unconscious but breathing — to keep the airway clear",
                     "Suffering from a broken leg", "In cardiac arrest"],
         "correctIndex": 1},
        {"question": "Reflector triangles at a breakdown scene should be placed:",
         "options": ["Only in front of the vehicle",
                     "Behind and in front of the vehicle to warn approaching traffic",
                     "Inside the vehicle", "On the vehicle roof"],
         "correctIndex": 1},
    ],
    19: [  # Work Planning
        {"question": "Effective journey planning includes:",
         "options": ["Only checking fuel level",
                     "Planning the route, checking vehicle condition, weather, and rest stops",
                     "Loading the vehicle to maximum capacity",
                     "Departing at the earliest time regardless of conditions"],
         "correctIndex": 1},
        {"question": "Driver hours regulations exist primarily to:",
         "options": ["Increase productivity", "Prevent driver fatigue and reduce road accidents",
                     "Meet fuel efficiency targets", "Comply with vehicle warranty conditions"],
         "correctIndex": 1},
        {"question": "A professional driver should take a rest break:",
         "options": ["Only at the destination", "After every 2 hours of driving or when feeling fatigued",
                     "After every 8 hours regardless of how they feel", "Only if required by a passenger"],
         "correctIndex": 1},
        {"question": "Good vehicle trip documentation includes:",
         "options": ["Only the driver's name",
                     "Trip log recording mileage, stops, fuel, and any incidents",
                     "Passenger list only", "Weather conditions only"],
         "correctIndex": 1},
        {"question": "Planning rest stops on long journeys helps to:",
         "options": ["Increase overall journey time",
                     "Reduce fatigue and maintain alertness throughout the journey",
                     "Increase fuel consumption", "Satisfy vehicle insurance requirements"],
         "correctIndex": 1},
    ],
    20: [  # Customer Care
        {"question": "A professional driver's behaviour should reflect:",
         "options": ["Urgency to complete the journey as fast as possible",
                     "Courtesy, patience, and professionalism at all times",
                     "Prioritising their own comfort over passengers'",
                     "Ignoring passenger concerns"],
         "correctIndex": 1},
        {"question": "If a passenger makes an unreasonable demand, a driver should:",
         "options": ["Comply immediately to keep the peace",
                     "Calmly explain what is safe and legal, and decline if necessary",
                     "Ignore the passenger", "Stop the vehicle and ask them to leave immediately"],
         "correctIndex": 1},
        {"question": "Professional appearance and hygiene for a driver are important because:",
         "options": ["They are a legal requirement", "They project professionalism and comfort for passengers",
                     "They improve fuel efficiency", "They are only required for public transport drivers"],
         "correctIndex": 1},
        {"question": "Assisting passengers with disabilities means:",
         "options": ["Allowing them to board last", "Providing appropriate assistance ensuring their comfort and safety",
                     "Charging them extra", "Only assisting if asked twice"],
         "correctIndex": 1},
        {"question": "A driver should handle a customer complaint by:",
         "options": ["Arguing to defend their actions",
                     "Listening calmly, acknowledging the concern, and resolving it professionally",
                     "Ignoring it and driving on", "Stopping and refusing to continue"],
         "correctIndex": 1},
    ],
    21: [  # The Examination
        {"question": "The Kenya driving test consists of:",
         "options": ["A written theory test only",
                     "Theory test, eye test, and practical driving test",
                     "A practical driving test only",
                     "A medical examination and interview"],
         "correctIndex": 1},
        {"question": "Before the practical test the examiner will check:",
         "options": ["Your mobile phone contacts",
                     "Vehicle roadworthiness and your identification documents",
                     "Your insurance history", "Your vehicle purchase receipt"],
         "correctIndex": 1},
        {"question": "An immediate fail in the practical test is given for:",
         "options": ["Stalling the engine once",
                     "A dangerous fault causing actual or potential danger",
                     "Making a minor error at a junction", "Checking mirrors too frequently"],
         "correctIndex": 1},
        {"question": "During the driving test you should:",
         "options": ["Ignore uncertain road signs and continue",
                     "Apply what you know and drive safely throughout",
                     "Stop and ask the examiner for guidance", "Speed up to demonstrate confidence"],
         "correctIndex": 1},
        {"question": "After passing the driving test a new driver receives:",
         "options": ["A permanent licence immediately", "A learner's permit extension",
                     "A licence valid for the class of vehicle tested", "A digital certificate only"],
         "correctIndex": 2},
    ],
    22: [  # Traffic Signs
        {"question": "A red circle with a number (e.g. 50) on a road sign means:",
         "options": ["Minimum speed of 50 km/h", "Maximum speed limit of 50 km/h",
                     "Distance to next town is 50 km", "Road works ahead for 50 metres"],
         "correctIndex": 1},
        {"question": "A triangular sign with a red border warns of:",
         "options": ["An instruction you must follow", "A hazard or potential danger ahead",
                     "An information point", "A priority road"],
         "correctIndex": 1},
        {"question": "A blue rectangular sign typically provides:",
         "options": ["A mandatory instruction", "Useful information or directions",
                     "A warning", "A prohibition"],
         "correctIndex": 1},
        {"question": "The 'Give Way' sign requires you to:",
         "options": ["Stop completely and wait for a police officer",
                     "Give right of way to traffic on the major road before proceeding",
                     "Continue at normal speed", "Sound your horn and proceed"],
         "correctIndex": 1},
        {"question": "A pedestrian figure inside a triangle means:",
         "options": ["No pedestrians allowed", "Pedestrian crossing ahead — prepare to stop",
                     "School zone at all times", "Pedestrian-only road"],
         "correctIndex": 1},
    ],
    23: [  # Model Town Illustrations
        {"question": "A broken white centre line on the road means:",
         "options": ["Overtaking is prohibited", "You may cross to overtake if it is safe to do so",
                     "The road is one-way", "A bus lane boundary"],
         "correctIndex": 1},
        {"question": "When a level crossing has flashing lights you must:",
         "options": ["Slow down and proceed if no train is visible",
                     "Stop and wait until the lights stop and barriers open",
                     "Sound your horn and cross quickly", "Follow the vehicle in front"],
         "correctIndex": 1},
        {"question": "In the model town, a marked bus stop zone means:",
         "options": ["Temporary parking is allowed for drop-off",
                     "No private vehicles may park or stop in that zone",
                     "Drive at 20 km/h", "Give way to pedestrians only"],
         "correctIndex": 1},
        {"question": "At an unmarked intersection where two vehicles arrive simultaneously, right of way goes to:",
         "options": ["The larger vehicle", "The vehicle on the right",
                     "The faster vehicle", "The vehicle travelling uphill"],
         "correctIndex": 1},
        {"question": "Parking within 5 metres of a junction is:",
         "options": ["Allowed if hazard lights are on",
                     "Prohibited as it obstructs visibility and traffic flow",
                     "Permitted for less than 2 minutes", "Only prohibited on highways"],
         "correctIndex": 1},
    ],
}


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    doc = fitz.open(PDF_PATH)

    chapters_meta = []
    chapter_order = 0

    for (unit_num, chapter_title, start_page, end_page) in CHAPTERS_TOC:
        chapter_order += 1
        chapter_id = f"ch-{unit_num:02d}"
        chapter_slug = slugify(
            f"unit-{unit_num:02d}-{chapter_title}" if unit_num > 0 else chapter_title
        )

        print(f"Processing: Unit {unit_num} – {chapter_title} (pages {start_page}–{end_page-1})…")

        # Collect spans from all pages in this chapter's range.
        # Pre-filter bare page-number spans so they don't confuse the
        # empty-lesson detection in split_by_lesson_headings.
        all_spans = []
        for page_num in range(start_page - 1, min(end_page - 1, len(doc))):
            page = doc[page_num]
            for kind, text in extract_page_spans(page):
                if kind == "body" and re.fullmatch(r"\d{1,3}", text):
                    continue  # skip bare page numbers early
                all_spans.append((kind, text))

        # Split into lessons on size-11 headings only
        raw_lessons = split_by_lesson_headings(all_spans, chapter_title)

        # Distribute quiz questions across lessons
        quiz_pool = QUIZ_BANK.get(unit_num, [])
        n_lessons = len(raw_lessons)

        lessons_data = []
        lessons_meta = []

        for lesson_idx, (lesson_title, lesson_spans) in enumerate(raw_lessons):
            lesson_id = f"lesson-{unit_num:02d}-{lesson_idx+1:02d}"
            lesson_slug = slugify(f"{chapter_slug}-{lesson_title}")
            lesson_blocks = spans_to_lesson_content(lesson_spans)
            estimated_minutes = estimate_minutes(lesson_blocks)
            key_points = build_key_points(lesson_blocks)

            # Spread quiz questions across lessons
            qs_per_lesson = len(quiz_pool) // n_lessons if n_lessons > 0 else 0
            q_start = lesson_idx * qs_per_lesson
            q_end = q_start + qs_per_lesson if lesson_idx < n_lessons - 1 else len(quiz_pool)
            quiz = quiz_pool[q_start:q_end][:5]

            if not quiz:
                quiz = [{
                    "question": f"What is the main focus of this section on '{lesson_title}'?",
                    "options": [
                        "Vehicle maintenance procedures",
                        f"Understanding {chapter_title.lower()} concepts and safe practices",
                        "Traffic fine payment procedures",
                        "Vehicle registration requirements"
                    ],
                    "correctIndex": 1
                }]

            lesson_obj = {
                "id": lesson_id,
                "slug": lesson_slug,
                "chapterId": chapter_id,
                "title": lesson_title,
                "order": lesson_idx + 1,
                "estimatedMinutes": estimated_minutes,
                "content": lesson_blocks,
                "keyPoints": key_points,
                "quiz": quiz
            }
            lessons_data.append(lesson_obj)
            lessons_meta.append({
                "id": lesson_id,
                "slug": lesson_slug,
                "title": lesson_title,
                "order": lesson_idx + 1,
                "estimatedMinutes": estimated_minutes
            })

        # Write chapter JSON file
        chapter_filename = f"{unit_num:02d}-{slugify(chapter_title)}.json"
        chapter_obj = {
            "id": chapter_id,
            "slug": chapter_slug,
            "title": chapter_title,
            "unitNumber": unit_num,
            "order": chapter_order,
            "lessons": lessons_data
        }
        with open(os.path.join(OUT_DIR, chapter_filename), "w", encoding="utf-8") as f:
            json.dump(chapter_obj, f, indent=2, ensure_ascii=False)

        chapters_meta.append({
            "id": chapter_id,
            "slug": chapter_slug,
            "title": chapter_title,
            "unitNumber": unit_num,
            "order": chapter_order,
            "filename": chapter_filename,
            "lessons": lessons_meta
        })
        print(f"  → {chapter_filename}: {len(lessons_meta)} lesson(s)")

    # Write index.json
    total_lessons = sum(len(c["lessons"]) for c in chapters_meta)
    index_obj = {
        "version": "1.0.0",
        "source": "Kenya Learner Driver Handbook (Light Motor Vehicle)",
        "generatedAt": "2026-07-17",
        "totalChapters": len(chapters_meta),
        "totalLessons": total_lessons,
        "chapters": chapters_meta
    }
    with open(os.path.join(OUT_DIR, "index.json"), "w", encoding="utf-8") as f:
        json.dump(index_obj, f, indent=2, ensure_ascii=False)

    print(f"\n✓ Done: {len(chapters_meta)} chapters, {total_lessons} lessons")


if __name__ == "__main__":
    main()
