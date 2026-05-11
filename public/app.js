const slots = ["1", "2"];
const state = new Map();
const saveTimers = new Map();

for (const slot of slots) {
  state.set(slot, {
    hidden: false,
    text: "",
    hasContent: false,
    updatedAt: null,
    saving: false,
  });
}

document.addEventListener("DOMContentLoaded", () => {
  bindEvents();
  loadSlots();
});

function bindEvents() {
  document.querySelectorAll("textarea").forEach((textarea) => {
    textarea.addEventListener("input", () => {
      const slot = textarea.id.replace("slot-", "");
      const slotState = state.get(slot);
      slotState.text = textarea.value;
      slotState.hidden = false;
      document.querySelector(`.slot[data-slot="${slot}"]`).classList.remove("is-hidden");
      setToggleUi(slot, false);
      scheduleSave(slot);
    });
  });

  document.querySelectorAll("button[data-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const slot = button.dataset.slot;
      const action = button.dataset.action;

      if (action === "delete") {
        await deleteSlot(slot);
      }

      if (action === "copy") {
        await copySlot(slot);
      }

      if (action === "toggle") {
        await toggleSlot(slot);
      }
    });
  });
}

async function loadSlots() {
  try {
    const data = await requestJson("/api/slots");

    for (const item of data.slots || []) {
      const slotState = state.get(String(item.id));
      if (!slotState) continue;

      slotState.hasContent = Boolean(item.hasContent);
      slotState.updatedAt = item.updatedAt || null;
      slotState.hidden = slotState.hasContent;
      slotState.text = "";
      updateSlotUi(String(item.id));
    }
  } catch (error) {
    setAllStatus(error.message || "加载失败");
  }
}

function updateSlotUi(slot) {
  const slotState = state.get(slot);
  const card = document.querySelector(`.slot[data-slot="${slot}"]`);
  const textarea = document.getElementById(`slot-${slot}`);
  card.classList.toggle("is-hidden", slotState.hidden);
  textarea.readOnly = slotState.hidden;
  textarea.value = slotState.hidden ? "" : slotState.text;
  textarea.placeholder = slotState.hidden ? "已隐藏，点击显示" : "输入或点击显示";
  setToggleUi(slot, slotState.hidden);
}

function setToggleUi(slot, hidden) {
  const label = hidden ? "显示" : "隐藏";
  const toggleButton = document.querySelector(`button[data-action="toggle"][data-slot="${slot}"]`);
  const labelElement = toggleButton.querySelector(".sr-only");

  toggleButton.setAttribute("aria-label", `${label}文本框 ${slot}`);
  labelElement.textContent = label;
}

function scheduleSave(slot) {
  clearTimeout(saveTimers.get(slot));
  setStatus(slot, "等待保存...");

  saveTimers.set(
    slot,
    setTimeout(() => {
      saveSlot(slot);
    }, 700),
  );
}

async function saveSlot(slot) {
  const slotState = state.get(slot);
  const textarea = document.getElementById(`slot-${slot}`);
  const text = slotState.hidden ? slotState.text : textarea.value;

  if (text.length > 50000) {
    setStatus(slot, "文本太长，最多 50000 字符");
    return false;
  }

  try {
    await ensureUnlocked(slot);
    slotState.saving = true;
    setStatus(slot, "保存中...");

    const data = await requestJson("/api/slots", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ slot, text }),
    });

    slotState.text = text;
    slotState.hasContent = text.length > 0;
    slotState.updatedAt = data.updatedAt || null;
    setStatus(slot, "已保存");
    return true;
  } catch (error) {
    setStatus(slot, error.message || "保存失败");
    return false;
  } finally {
    slotState.saving = false;
  }
}

async function deleteSlot(slot) {
  if (!confirm(`确定删除文本框 ${slot} 的内容吗？`)) return;

  clearTimeout(saveTimers.get(slot));

  try {
    await ensureUnlocked(slot);
    await requestJson("/api/slots", {
      method: "DELETE",
      headers: authHeaders(),
      body: JSON.stringify({ slot }),
    });

    const slotState = state.get(slot);
    slotState.text = "";
    slotState.hidden = false;
    slotState.hasContent = false;
    slotState.updatedAt = null;
    updateSlotUi(slot);
    setStatus(slot, "已删除");
  } catch (error) {
    setStatus(slot, error.message || "删除失败");
  }
}

async function copySlot(slot) {
  const slotState = state.get(slot);
  const textarea = document.getElementById(`slot-${slot}`);

  if (slotState.hidden) {
    setStatus(slot, "请先点击显示");
    return;
  }

  if (!textarea.value) {
    setStatus(slot, "没有可复制的内容");
    return;
  }

  try {
    await navigator.clipboard.writeText(textarea.value);
    setStatus(slot, "已复制");
  } catch {
    textarea.select();
    document.execCommand("copy");
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    setStatus(slot, "已复制");
  }
}

async function toggleSlot(slot) {
  const slotState = state.get(slot);
  const textarea = document.getElementById(`slot-${slot}`);

  if (slotState.hidden) {
    await revealSlot(slot);
    return;
  }

  clearTimeout(saveTimers.get(slot));
  slotState.text = textarea.value;

  if (slotState.text) {
    const saved = await saveSlot(slot);
    if (!saved) return;
  }

  slotState.hidden = true;
  updateSlotUi(slot);
  setStatus(slot, "已隐藏");
}

async function revealSlot(slot) {
  try {
    await ensureUnlocked(slot);
    const data = await requestJson("/api/slots", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ action: "reveal", slot }),
    });

    const slotState = state.get(slot);
    slotState.text = data.text || "";
    slotState.hasContent = slotState.text.length > 0;
    slotState.updatedAt = data.updatedAt || null;
    slotState.hidden = false;
    updateSlotUi(slot);
    setStatus(slot, slotState.hasContent ? "已显示" : "没有内容");
    document.getElementById(`slot-${slot}`).focus();
  } catch (error) {
    setStatus(slot, error.message || "显示失败");
  }
}

async function ensureUnlocked(slot) {
  if (sessionStorage.getItem("copytxtToken")) return;

  const password = prompt("请输入显示密码");
  if (!password) {
    throw new Error("需要密码");
  }

  const data = await requestJson("/api/slots", {
    method: "POST",
    body: JSON.stringify({ action: "unlock", password }),
  });

  if (!data.token) {
    throw new Error("解锁失败");
  }

  sessionStorage.setItem("copytxtToken", data.token);
  setStatus(slot, "已解锁");
}

function authHeaders() {
  const token = sessionStorage.getItem("copytxtToken");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function requestJson(url, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };

  const response = await fetch(url, {
    ...options,
    headers,
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    if (response.status === 401) {
      sessionStorage.removeItem("copytxtToken");
    }

    throw new Error(data.error || "请求失败");
  }

  return data;
}

function setStatus(slot, message) {
  document.getElementById(`status-${slot}`).textContent = message;
}

function setAllStatus(message) {
  for (const slot of slots) {
    setStatus(slot, message);
  }
}
