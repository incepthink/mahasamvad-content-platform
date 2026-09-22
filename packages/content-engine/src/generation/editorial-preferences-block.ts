// The learned editorial preferences, as they reach the model.
//
// A PURE BUILDER IN ITS OWN MODULE, deliberately. Three prompts need it — the /dlo article
// prompt (dlo-article-prompt.ts), the feedback revision (revise-article.ts) and, later, the
// extraction pass that writes these rules — and dlo-article-prompt.ts must not import
// revise-article.ts nor the reverse. Putting the block here is what keeps the wording of the
// precedence rule and the never-a-fact fence IDENTICAL on every path without an import cycle.
//
// ---------------------------------------------------------------------------------------
// WHY THERE ARE TWO PLACEMENTS
// ---------------------------------------------------------------------------------------
//
// EDITORIAL_PREFERENCE_PLACEMENT = system (default) | user.
//
//   system — appended after the five base rules as a `6. LEARNED EDITORIAL PREFERENCES`
//            section of DGIPR_EDITORIAL_SYSTEM_PROMPT. This is LangMem's own shape (the
//            system prompt evolving through feedback), it is in-distribution in FORM for this
//            model — a numbered editorial rule list is exactly what it already receives — and
//            the department has already shown it expects rules to live there, since the five
//            base rules were hand-written into that constant.
//
//   user   — a `### LEARNED EDITORIAL PREFERENCES` block in the user turn, placed AFTER
//            `### REVIEWED NAMES AND DESIGNATIONS` and BEFORE `### HEADLINE / ANGLE`, so the
//            officer's two per-run blocks stay last. This repo's standing belief is that a
//            late block weighs most, which is the whole argument for trying it.
//
// The flag exists because which of the two a 31B instruction-tuned Gemma actually FOLLOWS is
// an empirical question about that model, not something to settle by argument. It is read in
// exactly one place (below), the ARTICLE_POSTER_MODE / SOCIAL_REFERENCE_MODE / ARTICLE_PROVIDER
// idiom, so an A/B is an env flip and a restart rather than a code change.
//
// ---------------------------------------------------------------------------------------
// WHAT IS NOT NEGOTIABLE
// ---------------------------------------------------------------------------------------
//
// THE BASE FIVE RULES ARE NEVER MUTATED. They are the department's constitution, they are
// asserted by the distillation harnesses, and a learned rule only ever EXTENDS them. This
// module appends; it does not rewrite.
//
// NO PREFERENCE MAY EVER INTRODUCE A FACT. That sentence travels in every shape below. It is
// the one way this feature could damage a government article — a rule phrased as "always name
// the Chief Minister" applied to a note that names nobody is an invention — and the fence is
// cheaper stated than guarded.

import { pathToFileURL } from 'node:url';

import { MAX_INJECTED_PREFERENCES } from '@dgipr/schemas';

export const EDITORIAL_PREFERENCE_PLACEMENTS = ['system', 'user'] as const;
export type EditorialPreferencePlacement =
  (typeof EDITORIAL_PREFERENCE_PLACEMENTS)[number];

/**
 * Where the learned rules go. The ONE place EDITORIAL_PREFERENCE_PLACEMENT is read.
 *
 * Unset, blank or unrecognised all mean `system`, which is the default. Unlike
 * `articleProvider()` this does not throw on a typo: the two placements produce the same
 * rules in a different position, so falling back costs a worse A/B rather than a wrong
 * article — and failing every /dlo run over a mistyped env line would be the larger harm.
 */
export function editorialPreferencePlacement(): EditorialPreferencePlacement {
  return process.env.EDITORIAL_PREFERENCE_PLACEMENT?.trim().toLowerCase() ===
    'user'
    ? 'user'
    : 'system';
}

/** The user-turn heading. Shared so the eval grader's split list cannot drift from it. */
export const EDITORIAL_PREFERENCES_HEADING =
  '### LEARNED EDITORIAL PREFERENCES';

/**
 * Trim, drop the empties, de-duplicate and cap.
 *
 * De-duplication is by exact trimmed text and is not a substitute for Phase 2's
 * consolidation — it is here because the caller may legitimately hand over the same rule
 * twice (a scope-'both' rule and its 'news' twin), and sending it twice teaches the model
 * that repetition is how emphasis works.
 *
 * The cap is applied LAST, so it keeps the highest-ranked distinct rules rather than the
 * highest-ranked slots. Ordering is the caller's — listActiveEditorialPreferences already
 * returns them by reinforcement then recency, and re-sorting here would hide that.
 */
