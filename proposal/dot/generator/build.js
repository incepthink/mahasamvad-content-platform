const pptxgen = require("pptxgenjs");
const { C, F, titleSlide, sectionSlide, contentSlide, card, numberedCircle, statBlock, footnote } = require("./lib");

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE"; // 13.3 x 7.5
pres.author = "Incepthink LLP";
pres.title = "Maharashtra Tourism — AI Travel Platform";

/* ───────────────────────── 1. Title ───────────────────────── */
{
  const s = titleSlide(pres, {
    eyebrow: "INCEPTHINK LLP  ·  FOR THE DIRECTORATE OF TOURISM, GOVERNMENT OF MAHARASHTRA",
    title: "One app for the\nMaharashtra visitor",
    sub: "Plan the trip. Pay for every ticket once. Ask anything, and get today's answer —\neven where there is no network.",
    footer: "September 2026",
  });
  s.addNotes(
    "0:00–0:30. Open flat, no warm-up. 'We are going to talk about one visitor, one Sunday, " +
    "and what the state currently does to them. Then what we would build.' Do not read the slide."
  );
}

/* ───────────────────────── 2. Their own words ───────────────────────── */
{
  const s = contentSlide(pres, "The department has already named the direction");
  card(pres, s, { x: 0.7, y: 1.55, w: 12.0, h: 2.35, fill: C.card });
  s.addText('"Technology and AI are helping us bring these experiences closer to travellers through personalised travel planning, seamless digital access, and immersive storytelling."', {
    x: 1.15, y: 1.85, w: 11.1, h: 1.5, isTextBox: true, margin: 0,
    fontFace: F.head, fontSize: 21, italic: true, color: C.ink, lineSpacing: 32,
  });
  s.addText("Chandrashekhar Jaiswal, General Manager, Department of Tourism, Government of Maharashtra\nImagiNxt 2026, Jio World Convention Centre, Mumbai — 22 May 2026", {
    x: 1.15, y: 3.32, w: 11.1, h: 0.55, isTextBox: true, margin: 0,
    fontFace: F.body, fontSize: 12, color: C.muted, lineSpacing: 16,
  });

  const items = [
    ["Personalised travel planning", "An itinerary built around who the visitor actually is"],
    ["Seamless digital access", "One payment for a trip that today needs three counters"],
    ["Immersive storytelling", "Every site explained, in the visitor's own language"],
  ];
  items.forEach(([h, d], i) => {
    const x = 0.7 + i * 4.07;
    numberedCircle(pres, s, { x, y: 4.35, d: 0.5, n: i + 1 });
    s.addText(h, {
      x: x + 0.68, y: 4.38, w: 3.2, h: 0.45, isTextBox: true, margin: 0,
      fontFace: F.body, fontSize: 14.5, bold: true, color: C.ink,
    });
    s.addText(d, {
      x, y: 4.88, w: 3.75, h: 1.0, isTextBox: true, margin: 0,
      fontFace: F.body, fontSize: 13, color: C.ink2, lineSpacing: 19,
    });
  });
  s.addText("This deck is the third phrase made real — and the first two made possible.", {
    x: 0.7, y: 6.2, w: 12.0, h: 0.4, isTextBox: true, margin: 0,
    fontFace: F.body, fontSize: 14, bold: true, color: C.lat,
  });
  s.addNotes(
    "0:30–1:10. Read the quote out loud — it is theirs, not ours. Then: 'We are not here to " +
    "propose a direction. You have set one. We are here with what it takes to deliver it.' " +
    "Pause on the three phrases; they map exactly onto what follows."
  );
}

/* ───────────────────────── 3. The position ───────────────────────── */
{
  const s = contentSlide(pres, "Maharashtra has the most to gain — and the most to lose");
  const stats = [
    ["3.71 M", "Foreign tourist visits, 2024 —\nrank 1 in India, ~17.7% of all FTVs", C.lat, 38],
    ["₹1 lakh cr", "Private investment targeted\nunder Tourism Policy 2024", C.sea, 28],
    ["18 lakh", "Direct and indirect jobs\ntargeted over the decade", C.sea, 38],
    ["12 forts", "Maratha Military Landscapes,\nUNESCO World Heritage, July 2025", C.lat, 33],
  ];
  stats.forEach(([v, l, col, fs], i) => {
    const x = 0.7 + i * 3.1;
    card(pres, s, { x, y: 1.75, w: 2.85, h: 2.2 });
    statBlock(s, { x: x + 0.28, y: 2.0, w: 2.35, value: v, label: l, color: col, fontSize: fs });
  });

  card(pres, s, { x: 0.7, y: 4.35, w: 12.0, h: 1.85, fill: C.ink });
  s.addText("Every one of those numbers depends on the visitor having a good day.", {
    x: 1.15, y: 4.65, w: 11.1, h: 0.5, isTextBox: true, margin: 0,
    fontFace: F.head, fontSize: 22, bold: true, color: C.white,
  });
  s.addText("A UNESCO inscription brings people who have never been to India before. Today the state has no way to plan their day, no way to take their money at the gate, and no way to answer a question they ask on the spot.", {
    x: 1.15, y: 5.25, w: 11.1, h: 0.8, isTextBox: true, margin: 0,
    fontFace: F.body, fontSize: 14, color: C.onDark, lineSpacing: 21,
  });
  footnote(s, "Sources: Ministry of Tourism, India Tourism Data Compendium 2025 (66th edn) · Maharashtra Tourism Policy 2024 · UNESCO World Heritage List entry 1739.");
  s.addNotes(
    "1:10–1:35. Fast. These are their own numbers, quoted back. The point is the dark box: " +
    "scale is already there, experience is not. Do not linger — the next slide is the argument."
  );
}

