import fs from 'fs'; import path from 'path'; import matter from 'gray-matter';
const VAULT = process.env.HOME + '/ObsidianVault/Family History/People';
const bad=[];
for (const f of fs.readdirSync(VAULT).filter(x=>x.endsWith('.md'))) {
  const raw = fs.readFileSync(path.join(VAULT,f),'utf-8');
  if (!raw.trim()) continue;
  let fm;
  try { fm = matter(raw).data || null; } catch(e) { bad.push([f,'PARSE: '+e.message.slice(0,90)]); continue; }
  const fn=(fm.first_name||'').toString().trim(), ln=(fm.last_name||'').toString().trim();
  if(!fn||!ln) bad.push([f,`fn=${JSON.stringify(fn)} ln=${JSON.stringify(ln)}`]);
}
console.log('MALFORMED:',bad.length);
bad.slice(0,8).forEach(b=>console.log(' ',b[0],'|',b[1]));
