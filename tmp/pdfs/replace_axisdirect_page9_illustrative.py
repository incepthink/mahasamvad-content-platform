from pathlib import Path

from pypdf import PdfReader, PdfWriter
from reportlab.lib import colors
from reportlab.lib.colors import HexColor
from reportlab.lib.enums import TA_JUSTIFY, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "output" / "pdf" / "AxisDirect_Case_Study_Professional_v4.pdf"
PAGE_PDF = ROOT / "tmp" / "pdfs" / "axisdirect-page9-illustrative.pdf"
MERGED_PDF = ROOT / "tmp" / "pdfs" / "axisdirect-page9-illustrative-merged.pdf"

PAGE_W, PAGE_H = A4
LEFT = 19 * mm
RIGHT = 19 * mm
TOP = 21 * mm
BOTTOM = 18 * mm
CONTENT_W = PAGE_W - LEFT - RIGHT

NAVY = HexColor("#14213D")
BURGUNDY = HexColor("#A30D4F")
TEXT = HexColor("#253044")
MID = HexColor("#687386")
RULE = HexColor("#D7DCE4")
PALE = HexColor("#F2F4F7")
NOTE_BG = HexColor("#F7F2F5")
WHITE = colors.white

pdfmetrics.registerFont(TTFont("Arial", r"C:\Windows\Fonts\arial.ttf"))
pdfmetrics.registerFont(TTFont("Arial-Bold", r"C:\Windows\Fonts\arialbd.ttf"))

styles = getSampleStyleSheet()
styles.add(ParagraphStyle(
    name="Body", fontName="Arial", fontSize=8.85, leading=12.1,
    textColor=TEXT, alignment=TA_JUSTIFY, spaceAfter=5,
))
styles.add(ParagraphStyle(
    name="PageTitle", fontName="Arial-Bold", fontSize=19.5, leading=23,
    textColor=NAVY, spaceAfter=10,
))
styles.add(ParagraphStyle(
    name="Subhead", fontName="Arial-Bold", fontSize=11.1, leading=13.6,
    textColor=NAVY, spaceBefore=6, spaceAfter=4,
))
styles.add(ParagraphStyle(
    name="TableHead", fontName="Arial-Bold", fontSize=7.05, leading=8.3,
    textColor=WHITE,
))
styles.add(ParagraphStyle(
    name="TableCell", fontName="Arial", fontSize=7.2, leading=9.0,
    textColor=TEXT,
))
styles.add(ParagraphStyle(
    name="TableCellBold", fontName="Arial-Bold", fontSize=7.2, leading=9.0,
    textColor=TEXT,
))
styles.add(ParagraphStyle(
    name="Disclosure", fontName="Arial-Bold", fontSize=8.15, leading=10.8,
    textColor=BURGUNDY, alignment=TA_LEFT,
))
styles.add(ParagraphStyle(
    name="Quote", fontName="Arial-Bold", fontSize=10.0, leading=13.8,
    textColor=NAVY, alignment=TA_LEFT,
))
styles.add(ParagraphStyle(
    name="Note", fontName="Arial", fontSize=7.65, leading=10.0,
    textColor=MID, alignment=TA_LEFT,
))


def P(text, style="Body"):
    return Paragraph(text, styles[style])


def header_footer(canvas, doc):
    canvas.saveState()
    canvas.setFont("Arial-Bold", 9)
    canvas.setFillColor(BURGUNDY)
    canvas.drawString(LEFT, PAGE_H - 12.5 * mm, "AXISDIRECT")
    canvas.setFont("Arial-Bold", 6.7)
    canvas.setFillColor(MID)
    canvas.drawRightString(PAGE_W - RIGHT, PAGE_H - 12.2 * mm, "HASHCASE (HASHBYTE PVT LTD)")
    canvas.setStrokeColor(RULE)
    canvas.setLineWidth(0.55)
    canvas.line(LEFT, PAGE_H - 15.5 * mm, PAGE_W - RIGHT, PAGE_H - 15.5 * mm)
    canvas.line(LEFT, 12 * mm, PAGE_W - RIGHT, 12 * mm)
    canvas.setFont("Arial", 6.7)
    canvas.setFillColor(MID)
    canvas.drawString(LEFT, 8.2 * mm, "High-Value Customer Identification & Social Influence Mapping")
    canvas.drawRightString(PAGE_W - RIGHT, 8.2 * mm, "9")
    canvas.restoreState()


def standard_table(shaded_rows=()):
    commands = [
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("GRID", (0, 0), (-1, -1), 0.45, RULE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]
    for row in shaded_rows:
        commands.append(("BACKGROUND", (0, row), (-1, row), PALE))
    return TableStyle(commands)


doc = SimpleDocTemplate(
    str(PAGE_PDF), pagesize=A4,
    leftMargin=LEFT, rightMargin=RIGHT, topMargin=TOP, bottomMargin=BOTTOM,
)

story = [
    P("Project outcomes and client validation", "PageTitle"),
]

disclosure = Table([[P(
    "ILLUSTRATIVE SCENARIO ONLY - The funnel counts and performance figures on this page are synthetic planning assumptions. They are not verified AxisDirect results and must be replaced or client-approved before external use.",
    "Disclosure",
)]], colWidths=[CONTENT_W])
disclosure.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, -1), NOTE_BG),
    ("BOX", (0, 0), (-1, -1), 0.7, RULE),
    ("LEFTPADDING", (0, 0), (-1, -1), 10),
    ("RIGHTPADDING", (0, 0), (-1, -1), 10),
    ("TOPPADDING", (0, 0), (-1, -1), 8),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
]))
story += [
    disclosure,
    Spacer(1, 5),
    P(
        "The engagement established a repeatable operating model for identifying influential customers, validating the customer-to-profile match, and converting the assessment into a clear service action."
    ),
    P("Confirmed engagement outputs", "Subhead"),
]