/* ───────────────────────── 4. Kanheri ───────────────────────── */
{
  const s = contentSlide(pres, "One visitor, one Sunday: Kanheri Caves");
  card(pres, s, { x: 0.7, y: 1.4, w: 12.0, h: 3.5, fill: C.card });

  const steps = [
    ["Arrives", "Sanjay Gandhi National Park, Borivali. Buys a park entry ticket at the gate."],
    ["Travels 6 km", "The caves are six kilometres inside the park. Pays again — shuttle bus or vehicle entry."],
    ["Climbs", "Reaches the Kanheri ticket counter at the top. A third ticket is required, to a different department."],
    ["Turns back", "No mobile network at the counter. Card and UPI fail. No cash on hand. The visit ends here."],
  ];
  steps.forEach(([h, d], i) => {
    const x = 0.95 + i * 2.95;
    numberedCircle(pres, s, { x, y: 1.75, d: 0.55, n: i + 1, color: i === 3 ? C.lat : C.ink2 });
    s.addText(h, {
      x, y: 2.45, w: 2.6, h: 0.4, isTextBox: true, margin: 0,
      fontFace: F.head, fontSize: 17, bold: true, color: i === 3 ? C.lat : C.ink,
    });
    s.addText(d, {
      x, y: 2.9, w: 2.62, h: 1.7, isTextBox: true, margin: 0,
      fontFace: F.body, fontSize: 12.5, color: C.ink2, lineSpacing: 19,
    });
  });

  s.addText("Three separate tickets, sold at three separate points, by three separate authorities — Forest Department, park operations, and the Archaeological Survey of India. The last one stands in a place with no signal.", {
    x: 0.7, y: 5.15, w: 12.0, h: 0.85, isTextBox: true, margin: 0,
    fontFace: F.body, fontSize: 15.5, color: C.ink, lineSpacing: 23,
  });
  s.addText("The visitor did nothing wrong. The system had no way to tell them.", {
    x: 0.7, y: 6.1, w: 12.0, h: 0.45, isTextBox: true, margin: 0,
    fontFace: F.head, fontSize: 19, bold: true, color: C.lat,
  });
  footnote(s, "Kanheri Caves sits ~6 km inside SGNP; the cave ticket is an ASI centrally-protected-monument ticket, separate from park entry. Connectivity at the counter observed on site; fare amounts vary across published accounts and are being confirmed.");
  s.addNotes(
    "1:35–2:30. THIS IS THE SLIDE. Tell it as a story, slowly, in the first person if you can — " +
    "'I have watched this happen.' Land hard on step 4 and then stop talking for two seconds. " +
    "Everyone in that room has either had this day or heard about it. Do not defend the fare " +
    "figures if challenged — say the structure is the point and we are confirming amounts with SGNP and ASI."
  );
}

/* ───────────────────────── 5. What it shows ───────────────────────── */
{
  const s = contentSlide(pres, "What that morning actually shows");
  const rows = [
    ["No one told them", "Nothing in any state channel warns a visitor that Kanheri needs a second ticket, or what it costs, before they leave home."],
    ["No single payment", "Three authorities, three tills. The state cannot sell a visit to its own monument in one transaction."],
    ["No offline path", "Digital payment is assumed to work everywhere. At the places worth visiting, it often doesn't."],
    ["No one finds out", "The visitor turns around and the department never learns it happened. There is no record of a lost visit."],
  ];
  rows.forEach(([h, d], i) => {
    const y = 1.75 + i * 1.26;
    card(pres, s, { x: 0.7, y, w: 12.0, h: 1.08 });
    numberedCircle(pres, s, { x: 0.98, y: y + 0.27, d: 0.55, n: i + 1 });
    s.addText(h, {
      x: 1.75, y: y + 0.16, w: 3.0, h: 0.4, isTextBox: true, margin: 0,
      fontFace: F.head, fontSize: 17, bold: true, color: C.ink,
    });
    s.addText(d, {
      x: 1.75, y: y + 0.56, w: 10.6, h: 0.45, isTextBox: true, margin: 0,
      fontFace: F.body, fontSize: 13, color: C.ink2,
    });
  });
  s.addText("The fourth is the one that compounds. Everything else can be fixed once you can see it.", {
    x: 0.7, y: 6.9, w: 12.0, h: 0.4, isTextBox: true, margin: 0,
    fontFace: F.body, fontSize: 13.5, italic: true, color: C.muted,
  });
  s.addNotes(
    "2:30–3:05. Don't read all four. Say 1 and 2 quickly, spend your time on 4 — the department " +
    "has no instrument that registers a failed visit. If an officer pushes back on any of 1–3, " +
    "concede fast and return to 4; it is the unarguable one."
  );
}

/* ───────────────────────── 6. Not the exception ───────────────────────── */
{
  const s = contentSlide(pres, "Kanheri is not the exception. It is the pattern.");
  const cols = [
    ["Forts", "27 forts listed by the department, 12 now UNESCO-inscribed. Hilltop sites, thin signal, seasonal restrictions issued locally and never reaching the visitor."],
    ["Waterfalls and monsoon sites", "Access restrictions ordered district by district after the 2024 Lonavala deaths. A visitor planning from Mumbai has no way to know today's order."],
    ["Caves and monuments", "8 cave sites. ASI ticketing sits on a separate national system from anything the state runs."],
    ["Beaches, temples, agro-tourism", "18 beaches, 43 temples, and a registered agro-tourism network — each with its own gate, its own till, its own rules."],
  ];
  cols.forEach(([h, d], i) => {
    const x = 0.7 + (i % 2) * 6.15;
    const y = 1.75 + Math.floor(i / 2) * 2.25;
    card(pres, s, { x, y, w: 5.85, h: 2.05 });
    s.addText(h, {
      x: x + 0.35, y: y + 0.28, w: 5.15, h: 0.45, isTextBox: true, margin: 0,
      fontFace: F.head, fontSize: 19, bold: true, color: C.lat,
    });
    s.addText(d, {
      x: x + 0.35, y: y + 0.82, w: 5.15, h: 1.05, isTextBox: true, margin: 0,
      fontFace: F.body, fontSize: 13, color: C.ink2, lineSpacing: 19,
    });
  });
  s.addText("36 districts. Hundreds of gates. Not one of them shares a queue, a till, or a sentence of advice with another.", {
    x: 0.7, y: 6.35, w: 12.0, h: 0.5, isTextBox: true, margin: 0,
    fontFace: F.head, fontSize: 17, bold: true, color: C.ink,
  });
  s.addNotes(
    "3:05–3:30. Purpose of this slide is scale — Kanheri was not a one-off anecdote. " +
    "Move through it briskly, one line per quadrant. Land the closing sentence."
  );
}