export function cappedPreferences(
  rules: readonly string[],
  limit = MAX_INJECTED_PREFERENCES,
): string[] {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const rule of rules) {
    const trimmed = rule.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) continue;
    seen.add(trimmed);
    kept.push(trimmed);
    if (kept.length >= Math.max(0, limit)) break;
  }
  return kept;
}

// The precedence rule, in one place so the three shapes below cannot state it differently.
// It mirrors PRECEDENCE_RULE in simple-article-prompt.ts without importing the non-DLO
// specification — the /dlo prompt is a separate product contract and must not start
// inheriting that file's wording by the back door.
//
// Three sentences, three jobs: what these are, what they beat, and what beats them. The
// officer's own two blocks win because they were written for THIS article, which is the
// distinction a standing rule cannot make for itself.
const PRECEDENCE_LINES = [
  'These are standing preferences learned from officer feedback on earlier articles.',
  'Where one conflicts with the general editorial rules, follow the preference.',
  'Where one conflicts with the HEADLINE / ANGLE or OFFICER REQUEST the officer wrote for this article, follow those.',
] as const;

// The fence. Stated as its own sentence rather than folded into the precedence lines, for the
// reason NO_TEXT_RULE is phrased the way it is: a rule buried inside a longer clause stops
// being read as absolute.
const NEVER_A_FACT_LINE =
  'No preference may ever introduce a fact: never a name, date, amount, designation, scheme name, place, figure or quotation that the source does not contain.';

/**
 * The `6. LEARNED EDITORIAL PREFERENCES` section appended to the base system prompt.
 *
 * Returns `''` when there is nothing to say, so the caller can concatenate unconditionally
 * and a run with no rules produces a system message that is byte-identical to today's.
 */
export function editorialPreferencesSystemSection(
  rules: readonly string[],
  limit = MAX_INJECTED_PREFERENCES,
): string {
  const kept = cappedPreferences(rules, limit);
  if (kept.length === 0) return '';
  return [
    '',
    '6. LEARNED EDITORIAL PREFERENCES:',
    ...PRECEDENCE_LINES.map((line) => `   - ${line}`),
    `   - ${NEVER_A_FACT_LINE}`,
    ...kept.map((rule) => `   * ${rule}`),
  ].join('\n');
}

/**
 * The `### LEARNED EDITORIAL PREFERENCES` block for the user turn.
 *
 * Returns `[]` when there is nothing to say — the DLO prompt builder spreads this, so an
 * empty array leaves the prompt byte-identical. That byte-identity is what keeps
 * `capture-dlo-distillation.ts` able to reconstruct a historical prompt faithfully, and it is
 * the decisive assertion in the tests.
 */
export function editorialPreferencesUserBlock(
  rules: readonly string[],
  limit = MAX_INJECTED_PREFERENCES,
): string[] {
  const kept = cappedPreferences(rules, limit);
  if (kept.length === 0) return [];
  return [
    '',
    EDITORIAL_PREFERENCES_HEADING,
    '',
    ...PRECEDENCE_LINES,
    NEVER_A_FACT_LINE,
    '',
    ...kept.map((rule) => `- ${rule}`),
  ];
}

/**
 * The `<LEARNED_PREFERENCES>` block for the feedback revision prompt.
 *
 * THIS IS NOT OPTIONAL, and the repo has been bitten by exactly this omission before: the
 * feedback path had never seen the officer's HEADLINE / ANGLE at all, so a revision rewrote
 * the article with no knowledge of it. Without this block, every feedback round would
 * silently undo what the department has learned — the rules would steer the first draft and
 * then be argued away by the first "make the opening punchier".
 *
 * Placed IMMEDIATELY BEFORE `<FEEDBACK>` by the caller, so this round's feedback — the most
 * recent statement of what the officer wants — is the last thing the model reads. The tag's
 * `purpose` says `not_fact_source` for the same reason every other block there does.
 */
export function editorialPreferencesRevisionBlock(
  rules: readonly string[],
  limit = MAX_INJECTED_PREFERENCES,
): string[] {
  const kept = cappedPreferences(rules, limit);
  if (kept.length === 0) return [];
  return [
    '<LEARNED_PREFERENCES purpose="standing_editorial_rules_not_fact_source">',
    ...PRECEDENCE_LINES,
    NEVER_A_FACT_LINE,
    ...kept.map((rule) => `- ${rule}`),
    '</LEARNED_PREFERENCES>',
  ];
}