outputs = [
    [P("Output", "TableHead"), P("Delivered scope", "TableHead")],
    [P("Customer population", "TableCellBold"), P("Approximately 50 lakh KYC records across retail, HNI, and trading relationships", "TableCell")],
    [P("Identification workflow", "TableCellBold"), P("Five stages covering normalization, shortlisting, candidate discovery, identity checks, and service-tier assignment", "TableCell")],
    [P("Assessment model", "TableCellBold"), P("Five identity checks, followed by a separate assessment of reach, professional authority, engagement, and financial-market relevance", "TableCell")],
    [P("Service operating model", "TableCellBold"), P("Four tiers linked to routing, ownership, response expectations, escalation, and review", "TableCell")],
]
t = Table(outputs, colWidths=[0.27 * CONTENT_W, 0.73 * CONTENT_W], repeatRows=1)
t.setStyle(standard_table(shaded_rows=(2, 4)))
story += [t, P("Illustrative processing funnel", "Subhead")]

funnel = [
    [P("Stage", "TableHead"), P("What the stage represents", "TableHead"), P("Illustrative figure", "TableHead")],
    [P("Customer population", "TableCellBold"), P("KYC population available for initial screening", "TableCell"), P("5,000,000 records", "TableCellBold")],
    [P("Rule-based shortlist", "TableCellBold"), P("Records meeting the KYC and relationship-screening rules", "TableCell"), P("126,400 records", "TableCellBold")],
    [P("Candidate profiles assessed", "TableCellBold"), P("Potential public or professional profiles evaluated for a match", "TableCell"), P("24,860 profiles", "TableCellBold")],
    [P("Analyst review", "TableCellBold"), P("Ambiguous matches checked by an authorized reviewer", "TableCell"), P("4,720 profiles", "TableCellBold")],
    [P("Confirmed tiered profiles", "TableCellBold"), P("High-confidence matches plus reviewed matches approved for the service workflow", "TableCell"), P("8,140 profiles", "TableCellBold")],
]
t = Table(funnel, colWidths=[0.25 * CONTENT_W, 0.50 * CONTENT_W, 0.25 * CONTENT_W], repeatRows=1)
t.setStyle(standard_table(shaded_rows=(2, 4)))
story += [t, P("Illustrative pilot results", "Subhead")]

results = [
    [P("Measure", "TableHead"), P("Illustrative result", "TableHead")],
    [P("Confirmed-match accuracy", "TableCellBold"), P("93.2% across a labelled review sample of 1,000 cases", "TableCell")],
    [P("Analyst-review rate", "TableCellBold"), P("19.0% of candidate profiles, or 4,720 of 24,860 profiles assessed", "TableCell")],
    [P("Research time", "TableCellBold"), P("Median identification time reduced from 24 minutes to 6 minutes", "TableCell")],
    [P("Service response", "TableCellBold"), P("Median first-response time for priority cases improved by 38%", "TableCell")],
]
t = Table(results, colWidths=[0.31 * CONTENT_W, 0.69 * CONTENT_W], repeatRows=1)
t.setStyle(standard_table(shaded_rows=(2, 4)))
story += [t, P("Client validation", "Subhead")]

quote = Table([
    [P(
        '"The workflow gave our service teams a consistent way to identify influential customers, understand why a case required additional attention, and route sensitive issues to the right team earlier."',
        "Quote",
    )],
    [P("Proposed wording only - client name, title, and written approval are required before publication.", "Note")],
], colWidths=[CONTENT_W])
quote.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, -1), PALE),
    ("BOX", (0, 0), (-1, -1), 0.6, RULE),
    ("LEFTPADDING", (0, 0), (-1, -1), 13),
    ("RIGHTPADDING", (0, 0), (-1, -1), 13),
    ("TOPPADDING", (0, 0), (-1, 0), 9),
    ("BOTTOMPADDING", (0, 0), (-1, 0), 6),
    ("TOPPADDING", (0, 1), (-1, 1), 0),
    ("BOTTOMPADDING", (0, 1), (-1, 1), 8),
]))
story += [quote]

doc.build(story, onFirstPage=header_footer)

source = PdfReader(str(OUTPUT))
replacement = PdfReader(str(PAGE_PDF))
if len(source.pages) != 9 or len(replacement.pages) != 1:
    raise RuntimeError("Unexpected source or replacement page count")

writer = PdfWriter()
for index, page in enumerate(source.pages):
    writer.add_page(replacement.pages[0] if index == 8 else page)
writer.add_metadata({
    "/Title": "AxisDirect - High-Value Customer Identification and Social Influence Mapping",
    "/Author": "HashCase (HashByte Pvt Ltd)",
    "/Subject": "Client case study",
})
with MERGED_PDF.open("wb") as handle:
    writer.write(handle)
MERGED_PDF.replace(OUTPUT)

PAGE_PDF.unlink(missing_ok=True)
print(OUTPUT)