/* ───────────────────────── 7. What we propose ───────────────────────── */
{
  const s = sectionSlide(pres, {
    title: "What we propose",
    sub: "One website and one mobile app for the Maharashtra visitor — carrying four capabilities that only the state can offer.",
  });
  s.addNotes("3:30–3:40. Transition. Say the sentence and move on.");
}

{
  const s = contentSlide(pres, "One app. Four things it does.");
  const caps = [
    ["Plans", "The visitor tells it who they are — days, budget, who's travelling, what they can walk. It returns a real itinerary across the state's own sites."],
    ["Pays", "Every ticket on that itinerary, bought once, in one transaction — and it works when the network doesn't."],
    ["Promotes", "The department steers demand with price: quiet days, quiet districts, the behaviour it wants to reward."],
    ["Answers", "An assistant that knows today: what's open, what's crowded, what's restricted, what a ticket costs, in the visitor's language."],
  ];
  caps.forEach(([h, d], i) => {
    const x = 0.7 + i * 3.1;
    card(pres, s, { x, y: 1.8, w: 2.85, h: 3.5, fill: i === 1 ? C.ink : C.card });
    const fg = i === 1 ? C.white : C.ink;
    const bg = i === 1 ? C.onDark : C.ink2;
    numberedCircle(pres, s, { x: x + 0.3, y: 2.12, d: 0.58, n: i + 1, color: i === 1 ? C.lat : C.ink2 });
    s.addText(h, {
      x: x + 0.3, y: 2.85, w: 2.3, h: 0.5, isTextBox: true, margin: 0,
      fontFace: F.head, fontSize: 23, bold: true, color: fg,
    });
    s.addText(d, {
      x: x + 0.3, y: 3.42, w: 2.3, h: 1.7, isTextBox: true, margin: 0,
      fontFace: F.body, fontSize: 12, color: bg, lineSpacing: 18,
    });
  });
  s.addText("Built on the department's own content, its own registered operators, and its own ticketing — not scraped from the internet.", {
    x: 0.7, y: 5.6, w: 12.0, h: 0.5, isTextBox: true, margin: 0,
    fontFace: F.body, fontSize: 15, color: C.ink, lineSpacing: 22,
  });
  s.addText("That last line is what makes it the state's product and nobody else's.", {
    x: 0.7, y: 6.2, w: 12.0, h: 0.45, isTextBox: true, margin: 0,
    fontFace: F.head, fontSize: 17, bold: true, color: C.lat,
  });
  s.addNotes(
    "3:40–4:00. Four words: plans, pays, promotes, answers. Say them and let the slide do the " +
    "rest. Flag the last line — you will return to it on the 'why not a chatbot' slide."
  );
}

/* ───────────────────────── 8. Capability 1 ───────────────────────── */
{
  const s = contentSlide(pres, "Plans — around the visitor, not around a brochure");
  card(pres, s, { x: 0.7, y: 1.5, w: 5.6, h: 4.1, fill: C.card });
  s.addText("What it asks", {
    x: 1.05, y: 1.8, w: 4.9, h: 0.4, isTextBox: true, margin: 0,
    fontFace: F.head, fontSize: 19, bold: true, color: C.lat,
  });
  s.addText([
    { text: "How many days, and from where", options: { bullet: true, breakLine: true } },
    { text: "Who is travelling — children, elders, mobility needs", options: { bullet: true, breakLine: true } },
    { text: "Budget, and appetite for walking or climbing", options: { bullet: true, breakLine: true } },
    { text: "Interests — forts, coast, wildlife, temples, food", options: { bullet: true, breakLine: true } },
    { text: "Language they want to be spoken to in", options: { bullet: true } },
  ], {
    x: 1.05, y: 2.3, w: 4.9, h: 3.1, isTextBox: true, margin: 0,
    fontFace: F.body, fontSize: 14, color: C.ink2, paraSpaceAfter: 14,
  });

  card(pres, s, { x: 6.8, y: 1.5, w: 5.9, h: 4.1, fill: C.ink });
  s.addText("What it returns", {
    x: 7.15, y: 1.8, w: 5.2, h: 0.4, isTextBox: true, margin: 0,
    fontFace: F.head, fontSize: 19, bold: true, color: C.white,
  });
  s.addText([
    { text: "A day-by-day plan across the department's own sites", options: { bullet: true, breakLine: true } },
    { text: "Every ticket the trip needs, priced and listed up front", options: { bullet: true, breakLine: true } },
    { text: "Travel time and the last entry hour for each gate", options: { bullet: true, breakLine: true } },
    { text: "Stays and guides drawn only from registered operators", options: { bullet: true, breakLine: true } },
    { text: "Warnings — restrictions, closures, monsoon orders", options: { bullet: true } },
  ], {
    x: 7.15, y: 2.3, w: 5.2, h: 3.1, isTextBox: true, margin: 0,
    fontFace: F.body, fontSize: 14, color: C.onDark, paraSpaceAfter: 14,
  });
  s.addText("A visitor who knows Kanheri needs a second ticket, before they leave Borivali, does not turn back.", {
    x: 0.7, y: 6.25, w: 12.0, h: 0.5, isTextBox: true, margin: 0,
    fontFace: F.head, fontSize: 17, bold: true, color: C.lat,
  });
  s.addNotes(
    "4:00–4:40. Two columns: what it asks, what it gives. The fifth item on the right — warnings — " +
    "is the one that matters to the department politically. Close by tying back to Kanheri."
  );
}

