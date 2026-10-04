// Google Docs(웹에 게시된 문서)를 읽어 블로그 글 데이터(data/posts.js)를 만든다.
//
// 문서 작성 규칙
//   - 글은 "MM/DD- 메모" 또는 "MM/DD(요일)- 메모" 형식의 날짜 줄로 시작한다.
//   - 분류는 홈페이지 관심 분야 세 가지뿐이다. 날짜 줄에 [Reasoning] / [LLM] / [VLA]를 넣으면
//     그 분류를 쓰고, 넣지 않으면 본문 키워드로 자동 분류한다.
//   - 그 밖의 대괄호는 태그가 된다: "10/04- [Reasoning][EarlyFailure] 메모"
//   - 제목은 글 안의 첫 제목(Heading)으로 정하고, 없으면 날짜 줄의 메모를 쓴다.
//   - 본문 그림은 assets/blog/에 내려받아 함께 올린다(사이트 보안 정책상 외부 그림은 표시되지 않음).
//
// 실행: BLOG_DOC_URL="<게시된 문서 주소>" node scripts/build-blog.mjs
// 문서 주소는 저장소에 남기지 않도록 GitHub Secret(BLOG_DOC_URL)으로만 전달한다.

import { writeFile, mkdir, readFile, readdir, rm, access } from "node:fs/promises";
import { createHash } from "node:crypto";

const DOC_URL = process.env.BLOG_DOC_URL;
const DOC_FILE = process.env.BLOG_DOC_FILE; // 로컬 확인용: 저장해 둔 게시 문서 HTML
const OUT = new URL("../data/posts.js", import.meta.url);
const IMG_DIR = new URL("../assets/blog/", import.meta.url);

if (!DOC_URL && !DOC_FILE) {
  console.log("BLOG_DOC_URL이 설정되지 않아 동기화를 건너뜁니다.");
  process.exit(0);
}

let html;
if (DOC_FILE) {
  html = await readFile(DOC_FILE, "utf8");
} else {
  const res = await fetch(DOC_URL, { headers: { "user-agent": "blog-sync" } });
  if (!res.ok) throw new Error(`문서를 가져오지 못했습니다: HTTP ${res.status}`);
  html = await res.text();
}

/* ---------- 1. 서식 클래스 찾기 (Google Docs는 굵기·글꼴·들여쓰기를 CSS 클래스로 표현) ---------- */
// 게시 페이지에는 <style>이 둘 있다(첫째는 Google 화면용). 문서 서식은 둘째에 있으므로 모두 읽는다.
const styleText = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join("\n");
const classRules = [...styleText.matchAll(/\.(c\d+)\{([^}]*)\}/g)];
const classesWhere = (test) => new Set(classRules.filter(([, , rule]) => test(rule)).map(([, cls]) => cls));
const boldClasses = classesWhere((r) => /font-weight:700/.test(r));
const monoClasses = classesWhere((r) => /font-family:"?[^;"]*(Mono|Courier|Consolas|Code)/i.test(r)); // 수식·코드
const quoteClasses = classesWhere((r) => /margin-left:[1-9]/.test(r) && /margin-right:[1-9]/.test(r)); // 인용문
const indentOf = new Map( // 목록 들여쓰기: 36pt = 1단계, 72pt = 2단계
  classRules
    .map(([, cls, rule]) => [cls, Number((rule.match(/margin-left:([\d.]+)pt/) || [])[1])])
    .filter(([, pt]) => pt >= 36)
    .map(([cls, pt]) => [cls, Math.round(pt / 36) - 1])
);
const classesOf = (attrs) => ((attrs || "").match(/class="([^"]*)"/) || [, ""])[1].split(/\s+/);
const hasClass = (attrs, set) => classesOf(attrs).some((c) => set.has(c));

/* ---------- 2. 본문 블록 추출 ---------- */
// 문서 본문만 읽는다. 뒤따르는 Google 스크립트 안의 "<p" 같은 글자가 글에 섞이지 않게 첫 <script> 앞에서 자른다.
const body = (html.split(/<div id="contents"[^>]*>/)[1] || html).split(/<script\b/i)[0];
const BLOCK = /<(p|h[1-6]|ul|ol|table)\b([^>]*)>([\s\S]*?)<\/\1>/g;

