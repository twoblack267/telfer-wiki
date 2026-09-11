
import fs from 'fs'; import path from 'path'; import matter from 'gray-matter';
const D = process.env.HOME + '/ObsidianVault/Family History/People';
const TAG = /^\\s*-\\s*['"]?redirect['"]?\\s*$/im;
const TIT = /\\bredirect\\b/i;
function isStub(fm){ if(!fm) return false;
  if (TIT.test((fm.title||'').toString())) return true;
  const t = fm.tags;
  if (Array.isArray(t)) return t.some(x=>String(x).trim().toLowerCase()==='redirect');
  if (typeof t === 'string') return t.split(/[,\s]+/).some(x=>x.trim().toLowerCase()==='redirect');
  return false; }
function rawTag(raw){ const e = raw.indexOf('\\n---',3); const h = raw.startsWith('---')? raw.slice(3, e===-1?800:e) : raw.slice(0,800); return TAG.test(h); }
const old=[]; const now=[];
for (const f of fs.readdirSync(D).filter(x=>x.endsWith('.md'))) {
  let raw=''; try { raw = fs.readFileSync(path.join(D,f),'utf-8'); } catch { continue; }
  let fm=null; try { fm = matter(raw).data || null; } catch {}
  const oldHit = ((fm&&fm.title||'').toString().toLowerCase().includes('redirect'));
  const newHit = isStub(fm) || rawTag(raw);
  if (oldHit) old.push(f);
  if (newHit) now.push(f);
}
console.log(JSON.stringify({old: old.length, now: now.length, newly: now.filter(x=>!old.includes(x)), still_stubs: now.filter(x=>old.includes(x))}, null, 1));