/* ───────────────────────── 9. Capability 2 ───────────────────────── */
{
  const s = contentSlide(pres, "Pays — one transaction for a trip with many gates");
  card(pres, s, { x: 0.7, y: 1.5, w: 12.0, h: 1.55, fill: C.card });
  s.addText("Today", {
    x: 1.05, y: 1.72, w: 1.5, h: 0.35, isTextBox: true, margin: 0,
    fontFace: F.body, fontSize: 12, bold: true, color: C.muted, charSpacing: 1.5,
  });
  s.addText("Park gate  →  shuttle counter  →  monument counter  →  guide  →  parking", {
    x: 1.05, y: 2.1, w: 11.3, h: 0.5, isTextBox: true, margin: 0,
    fontFace: F.head, fontSize: 20, color: C.ink2,
  });
  s.addText("Five payments, five queues, five authorities, cash at the ones that matter most.", {
    x: 1.05, y: 2.6, w: 11.3, h: 0.35, isTextBox: true, margin: 0,
    fontFace: F.body, fontSize: 12.5, color: C.muted,
  });

  card(pres, s, { x: 0.7, y: 3.25, w: 12.0, h: 1.75, fill: C.ink });
  s.addText("With the app", {
    x: 1.05, y: 3.48, w: 2.5, h: 0.35, isTextBox: true, margin: 0,
    fontFace: F.body, fontSize: 12, bold: true, color: C.lat, charSpacing: 1.5,
  });
  s.addText("One payment  →  one QR pass  →  every gate on the itinerary", {
    x: 1.05, y: 3.88, w: 11.3, h: 0.5, isTextBox: true, margin: 0,
    fontFace: F.head, fontSize: 22, bold: true, color: C.white,
  });
  s.addText("Settlement is split behind the scenes and routed to each authority — Forest Department, ASI, MTDC, the registered operator. The visitor never sees the seam.", {
    x: 1.05, y: 4.4, w: 11.3, h: 0.5, isTextBox: true, margin: 0,
    fontFace: F.body, fontSize: 13, color: C.onDark,
  });

  const notes = [
    ["Revenue the state can see", "Every ticket sold through the app is a recorded, reconciled transaction — not a paper stub in a cash box."],
    ["Capacity becomes controllable", "Once tickets are issued in advance, a site can be capped, timed, or priced by slot. That is the whole of crowd management."],
  ];
  notes.forEach(([h, d], i) => {
    const x = 0.7 + i * 6.15;
    s.addText(h, {
      x, y: 5.3, w: 5.8, h: 0.4, isTextBox: true, margin: 0,
      fontFace: F.head, fontSize: 16, bold: true, color: C.lat,
    });
    s.addText(d, {
      x, y: 5.75, w: 5.8, h: 0.9, isTextBox: true, margin: 0,
      fontFace: F.body, fontSize: 13, color: C.ink2, lineSpacing: 19,
    });
  });
  footnote(s, "ASI has offered online ticketing for 170+ centrally-protected monuments, and opened it on the ONDC network in January 2026 — an integration path already exists.");
  s.addNotes(
    "4:40–5:20. Before/after is the whole slide. The two notes at the bottom are for the officer " +
    "who is thinking about money and about Lonavala — pre-issued tickets are how you cap a site. " +
    "The ASI/ONDC footnote answers 'can you even integrate with ASI' before it is asked."
  );
}

/* ───────────────────────── 10b. Promotes ───────────────────────── */
{
  const s = contentSlide(pres, "Promotes — price becomes an instrument, not just a rate");
  s.addText("Once the state issues the ticket, the state sets the offer. That is a policy lever the department has never had.", {
    x: 0.7, y: 1.28, w: 12.0, h: 0.45, isTextBox: true, margin: 0,
    fontFace: F.body, fontSize: 15, italic: true, color: C.muted,
  });

  const levers = [
    ["Fill the empty days", "Weekday, off-season and monsoon pricing. The same site, the same staff, a quieter day made worth visiting."],
    ["Spread the map", "Bundles and lower rates at the districts that see nobody. The itinerary engine promotes them; the price makes them move."],
    ["Reward the right behaviour", "Multi-site passes, longer stays, bookings through registered operators only. Youth, student and senior rates the policy already contemplates."],
  ];
  levers.forEach(([h, d], i) => {
    const x = 0.7 + i * 4.07;
    card(pres, s, { x, y: 1.85, w: 3.85, h: 2.5 });
    numberedCircle(pres, s, { x: x + 0.35, y: 2.15, d: 0.5, n: i + 1 });
    s.addText(h, {
      x: x + 0.35, y: 2.8, w: 3.2, h: 0.42, isTextBox: true, margin: 0,
      fontFace: F.head, fontSize: 17, bold: true, color: C.ink,
    });
    s.addText(d, {
      x: x + 0.35, y: 3.25, w: 3.2, h: 1.0, isTextBox: true, margin: 0,
      fontFace: F.body, fontSize: 12.5, color: C.ink2, lineSpacing: 18,
    });
  });

  card(pres, s, { x: 0.7, y: 4.6, w: 12.0, h: 1.58, fill: C.ink });
  s.addText("And for the first time, a campaign can be proved.", {
    x: 1.05, y: 4.82, w: 11.3, h: 0.45, isTextBox: true, margin: 0,
    fontFace: F.head, fontSize: 20, bold: true, color: C.white,
  });
  s.addText("An offer issued in the app is traceable end to end — impressions, itineraries built, tickets sold, revenue collected, districts visited. Today the department buys campaigns on a monthly retainer and measures them on reports. This measures them on visits.", {
    x: 1.05, y: 5.32, w: 11.3, h: 0.75, isTextBox: true, margin: 0,
    fontFace: F.body, fontSize: 13, color: C.onDark, lineSpacing: 19,
  });
  s.addText("The department decides every rate and every offer. The platform executes policy — it does not set price.", {
    x: 0.7, y: 6.33, w: 12.0, h: 0.45, isTextBox: true, margin: 0,
    fontFace: F.head, fontSize: 15.5, bold: true, color: C.lat,
  });
  footnote(s, "Discounting on tickets belonging to other authorities — ASI, Forest Department — requires each authority's own sanction. On departmental and MTDC inventory the decision sits with the department.");
  s.addNotes(
    "5:20–6:00. Do not call these 'discounts' in the room — call them demand management. " +
    "Lever 2 is the one that matters to them: the whole policy problem is that everyone goes to " +
    "six places. The dark bar answers the marketing budget question — they currently cannot prove " +
    "a campaign worked. Close on the last line before anyone worries we are setting government prices."
  );
}

