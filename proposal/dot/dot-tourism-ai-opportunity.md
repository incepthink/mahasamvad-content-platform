# Department of Tourism, Government of Maharashtra — AI opportunity research

Prepared 14 September 2026. Same treatment as the DIT and CMRF work: read the department's
own public material first, find where its stated intent outruns what its systems actually
do, and map modules onto that gap. Nothing here is a commercial proposal yet.

---

## 1. Who you are actually pitching

Three bodies, and they are not interchangeable:

| Body | What it is | Relevance |
|---|---|---|
| **Tourism Department (Mantralaya)** | Policy and budget. Minister **Shambhuraj Desai**; MoS **Indranil Naik**; Addl. Chief Secretary (Tourism) **Sanjay Khandare, IAS** | Where a state-wide AI programme gets sanctioned |
| **Directorate of Tourism (DoT)** | Executive arm. Sakhar Bhavan, Nariman Point, Mumbai, 022-69107600, diot@maharashtratourism.gov.in. Joint Director **Santosh Jadhav**; GM **Chandrashekhar Jaiswal** | Owns the policies, the registrations, the RTS services, the portal. **This is the buyer.** |
| **MTDC** | The corporation — resorts, bookings, PR/publicity tenders. MD **Manojkumar Suryawanshi, IAS** | Owns the customer-facing assets and most of the tender pipeline |

DoT runs six regional offices (Konkan, Pune, Nashik, Ch. Sambhajinagar, Amravati, Nagpur)
and works across all 36 districts. That six-region / 36-district structure is the same
shape as the DGIPR DLO network — the multi-office, multi-language deployment argument
carries over almost unchanged.

---

## 2. The department has already said what it wants — in public, this year

This is the strongest opening available, and it is better than anything we invented for
CMRF because the department said it themselves, on a stage, four months ago.

**ImagiNxt 2026**, Maharashtra Tourism's own innovation summit, 22 May 2026, Jio World
Convention Centre, 150+ speakers on AI and deeptech:

> "Maharashtra Tourism is proud to be part of ImagiNxt, a platform that truly reflects
> India's technology moment." — **Santosh Jadhav**, Joint Director, DoT

> The department aims to leverage **"personalised travel planning, seamless digital access,
> and immersive storytelling"** for visitors. — **Chandrashekhar Jaiswal**, GM, DoT

Summit coverage lists exactly what they were looking at: AI-powered itineraries and
destination discovery, digital storytelling for cultural exploration, virtual guides,
real-time visitor information and smart navigation at sites.

**The pitch writes itself: they named three capabilities and we already have two of them
built.** We are not proposing an idea — we are answering a stated requirement.

---

## 3. The record — numbers to open the deck with

- **3.71 million foreign tourist visits in 2024 — rank 1 in India**, ~17.7% of the national
  20.94 million (Ministry of Tourism, *India Tourism Data Compendium 2025*, 66th edn,
  Nov 2025). Maharashtra is the most-visited state in the country by foreign arrivals.
- **Tourism Policy 2024**: ~₹1,00,000 crore private investment and ~**18 lakh direct and
  indirect jobs** targeted over a decade. Incentives: capital subsidy up to 15% (cap ₹15 cr),
  5% interest subsidy (cap ₹50 lakh), electricity duty and stamp duty relief.
- Tourism contributes **~9% of GSDP, targeted to 14% by 2034**, with a roadmap to 2047
  *(reported figure — sponsored feature, verify with the department before quoting)*.
- **12 Maratha forts inscribed on the UNESCO World Heritage List in July 2025** as the
  *Maratha Military Landscapes of India*, India's 44th entry. A step-change in international
  attention on exactly the assets with the weakest visitor-information layer.
- **Maharashtra Convention Bureau** launched at IMEX Frankfurt; target of **10+ major
  international conventions a year by 2030**, deliberately spread beyond Mumbai.
