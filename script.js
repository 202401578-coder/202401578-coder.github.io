// B안 인터랙션: 테마, 메뉴, 스크롤 효과, 카운터, 타이핑, 프로젝트 필터·모달, 히어로 캔버스
const root = document.documentElement;
root.classList.remove("no-js");
root.classList.add("js");

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

document.addEventListener("DOMContentLoaded", () => {
  initDates();
  initTheme();
  initNav();
  initScrollEffects();
  initReveal();
  initTyping();
  initSpotlight();
  initProjects();
  initModals();
  initCanvas();
  initBlogTeaser();
});

/* ---------- 블로그 최신 글 미리보기 (data/posts.js) ---------- */
function initBlogTeaser() {
  const list = $("#blog-teaser-list");
  if (!list) return;
  const posts = (window.BLOG_POSTS || []).slice(0, 3);
  const CATEGORY = { reasoning: "Reasoning & Reliability", "llm-eval": "LLM Evaluation", vla: "VLA" };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  if (!posts.length) {
    list.innerHTML = '<li class="teaser-empty">곧 첫 글이 올라옵니다.</li>';
    return;
  }
  list.innerHTML = posts.map((p) => `
    <li class="card spot teaser">
      <a href="blog/index.html#/post/${encodeURIComponent(p.id)}">
        <div class="pmeta"><span class="tag cat-${p.category}">${CATEGORY[p.category]}</span><time datetime="${p.date}">${p.date.replace(/-/g, ".")}</time></div>
        <h3>${esc(p.title)}</h3>
        <p>${esc(p.summary)}</p>
      </a>
    </li>`).join("");
  initSpotlight();
}

/* ---------- 날짜 기반 자동 갱신 ----------
   data-start / data-end가 있는 상태 배지는 오늘 날짜로 예정·진행 중·완료를 정하고,
   타임라인의 '지금' 선과 data-ongoing 막대(…– 현재)는 이번 달까지 맞춘다.
   HTML에 적힌 값은 스크립트가 꺼졌을 때의 기본값이다. */
function initDates() {
  const today = new Date();
  const parse = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d, 23, 59, 59); };

  $$(".tag[data-start][data-end]").forEach((tag) => {
    const start = parse(tag.dataset.start);
    start.setHours(0, 0, 0);
    const end = parse(tag.dataset.end);
    let label, cls;
    if (today < start) { label = "예정"; cls = "t-plan"; }
    else if (today <= end) { label = "진행 중"; cls = "t-progress"; }
    else { label = "완료"; cls = "t-done"; }
    tag.classList.remove("t-plan", "t-progress", "t-done");
    tag.classList.add(cls);
    tag.textContent = label;
  });

  // 타임라인은 2026년 1월(1열)부터 11월(11열)까지
  const gantt = $(".gantt");
  if (!gantt) return;
  const LAST_MONTH = 11;
  const inYear = today.getFullYear() === 2026;
  const month = today.getMonth() + 1;
  const daysInMonth = new Date(today.getFullYear(), month, 0).getDate();
  const now = $(".g-now", gantt);
  if (inYear && month <= LAST_MONTH) {
    now.style.setProperty("--m", (month + (today.getDate() - 1) / daysInMonth).toFixed(2));
  } else if (now) {
    now.hidden = true;
  }
  const endCol = inYear ? Math.min(month, LAST_MONTH) + 1 : LAST_MONTH + 1;
  $$(".g-bar[data-ongoing]", gantt).forEach((bar) => bar.style.setProperty("--e", endCol));
}

/* ---------- 테마 전환 ---------- */
function initTheme() {
  const btn = $(".theme-toggle");
  const current = () =>
    root.dataset.theme || (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
  const label = () => btn.setAttribute("aria-label", current() === "dark" ? "라이트 테마로 전환" : "다크 테마로 전환");
  label();
  btn.addEventListener("click", () => {
    const next = current() === "dark" ? "light" : "dark";
    root.dataset.theme = next;
    try { localStorage.setItem("wk-theme", next); } catch (e) {}
    label();
    window.dispatchEvent(new Event("themechange"));
  });
}

/* ---------- 메뉴: 모바일 열기·닫기, 현재 섹션 강조, 움직이는 표시 ---------- */
function initNav() {
  const nav = $("#site-nav");
  const toggle = $(".nav-toggle");
  const links = $$("a", nav);
  const indicator = $(".pill-indicator");

  const setMenu = (open) => {
    nav.classList.toggle("is-open", open);
    toggle.setAttribute("aria-expanded", String(open));
    $(".sr-only", toggle).textContent = open ? "메뉴 닫기" : "메뉴 열기";
  };
  toggle.addEventListener("click", () => setMenu(!nav.classList.contains("is-open")));
  links.forEach((a) => a.addEventListener("click", () => setMenu(false)));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && nav.classList.contains("is-open")) { setMenu(false); toggle.focus(); }
  });

  const moveIndicator = (link) => {
    if (!link) { indicator.style.opacity = 0; return; }
    indicator.style.opacity = 1;
    indicator.style.width = `${link.offsetWidth}px`;
    indicator.style.transform = `translateX(${link.offsetLeft}px)`;
  };

  const sections = links
    .filter((a) => a.getAttribute("href").startsWith("#"))
    .map((a) => $(a.getAttribute("href")))
    .filter(Boolean);
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      let active = null;
      links.forEach((a) => {
        const on = a.getAttribute("href") === `#${entry.target.id}`;
        a.classList.toggle("is-current", on);
        if (on) { a.setAttribute("aria-current", "true"); active = a; } else a.removeAttribute("aria-current");
      });
      moveIndicator(active);
    });
  }, { rootMargin: "-45% 0px -50% 0px" });
  sections.forEach((s) => io.observe(s));
  window.addEventListener("resize", () => moveIndicator($(".is-current", nav)));
}