const decode = (s) =>
  s.replace(/&nbsp;/g, " ").replace(/&#39;/g, "'").replace(/&quot;/g, '"')
   .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const escapeHtml = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const textOf = (frag) => decode(frag.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();

// Google 추적 링크(https://www.google.com/url?q=...)를 실제 주소로 되돌린다
const realHref = (href) => {
  const h = decode(href);
  const m = h.match(/^https:\/\/www\.google\.com\/url\?q=([^&]+)/);
  const url = m ? decodeURIComponent(m[1]) : h;
  return /^https?:\/\//.test(url) ? url : null;
};

// 본문 그림은 사이트 보안 정책(img-src 'self') 때문에 외부 주소로 띄울 수 없다.
// 우선 자리표시자로 두고, 6단계에서 assets/blog/로 내려받은 뒤 실제 경로로 바꾼다.
const images = [];
const imageToken = (src, alt) => {
  images.push({ src: decode(src), alt });
  return `@@IMG${images.length - 1}@@`;
};

// 허용한 서식(굵게, 코드, 링크, 그림)만 남기고 나머지 태그는 지운다
function inline(frag) {
  let out = "";
  const TOKEN = /<span([^>]*)>([\s\S]*?)<\/span>|<a [^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>|<br[^>]*>|<img\b([^>]*)>|([^<]+)|<[^>]+>/g;
  for (const m of frag.matchAll(TOKEN)) {
    if (m[1] !== undefined) {
      const inner = inline(m[2]);
      if (!inner.trim()) out += inner;
      else if (hasClass(m[1], monoClasses)) out += `<code>${inner}</code>`;
      else if (hasClass(m[1], boldClasses)) out += `<strong>${inner}</strong>`;
      else out += inner;
    } else if (m[5] !== undefined) {
      const src = (m[5].match(/src="([^"]+)"/) || [])[1];
      const alt = decode((m[5].match(/alt="([^"]*)"/) || [])[1] || "") || decode((m[5].match(/title="([^"]*)"/) || [])[1] || "");
      if (src && /^https:\/\//.test(decode(src))) out += imageToken(src, alt);
    } else if (m[3] !== undefined) {
      const href = realHref(m[3]);
      const label = escapeHtml(textOf(m[4]));
      out += href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener">${label}</a>` : label;
    } else if (m[0].startsWith("<br")) {
      out += "<br>";
    } else if (m[6] !== undefined) {
      out += escapeHtml(decode(m[6]));
    }
  }
  return out
    .replace(/\*\*([^*<>]+?)\*\*/g, "<strong>$1</strong>") // 문서에 마크다운째 붙여넣은 **굵게** 표시
    .replace(/<strong>\s*<\/strong>/g, "").replace(/<\/strong><strong>/g, "").replace(/<\/code><code>/g, "");
}

// 제목은 글 하나를 다 읽은 뒤 단계를 맞추므로(4단계) 여기서는 원래 단계만 기록해 둔다
function renderBlock(tag, attrs, inner) {
  if (/^h[1-6]$/.test(tag)) {
    const html = inline(inner).replace(/<\/?strong>/g, "").trim(); // 제목 전체를 굵게 한 표시는 뺀다
    return html ? { level: Number(tag[1]), text: textOf(inner), html } : "";
  }
  if (tag === "p") {
    const content = inline(inner).trim();
    if (!content || /^(<br>\s*)+$/.test(content)) return ""; // 문서의 빈 줄
    const bare = content.replace(/<\/?(strong|code)>/g, "").trim();
    if (/^(@@IMG\d+@@\s*)+$/.test(bare)) return `<figure>${bare}</figure>`; // 그림만 있는 문단
    return hasClass(attrs, quoteClasses) ? `<blockquote><p>${content}</p></blockquote>` : `<p>${content}</p>`;
  }
  if (tag === "ul" || tag === "ol") {
    const items = [...inner.matchAll(/<li\b([^>]*)>([\s\S]*?)<\/li>/g)].map((m) => {
      const depth = Math.max(0, ...classesOf(m[1]).map((c) => indentOf.get(c) || 0));
      return `<li${depth ? ` class="lvl-${Math.min(depth, 3)}"` : ""}>${inline(m[2]).trim()}</li>`;
    });
    return `<${tag}>${items.join("")}</${tag}>`;
  }
  if (tag === "table") {
    const rows = [...inner.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map((r, i) => {
      const cells = [...r[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map((c) => {
        const cellText = [...c[1].matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)].map((p) => inline(p[1]).trim()).filter(Boolean).join("<br>");
        return i === 0 ? `<th>${cellText}</th>` : `<td>${cellText}</td>`;
      });
      return `<tr>${cells.join("")}</tr>`;
    });
    return `<div class="table-wrap"><table>${rows.join("")}</table></div>`;
  }
  return "";
}

/* ---------- 3. 날짜 줄 기준으로 글 나누기 ---------- */
const DATE_LINE = /^(\d{1,2})\/(\d{1,2})(?:\s*\([^)]*\))?\s*[-–—:]\s*(.*)$/;
const today = new Date();
const posts = [];
let current = null;

for (const m of body.matchAll(BLOCK)) {
  const [, tag, attrs, inner] = m;
  const text = textOf(inner);
  const date = tag === "p" ? text.match(DATE_LINE) : null;
  if (date) {
    const month = Number(date[1]);
    const day = Number(date[2]);
    let year = today.getFullYear();
    if (new Date(year, month - 1, day) > today) year -= 1; // 미래 날짜면 작년 글로 본다
    current = { year, month, day, memo: date[3].trim(), blocks: [], headings: [], text: [], prose: [] };
    posts.push(current);
    continue;
  }
  if (!current) continue; // 첫 날짜 줄 이전(문서 제목 등)은 건너뜀
  if (/^h[1-6]$/.test(tag) && text) current.headings.push(text);
  if (text) current.text.push(text);
  if (text && tag === "p") current.prose.push(text); // 요약은 문단에서만 (표 글자가 붙어 나오지 않게)
  const rendered = renderBlock(tag, attrs, inner);
  if (rendered) current.blocks.push(rendered);
}

/* ---------- 3-1. 제목 단계 맞추기 ----------
   문서마다 제목 크기를 다르게 쓴 경우가 많아(어떤 글은 장 제목이 제목1, 어떤 글은 제목2),
   원래 크기 대신 구조로 단계를 정한다.
   - "1. 연구 개요"처럼 번호로 시작하는 장 → h2, "7.1 데이터" 같은 절 → h3
   - 첫 번호 장 앞의 제목들(문서 제목·부제) → 글 제목 영역으로 보낸다
   - 번호 없는 제목 → 속한 장 안에서 원래 크기 순서대로 한 단계씩 아래
   - 번호 장이 없는 글 → 맨 앞 제목을 글 제목으로 보고, 나머지는 원래 크기 순서대로 h2부터 */
const CHAPTER = /^(\d+)\s*[.)]\s|^부록/;
const SECTION = /^\d+\.\d+/;
const isHeading = (b) => typeof b === "object";

function normalizeHeadings(post) {
  const blocks = post.blocks;
  const numbered = blocks.some((b) => isHeading(b) && CHAPTER.test(b.text) && !SECTION.test(b.text));
  const firstBody = numbered
    ? blocks.findIndex((b) => isHeading(b) && (CHAPTER.test(b.text) || SECTION.test(b.text)))
    : blocks.findIndex((b) => !isHeading(b));
  const titleBlock = blocks.slice(0, Math.max(0, firstBody)).filter(isHeading);
  post.titleHeadings = titleBlock.map((h) => h.text);

  const out = [];
  let base = 1;         // 지금 속한 장/절의 단계
  let rankOf = null;    // 번호 없는 제목의 원래 크기 → 순서
  const ranksFrom = (start) => {
    const levels = [];
    for (let j = start; j < blocks.length; j++) {
      const b = blocks[j];
      if (!isHeading(b)) continue;
      if (numbered && j > start && CHAPTER.test(b.text) && !SECTION.test(b.text)) break;
      if (numbered && (CHAPTER.test(b.text) || SECTION.test(b.text))) continue;
      if (!levels.includes(b.level)) levels.push(b.level);
    }
    levels.sort((a, b) => a - b);
    return new Map(levels.map((lv, i) => [lv, i + 1]));
  };
  if (!numbered) rankOf = ranksFrom(Math.max(0, firstBody));

  blocks.forEach((b, i) => {
    if (!isHeading(b)) return out.push(b);
    if (titleBlock.includes(b)) {
      out.push({ title: true, ...b }); // 5단계에서 글 제목·부제로 쓰고 남는 것만 본문에 둔다
      return;
    }
    let level;
    if (numbered && SECTION.test(b.text)) { level = 3; base = 3; }
    else if (numbered && CHAPTER.test(b.text)) { level = 2; base = 2; rankOf = ranksFrom(i); }
    else level = (numbered ? base : 1) + (rankOf.get(b.level) || 1);
    level = Math.min(level, 4);
    out.push(`<h${level}>${b.html}</h${level}>`);
  });
  post.blocks = out;
}
posts.forEach(normalizeHeadings);

/* ---------- 4. 분류·제목·요약 ---------- */
// 분류는 홈페이지 Research Interests의 세 분야로만 한다.
// 날짜 줄의 [Reasoning] / [LLM] / [VLA]가 우선이고, 없으면 본문 키워드가 가장 많은 분야로 정한다.
const CATEGORIES = [
  { id: "reasoning", tag: /^(reasoning|reliability|추론|신뢰)/i,
    words: ["reliab", "신뢰", "verification", "검증", "failure", "실패", "uncertainty", "불확실", "calibration", "reasoning", "추론", "hallucination", "환각", "early warning", "robust"] },
  { id: "llm-eval", tag: /^(llm|eval|평가)/i,
    words: ["llm", "evaluation", "평가", "benchmark", "벤치마크", "judge", "metric", "leaderboard", "리더보드", "에이전트", "agent"] },
  { id: "vla", tag: /^(vla|vision|로봇|행동)/i,
    words: ["vla", "vision-language-action", "robot", "로봇", "embodied", "action", "행동", "vlm", "vision-language", "grounding", "manipulation", "자율주행", "차선"] },
];
const score = (text, words) => words.reduce((n, w) => n + (text.toLowerCase().split(w.toLowerCase()).length - 1), 0);

function classify(post) {
  for (const b of post.brackets) {
    const hit = CATEGORIES.find((c) => c.tag.test(b));
    if (hit) return hit.id;
  }
  const all = `${post.memo} ${post.text.join(" ")}`;
  return CATEGORIES.map((c) => [c.id, score(all, c.words)]).sort((a, b) => b[1] - a[1])[0][0];
}
const isCategoryTag = (b) => CATEGORIES.some((c) => c.tag.test(b)) || /^(AI\s?소식|연구\s?일지)$/.test(b);

// 본문에 자주 나오는 영문 고유명사·약어를 태그로 쓴다 (예: SAM2, LLM)
function tagsOf(post) {
  const counts = new Map();
  const ACRONYM = /^([A-Z][A-Za-z]*\d[\w-]*|[A-Z]{2,6}|[A-Z][a-z]+[A-Z][\w-]*)$/; // SAM2, VLM, IoU, RobustPVOS
  const STOP = /^(THINK|LOOK|STOP|GT|RQ\d*|H\d|IWAIT|TODO|AND|OR|NOT)$/;
  for (const w of post.text.join(" ").match(/\b[A-Z][A-Za-z0-9-]{1,}\b/g) || []) {
    if (!ACRONYM.test(w) || STOP.test(w)) continue;
    counts.set(w, (counts.get(w) || 0) + 1);
  }
  return [...counts.entries()].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([w]) => w);
}

const pad = (n) => String(n).padStart(2, "0");
const seen = new Map();
const out = posts
  .filter((p) => p.blocks.length)
  .map((p) => {
    const dateStr = `${p.year}-${pad(p.month)}-${pad(p.day)}`;
    const n = (seen.get(dateStr) || 0) + 1;
    seen.set(dateStr, n);
    // 날짜 줄의 대괄호: 분야([Reasoning]/[LLM]/[VLA])가 아니면 태그로 붙인다 (예: [EarlyFailure])
    p.brackets = [...p.memo.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1].trim());
    const extraTags = p.brackets.filter((b) => !isCategoryTag(b));
    const memo = p.memo.replace(/\[[^\]]*\]/g, "").replace(/^[\s\-–—:]+/, "").trim();
    // 첫 번호 장 앞의 제목들(titleHeadings)에서 글 제목을 고른다.
    // "연구계획서"처럼 문서 종류만 적힌 첫 제목이면 바로 다음 제목(실제 주제)을 제목으로 쓴다
    const th = p.titleHeadings;
    const generic = th[0] && /계획서|일지|정리|메모|기록|보고서$/.test(th[0]) && th[1];
    const title = (generic ? th[1] : th[0]) || memo || `${dateStr} 기록`;
    const kicker = generic ? th[0] : "";
    // 제목·kicker로 쓰지 않은 앞부분 제목(부제)은 본문 첫머리에 부제로 남긴다
    const html = p.blocks
      .map((b) => (typeof b === "string" ? b : b.text === title || b.text === kicker ? "" : `<p class="lede">${b.html}</p>`))
      .filter(Boolean)
      .join("\n");
    const plain = p.prose.join(" ").replace(/@@IMG\d+@@/g, "").replace(/\s+/g, " ").trim();
    return {
      id: `${dateStr}-${n}`,
      date: dateStr,
      category: classify(p),
      title,
      kicker,
      memo: memo && memo !== title ? memo : "",
      summary: plain.length > 160 ? `${plain.slice(0, 160).trim()}…` : plain,
      tags: [...extraTags, ...tagsOf(p).filter((t) => !extraTags.includes(t))].slice(0, 5),
      html,
    };
  })
  .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id.localeCompare(a.id)));