- **Youth Tourism Clubs**: ₹25 crore allocation, ₹10,000 per school / ₹25,000 per college.
  **NaMo Tourism Skill Training**: 7,500 residents to be trained as hospitality staff and guides.

---

## 4. What exists digitally today — and where it breaks

I went through every public property. The department is not digitally empty; it is
digitally **fragmented**. That is a better problem for us, because the fix is a layer, not
a replacement — the CMRF framing exactly.

**maharashtratourism.gov.in** — large, well-stocked content estate: 36 district pages,
40+ festivals, 18 beaches, 27 forts, 43 temples, 8 caves, a media library, 13 policies.
English and Marathi only. No search assistant, no itinerary tool, no conversational entry point.

**mahaatithi.org** — the official booking portal, and the most ambitious asset. Books
accommodation, guided tours, aqua tourism, events, cuisine, tour operators, handicrafts.
**Interface offered in 20 languages** including Arabic, French, German, Russian, Spanish.
Reported to carry an inventory of **100,000+ tourism assets and operators**. Support is a
WhatsApp number (+91-9993308883) and a phone line.

**mtdc.co** — resorts, packages, PADI diving, conferences, weddings. A chat widget already
sits on the site, so the "do you have a chatbot" question is closed; the live question is
what it can actually do.

**maitri.maharashtra.gov.in** — the single window carrying almost every DoT registration:
Agro Tourism, Caravan, Homestay, Vacation Homes, Tourist Apartments, Tourism Villas,
Adventure, Industrial Status, and the **RTS services** themselves. Separate portals exist
for AAI policy (aaipolicy.in) and sponsorship/logo services (nflsregistration.dotregistration.co.in).
Yuva Tourism Policy applications run on a **Google Form**.

### The gaps, stated plainly

1. **Twenty languages of interface, but not of content or support.** MahaAtithi's chrome is
   translated; the destination knowledge, the answers and the human support behind it are
   not. A French visitor gets a French menu and an English answer on WhatsApp.
2. **No planning layer anywhere.** Every property answers "what exists" and "how do I book
   one thing". Nothing answers "I have three days from Mumbai in August with two kids and
   ₹20,000" — which is the question every tourist actually has, and the exact capability
   the GM named on stage.
3. **Fragmented registration.** Nine-plus schemes, three-plus portals, one Google Form, PDF
   forms alongside online forms. An agro-tourism farmer has to work out which of thirteen
   policies applies before they can start — the identical problem to CMRF's five-step
   routing rule that no citizen could follow.
4. **Statutory documents are unreadable by machine.** The RTS Act service document
   (`newrtsdocument.pdf`, June 2026) is a **scanned image with no extractable text**. The
   department's own list of notified services and time limits cannot be searched, indexed
   or answered against. Same for the Marathi citizen charter.
5. **Service timelines are slow and self-declared.** The citizen charter commits to urgent
   files in ~4 days, standard matters in **45 days**, inter-departmental in **3 months**,
   with a three-tier manual grievance escalation (desk officer → deputy secretary →
   principal secretary). No status tracking is exposed to the applicant.
6. **No verified vendor turnaround.** MahaAtithi requires fire safety certification, police
   verification and municipal approvals from vendors, but publishes **no verification
   timeline**. A 100,000-asset inventory verified by hand is a permanent backlog.
7. **Content production is outsourced and campaign-shaped.** The ₹2 crore Marketing & Brand
   Advisory RFP buys films, print and social creative on a monthly KPI retainer. Nobody is
   producing continuous multilingual destination content at the scale a 36-district,
   20-language estate needs.
8. **Safety advisories are reactive and local.** After the 2024 Lonavala waterfall tragedy,
   restrictions and monsoon trekking bans are issued district by district, by police and
   collectors — not surfaced in the tourist's own planning channel, in their own language,
   at the moment they are deciding to go.

---

## 5. How we help — seven modules

Same architecture as CMRF: an **assistance layer over systems that stay in place**. AI never
approves a registration, never issues a certificate, never overrides a safety order.

