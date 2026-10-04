// 블로그: 해시 주소(#/, #/reasoning, #/llm-eval, #/vla, #/post/<id>)로 목록과 글 화면을 바꾼다.
// 글 데이터(window.BLOG_POSTS)는 GitHub Actions가 Google Docs에서 만들어 ../data/posts.js에 넣는다.
const root = document.documentElement;
root.classList.remove("no-js");
root.classList.add("js");

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

// 분류 = 홈페이지 Research Interests의 세 분야 (탭에는 전체 이름, 글 표시에는 짧은 이름)
const CATEGORY = { reasoning: "Reasoning Verification & Reliability", "llm-eval": "LLM Evaluation", vla: "Vision-Language-Action (VLA)" };
const SHORT = { reasoning: "Reasoning & Reliability", "llm-eval": "LLM Evaluation", vla: "VLA" };
const posts = (window.BLOG_POSTS || []).slice();
const state = { cat: "all", query: "" };

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const formatDate = (d) => { const [y, m, day] = d.split("-"); return `${y}.${m}.${day}`; };

document.addEventListener("DOMContentLoaded", () => {
  initChrome();
  $$("[data-count-for]").forEach((el) => {
    const c = el.dataset.countFor;
    el.textContent = c === "all" ? posts.length : posts.filter((p) => p.category === c).length;
  });
  $("#blog-search").addEventListener("input", (e) => { state.query = e.target.value.trim().toLowerCase(); renderList(); });
  addEventListener("hashchange", () => transition(route));
  route();
});

/* ---------- 화면 전환 (지원 브라우저에서는 부드럽게) ---------- */
function transition(fn) {
  if (document.startViewTransition && !reduceMotion) document.startViewTransition(fn);
  else fn();
}

