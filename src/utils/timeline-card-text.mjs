/**
 * Build the text a timeline card shows when it is opened.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every auto-generated birth/death event used to carry the literal string
 * "is born" / "dies, aged 64" as its detail. That was fine when the detail was
 * only ever a caption under the date. Once every entry became an opener for the
 * reader window, all 1,025 of them opened a window containing a three-word
 * fragment — which is what Mark saw.
 *
 * THE RULE THIS CODE OBEYS
 * ------------------------
 * Nothing goes in a card that is not true. So:
 *   - Every sentence is assembled from fields already in the vault-derived
 *     people record. Nothing is invented, estimated or "flavoured up".
 *   - Where a field is missing, the line is OMITTED. A blank line beats a
 *     guess. Dates keep their vault tilde (~1892) and their "?" — an
 *     approximate year is never silently promoted to an exact one.
 *   - A person's own prose (body_markdown) is used verbatim where it exists,
 *     because that prose is the vault text that passed review — not a
 *     machine rewrite of it.
 *   - LIVING PEOPLE: name + birth year only. No narrative, no dates of birth
 *     beyond the year, no family listing. This matches the existing site rule
 *     enforced on the profile pages (`living` branch in people/[slug].astro).
 */

function cleanMarkdown(raw) {
  let t = raw;
  // drop fenced code and images, keep the words
  t = t.replace(/```[\s\S]*?```/g, " ");
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, " ");
  // Obsidian wikilinks -> their label. This MUST come before the markdown-link
  // rule, and it caught 478 cards on the public timeline printing
  // "[[Francis Telfer (1809–1895)]]" verbatim — vault syntax is not page copy.
  t = t.replace(/!?\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, target, alias) => (alias || target || "").trim());
  // Unclosed wikilinks: the vault has lines like "[[Janet Dunlop Lawrie (1811–1902)"
  // with the closing brackets missing. Strip the opening marker so the name
  // still prints instead of leaking "[[". Safety net, not the main rule.
  t = t.replace(/!?\[\[([^\[\]\n]+)/g, (_m, label) => String(label).trim());
  // markdown links -> their label
  t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  // tables -> drop entirely (vitals are rebuilt from fields, not table rows)
  t = t.replace(/^\|.*\|$/gm, " ");
  // emphasis / inline code
  t = t.replace(/\*\*|__|\*|`/g, "");
  // collapse whitespace
  t = t.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n");
  return t.trim();
}

/** Split a body into { heading: text } using ## headings. */
/**
 * Vault blockquotes are editorial bookkeeping: "> De-duplicated 2026-08-30: the
 * Douglas Square narrative is told in full on ...". True, useful to a researcher,
 * pointless and confusing to a cousin reading a card. They are dropped from card
 * copy — the note stays in the vault, which is where it belongs.
 */
function stripQuotes(md) {
  return md
    .split(/\n/)
    .filter((l) => !/^\s*>/.test(l))
    .join("\n");
}

function sections(bodyIn) {
  const body = stripQuotes(bodyIn);
  const out = {};
  const re = /^##\s+(.+?)\s*$/gm;
  const marks = [];
  let m;
  while ((m = re.exec(body))) {
    marks.push({ name: m[1].trim().toLowerCase(), at: m.index, end: m.index + m[0].length });
  }
  for (let i = 0; i < marks.length; i++) {
    const stop = i + 1 < marks.length ? marks[i + 1].at : body.length;
    out[marks[i].name] = body.slice(marks[i].end, stop);
  }
  return out;
}

/** First real prose paragraph of the body, skipping headings/bullets/vitals. */
function leadParagraph(body) {
  const lines = body.split("\n");
  const out = [];
  for (const raw of lines) {
    const l = raw.trim();
    if (!l) {
      if (out.length) break;
      continue;
    }
    if (l.startsWith("#") || l.startsWith("|")) {
      if (out.length) break;
      continue;
    }
    if (/^[-*+]\s/.test(l)) {
      if (out.length) break;
      continue;
    }
    // a vitals-style line ("Born: ... Died: ...") is handled separately
    if (/^(Born|Died|Married|Buried|Baptised|Baptized|Role|Parents|Spouse|Children)\s*:/i.test(l.replace(/\*\*/g, ""))) {
      if (out.length) break;
      continue;
    }
    out.push(l);
    if (out.join(" ").length > 400) break;
  }
  return cleanMarkdown(out.join(" "));
}

/** Pull "Born: ... Died: ... " vitals out of the raw body, verbatim. */
function vitalsLines(body) {
  // The vault writes these bold-wrapped:  **Born:** ca 1826 — Nisbet, Scotland
  // so strip the emphasis BEFORE testing the label, or every vital line is
  // silently skipped (which is exactly what happened on the first build).
  const keep = /^(Born|Baptised|Baptized|Died|Buried|Married|Marriage|Spouse|Wife|Husband)\s*:/i;
  const seen = new Set();
  const out = [];
  for (const raw of body.split("\n")) {
    let l = raw.trim().replace(/^[-*+]\s+/, "").replace(/\*\*/g, "");
    // Split the crammed vitals line into its pipe-separated clauses BEFORE
    // cleaning, so each label keeps only its own value.
    const clauses = l.split(/\s*\|\s*/);
    for (const clause of clauses) {
      const c = clause.replace(/\*/g, "").trim();
      if (!keep.test(c)) continue;
      // One cleaner, not two: a second inline copy of the wikilink rule here is
      // what let the unclosed-link leak survive the fix.
      const flatC = cleanMarkdown(c).replace(/\s+/g, " ").trim();
      if (!flatC || seen.has(flatC)) continue;
      seen.add(flatC);
      out.push(flatC);
      if (out.length >= 6) break;
    }
    continue;
    const flat = l.replace(/\s+/g, " ").trim();
    if (!flat || seen.has(flat)) continue;
    seen.add(flat);
    out.push(flat);
    if (out.length >= 6) break;
  }
  return out;
}

/**
 * Resolve a relationship entry to a human name.
 * Relationship arrays hold SLUGS ("ernest-telfer-1878") for anyone with a
 * profile, and objects with plain_name for anyone withdrawn from publication.
 * Printing the slug was a real defect on the first build — every parent read
 * "Parents: ernest-telfer-1878 and florence-nicholas". A slug must never reach
 * the page: resolve it through the index, and if it will not resolve, drop it.
 */
function names(list, index) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const v of list) {
    let label = "";
    if (typeof v === "string") {
      const rec = index && index.get ? index.get(v) : null;
      label = rec ? rec.display_name || rec.title || "" : "";
      // A slug we cannot resolve would print as "mary-jane-1874" — omit it.
    } else if (v && typeof v === "object") {
      label = v.plain_name || v.display_name || v.name || "";
    }
    label = String(label || "").trim();
    if (label && !/^[a-z0-9]+(-[a-z0-9]+)+$/.test(label)) out.push(label);
  }
  return dedupeByName(out);
}

/**
 * The same parent can appear twice: once as a resolvable slug and once as a
 * withdrawn {"plain_name": "..."} object. Both are the same person, so key on
 * the first two words of the name and keep the longest label (it carries the
 * dates).
 */
function dedupeByName(list) {
  const best = new Map();
  for (const label of list) {
    const key = label.toLowerCase().replace(/[^a-z ]/g, " ").trim().split(/\s+/).slice(0, 2).join(" ");
    const prev = best.get(key);
    if (!prev || label.length > prev.length) best.set(key, label);
  }
  return [...best.values()];
}

function joinList(items) {
  const v = items.filter(Boolean);
  if (v.length === 0) return "";
  if (v.length === 1) return v[0];
  if (v.length === 2) return `${v[0]} and ${v[1]}`;
  return `${v.slice(0, -1).join(", ")} and ${v[v.length - 1]}`;
}

/**
 * @typedef {object} CardPerson
 * @property {string} [display_name]
 * @property {string} [title]
 * @property {string} [lifespan]
 * @property {unknown} [birth_year]
 * @property {unknown} [death_year]
 * @property {string|null} [birth_date]
 * @property {string|null} [death_date]
 * @property {boolean} [is_living]
 * @property {string} [body_markdown]
 * @property {any[]} [parents]
 * @property {any[]} [spouses]
 * @property {any[]} [children]
 * @property {any[]} [roles]
 */

/**
 * The window body for one person.
 * @param {CardPerson} p
 * @param {Map<string, object>} [index] slug -> person record Returns plain text with blank-line
 * paragraphs; the reader renders it as paragraphs.
 */
export function personCardText(p, index) {
  const body = p.body_markdown || "";
  const living = p.is_living === true && (p.death_year == null || p.death_year === "");

  // LIVING: name + birth year only. Deliberately short — see file header.
  //
  // But "living" in this vault often means "death not yet confirmed by two
  // independent sources", NOT "still alive". Gladys Merle Telfer's own note
  // records a 2008 death notice and keeps the flag set pending a second
  // source. Printing "Living." over that would be a flat falsehood, so the
  // card must carry the caveat whenever the record itself raises one.
  if (living) {
    const by = typeof p.birth_year === "number" ? String(p.birth_year) : p.birth_year ? String(p.birth_year) : "";
    const note = /##\s+Research Note/i.test(body) || /not confirmed by two independent sources/i.test(body);
    if (note) {
      const span = (p.lifespan || "").trim();
      return (
        `Dates not yet confirmed by two independent sources, so this profile is held private. ` +
        (span && span !== "?" ? `The vault currently records ${span}.` : by ? `Born ${by}.` : "")
      ).trim();
    }
    return by ? `Born ${by}. Personal details withheld.` : "Personal details withheld.";
  }

  if (body.trim().length < 20) {
    // No prose on record at all: say so plainly rather than pad it.
    const span = (p.lifespan || "").trim();
    return span ? `On record: ${span}. No further detail has been transcribed yet.` : "No detail has been transcribed for this person yet.";
  }

  const secs = sections(body);
  const paras = [];

  // 1. Lead prose, but never the vitals block twice.
  const lead =
    leadParagraph(secs["life summary"] || "") ||
    leadParagraph(secs["biography"] || "") ||
    leadParagraph(secs["life"] || "") ||
    leadParagraph(stripQuotes(body));
  if (lead && lead.length > 20) paras.push(lead);

  // 2. Vitals exactly as the vault words them.
  const v = vitalsLines(stripQuotes(body));
  if (v.length) paras.push(v.join("\n"));

  // 3. Immediate family, from the relationship fields (not inferred).
  const fam = [];
  const par = names(p.parents, index);
  const spo = names(p.spouses, index);
  const chi = names(p.children, index);
  if (par.length) fam.push(`Parents: ${joinList(par.slice(0, 6))}${par.length > 6 ? ` (+${par.length - 6} more)` : ""}.`);
  if (spo.length) fam.push(`Married: ${joinList(spo.slice(0, 4))}.`);
  if (chi.length) fam.push(`Children: ${joinList(chi.slice(0, 8))}${chi.length > 8 ? ` (+${chi.length - 8} more)` : ""}.`);
  // A "Spouse:" vital line and a "Married:" family line say the same thing.
  // Keep the vault's worded vital, drop the generated duplicate.
  const vitalBlob = v.join(" ");
  const famDedup = fam.filter((line) => {
    if (/^(Married|Spouse|Wife|Husband):/.test(line) && /(Spouse|Married|Wife|Husband)\s*:/i.test(vitalBlob)) return false;
    return true;
  });
  if (famDedup.length) paras.push(famDedup.join("\n"));

  // 4. If the vault has a Family Stories block, give its first paragraph.
  const story = leadParagraph(secs["family stories"] || "");
  if (story && story.length > 40 && !paras.some((x) => x.includes(story.slice(0, 60)))) {
    paras.push(story);
  }

  // 5. Evidence caveat, when the vault flags the record as thin.
  const ev = cleanMarkdown(secs["evidence"] || "").split("\n\n")[0];
  if (ev && ev.length > 30) paras.push(ev);

  if (!paras.length) {
    const span = (p.lifespan || "").trim();
    return span ? `On record: ${span}.` : "No detail has been transcribed for this person yet.";
  }
  return paras.join("\n\n");
}
