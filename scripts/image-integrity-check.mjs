#!/usr/bin/env node
/**
 * image-integrity-check.mjs — Telfer Wiki photo guard (Skippy, 2026-09-05)
 *
 * WHY: photos were silently vanishing from live pages on every nightly regen.
 * Person pages derive images[] FRESH from the vault .md at each regen, and
 * convert-markdown.mjs only builds images[] from Obsidian inline embeds
 * `![[...]]`. Photos referenced any other way (plain `[[...jpg]]` prose, manual
 * people.json edits, wrong path) are dropped on the next regen and night-watch
 * pushes the blank page live with no alarm. This script is the missing safety
 * net: it audits vault-vs-published image wiring and reports problems so they
 * are caught BEFORE a blank page goes live.
 *
 * OUTPUT (machine JSON to stdout when --json; human lines by default):
 *   {
 *     "ok": true/false,
 *     "vault_embeds": N,          // distinct ![[...jpg]] embeds found in vault .md
 *     "wired_people": {slug: [filenames]},   // what each person thinks they own
 *     "missing_files": [{person, image}],    // embedded/registered but file absent
 *     "unwired_photos": [filenames],         // file in public/ but no person uses it
 *     "dead_duplicates": [[a,b]],            // byte-identical twins (one redundant)
 *     "plain_wikilink_photo_mentions": [{person, file}], // the TRAP: photo cited as [[..jpg]] prose
 *     "recommendation": "list of human buckets"
 *   }
 *
 * AUTO+BOARD MODEL (matches Can Do Board philosophy):
 *   - mechanical (missing file that IS cleanly embedded, or duplicate purge that
 *     is byte-identical + unwired) -> safe to auto-heal.
 *   - judgement (plain-wikilink trap on a photo that looks intended, or any
 *     photo touching a LIVING person) -> CANNOT auto-deploy -> fire a board card.
 *
 * Exit code nonzero => problems found (guard semantics for night-watch caller).
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const REPO = process.env.TELFER_WIKI || path.join(os.homedir(), 'telfer-wiki');
const VAULT = '/Users/marktelfer/ObsidianVault';
const PEOPLE_DIR = path.join(VAULT, 'Family History/People');
const PHOTOS_DIR = path.join(PEOPLE_DIR, 'Photos');
const PUBLIC_IMG = path.join(REPO, 'public/images/people');

const J = (o) => process.argv.includes('--json') ? JSON.stringify(o, null, 1) : textSummary(o);
function textSummary(o){ const L=[]; L.push(`image-integrity check: ok=${o.ok}`); return L.join('\n'); }

// ---- load people.json ----
const people = JSON.parse(fs.readFileSync(path.join(REPO,'src/data/people.json'),'utf-8'));

// 1. what each person REGISTERS (images[] src basename + person_photo)
const wired = {};            // filename -> [slugs]
// 2. what each vault .md EMBEDS as ![[...jpg]] (and plain [[...jpg]] mentions)
const out = {
  ok: true, vault_embeds: 0, wired_people: {},
  missing_files: [], unwired_photos: [], dead_duplicates: [],
  plain_wikilink_photo_mentions: [], recommendation: []
};

for (const p of (people||[])) {
  if (!p || typeof p !== 'object') continue;
  const slug = p.slug;
  out.wired_people[slug] = out.wired_people[slug] || [];
  for (const im of (p.images||[])) {
    const src = typeof im === 'string' ? im : (im?.src||'');
    out.wired_people[slug].push(path.basename(src));
  }
  if (p.person_photo) out.wired_people[slug].push(path.basename(p.person_photo));
  out.wired_people[slug] = [...new Set(out.wired_people[slug])];
}

// filenames referenced by ANY person (normalised key set for trap x-check)
const ownerOf = {};
for (const slug of Object.keys(out.wired_people)) for (const f of out.wired_people[slug]) (ownerOf[f]=ownerOf[f]||[]).push(slug);

// normalise a vault file display-name to a people.json slug key.
// Build a map from full display name -> slug using people.json name parts.
const nameSlugMap = {};
for (const x of (people||[])) {
  if (!x || typeof x!=='object' || !x.slug) continue;
  const nm = ([x.first_name,x.middle_name,x.last_name].filter(Boolean).join(' ')).toLowerCase().replace(/\s+/g,' ');
  if (nm) nameSlugMap[nm] = x.slug;
}
const resolveSlug = (vaultFilename) => {
  const disp = vaultFilename.replace(/\.md$/,'').toLowerCase();
  // 1) exact full-name match (strip a trailing life-range in the filename)
  const clean = disp.replace(/[（(]\s*[\d~?–\u2013\u2014 ]*[）)]\s*$/,'').trim(); // remove (1986-?) / (1884-1951) tail
  if (nameSlugMap[clean]) return nameSlugMap[clean];
  // 2) match on first+last (ignore middle/year) against all
  const parts = clean.split(/\s+/);
  const first = parts[0], last = parts[parts.length-1];
  const hit = Object.keys(nameSlugMap).find(n => {
    const np = n.split(' ');
    return np[0]===first && np[np.length-1]===last;
  });
  return (hit && nameSlugMap[hit]) || null;
};

// public dir contents
const phys = fs.readdirSync(PUBLIC_IMG).filter(f=>/\.(jpg|jpeg|png|gif|webp)$/i.test(f));

// (a) missing_files: a person registers an image whose FILE isn't in public/
for (const [slug, files] of Object.entries(out.wired_people)) for (const f of files) {
  if (!phys.includes(f)) out.missing_files.push({person:slug, image:f});
}
// (b2) unwired_photos: file physically present but *nothing* references it.
// Authoritative reference check = scan EVERY vault .md (people + docs + notes +
// stories) for the filename in an IMAGE context: ![](...) , ![[...]] , or a bare
// URL/path. A photo referenced only inline (story plates) is NOT registered in
// images[] and that is correct — so we must NOT flag story-inline images as dead.
// Only files with ZERO vault image-reference AND zero people.json wiring are dead.
const vaultImageRe = /(!\[\[[^\]]*\.|!\[[^\]]*\]\([^)]*\.|``?[^`]*?)\s*[^\\/\s\])]+\.(?:jpg|jpeg|png|gif|webp)/gi;
const fileReferencedInVault = (fname) => {
  // cheap pre-filter: folder-glob first would be ideal; do a bounded walk of
  // Family History/**/*.md and _assets
  const roots = [path.join(VAULT,'Family History'), path.join(VAULT,'_assets')];
  for (const root of roots) if (fs.existsSync(root)) {
    const walk = (dir) => fs.readdirSync(dir,{withFileTypes:true}).flatMap(e => {
      const fp=path.join(dir,e.name);
      return e.isDirectory()?walk(fp):(e.name.endsWith('.md')?[fp]:[]);
    });
    for (const mdf of walk(root)) {
      try { if (fs.readFileSync(mdf,'utf-8').includes(fname)) return true; } catch {}
    }
  }
  return false;
};
out.unwired_photos = phys.filter(f => !ownerOf[f] && !fileReferencedInVault(f));