// Run directly (FREE — no model call, no network):
//   tsx src/generation/editorial-preferences-block.ts
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  let failures = 0;
  const check = (label: string, condition: boolean): void => {
    if (condition) console.log(`  ok    ${label}`);
    else {
      failures += 1;
      console.error(`  FAIL  ${label}`);
    }
  };

  const rules = [
    'शीर्षक १० शब्दांच्या आत ठेवा.',
    'मंत्र्यांचे धोरणात्मक विधान पहिल्या परिच्छेदात द्या.',
  ];

  console.log('\n=== nothing is emitted when there are no rules ===');
  check(
    'the system section is empty',
    editorialPreferencesSystemSection([]) === '',
  );
  check(
    'the user block is an empty array',
    editorialPreferencesUserBlock([]).length === 0,
  );
  check(
    'the revision block is an empty array',
    editorialPreferencesRevisionBlock([]).length === 0,
  );
  check(
    'blank and whitespace-only rules count as none',
    editorialPreferencesUserBlock(['', '   ', '\n']).length === 0,
  );

  console.log('\n=== the precedence rule and the fence reach every shape ===');
  for (const [name, text] of [
    ['system section', editorialPreferencesSystemSection(rules)],
    ['user block', editorialPreferencesUserBlock(rules).join('\n')],
    ['revision block', editorialPreferencesRevisionBlock(rules).join('\n')],
  ] as const) {
    check(
      `${name}: says these are standing preferences from feedback`,
      text.includes('standing preferences learned from officer feedback'),
    );
    check(
      `${name}: a preference beats the general editorial rules`,
      text.includes('follow the preference'),
    );
    check(
      `${name}: the officer's own blocks beat a preference`,
      text.includes('HEADLINE / ANGLE or OFFICER REQUEST') &&
        text.includes('follow those'),
    );
    check(
      `${name}: no preference may ever introduce a fact`,
      text.includes('No preference may ever introduce a fact'),
    );
    check(
      `${name}: carries every rule verbatim`,
      rules.every((rule) => text.includes(rule)),
    );
  }

  console.log('\n=== the cap is enforced, and ordering is the caller’s ===');
  const many = Array.from({ length: 30 }, (_, i) => `नियम ${i + 1}.`);
  const capped = cappedPreferences(many);
  check(
    `at most MAX_INJECTED_PREFERENCES (${MAX_INJECTED_PREFERENCES}) survive`,
    capped.length === MAX_INJECTED_PREFERENCES,
  );
  check(
    'the FIRST rules survive — the caller ranked them, this must not re-sort',
    capped[0] === 'नियम 1.' &&
      capped[MAX_INJECTED_PREFERENCES - 1] ===
        `नियम ${MAX_INJECTED_PREFERENCES}.`,
  );
  check(
    'the block honours the cap too',
    editorialPreferencesUserBlock(many).filter((line) => line.startsWith('- '))
      .length === MAX_INJECTED_PREFERENCES,
  );
  check(
    'an explicit smaller limit is honoured',
    cappedPreferences(many, 3).length === 3,
  );
  check(
    'a duplicate rule is sent once',
    cappedPreferences(['अ.', ' अ. ', 'ब.']).length === 2,
  );

  console.log('\n=== the placement flag ===');
  const restore = process.env.EDITORIAL_PREFERENCE_PLACEMENT;
  delete process.env.EDITORIAL_PREFERENCE_PLACEMENT;
  check(
    'unset defaults to system',
    editorialPreferencePlacement() === 'system',
  );
  process.env.EDITORIAL_PREFERENCE_PLACEMENT = ' User ';
  check(
    'trimmed and lowercased before comparison',
    editorialPreferencePlacement() === 'user',
  );
  process.env.EDITORIAL_PREFERENCE_PLACEMENT = 'sytsem';
  check(
    'an unrecognised value falls back to system rather than failing the run',
    editorialPreferencePlacement() === 'system',
  );
  if (restore === undefined) delete process.env.EDITORIAL_PREFERENCE_PLACEMENT;
  else process.env.EDITORIAL_PREFERENCE_PLACEMENT = restore;

  console.log('\n=== the user block’s own shape ===');
  const block = editorialPreferencesUserBlock(rules);
  check(
    'it opens with a blank line, as every other DLO block does',
    block[0] === '',
  );
  check(
    'the heading is the one the eval grader splits on',
    block[1] === EDITORIAL_PREFERENCES_HEADING,
  );
  check(
    'every rule is a plain list row',
    block.filter((line) => line.startsWith('- ')).length === rules.length,
  );

  console.log('\n=== the revision block’s own shape ===');
  const revision = editorialPreferencesRevisionBlock(rules);
  check(
    'it is fenced as a standing rule set and not as a fact source',
    revision[0] ===
      '<LEARNED_PREFERENCES purpose="standing_editorial_rules_not_fact_source">',
  );
  check(
    'it is closed',
    revision[revision.length - 1] === '</LEARNED_PREFERENCES>',
  );

  if (failures > 0) process.exitCode = 1;
  else console.log('\nAll editorial-preferences-block checks passed.');
}