function route() {
  const hash = location.hash.replace(/^#\/?/, "");
  const postMatch = hash.match(/^post\/(.+)$/);
  if (postMatch) {
    const post = posts.find((p) => p.id === decodeURIComponent(postMatch[1]));
    if (post) return showPost(post);
  }
  state.cat = CATEGORY[hash] ? hash : "all";
  showList();
}

/* ---------- 목록 ---------- */
function showList() {
  $("#view-post").hidden = true;
  $("#view-list").hidden = false;
  document.title = `${state.cat === "all" ? "블로그" : CATEGORY[state.cat]} | 이원경`;
  $$(".blog-tabs .tab").forEach((t) => {
    const on = t.dataset.cat === state.cat;
    t.classList.toggle("is-active", on);
    if (on) t.setAttribute("aria-current", "page"); else t.removeAttribute("aria-current");
  });
  renderList();
}

function renderList() {
  const list = posts.filter((p) => {
    if (state.cat !== "all" && p.category !== state.cat) return false;
    if (!state.query) return true;
    return `${p.title} ${p.kicker} ${p.memo} ${p.summary} ${p.tags.join(" ")}`.toLowerCase().includes(state.query);
  });
  const grid = $("#post-grid");
  $("#result-note").textContent = state.query ? `검색 결과 ${list.length}개` : "";
  if (!list.length) {
    grid.innerHTML = `<li class="empty">${state.query ? "검색 결과가 없습니다." : state.cat === "all" ? "아직 등록된 글이 없습니다." : "아직 이 분야의 글이 없습니다."}</li>`;
    return;
  }
  grid.innerHTML = list.map((p, i) => `
    <li class="post-card spot" style="--i:${i}">
      <a href="#/post/${encodeURIComponent(p.id)}">
        <div class="pmeta">
          <span class="tag cat-${p.category}">${SHORT[p.category]}</span>
          <time datetime="${p.date}">${formatDate(p.date)}</time>
        </div>
        ${p.kicker ? `<p class="card-kicker">${escapeHtml(p.kicker)}</p>` : ""}
        <h2>${escapeHtml(p.title)}</h2>
        <p class="card-summary">${escapeHtml(p.summary)}</p>
        ${p.tags.length ? `<ul class="chips">${p.tags.map((t) => `<li>${escapeHtml(t)}</li>`).join("")}</ul>` : ""}
      </a>
    </li>`).join("");
  bindSpotlight(grid);
}

/* ---------- 글 ---------- */
function showPost(post) {
  $("#view-list").hidden = true;
  $("#view-post").hidden = false;
  document.title = `${post.title} | 이원경`;

  $("#post-kicker").textContent = post.kicker || CATEGORY[post.category];
  $("#post-title").textContent = post.title;
  $("#post-meta").innerHTML = `
    <a class="tag cat-${post.category}" href="#/${post.category}">${SHORT[post.category]}</a>
    <time datetime="${post.date}">${formatDate(post.date)}</time>
    ${post.tags.map((t) => `<span class="chip">${escapeHtml(t)}</span>`).join("")}`;
  const memo = $("#post-memo");
  memo.textContent = post.memo ? `메모 · ${post.memo}` : "";
  memo.hidden = !post.memo;

  // 본문은 빌드 스크립트가 허용한 태그만 남긴 HTML이다. 글 제목과 같은 첫 제목은 중복이라 뺀다.
  const body = $("#post-body");
  body.innerHTML = post.html;
  $$("h2, h3", body).slice(0, 2).forEach((h) => { if (h.textContent.trim() === post.title || h.textContent.trim() === post.kicker) h.remove(); });

  // 목차: 큰 제목(h2)이 3개 이상이면 h2로, 아니면 h3로 만든다
  const heads = $$("h2", body).length >= 3 ? $$("h2", body) : $$("h3", body);
  heads.forEach((h, i) => { h.id = `sec-${i + 1}`; });
  const toc = $("#post-toc");
  toc.hidden = heads.length < 3;
  toc.innerHTML = heads.length < 3 ? "" :
    `<p class="toc-title">목차</p><ol>${heads.map((h) => `<li><a href="#/post/${encodeURIComponent(post.id)}" data-target="${h.id}">${escapeHtml(h.textContent)}</a></li>`).join("")}</ol>`;
  $$("a[data-target]", toc).forEach((a) => a.addEventListener("click", (e) => {
    e.preventDefault();
    const target = document.getElementById(a.dataset.target);
    target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    target.setAttribute("tabindex", "-1");
    target.focus({ preventScroll: true });
  }));

  // 이전·다음 글 (목록은 최신순)
  const idx = posts.indexOf(post);
  const newer = posts[idx - 1];
  const older = posts[idx + 1];
  $("#post-nav").innerHTML = `
    ${older ? `<a class="nav-older" href="#/post/${encodeURIComponent(older.id)}"><span>이전 글</span>${escapeHtml(older.title)}</a>` : "<span></span>"}
    ${newer ? `<a class="nav-newer" href="#/post/${encodeURIComponent(newer.id)}"><span>다음 글</span>${escapeHtml(newer.title)}</a>` : "<span></span>"}`;

  scrollTo({ top: 0, behavior: "auto" });
  $("#post-title").setAttribute("tabindex", "-1");
  $("#post-title").focus({ preventScroll: true });
}

/* ---------- 공통: 테마, 모바일 메뉴, 카드 조명 ---------- */
function initChrome() {
  const btn = $(".theme-toggle");
  const current = () => root.dataset.theme || (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
  btn.addEventListener("click", () => {
    const next = current() === "dark" ? "light" : "dark";
    root.dataset.theme = next;
    try { localStorage.setItem("wk-theme", next); } catch (e) {}
  });

  const nav = $("#site-nav");
  const toggle = $(".nav-toggle");
  const setMenu = (open) => {
    nav.classList.toggle("is-open", open);
    toggle.setAttribute("aria-expanded", String(open));
    $(".sr-only", toggle).textContent = open ? "메뉴 닫기" : "메뉴 열기";
  };
  toggle.addEventListener("click", () => setMenu(!nav.classList.contains("is-open")));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && nav.classList.contains("is-open")) { setMenu(false); toggle.focus(); }
  });
}

function bindSpotlight(scope) {
  $$(".spot", scope).forEach((card) => {
    card.addEventListener("pointermove", (e) => {
      const r = card.getBoundingClientRect();
      card.style.setProperty("--mx", `${e.clientX - r.left}px`);
      card.style.setProperty("--my", `${e.clientY - r.top}px`);
    });
  });
}