// (c) duplicates: identical bytes under different filenames in public dir.
// Classify INTO two buckets so the guard never cries wolf on legitimately-shared
// couple/grave photos (both spouses holding the same image is correct):
//   - legit_shared: EVERY twin is wired to >=1 person (keep — e.g. grave on both
//     spouses, historical plate held by the whole reunion). Not a problem.
//   - redundant_duplicates: >=1 twin is a dead file (referenced by no person and
//     no vault markdown) while its twin is wired -> safe to auto-delete the dead one.
const md5 = {}; for (const f of phys){ const h=crypto.createHash('md5').update(fs.readFileSync(path.join(PUBLIC_IMG,f))).digest('hex'); md5[h]=md5[h]||[]; md5[h].push(f); }
out.legit_shared = [];
out.dead_duplicates = [];
for (const grp of Object.values(md5)) {
  if (grp.length<2) continue;
  const deadTwin = grp.find(f => !ownerOf[f] && !fileReferencedInVault(f));
  if (deadTwin) out.dead_duplicates.push({group:grp, dead:deadTwin, keep:grp.filter(f=>f!==deadTwin)});
  else out.legit_shared.push(grp);   // every twin used -> expected sharing, not a bug
}

// (d) plain-wikilink trap: scan each vault person .md for [[...jpg]] WITHOUT !
//     that matches a public/ or Photos/ file -> candidate intended photo dropped by converter.
//     (Only flag when that file is NOT already wired to the person via images[]/person_photo —
//     if it is wired elsewhere with a ![[...]], the prose mention is just a citation, fine.)
const wiredForPerson = (slug,f) => (out.wired_people[slug]||[]).includes(f);
if (fs.existsSync(PEOPLE_DIR)) for (const f of fs.readdirSync(PEOPLE_DIR)) {
  if (!f.endsWith('.md')) continue;
  const body = fs.readFileSync(path.join(PEOPLE_DIR,f),'utf-8');
  const plain = [...body.matchAll(/\[\[([^\]!][^\]|]*\.(?:jpg|jpeg|png|gif|webp))\]\]/gi)];
  if (plain.length) for (const m of plain) {
    const base = path.basename(m[1].trim());
    if (!base.endsWith('.jpg')) continue;
    const slugGuess = resolveSlug(f);   // display-name -> people.json slug
    // Only a trap if the referenced image is NOT already a wired/registered image
    // for this person AND the image physically exists (someone expects to see it).
    if (slugGuess && !wiredForPerson(slugGuess, base) && (phys.includes(base) ||
        fs.existsSync(path.join(PHOTOS_DIR, base)))) {
      out.plain_wikilink_photo_mentions.push({person: f.replace(/\.md$/,''), slug: slugGuess, file: base});
    }
  }
}