/* ───────────────────────── 10. Capability 3 ───────────────────────── */
{
  const s = contentSlide(pres, "Answers — an assistant that knows today");
  s.addText("The difference between a travel chatbot and a state system is the word 'today'.", {
    x: 0.7, y: 1.3, w: 12.0, h: 0.45, isTextBox: true, margin: 0,
    fontFace: F.body, fontSize: 15, italic: true, color: C.muted,
  });

  const qas = [
    ['"Is the Kanheri counter taking cards today?"', "Answered from the gate's own status, not from a web page written three years ago."],
    ['"Is Bhushi Dam safe this Sunday?"', "Answered from the collector's live order and the site's own booking load."],
    ['"Which homestay near Malvan has a valid fire certificate?"', "Answered from the department's registration records — the only place that fact exists."],
    ['"Explain this cave to me in French."', "Answered from the department's own approved interpretation, translated, not invented."],
  ];
  qas.forEach(([q, a], i) => {
    const y = 1.95 + i * 1.13;
    card(pres, s, { x: 0.7, y, w: 12.0, h: 0.98 });
    s.addText(q, {
      x: 1.05, y: y + 0.13, w: 11.3, h: 0.38, isTextBox: true, margin: 0,
      fontFace: F.head, fontSize: 16, bold: true, color: C.ink,
    });
    s.addText(a, {
      x: 1.05, y: y + 0.53, w: 11.3, h: 0.35, isTextBox: true, margin: 0,
      fontFace: F.body, fontSize: 12.5, color: C.ink2,
    });
  });
  s.addText("Not one of these four questions can be answered by a general AI assistant. All four can be answered by the department.", {
    x: 0.7, y: 6.6, w: 12.0, h: 0.5, isTextBox: true, margin: 0,
    fontFace: F.head, fontSize: 17, bold: true, color: C.lat,
  });
  s.addNotes(
    "6:00–6:40. Read two of the four aloud, not all four. This slide is the answer to the " +
    "question every officer is silently asking — 'why not just use ChatGPT'. Do not say that " +
    "phrase yourself yet; the next slide names it."
  );
}

/* ───────────────────────── 11. Offline ───────────────────────── */
{
  const s = contentSlide(pres, "It has to work where the network doesn't");
  card(pres, s, { x: 0.7, y: 1.5, w: 12.0, h: 1.3, fill: C.ink });
  s.addText("The places worth visiting are the places with no signal. A system that assumes connectivity fails exactly where tourism happens.", {
    x: 1.05, y: 1.75, w: 11.3, h: 0.85, isTextBox: true, margin: 0,
    fontFace: F.head, fontSize: 19, color: C.white, lineSpacing: 27,
  });

  const mech = [
    ["Tickets issued before departure", "The pass is bought and downloaded while the visitor still has signal. Nothing has to be purchased at the gate."],
    ["The pass validates offline", "A signed QR code the gate can verify on a handheld device with no connection. It syncs when signal returns."],
    ["The guide works offline", "Maps, site interpretation, timings and safety notes for the planned itinerary are cached on the phone."],
    ["The gate reconciles later", "Scans queue locally and upload when the device reaches coverage. The count is never lost."],
  ];
  mech.forEach(([h, d], i) => {
    const x = 0.7 + (i % 2) * 6.15;
    const y = 3.05 + Math.floor(i / 2) * 1.75;
    card(pres, s, { x, y, w: 5.85, h: 1.55 });
    numberedCircle(pres, s, { x: x + 0.3, y: y + 0.28, d: 0.48, n: i + 1 });
    s.addText(h, {
      x: x + 0.92, y: y + 0.28, w: 4.6, h: 0.42, isTextBox: true, margin: 0,
      fontFace: F.head, fontSize: 15.5, bold: true, color: C.ink,
    });
    s.addText(d, {
      x: x + 0.92, y: y + 0.72, w: 4.6, h: 0.72, isTextBox: true, margin: 0,
      fontFace: F.body, fontSize: 12, color: C.ink2, lineSpacing: 17,
    });
  });
  s.addText("Our visitor buys the Kanheri ticket in Borivali — and walks straight in at the top.", {
    x: 0.7, y: 6.6, w: 12.0, h: 0.5, isTextBox: true, margin: 0,
    fontFace: F.head, fontSize: 17, bold: true, color: C.lat,
  });
  s.addNotes(
    "6:40–7:20. This is the engineering credibility slide — it shows we have thought past the demo. " +
    "If asked about handhelds at gates, say the pass verifies on any Android phone and we would " +
    "confirm device availability site by site. Close on the Kanheri callback."
  );
}

/* ───────────────────────── 12. Why not a chatbot ───────────────────────── */
{
  const s = contentSlide(pres, "Why this cannot be done with a general AI assistant");
  s.addText("A general model knows everything published on the internet. It knows nothing about today, here, officially.", {
    x: 0.7, y: 1.3, w: 12.0, h: 0.5, isTextBox: true, margin: 0,
    fontFace: F.body, fontSize: 15, italic: true, color: C.muted,
  });

  // two-column comparison
  const colX = [0.7, 6.85];
  const heads = ["A general assistant", "The department's platform"];
  const fills = [C.card, C.ink];
  heads.forEach((h, i) => {
    card(pres, s, { x: colX[i], y: 1.95, w: 5.75, h: 3.85, fill: fills[i] });
    s.addText(h, {
      x: colX[i] + 0.35, y: 2.2, w: 5.05, h: 0.45, isTextBox: true, margin: 0,
      fontFace: F.head, fontSize: 19, bold: true, color: i === 0 ? C.ink2 : C.white,
    });
  });
  const left = [
    "Describes the caves beautifully",
    "Cannot see today's restriction order",
    "Cannot tell a licensed operator from an unlicensed one",
    "Cannot sell a ticket",
    "Cannot work without a network",
    "Leaves no record for the department",
  ];
  const right = [
    "Describes the caves in the department's own approved words",
    "Carries the collector's order the hour it is issued",
    "Lists only operators on the state's own register",
    "Issues the ticket and settles it to each authority",
    "Works offline, at the gate, by design",
    "Every visit, question and lost sale is recorded",
  ];
  s.addText(left.map((t, i) => ({ text: t, options: { bullet: true, breakLine: i < left.length - 1 } })), {
    x: colX[0] + 0.35, y: 2.72, w: 5.05, h: 2.9, isTextBox: true, margin: 0,
    fontFace: F.body, fontSize: 13, color: C.ink2, paraSpaceAfter: 11,
  });
  s.addText(right.map((t, i) => ({ text: t, options: { bullet: true, breakLine: i < right.length - 1 } })), {
    x: colX[1] + 0.35, y: 2.72, w: 5.05, h: 2.9, isTextBox: true, margin: 0,
    fontFace: F.body, fontSize: 13, color: C.onDark, paraSpaceAfter: 11,
  });
  s.addText("The moat is not the model. It is the data only the department holds — and the authority only the department has.", {
    x: 0.7, y: 6.25, w: 12.0, h: 0.5, isTextBox: true, margin: 0,
    fontFace: F.head, fontSize: 17, bold: true, color: C.lat,
  });
  s.addNotes(
    "7:20–8:05. Name the objection out loud here: 'Someone will ask why this isn't just ChatGPT.' " +
    "Then walk the right column only. The closing line is the single most important sentence in " +
    "the deck — say it slowly."
  );
}

