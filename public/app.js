const state = new Map();
const saveTimers = new Map();
const slotsElement = document.getElementById("slots");
const template = document.getElementById("slot-template");

document.addEventListener("DOMContentLoaded", () => {
  loadSlots();
});

async function loadSlots() {
  try {
    const data = await requestJson("/api/slots");
    slotsElement.textContent = "";
    state.clear();

    for (const item of data.slots || []) {
      addSlotToPage(item);
    }
  } catch (error) {
    slotsElement.textContent = error.message || "加载失败";
  }
}

function addSlotToPage(item) {
  const slot = String(item.id);
  const slotState = {
    title: item.title || "",
    hidden: Boolean(item.isHidden),
    text: item.text || "",
    hasContent: Boolean(item.hasContent),
    updatedAt: item.updatedAt || null,
    saving: false,
    isSecured: Boolean(item.isHidden),
  };

  state.set(slot, slotState);

  const node = template.content.firstElementChild.cloneNode(true);
  node.dataset.slot = slot;
  node.querySelector(".title-input").value = slotState.title;
  node.querySelector("textarea").id = `slot-${slot}`;
  node.querySelector(".delete-box").dataset.slot = slot;
  node.querySelector("button[data-action='copy']").dataset.slot = slot;
  node.querySelector("button[data-action='toggle']").dataset.slot = slot;

  bindSlotEvents(node, slot);
  slotsElement.appendChild(node);
  updateSlotUi(slot);
}

function bindSlotEvents(node, slot) {
  node.querySelector(".title-input").addEventListener("input", (event) => {
    const slotState = state.get(slot);
    slotState.title = event.target.value;
    scheduleSave(slot);
  });

  node.querySelector("textarea").addEventListener("input", (event) => {
    const slotState = state.get(slot);
    slotState.text = event.target.value;
    slotState.hidden = false;
    slotState.isSecured = false;
    node.classList.remove("is-hidden");
    setToggleUi(slot, false);
    scheduleSave(slot);
  });

  node.querySelectorAll("button[data-action]").forEach((button) => {
    button.addEventListener("click", async () => {
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

      if (action === "add") {
        await createSlot(button);
      }
    });
  });
}

function updateSlotUi(slot) {
  const slotState = state.get(slot);
  const card = getSlotElement(slot);
  const textarea = card.querySelector("textarea");
  const titleInput = card.querySelector(".title-input");

  card.classList.toggle("is-hidden", slotState.hidden);
  titleInput.value = slotState.title;
  textarea.readOnly = slotState.hidden;
  textarea.value = slotState.hidden ? maskText() : slotState.text;
  textarea.placeholder = slotState.hidden ? "已隐藏，点击眼睛显示" : "输入或点击显示";
  setToggleUi(slot, slotState.hidden);
}

function maskText() {
  return "••••••••••••";
}

function setToggleUi(slot, hidden) {
  const label = hidden ? "显示" : "隐藏";
  const toggleButton = getSlotElement(slot).querySelector("button[data-action='toggle']");
  const labelElement = toggleButton.querySelector(".sr-only");

  toggleButton.setAttribute("aria-label", `${label}文本框`);
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
  const card = getSlotElement(slot);
  const text = slotState.hidden ? slotState.text : card.querySelector("textarea").value;
  const title = card.querySelector(".title-input").value;

  if (text.length > 50000) {
    setStatus(slot, "文本太长，最多 50000 字符");
    return false;
  }

  try {
    slotState.saving = true;
    setStatus(slot, "保存中...");

    let data;
    try {
      data = await requestJson("/api/slots", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ slot, title, text, isHidden: slotState.isSecured }),
      });
    } catch (error) {
      if (error.status === 401) {
        await ensureUnlocked(slot);
        data = await requestJson("/api/slots", {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({ slot, title, text, isHidden: slotState.isSecured }),
        });
      } else {
        throw error;
      }
    }

    slotState.title = title;
    slotState.text = text;
    slotState.hasContent = text.length > 0;
    slotState.updatedAt = data.updatedAt || null;
    slotState.hidden = Boolean(data.isHidden);
    slotState.isSecured = Boolean(data.isHidden);
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
  if (!confirm("确定删除这个文本框吗？")) return;

  clearTimeout(saveTimers.get(slot));

  try {
    try {
      await requestJson("/api/slots", {
        method: "DELETE",
        headers: authHeaders(),
        body: JSON.stringify({ slot }),
      });
    } catch (error) {
      if (error.status === 401) {
        await ensureUnlocked(slot);
        await requestJson("/api/slots", {
          method: "DELETE",
          headers: authHeaders(),
          body: JSON.stringify({ slot }),
        });
      } else {
        throw error;
      }
    }

    getSlotElement(slot).remove();
    state.delete(slot);
    saveTimers.delete(slot);
  } catch (error) {
    setStatus(slot, error.message || "删除失败");
  }
}

async function copySlot(slot) {
  const slotState = state.get(slot);
  const textarea = getSlotElement(slot).querySelector("textarea");

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
  const textarea = getSlotElement(slot).querySelector("textarea");

  if (slotState.hidden) {
    await revealSlot(slot);
    return;
  }

  clearTimeout(saveTimers.get(slot));
  slotState.text = textarea.value;
  slotState.hidden = true;
  slotState.isSecured = true;

  if (slotState.text) {
    const saved = await saveSlot(slot);
    if (!saved) {
      slotState.hidden = false;
      slotState.isSecured = false;
      return;
    }
  }

  updateSlotUi(slot);
  setStatus(slot, "已加锁");
}

async function revealSlot(slot) {
  try {
    const slotState = state.get(slot);

    if (slotState.isSecured) {
      await ensureUnlocked(slot);
    }

    const data = await requestJson("/api/slots", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ action: "reveal", slot }),
    });

    slotState.title = data.title || slotState.title;
    slotState.text = data.text || "";
    slotState.hasContent = slotState.text.length > 0;
    slotState.updatedAt = data.updatedAt || null;
    slotState.hidden = false;
    slotState.isSecured = Boolean(data.isHidden);
    updateSlotUi(slot);
    setStatus(slot, slotState.hasContent ? "已显示" : "没有内容");
    getSlotElement(slot).querySelector("textarea").focus();
  } catch (error) {
    setStatus(slot, error.message || "显示失败");
  }
}

async function createSlot(button) {
  if (button) button.disabled = true;

  try {
    const data = await requestJson("/api/slots", {
      method: "POST",
      body: JSON.stringify({ action: "create" }),
    });

    addSlotToPage(data);
    getSlotElement(data.id).querySelector(".title-input").focus();
  } catch (error) {
    alert(error.message || "新增失败");
  } finally {
    if (button) button.disabled = false;
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

    const error = new Error(data.error || "请求失败");
    error.status = response.status;
    throw error;
  }

  return data;
}

function getSlotElement(slot) {
  return slotsElement.querySelector(`.slot[data-slot="${slot}"]`);
}

function setStatus(slot, message) {
  getSlotElement(slot).querySelector(".status").textContent = message;
}
