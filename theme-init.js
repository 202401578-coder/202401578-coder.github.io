// 저장된 테마를 그리기 전에 적용해 화면 깜빡임을 막는다.
// (보안 정책상 인라인 스크립트를 쓰지 않으려고 별도 파일로 분리)
try {
  const t = localStorage.getItem("wk-theme");
  if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
} catch (e) {}
