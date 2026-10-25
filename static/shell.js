// Shared bits for the Learning Box pages: kid's name and the DEV badge.

/** Fetch /api/status once; fills #env-badge and the tab title on non-prod instances. */
export async function loadShell(title) {
  let status = { kid_name: "Trainer", env: "prod" };
  try {
    status = await fetch("/api/status").then((r) => r.json());
  } catch { /* offline: keep defaults */ }
  const badge = document.getElementById("env-badge");
  if (badge) {
    badge.hidden = status.env === "prod";
    badge.textContent = status.env.toUpperCase();
  }
  document.title = status.env === "prod" ? title : `[${status.env.toUpperCase()}] ${title}`;
  return status;
}

export function say(text) {
  if (!("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 0.95;
  speechSynthesis.speak(u);
}
