// DeepSeek API (OpenAI-compatible)
const DEEPSEEK_BASE = "https://api.deepseek.com/v1/chat/completions";
const KEY_STORAGE = "deepseekApiKey";

async function getKey() {
  const res = await chrome.storage.local.get([KEY_STORAGE]);
  return (res[KEY_STORAGE] || "").trim();
}

async function setKey(key) {
  await chrome.storage.local.set({ [KEY_STORAGE]: (key || "").trim() });
}

async function deepseekChat({ model, system, user, temperature = 0.2, max_tokens = 800 }) {
  const apiKey = await getKey();
  if (!apiKey) throw new Error("API key не задан. Нажми кнопку «Ключ» и вставь ключ DeepSeek.");

  const payload = {
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user }
    ],
    temperature,
    max_tokens
  };

  const r = await fetch(DEEPSEEK_BASE, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify(payload)
  });

  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`DeepSeek API error: ${r.status} ${r.statusText}${txt ? ` — ${txt}` : ""}`);
  }

  const data = await r.json();
  const out = data?.choices?.[0]?.message?.content;
  if (!out) throw new Error("Пустой ответ модели.");
  return out;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      if (!msg || !msg.type) throw new Error("Bad request");

      if (msg.type === "SET_KEY") {
        await setKey(msg.key);
        sendResponse({ ok: true });
        return;
      }

      if (msg.type === "RUN") {
        const result = await deepseekChat(msg.payload);
        sendResponse({ ok: true, result });
        return;
      }

      throw new Error("Unknown message type");
    } catch (e) {
      sendResponse({ ok: false, error: e?.message || String(e) });
    }
  })();

  return true; // async response
});