/* ---------- 5. 그림 내려받기 ----------
   파일 이름을 그림 내용(sha1)으로 정해, 같은 그림은 몇 번을 다시 받아도 파일이 바뀌지 않는다.
   문서에서 지운 그림은 assets/blog/에서도 지운다(받기에 하나라도 실패한 회차는 건너뜀). */
const EXT = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };
const usedImages = new Set();
const imagePaths = [];
let imageFailed = false;
for (const [i, img] of images.entries()) {
  try {
    const r = await fetch(img.src, { headers: { "user-agent": "blog-sync" } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const ext = EXT[(r.headers.get("content-type") || "").split(";")[0].trim()];
    if (!ext) throw new Error(`지원하지 않는 형식 ${r.headers.get("content-type")}`);
    const buf = Buffer.from(await r.arrayBuffer());
    const name = `${createHash("sha1").update(buf).digest("hex").slice(0, 16)}.${ext}`;
    const file = new URL(name, IMG_DIR);
    if (!(await access(file).then(() => true, () => false))) {
      await mkdir(IMG_DIR, { recursive: true });
      await writeFile(file, buf);
    }
    usedImages.add(name);
    imagePaths[i] = { name, alt: img.alt };
  } catch (e) {
    imageFailed = true;
    console.warn(`그림 ${i + 1}을(를) 받지 못해 빼고 올립니다: ${e.message}`);
  }
}
for (const p of out) {
  p.html = p.html
    .replace(/@@IMG(\d+)@@/g, (_, i) => {
      const img = imagePaths[Number(i)];
      return img ? `<img src="../assets/blog/${img.name}" alt="${escapeHtml(img.alt || `${p.title} 본문 그림`)}" loading="lazy">` : "";
    })
    .replace(/<figure>\s*<\/figure>/g, "");
}
if (!imageFailed) {
  for (const f of await readdir(IMG_DIR).catch(() => [])) {
    if (/^[0-9a-f]{16}\.\w+$/.test(f) && !usedImages.has(f)) await rm(new URL(f, IMG_DIR));
  }
}

/* ---------- 6. 저장 (내용이 같으면 파일을 건드리지 않음) ---------- */
const file = `// 자동 생성 파일입니다. 직접 고치지 말고 scripts/build-blog.mjs로 다시 만드세요.\nwindow.BLOG_POSTS = ${JSON.stringify(out, null, 2)};\n`;
const previous = await readFile(OUT, "utf8").catch(() => "");
if (previous === file) {
  console.log(`변경 없음 (글 ${out.length}개)`);
} else {
  await mkdir(new URL("../data/", import.meta.url), { recursive: true });
  await writeFile(OUT, file);
  console.log(`글 ${out.length}개를 data/posts.js에 저장했습니다.`);
  for (const p of out) console.log(`- ${p.date} [${p.category}] ${p.title}`);
}
