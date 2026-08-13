const assert = require("node:assert/strict");
const test = require("node:test");

const {
  GUIDELINE_MESSAGE,
  checkBadWords,
  normalizeForFilter,
} = require("../../server/moderation/badWords");

function assertBlocked(value) {
  assert.deepEqual(checkBadWords(value), {
    ok: false,
    reason: GUIDELINE_MESSAGE,
  });
}

test("blocks every English and Hindi entry shipped by profanity-hindi", () => {
  const dictionaries = [
    require("profanity-hindi/data/english-bad-words"),
    require("profanity-hindi/data/hindi-bad-words"),
  ];

  for (const dictionary of dictionaries) {
    for (const term of Object.keys(dictionary)) {
      assertBlocked(term);
    }
  }
});

test("blocks standalone romanized Indic terms that were only present in phrases", () => {
  const individualTerms = [
    "aand",
    "balatkar",
    "bhadva",
    "bhosad",
    "bhosadi",
    "chinaal",
    "chuse",
    "fuddi",
    "ghand",
    "haramkhor",
    "jhaat",
    "kanjar",
    "lavda",
    "madar",
    "raand",
    "suwar",
    "tatti",
  ];

  for (const term of individualTerms) {
    assertBlocked(term);
  }
});

test("blocks native Devanagari, Gurmukhi, and Perso-Arabic terms", () => {
  const nativeTerms = [
    "मादरचोद",
    "भोसड़ी",
    "चूतिया",
    "गांडू",
    "हरामज़ादा",
    "ਲੰਡ",
    "ਭੈਣਚੋਦ",
    "ਫੁੱਦੂ",
    "بہنچود",
    "بھوسڑی",
    "رنڈی",
  ];

  for (const term of nativeTerms) {
    assertBlocked(term);
  }
});

test("blocks common character and separator evasions", () => {
  const evasions = [
    "f.u.c.k",
    "f u c k",
    "f🖕u🖕c🖕k",
    "fuuuuck",
    "fúck",
    "ＦＵＣＫ",
    "ѕhіt",
    "sh1t",
    "sh1t123",
    "f2u2c2k",
    "fuck123",
    "fuck!",
    "m@d@rch0d",
    "m@d@rch0d!123",
    "mаdаrchоd",
    "m-a-d-a-r-c-h-o-d",
    "b#ench0d",
    "bhen\u200Bchod",
    "भोस\u200Dड़ी",
    "ਭੈਣ-ਚੋਦ",
  ];

  for (const value of evasions) {
    assertBlocked(value);
  }
});

test("blocks the custom banana swear term", () => {
  for (const value of ["banana", "B.A.N.A.N.A.", "banana123"]) {
    assertBlocked(value);
  }
});

test("normalization preserves Indic marks while folding Latin evasions", () => {
  assert.equal(normalizeForFilter("FÚСK"), "fuck");
  assert.equal(normalizeForFilter("भोस\u200Dड़ी"), "भोसड़ी");
  assert.equal(normalizeForFilter("ਭੈਣ-ਚੋਦ"), "ਭੈਣ ਚੋਦ");
});

test("does not substring-match safe school words and phrases", () => {
  const allowedMessages = [
    "Please finish the class assignment.",
    "Mahatma Gandhi is in the history chapter.",
    "Branding is part of the business studies project.",
    "We are studying sexual reproduction in biology.",
    "The peacock is India's national bird.",
    "Please graph the assessment results.",
    "The grape experiment is due tomorrow.",
    "Hello, thanks for sending the notes.",
  ];

  for (const message of allowedMessages) {
    assert.deepEqual(checkBadWords(message), { ok: true });
  }
});

test("allows empty and non-string input", () => {
  for (const value of [null, undefined, "", "   ", 42, {}]) {
    assert.deepEqual(checkBadWords(value), { ok: true });
  }
});