| # | Gap | Module | What it does |
|---|---|---|---|
| 1 | No planning layer | **Maharashtra Trip Planner** | Conversational itinerary builder over the department's own 36-district content estate. Budget, days, origin, season, interest, accessibility. Outputs a day-by-day plan with MahaAtithi inventory attached so it ends in a booking, not a PDF. Directly answers "personalised travel planning". |
| 2 | 20 languages of chrome, 1 of substance | **Multilingual Visitor Assistant** | WhatsApp + web + IVR over the same knowledge base, answering in Marathi, Hindi, English and the priority foreign-market languages MahaAtithi already advertises. Replaces a single WhatsApp number with a 24/7 answering layer; hands off to a human when it should. |
| 3 | Fragmented registration | **Scheme Discovery & Assisted Registration** | Asks the operator what they have (a farm, three rooms, a boat, a caravan park) and routes them to the right one of the thirteen policies, then guides the MAITRI application — voice-first, camera capture, OCR auto-fill, live completeness checklist. The CMRF Module 1+2 pattern, transplanted. |
| 4 | 45-day files, manual escalation, unverifiable backlog | **Verification & Officer Cockpit** | Extract → validate against the department's own policy criteria → completeness score → queue by age against the RTS clock. Officer decides; the system does the reading. Applicant-facing status tracking falls out of it. |
| 5 | Campaign-shaped content, 36 districts, 20 languages | **Destination Content Engine** | **This is the AI NewsRoom stack, reconfigured.** Officer-approved multilingual destination copy, festival and event notices, social posts, district pages, UNESCO fort interpretation — produced continuously, reviewed by DoT, in DoT's voice. Answers "immersive storytelling" without the monthly-retainer ceiling. |
| 6 | Reactive, local safety advisories | **Advisory & Crowd Signal Layer** | Ingests district collector and police orders, monsoon trekking bans, waterfall and fort restrictions; surfaces them inside Modules 1 and 2 at planning time and at arrival, in the visitor's language. Low build cost, very high political value after Lonavala. |
| 7 | Scanned statutory PDFs | **Document Intelligence baseline** | OCR and structure the RTS list, citizen charter, thirteen policy GRs, guide and empanelment lists into a queryable corpus. Unglamorous, cheap, and it is the substrate every other module reads from. Good opener for a paid pilot. |

**Cross-cutting, carried over unchanged from the DIT and CMRF positions:** on-premises
deployment, weights the department owns, data that does not leave, DPDP Act 2023 alignment,
human-in-the-loop on every decision, full audit trail.

---

## 6. What we are reusing versus building new

- **Reused nearly as-is:** the AI NewsRoom content stack (Module 5), the Marathi-first model
  and fine-tuning position from the DIT deck (Qwen3-32B, LoRA SFT then DPO on officer-approved
  output), the on-prem/governance slides, the CMRF conversational eligibility and assisted-form
  pattern (Modules 2, 3, 4).
- **Genuinely new:** the itinerary engine (Module 1), the advisory/crowd layer (Module 6),
  and MahaAtithi inventory integration.

Roughly two-thirds of this is already built or specced. That is the honest commercial story
and it is also the fastest credible pilot.

---

## 7. Route in

- **Procurement precedent is marketing-shaped, not IT-shaped.** DoT's recent large RFP is the
  ₹2 crore Marketing & Brand Advisory retainer — QCBS 70:30, ₹1.5 crore turnover floor,
  Mumbai office required, INS registration, one prior ₹80 lakh+ tourism/government project.
  MTDC's own tender history is website, mobile app, social media and PR. **There is no
  existing AI or platform tender line to bid into** — which means the opening is a
  presentation to DoT that creates the requirement, exactly as with DIT.
- **Eligibility check needed:** confirm whether HashByte Pvt Ltd clears the turnover, prior-project
  and Mumbai-office criteria those RFPs use, or whether we go in via MAITRI/MahaAtithi's
  existing implementation partner.