// ── AUTO-FIX (mechanical + safe). Invoked with --autofix. Performs ONLY
// reversible operations that cannot guess intent:
//   (a) copy any missing published file that a person's images[] references, from
//       the vault path the person's people.json record carries (reversible; the
//       nightly regen also does this — this is the belt-and-braces re-check).
//   (b) delete redundant dead duplicate twins (byte-identical to a wired twin AND
//       referenced by no profile / no vault markdown). Reversible via git.
//   (c) NOT auto-handled: plain-[[..]] traps (needs vault content intent) and
//       misplaced unique photos (needs Mark/board decision). Those stay surfaced.
if (process.argv.includes('--autofix')) {
  // (a) missing published files
  for (const {person,image} of out.missing_files) {
    // find the person record + its vault_path for that image
    const rec = (people||[]).find(p=>p && p.slug===person);
    if (!rec) continue;
    const srcRef = (rec.images||[]).find(im => (typeof im==='string'?im:(im?.src||'')).endsWith('/'+image));
    const sep = path.sep;
    const vp = srcRef?.vault_path;
    if (vp && fs.existsSync(vp)) {
      fs.copyFileSync(vp, path.join(PUBLIC_IMG,image));
      console.log(`AUTOFIX copied ${image} from vault`);
    } else if (fs.existsSync(path.join(PHOTOS_DIR,image))) {
      fs.copyFileSync(path.join(PHOTOS_DIR,image), path.join(PUBLIC_IMG,image));
      console.log(`AUTOFIX copied ${image} from Photos/`);
    }
  }
  // (b) redundant dead duplicate twins
  for (const dd of out.dead_duplicates) {
    if (fs.existsSync(path.join(PUBLIC_IMG, dd.dead))) {
      fs.rmSync(path.join(PUBLIC_IMG, dd.dead));
      console.log(`AUTOFIX removed duplicate ${dd.dead} (twin ${dd.keep[0]} kept)`);
    }
  }
}

// conditions — ok=false only when a real blocker exists (would ship a blank/broken
// photo). Advisory findings (misplaced unique photo waiting on Mark, legit shared
// couples photos) do NOT fail the guard.
const redundantDead = out.dead_duplicates;   // already only has dead-twin groups
if (out.missing_files.length || redundantDead.length || out.plain_wikilink_photo_mentions.length) out.ok = false;
const r = out.recommendation;
if (out.missing_files.length) r.push(`FIX (auto): copy missing published file(s) ${out.missing_files.map(m=>m.image).join(', ')} into public/images/people/ + re-wire.`);
for (const dd of redundantDead) r.push(`FIX (auto): duplicate ${dd.dead} is byte-identical to ${dd.keep.join(' & ')} and unused — safe to delete.`);
if (out.plain_wikilink_photo_mentions.length) r.push(`FIX (auto, deceased) / BOARD (living): photo ${[...new Set(out.plain_wikilink_photo_mentions.map(x=>x.file))].join(', ')} referenced as plain [[...]] — convert to ![[...]] in vault (deceased) or board-flag (living).`);
if (out.unwired_photos.length) r.push(`PLACE (board): unique photo(s) ${out.unwired_photos.join(', ')} exist but belong to no profile — decide where they go (likely a living profile).`);
if (out.legit_shared.length) r.push(`INFO: ${out.legit_shared.length} photo group(s) deliberately shared across profiles (couples/graves) — not a problem.`);

process.stdout.write(J(out));
process.exit(out.ok ? 0 : 2);