/* ───────────────────────── 13. Built on their systems ───────────────────────── */
{
  const s = contentSlide(pres, "Built on what the department already owns");
  const layers = [
    ["What the visitor touches", "Website and mobile app — Marathi, Hindi, English and the priority foreign-market languages, offline-capable.", C.lat],
    ["What powers the answers", "Itinerary engine, ticketing and settlement, and an assistant grounded strictly in departmental sources.", C.sea],
    ["What it reads from", "The department's 36-district content estate · MahaAtithi's registered operators · MAITRI registrations · ASI and Forest Department ticketing · district and police advisories.", C.ink2],
  ];
  layers.forEach(([h, d, col], i) => {
    const y = 1.7 + i * 1.5;
    card(pres, s, { x: 0.7, y, w: 12.0, h: 1.28 });
    s.addShape(pres.ShapeType.ellipse, { x: 1.0, y: y + 0.42, w: 0.42, h: 0.42, fill: { color: col } });
    s.addText(h, {
      x: 1.65, y: y + 0.2, w: 10.5, h: 0.42, isTextBox: true, margin: 0,
      fontFace: F.head, fontSize: 18, bold: true, color: C.ink,
    });
    s.addText(d, {
      x: 1.65, y: y + 0.63, w: 10.5, h: 0.55, isTextBox: true, margin: 0,
      fontFace: F.body, fontSize: 13, color: C.ink2, lineSpacing: 18,
    });
  });

  card(pres, s, { x: 0.7, y: 6.2, w: 12.0, h: 1.0, fill: C.ink });
  s.addText("Deployed on premises. Weights and data the department owns. Aligned to the DPDP Act 2023. No decision taken without an officer. A full audit trail of every answer given.", {
    x: 1.05, y: 6.45, w: 11.3, h: 0.55, isTextBox: true, margin: 0,
    fontFace: F.body, fontSize: 13.5, color: C.onDark, lineSpacing: 19,
  });
  s.addNotes(
    "8:05–8:40. Read top to bottom. The third layer is the point — we are not building a new " +
    "database, we are reading the ones they have. The dark bar is the governance answer; say it " +
    "as one breath and do not elaborate unless asked."
  );
}

/* ───────────────────────── 14. Goa ───────────────────────── */
{
  const s = contentSlide(pres, "One more thing worth knowing");
  card(pres, s, { x: 0.7, y: 1.5, w: 12.0, h: 2.5, fill: C.card });
  s.addText("In July 2026 the Goa Department of Tourism floated a Request for Proposal for an", {
    x: 1.1, y: 1.8, w: 11.2, h: 0.4, isTextBox: true, margin: 0,
    fontFace: F.body, fontSize: 14.5, color: C.ink2,
  });
  s.addText('"Integrated Sovereign AI-Driven Experience Tourism Platform and Infrastructure"', {
    x: 1.1, y: 2.2, w: 11.2, h: 0.55, isTextBox: true, margin: 0,
    fontFace: F.head, fontSize: 21, bold: true, color: C.lat,
  });
  s.addText("A 30-year public-private concession covering a redesigned tourism website and app, multilingual virtual assistants, personalised itineraries, integrated ticketing, geo-tagged emergency response, and on-premises AI compute with edge data centres at tourist sites.", {
    x: 1.1, y: 2.85, w: 11.2, h: 1.0, isTextBox: true, margin: 0,
    fontFace: F.body, fontSize: 13.5, color: C.ink2, lineSpacing: 20,
  });

  const facts = [
    ["Goa", "0.5 M foreign tourist visits a year, roughly"],
    ["Maharashtra", "3.71 M — seven times as many, rank 1 in India"],
  ];
  facts.forEach(([h, d], i) => {
    const x = 0.7 + i * 6.15;
    card(pres, s, { x, y: 4.25, w: 5.85, h: 1.25, fill: i === 1 ? C.ink : C.card });
    s.addText(h, {
      x: x + 0.35, y: 4.45, w: 5.15, h: 0.42, isTextBox: true, margin: 0,
      fontFace: F.head, fontSize: 19, bold: true, color: i === 1 ? C.white : C.ink2,
    });
    s.addText(d, {
      x: x + 0.35, y: 4.88, w: 5.15, h: 0.45, isTextBox: true, margin: 0,
      fontFace: F.body, fontSize: 13, color: i === 1 ? C.onDark : C.ink2,
    });
  });
  s.addText("The smaller destination is building this. The larger one has not started.", {
    x: 0.7, y: 5.75, w: 12.0, h: 0.5, isTextBox: true, margin: 0,
    fontFace: F.head, fontSize: 19, bold: true, color: C.lat,
  });
  footnote(s, "Reported by The Navhind Times and The Goan, 16 July 2026. The current status of that RFP is unconfirmed — we have not seen the tender document itself, and it does not appear in Goa Tourism's live tender listing as of September 2026. Goa FTV figure indicative, pending confirmation.");
  s.addNotes(
    "8:40–9:10. Handle honestly. Say: 'Two Goan dailies reported this in July. We have not seen " +
    "the document and we do not know where it stands today — but the direction is on the record.' " +
    "If an officer knows more about Goa than we do, that is fine; the footnote has already conceded " +
    "the limit of our knowledge. Do not oversell. The comparison of the two FTV numbers is the payload."
  );
}

