// Shared style kit for the DoT deck.
const C = {
  ink:    "1B2A41",  // basalt / fort stone — dominant dark
  ink2:   "2E4057",  // lighter basalt
  lat:    "C1502E",  // laterite — the accent
  sea:    "2E7D74",  // Arabian sea green — support
  card:   "F2F4F6",  // cool card tint
  line:   "D8DEE4",
  white:  "FFFFFF",
  muted:  "6B7785",
  onDark: "E8EDF2",
};

const F = { head: "Cambria", body: "Calibri" };

function titleSlide(pres, { eyebrow, title, sub, footer }) {
  const s = pres.addSlide();
  s.background = { color: C.ink };
  s.addText(eyebrow, {
    x: 0.9, y: 1.5, w: 11.5, h: 0.35, isTextBox: true, margin: 0,
    fontFace: F.body, fontSize: 14, color: C.lat, bold: true, charSpacing: 2,
  });
  s.addText(title, {
    x: 0.9, y: 2.0, w: 11.2, h: 2.0, isTextBox: true, margin: 0,
    fontFace: F.head, fontSize: 44, bold: true, color: C.white, lineSpacing: 50,
  });
  s.addText(sub, {
    x: 0.9, y: 4.15, w: 10.5, h: 0.9, isTextBox: true, margin: 0,
    fontFace: F.body, fontSize: 17, color: C.onDark, lineSpacing: 26,
  });
  if (footer) {
    s.addText(footer, {
      x: 0.9, y: 6.5, w: 11.5, h: 0.4, isTextBox: true, margin: 0,
      fontFace: F.body, fontSize: 12, color: C.muted,
    });
  }
  return s;
}

function sectionSlide(pres, { num, title, sub }) {
  const s = pres.addSlide();
  s.background = { color: C.ink };
  if (num) {
    s.addShape(pres.ShapeType.ellipse, {
      x: 0.9, y: 2.5, w: 0.85, h: 0.85, fill: { color: C.lat },
    });
    s.addText(num, {
      x: 0.9, y: 2.5, w: 0.85, h: 0.85, isTextBox: true, margin: 0,
      fontFace: F.head, fontSize: 30, bold: true, color: C.white,
      align: "center", valign: "middle",
    });
  }
  s.addText(title, {
    x: 2.1, y: 2.45, w: 10.2, h: 1.0, isTextBox: true, margin: 0,
    fontFace: F.head, fontSize: 36, bold: true, color: C.white, valign: "middle",
  });
  if (sub) {
    s.addText(sub, {
      x: 2.1, y: 3.55, w: 9.8, h: 0.8, isTextBox: true, margin: 0,
      fontFace: F.body, fontSize: 16, color: C.onDark, lineSpacing: 24,
    });
  }
  return s;
}

function contentSlide(pres, title, kicker) {
  const s = pres.addSlide();
  s.background = { color: C.white };
  s.addText(title, {
    x: 0.7, y: 0.45, w: 12.0, h: 0.75, isTextBox: true, margin: 0,
    fontFace: F.head, fontSize: 32, bold: true, color: C.ink,
  });
  if (kicker) {
    s.addText(kicker, {
      x: 0.7, y: 1.2, w: 11.5, h: 0.45, isTextBox: true, margin: 0,
      fontFace: F.body, fontSize: 15, color: C.muted, italic: true,
    });
  }
  return s;
}

// A tinted card. Returns nothing; draws at the given rect.
function card(pres, s, { x, y, w, h, fill }) {
  s.addShape(pres.ShapeType.roundRect, {
    x, y, w, h, rectRadius: 0.08,
    fill: { color: fill || C.card },
    line: { color: C.line, width: 0.75 },
  });
}

function numberedCircle(pres, s, { x, y, d, n, color }) {
  s.addShape(pres.ShapeType.ellipse, {
    x, y, w: d, h: d, fill: { color: color || C.lat },
  });
  s.addText(String(n), {
    x, y, w: d, h: d, isTextBox: true, margin: 0,
    fontFace: F.head, fontSize: Math.round(d * 26), bold: true,
    color: C.white, align: "center", valign: "middle",
  });
}

function statBlock(s, { x, y, w, value, label, color, fontSize }) {
  s.addText(value, {
    x, y, w, h: 0.85, isTextBox: true, margin: 0,
    fontFace: F.head, fontSize: fontSize || 40, bold: true, color: color || C.lat,
    valign: "middle",
  });
  s.addText(label, {
    x, y: y + 0.85, w, h: 0.75, isTextBox: true, margin: 0,
    fontFace: F.body, fontSize: 13, color: C.ink2, lineSpacing: 17,
  });
}

function footnote(s, text) {
  s.addText(text, {
    x: 0.7, y: 6.82, w: 12.0, h: 0.35, isTextBox: true, margin: 0,
    fontFace: F.body, fontSize: 9.5, color: C.muted, italic: true,
  });
}

module.exports = { C, F, titleSlide, sectionSlide, contentSlide, card, numberedCircle, statBlock, footnote };