- **Best hook for the first meeting:** ImagiNxt. They convened a summit about AI in tourism
  in May and named three capabilities. Open the deck by quoting Jaiswal back to the room and
  showing two of the three already running for another Maharashtra department.
- **Timing:** monsoon safety advisories (Module 6) and UNESCO fort interpretation (Modules 1, 5)
  are both seasonal and politically live. A narrow Module 6 + 7 pilot is cheap, fast and
  visibly useful before the next monsoon.

---

## 8. Open items before this becomes a deck

- Confirm the 9% → 14% GSDP figures and the MahaAtithi 100,000-asset number with DoT; both
  come from a sponsored feature, not a department document.
- Get inside MahaAtithi and the MTDC chat widget as a real user — what does the existing bot
  actually do, and how far does the 20-language support really go? Screenshots of the failure
  are what made the CMRF deck land.
- Pull the Tourism Policy 2024 GR itself (gr.maharashtra.gov.in) rather than press coverage,
  the way we used the CMRF procedure sheet.
- Decide the presenting entity — **Incepthink LLP** (as with DIT) or **HashCase** (as with CMRF).
- Decide whether to lead with the visitor-facing modules (politically attractive, publicly
  visible) or the officer-facing ones (operationally defensible, closer to what we've shipped).

---

## Sources

- [Department of Tourism, Maharashtra](https://maharashtratourism.gov.in/) · [Directorate of Tourism](https://maharashtratourism.gov.in/directorate-of-tourism-dot/) · [Policies & Applications](https://maharashtratourism.gov.in/policies-applications/) · [Contact](https://maharashtratourism.gov.in/contact/) · [Sitemap](https://maharashtratourism.gov.in/sitemap/)
- [Citizen Charter (PDF)](https://maharashtratourism.gov.in/wp-content/uploads/2026/03/Tourism-sub-dept-charter.pdf) · [RTS Act document (PDF, scanned)](https://maharashtratourism.gov.in/wp-content/uploads/2026/06/newrtsdocument.pdf) · [Marketing & Brand Advisory RFP 2025-26 (PDF)](https://maharashtratourism.gov.in/wp-content/uploads/2025/04/Marketing-Brand-Advisory-Agency-2025-26.pdf)
- [MahaAtithi booking portal](https://mahaatithi.org/) · [Become a Vendor](https://mahaatithi.org/become-a-vendor/) · [MTDC](https://www.mtdc.co/en) · [MTDC PR & Publicity tenders](https://mtdc.co/en/tenders/pr-and-publicity-branch/)
- [ImagiNxt 2026 press release](https://www.business-standard.com/amp/content/press-releases-ani/imaginxt-2026-hosted-by-maharashtra-tourism-brings-together-india-s-technology-and-innovation-ecosystem-126052201008_1.html) · [Maharashtra Tourism Innovation Summit coverage](https://www.travelandtourworld.com/news/article/p0ta8dutcilt/)
- [Transforming Tourism in Maharashtra (Business Today, sponsored)](https://www.businesstoday.in/impact-feature/story/transforming-tourism-in-maharashtra-545342-2026-07-27) · [Santosh Jadhav interview, Outlook Traveller](https://www.outlooktraveller.com/explore-maharashtra/maharashtra-tourism-policy-santosh-jadhav-on-investment-mice-expansion-and-youth-skill-development)
- [India Tourism Data Compendium 2025 — Maharashtra leads FTVs](https://affairscloud.com/india-tourism-data-compendium-2025-maharashtra-leads-india-in-attracting-foreign-tourists/) · [Maratha Military Landscapes, UNESCO](https://whc.unesco.org/en/list/1739/) · [PIB release](https://www.pib.gov.in/PressReleasePage.aspx?PRID=2144154&reg=48&lang=2)
- [2024 Lonavala waterfall tragedy](https://en.wikipedia.org/wiki/2024_Lonavala_waterfall_tragedy) · [Monsoon trekking restrictions 2026](https://www.stayvista.com/blog/monsoon-trekking-rules-2026/)