/* ───────────────────────── 15. Close ───────────────────────── */
{
  const s = pres.addSlide();
  s.background = { color: C.ink };
  s.addText("What the department gets", {
    x: 0.9, y: 0.7, w: 11.5, h: 0.7, isTextBox: true, margin: 0,
    fontFace: F.head, fontSize: 34, bold: true, color: C.white,
  });
  const gets = [
    ["A visitor who arrives prepared", "Knowing what the day costs, what it needs, and what is open."],
    ["A ticket the state can actually sell", "One payment, settled to every authority, recorded and reconciled."],
    ["A platform that works at the gate", "Offline by design, at the sites where tourism actually happens."],
    ["Sight of its own tourism economy", "Every visit, every question, every lost sale — visible for the first time."],
  ];
  gets.forEach(([h, d], i) => {
    const x = 0.9 + (i % 2) * 5.9;
    const y = 1.75 + Math.floor(i / 2) * 1.65;
    numberedCircle(pres, s, { x, y: y + 0.05, d: 0.5, n: i + 1 });
    s.addText(h, {
      x: x + 0.7, y, w: 4.9, h: 0.45, isTextBox: true, margin: 0,
      fontFace: F.head, fontSize: 17.5, bold: true, color: C.white,
    });
    s.addText(d, {
      x: x + 0.7, y: y + 0.5, w: 4.9, h: 0.8, isTextBox: true, margin: 0,
      fontFace: F.body, fontSize: 13, color: C.onDark, lineSpacing: 19,
    });
  });
  s.addText("The visitor who turned back at Kanheri is the whole case.\nEverything here exists so that they don't.", {
    x: 0.9, y: 5.25, w: 11.5, h: 1.0, isTextBox: true, margin: 0,
    fontFace: F.head, fontSize: 21, bold: true, color: "E8825F", lineSpacing: 32,
  });
  s.addText("Incepthink LLP", {
    x: 0.9, y: 6.45, w: 5.0, h: 0.4, isTextBox: true, margin: 0,
    fontFace: F.body, fontSize: 14, bold: true, color: C.onDark,
  });
  s.addNotes(
    "9:10–10:00. Four things, then the Kanheri line, then stop. Do not ask for anything — no " +
    "budget request, no pilot request, no list of what we need from them. End on the sentence " +
    "and let them speak first."
  );
}

/* ───────────────────────── Annexure ───────────────────────── */
{
  const s = sectionSlide(pres, {
    title: "Annexure",
    sub: "Backup material — not part of the ten-minute run.",
  });
  s.addNotes("Do not present. Turn to these only if asked.");
}

{
  const s = contentSlide(pres, "Annexure A — How the offline pass works");
  const steps = [
    ["Issue", "At purchase, the platform mints a pass containing the itinerary, the sites, the entitlements and the validity window. It is cryptographically signed by the issuing authority."],
    ["Carry", "The pass is stored on the device as a signed QR payload. It needs no server to be readable and cannot be altered without breaking the signature."],
    ["Verify", "At the gate, a handheld or any Android phone reads the code and checks the signature against a locally held public key. Valid or not valid is decided on the device, in under a second, with no connection."],
    ["Reconcile", "Each scan is written to a local queue with a timestamp. When the device next reaches coverage, scans upload and the central record updates. Duplicate-use checks run at that point."],
  ];
  steps.forEach(([h, d], i) => {
    const y = 1.55 + i * 1.32;
    card(pres, s, { x: 0.7, y, w: 12.0, h: 1.15 });
    numberedCircle(pres, s, { x: 1.0, y: y + 0.32, d: 0.5, n: i + 1 });
    s.addText(h, {
      x: 1.72, y: y + 0.17, w: 2.4, h: 0.4, isTextBox: true, margin: 0,
      fontFace: F.head, fontSize: 17, bold: true, color: C.lat,
    });
    s.addText(d, {
      x: 1.72, y: y + 0.55, w: 10.6, h: 0.55, isTextBox: true, margin: 0,
      fontFace: F.body, fontSize: 12.5, color: C.ink2, lineSpacing: 17,
    });
  });
  s.addText("The trade-off is honest: offline verification cannot detect a pass already used elsewhere until the devices sync. For single-entry site tickets this window is acceptable and bounded.", {
    x: 0.7, y: 6.9, w: 12.0, h: 0.4, isTextBox: true, margin: 0,
    fontFace: F.body, fontSize: 12, italic: true, color: C.muted,
  });
  s.addNotes("If asked how offline ticketing can possibly be secure. The last line is deliberate — concede the limit before they find it.");
}

{
  const s = contentSlide(pres, "Annexure B — Language and model approach");
  const rows = [
    ["Marathi first", "The platform is built Marathi-first, then Hindi and English, then the foreign-market languages the state's booking portal already advertises."],
    ["Open-weight, deployed on premises", "A dense open-weight model in the 30-billion-parameter class, fine-tuned on departmental content. The department holds the weights."],
    ["Grounded, not generative", "Answers are retrieved from departmental sources and cited. The model composes the sentence; it does not supply the fact."],
    ["Tuned on approved output", "Supervised fine-tuning on officer-approved copy, then preference tuning on the gap between drafts and what officers actually approved."],
    ["Scaled by measurement", "Production runs identical inference nodes behind a load balancer. Node count is set by benchmarked peak demand, not assumed in advance."],
  ];
  rows.forEach(([h, d], i) => {
    const y = 1.5 + i * 1.08;
    card(pres, s, { x: 0.7, y, w: 12.0, h: 0.92 });
    s.addText(h, {
      x: 1.05, y: y + 0.13, w: 3.4, h: 0.65, isTextBox: true, margin: 0,
      fontFace: F.head, fontSize: 15.5, bold: true, color: C.lat, valign: "middle",
    });
    s.addText(d, {
      x: 4.6, y: y + 0.13, w: 7.75, h: 0.65, isTextBox: true, margin: 0,
      fontFace: F.body, fontSize: 12.5, color: C.ink2, valign: "middle", lineSpacing: 17,
    });
  });
  s.addNotes("If asked what is under the hood. Never quote a fixed GPU count — say the node count follows benchmarking.");
}