/* ---------- 스크롤 진행 막대, 상단 바 그림자 ---------- */
function initScrollEffects() {
  const bar = $(".progress span");
  const topbar = $(".topbar");
  let ticking = false;
  const update = () => {
    const max = document.documentElement.scrollHeight - innerHeight;
    bar.style.setProperty("--p", max > 0 ? scrollY / max : 0);
    topbar.classList.toggle("is-scrolled", scrollY > 20);
    ticking = false;
  };
  addEventListener("scroll", () => { if (!ticking) { requestAnimationFrame(update); ticking = true; } }, { passive: true });
  update();
}

/* ---------- 등장 애니메이션 + 숫자 카운터 ---------- */
function initReveal() {
  const items = $$(".reveal");
  // 같은 부모 안에서 순서대로 조금씩 늦게 등장
  items.forEach((el) => {
    const siblings = [...el.parentElement.children].filter((c) => c.classList.contains("reveal"));
    el.style.setProperty("--d", `${Math.min(siblings.indexOf(el), 6) * 0.08}s`);
  });
  if (reduceMotion || !("IntersectionObserver" in window)) {
    items.forEach((el) => el.classList.add("in"));
    return;
  }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("in");
      $$("[data-count]", entry.target).forEach(countUp);
      io.unobserve(entry.target);
    });
  }, { threshold: 0.15, rootMargin: "0px 0px -40px 0px" });
  items.forEach((el) => io.observe(el));
}

function countUp(el) {
  if (reduceMotion) return;
  const target = parseFloat(el.dataset.count);
  const decimals = parseInt(el.dataset.decimals || "0", 10);
  const suffix = el.dataset.suffix || "";
  const final = el.textContent;
  const start = performance.now();
  const dur = 1400;
  const step = (now) => {
    const t = Math.min((now - start) / dur, 1);
    const eased = 1 - Math.pow(1 - t, 4);
    el.textContent = (target * eased).toFixed(decimals) + suffix;
    if (t < 1) requestAnimationFrame(step); else el.textContent = final;
  };
  requestAnimationFrame(step);
}

/* ---------- 타이핑 효과 ---------- */
function initTyping() {
  const el = $(".typing-text");
  if (!el || reduceMotion) return;
  const words = el.dataset.words.split("|");
  let w = 0, i = words[0].length, deleting = true;
  const tick = () => {
    const word = words[w];
    i += deleting ? -1 : 1;
    el.textContent = word.slice(0, i);
    let delay = deleting ? 38 : 70;
    if (!deleting && i === word.length) { deleting = true; delay = 2200; }
    else if (deleting && i === 0) { deleting = false; w = (w + 1) % words.length; delay = 300; }
    setTimeout(tick, delay);
  };
  setTimeout(tick, 2600);
}

/* ---------- 카드 위 마우스 조명 ---------- */
function initSpotlight() {
  $$(".spot").forEach((card) => {
    card.addEventListener("pointermove", (e) => {
      const r = card.getBoundingClientRect();
      card.style.setProperty("--mx", `${e.clientX - r.left}px`);
      card.style.setProperty("--my", `${e.clientY - r.top}px`);
    });
  });
}

