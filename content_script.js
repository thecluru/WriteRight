(() => {
  const STATE = {
    panel: null,
    shadow: null,
    lastActiveEl: null,
    undoStacks: new WeakMap()
  };

  function isEditable(el) {
    if (!el) return false;
    if (el.tagName === "TEXTAREA") return true;
    if (el.tagName === "INPUT") {
      const t = (el.getAttribute("type") || "text").toLowerCase();
      return ["text", "search", "email", "url", "tel"].includes(t);
    }
    if (el.isContentEditable) return true;
    return false;
  }

  function getActiveEditable() {
    const el = document.activeElement;
    if (isEditable(el)) return el;

    // fallback: если фокус внутри, поднимемся к contenteditable
    let cur = el;
    while (cur && cur !== document.body) {
      if (cur.isContentEditable) return cur;
      cur = cur.parentElement;
    }
    return null;
  }

  function readText(el) {
    if (!el) return "";
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") return el.value || "";
    if (el.isContentEditable) return el.innerText || "";
    return "";
  }

  function writeText(el, text) {
    if (!el) return;
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      el.value = text;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }
    if (el.isContentEditable) {
      el.innerText = text;
      el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: null }));
      return;
    }
  }

  function pushUndo(el, prevText) {
    if (!el) return;
    const stack = STATE.undoStacks.get(el) || [];
    stack.push(prevText);
    // ограничим историю
    if (stack.length > 10) stack.shift();
    STATE.undoStacks.set(el, stack);
  }

  function popUndo(el) {
    const stack = STATE.undoStacks.get(el) || [];
    const prev = stack.pop();
    STATE.undoStacks.set(el, stack);
    return prev;
  }

  function setStatus(text) {
    const el = STATE.shadow?.getElementById("msai-status");
    if (el) el.textContent = text || "";
  }

  function ensurePanel() {
    if (STATE.panel) return;

    const host = document.createElement("div");
    host.id = "msai-host";
    host.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483647;";
    const shadow = host.attachShadow({ mode: "open" });

    shadow.innerHTML = `
      <style>
        .box{font:12px/1.2 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Arial,sans-serif;background:#111;color:#fff;border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:10px;box-shadow:0 10px 30px rgba(0,0,0,.35);width:220px}
        .row{display:flex;gap:6px;flex-wrap:wrap}
        button,select{font:12px -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Arial,sans-serif;border-radius:10px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.08);color:#fff;padding:6px 8px;cursor:pointer}
        button:hover{background:rgba(255,255,255,.14)}
        select{flex:1;min-width:120px}
        .status{opacity:.8;margin-top:8px;min-height:14px}
        .title{font-weight:600;margin-bottom:8px;opacity:.9}
      </style>
      <div class="box">
        <div class="title">Mail Style AI</div>
        <div class="row" style="margin-bottom:6px;">
          <button id="msai-key">Ключ</button>
          <button id="msai-undo">Откат</button>
        </div>
        <div class="row" style="margin-bottom:6px;">
          <button id="msai-fix">Исправить</button>
          <button id="msai-style">Стиль</button>
          <button id="msai-think">Подумать</button>
        </div>
        <div class="row">
          <select id="msai-tone">
            <option value="business">Деловой</option>
            <option value="polite">Вежливый</option>
            <option value="short">Коротко</option>
          </select>
        </div>
        <div class="status" id="msai-status"></div>
      </div>
    `;

    document.documentElement.appendChild(host);
    STATE.panel = host;
    STATE.shadow = shadow;

    shadow.getElementById("msai-key").addEventListener("click", onSetKey);
    shadow.getElementById("msai-undo").addEventListener("click", onUndo);
    shadow.getElementById("msai-fix").addEventListener("click", () => onRun("fix"));
    shadow.getElementById("msai-style").addEventListener("click", () => onRun("style"));
    shadow.getElementById("msai-think").addEventListener("click", () => onRun("think"));
  }

  async function onSetKey() {
    const key = prompt("Вставь DeepSeek API key:");
    if (!key) return;
    setStatus("Сохраняю ключ…");
    chrome.runtime.sendMessage({ type: "SET_KEY", key }, (res) => {
      if (!res?.ok) setStatus(res?.error || "Ошибка сохранения ключа");
      else setStatus("Ключ сохранён");
      setTimeout(() => setStatus(""), 1500);
    });
  }

  function onUndo() {
    const el = getActiveEditable();
    if (!el) return setStatus("Нет активного поля ввода");
    const prev = popUndo(el);
    if (typeof prev !== "string") return setStatus("Откат недоступен");
    writeText(el, prev);
    setStatus("Откат выполнен");
    setTimeout(() => setStatus(""), 1200);
  }

  function buildPrompts(mode, tone, text) {
    const baseRules =
      "Ты редактор русского текста. Сохраняй факты и смысл. Не выдумывай детали. " +
      "Не добавляй лишние обещания, ссылки, подписи, если их не было. " +
      "Выводи только готовый текст без пояснений.";

    if (mode === "fix") {
      return {
        model: "deepseek-chat",
        system: baseRules,
        user:
          "Исправь орфографию и пунктуацию. Стиль почти не меняй, только ошибки.\n\nТекст:\n" + text,
        max_tokens: Math.max(400, Math.min(1400, Math.floor(text.length / 2) + 400))
      };
    }

    if (mode === "style") {
      let toneRule = "Сделай текст деловым и ясным.";
      if (tone === "polite") toneRule = "Сделай текст вежливым, тактичным, без навязчивости.";
      if (tone === "short") toneRule = "Сделай текст коротким и по делу, без воды.";

      return {
        model: "deepseek-chat",
        system: baseRules + " " + toneRule,
        user: "Перепиши текст.\n\nТекст:\n" + text,
        max_tokens: Math.max(500, Math.min(1800, Math.floor(text.length / 2) + 500))
      };
    }

    // think
    return {
      model: "deepseek-reasoner",
      system:
        baseRules +
        " Сначала продумай структуру и тон. Итог — аккуратное письмо.",
      user:
        "Сделай лучший вариант письма: ясная структура, корректный тон, без лишней воды.\n\nЧерновик:\n" +
        text,
      max_tokens: Math.max(700, Math.min(2200, Math.floor(text.length / 2) + 700))
    };
  }

  async function onRun(mode) {
    const el = getActiveEditable();
    if (!el) return setStatus("Кликни в поле ввода (письмо/сообщение)");
    const text = readText(el).trim();
    if (!text) return setStatus("Поле пустое");

    const tone = STATE.shadow.getElementById("msai-tone").value;

    setStatus("Думаю…");
    const payload = buildPrompts(mode, tone, text);

    chrome.runtime.sendMessage({ type: "RUN", payload }, (res) => {
      if (!res?.ok) {
        setStatus(res?.error || "Ошибка");
        return;
      }
      const out = String(res.result || "").trim();
      if (!out) {
        setStatus("Пустой ответ");
        return;
      }
      pushUndo(el, readText(el));
      writeText(el, out);
      setStatus("Готово");
      setTimeout(() => setStatus(""), 1200);
    });
  }

  // init
  ensurePanel();

  // Если страница SPA перерисовывается, панель может пропасть — восстановим.
  const obs = new MutationObserver(() => {
    if (!STATE.panel || !document.documentElement.contains(STATE.panel)) {
      STATE.panel = null;
      STATE.shadow = null;
      ensurePanel();
    }
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });
})();