{
  const s = contentSlide(pres, "Annexure C — What connects to what");
  const rows = [
    ["Department content estate", "36 district pages, 40+ festivals, forts, beaches, caves, temples", "Read"],
    ["MahaAtithi", "Registered operators, inventory, availability", "Read + book"],
    ["MAITRI", "Policy registrations, licences and their validity", "Read"],
    ["ASI ticketing / ONDC", "Centrally-protected monument tickets, incl. Kanheri", "Book + settle"],
    ["Forest Department", "National park and sanctuary entry, safari slots", "Book + settle"],
    ["MTDC", "Resorts, packages, activity bookings", "Book + settle"],
    ["District and police advisories", "Restriction orders, closures, monsoon bans", "Read"],
  ];
  s.addText("System", {
    x: 1.05, y: 1.45, w: 3.4, h: 0.3, isTextBox: true, margin: 0,
    fontFace: F.body, fontSize: 11, bold: true, color: C.muted, charSpacing: 1.2,
  });
  s.addText("What it holds", {
    x: 4.7, y: 1.45, w: 5.8, h: 0.3, isTextBox: true, margin: 0,
    fontFace: F.body, fontSize: 11, bold: true, color: C.muted, charSpacing: 1.2,
  });
  s.addText("Our use", {
    x: 10.7, y: 1.45, w: 2.0, h: 0.3, isTextBox: true, margin: 0,
    fontFace: F.body, fontSize: 11, bold: true, color: C.muted, charSpacing: 1.2,
  });
  rows.forEach(([a, b, c], i) => {
    const y = 1.85 + i * 0.72;
    if (i % 2 === 0) card(pres, s, { x: 0.7, y, w: 12.0, h: 0.62 });
    s.addText(a, {
      x: 1.05, y: y + 0.1, w: 3.5, h: 0.42, isTextBox: true, margin: 0,
      fontFace: F.body, fontSize: 13, bold: true, color: C.ink, valign: "middle",
    });
    s.addText(b, {
      x: 4.7, y: y + 0.1, w: 5.9, h: 0.42, isTextBox: true, margin: 0,
      fontFace: F.body, fontSize: 12.5, color: C.ink2, valign: "middle",
    });
    s.addText(c, {
      x: 10.7, y: y + 0.1, w: 2.0, h: 0.42, isTextBox: true, margin: 0,
      fontFace: F.body, fontSize: 12.5, bold: true, color: C.sea, valign: "middle",
    });
  });
  s.addText("Integration depth varies. Read-only access is available immediately; booking and settlement require agreement from each ticketing authority.", {
    x: 0.7, y: 6.95, w: 12.0, h: 0.4, isTextBox: true, margin: 0,
    fontFace: F.body, fontSize: 12, italic: true, color: C.muted,
  });
  s.addNotes("If asked what we actually need to plug into. Be candid that ASI and Forest Department consent is the long pole.");
}

{
  const s = contentSlide(pres, "Annexure D — What we are still confirming");
  const opens = [
    ["Fare and ticket structure at SGNP and Kanheri", "Published figures differ across sources. To be confirmed with the park authority and ASI before any external circulation."],
    ["Connectivity at the Kanheri counter", "Observed on site, not measured. Worth a documented signal survey before this is stated to the department as fact."],
    ["Status of the Goa RFP", "Reported July 2026 by two Goan dailies. The tender document has not been obtained and its current status is unknown."],
    ["Goa foreign-visit figure", "Used indicatively for the scale comparison. Replace with the Ministry of Tourism compendium figure before circulation."],
    ["Settlement and consent from each authority", "Ticketing integration is a commercial and administrative question as much as a technical one."],
  ];
  opens.forEach(([h, d], i) => {
    const y = 1.5 + i * 1.08;
    card(pres, s, { x: 0.7, y, w: 12.0, h: 0.92 });
    s.addText(h, {
      x: 1.05, y: y + 0.12, w: 4.6, h: 0.68, isTextBox: true, margin: 0,
      fontFace: F.body, fontSize: 13, bold: true, color: C.ink, valign: "middle", lineSpacing: 17,
    });
    s.addText(d, {
      x: 5.9, y: y + 0.12, w: 6.45, h: 0.68, isTextBox: true, margin: 0,
      fontFace: F.body, fontSize: 12, color: C.ink2, valign: "middle", lineSpacing: 16,
    });
  });
  s.addText("Internal slide. Do not show to the department.", {
    x: 0.7, y: 6.95, w: 12.0, h: 0.4, isTextBox: true, margin: 0,
    fontFace: F.body, fontSize: 12, bold: true, italic: true, color: C.lat,
  });
  s.addNotes("INTERNAL. Remove or hide before the deck leaves the building. This is our own honesty list.");
}

{
  const s = contentSlide(pres, "Annexure E — Sources");
  const src = [
    "Chandrashekhar Jaiswal quotation — ANI press release, ImagiNxt 2026, 22 May 2026 (carried by ThePrint, Business Standard, and others).",
    "Foreign tourist visits — Ministry of Tourism, India Tourism Data Compendium 2025 (66th edition), November 2025.",
    "Investment and employment targets — Maharashtra Tourism Policy 2024, as described by the Joint Director, Directorate of Tourism.",
    "Maratha Military Landscapes of India — UNESCO World Heritage List entry 1739, inscribed July 2025; Press Information Bureau release.",
    "Kanheri Caves access, distance and ticket structure — Sanjay Gandhi National Park visitor information and published visitor accounts, 2026.",
    "ASI online ticketing on the ONDC network — Press Information Bureau, 6 January 2026; 170+ centrally-protected monuments.",
    "Lonavala waterfall restrictions and monsoon trekking orders — district administration advisories, 2024 onward.",
    "Goa tourism RFP — The Navhind Times and The Goan, 16 July 2026.",
  ];
  s.addText(src.map((t, i) => ({ text: t, options: { bullet: true, breakLine: i < src.length - 1 } })), {
    x: 0.7, y: 1.5, w: 12.0, h: 5.2, isTextBox: true, margin: 0,
    fontFace: F.body, fontSize: 12.5, color: C.ink2, paraSpaceAfter: 11, lineSpacing: 18,
  });
  s.addNotes("Keep. Officers check sources, and having them on a slide is worth more than having them right.");
}

pres.writeFile({ fileName: "Maharashtra-Tourism-AI-Platform-Incepthink.pptx" })
  .then(f => console.log("wrote", f));