/* ---------- 프로젝트 필터 ---------- */
function initProjects() {
  const tabs = $$(".tab");
  const indicator = $(".tab-indicator");
  const cards = $$(".pcard");

  const moveIndicator = (tab) => {
    indicator.style.width = `${tab.offsetWidth}px`;
    indicator.style.transform = `translateX(${tab.offsetLeft}px)`;
  };
  const apply = (tab) => {
    const f = tab.dataset.filter;
    tabs.forEach((t) => {
      const on = t === tab;
      t.classList.toggle("is-active", on);
      t.setAttribute("aria-pressed", String(on));
    });
    moveIndicator(tab);
    cards.forEach((card) => {
      const show = f === "all" || card.dataset.cat.split(" ").includes(f);
      card.classList.toggle("is-hidden", !show);
      if (show && !reduceMotion) {
        card.animate([{ opacity: 0, transform: "translateY(14px) scale(.98)" }, { opacity: 1, transform: "none" }],
          { duration: 450, easing: "cubic-bezier(.2,.8,.2,1)" });
      }
    });
  };
  tabs.forEach((t) => t.addEventListener("click", () => apply(t)));
  moveIndicator(tabs[0]);
  window.addEventListener("resize", () => moveIndicator($(".tab.is-active")));
  // 글꼴이 늦게 로드되면 폭이 바뀌므로 다시 맞춘다
  document.fonts && document.fonts.ready.then(() => moveIndicator($(".tab.is-active")));

  // 타임라인·관심 분야에서 프로젝트로 이동할 때: 필터 해제 + 카드 강조
  $$('a[href^="#p-"]').forEach((a) => {
    a.addEventListener("click", () => {
      const card = $(a.getAttribute("href"));
      if (!card) return;
      if (card.classList.contains("is-hidden")) apply(tabs[0]);
      card.classList.remove("flash");
      void card.offsetWidth;
      card.classList.add("flash");
    });
  });
}

/* ---------- 모달 ---------- */
function initModals() {
  let opener = null;
  $$("[data-open]").forEach((btn) => {
    // 버튼뿐 아니라 링크(관심 분야의 '관련' 링크)도 상세 창을 바로 연다.
    // 링크의 href는 스크립트가 꺼졌을 때 해당 프로젝트로 이동하는 대체 경로다.
    btn.addEventListener("click", (e) => {
      const dlg = document.getElementById(btn.dataset.open);
      if (!dlg) return;
      e.preventDefault();
      opener = btn;
      dlg.showModal();
      root.classList.add("modal-open");
      dlg.scrollTop = 0;
    });
  });
  $$("dialog.modal").forEach((dlg) => {
    $(".modal-close", dlg).addEventListener("click", () => dlg.close());
    // 바깥(배경) 클릭 시 닫기
    dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener("close", () => {
      root.classList.remove("modal-open");
      $$("video", dlg).forEach((v) => v.pause());
      if (opener) opener.focus();
    });
  });
}

/* ---------- 히어로 신경망 캔버스 ---------- */
function initCanvas() {
  const canvas = $(".hero-canvas");
  if (!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext("2d");
  const hero = $(".hero");
  let w, h, dpr, nodes = [], color, running = true;
  const mouse = { x: -9999, y: -9999 };

  const readColor = () => {
    const s = getComputedStyle(root);
    color = { a: s.getPropertyValue("--a1").trim(), b: s.getPropertyValue("--a2").trim() };
  };
  const resize = () => {
    dpr = Math.min(devicePixelRatio || 1, 2);
    w = hero.clientWidth; h = hero.clientHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const count = Math.round(Math.min(90, (w * h) / 16000));
    nodes = Array.from({ length: count }, () => ({
      x: Math.random() * w, y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.35, vy: (Math.random() - 0.5) * 0.35,
      r: Math.random() * 1.6 + 0.8,
    }));
  };
  const draw = () => {
    ctx.clearRect(0, 0, w, h);
    const link = 130;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (!reduceMotion) {
        n.x += n.vx; n.y += n.vy;
        if (n.x < 0 || n.x > w) n.vx *= -1;
        if (n.y < 0 || n.y > h) n.vy *= -1;
        // 마우스 근처 노드는 살짝 밀려난다
        const mx = n.x - mouse.x, my = n.y - mouse.y, md = Math.hypot(mx, my);
        if (md < 120) { n.x += (mx / md) * 0.8; n.y += (my / md) * 0.8; }
      }
      for (let j = i + 1; j < nodes.length; j++) {
        const m = nodes[j];
        const d = Math.hypot(n.x - m.x, n.y - m.y);
        if (d < link) {
          ctx.globalAlpha = (1 - d / link) * 0.35;
          ctx.strokeStyle = color.a;
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(n.x, n.y); ctx.lineTo(m.x, m.y); ctx.stroke();
        }
      }
    }
    ctx.globalAlpha = 0.9;
    nodes.forEach((n, i) => {
      ctx.fillStyle = i % 3 === 0 ? color.b : color.a;
      ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2); ctx.fill();
    });
    ctx.globalAlpha = 1;
    if (running && !reduceMotion) requestAnimationFrame(draw);
  };

  readColor(); resize(); draw();
  addEventListener("resize", () => { resize(); if (reduceMotion) draw(); });
  addEventListener("themechange", () => { readColor(); if (reduceMotion) draw(); });
  hero.addEventListener("pointermove", (e) => {
    const r = hero.getBoundingClientRect();
    mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top;
  });
  hero.addEventListener("pointerleave", () => { mouse.x = mouse.y = -9999; });
  // 히어로가 화면 밖이면 그리기를 멈춰 배터리를 아낀다
  new IntersectionObserver(([e]) => {
    const was = running; running = e.isIntersecting;
    if (running && !was && !reduceMotion) requestAnimationFrame(draw);
  }).observe(hero);
}
