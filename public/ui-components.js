const selectionControllers = new WeakMap();
const otpControllers = new WeakMap();
let openSelectionController = null;
let selectionGlobalsBound = false;
let selectionId = 0;
let suppressSelectionOutsideClick = false;
let selectionPositionFrame = 0;

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

const promoteToTopLayer = (element) => {
  if (!element || typeof element.showPopover !== "function") return;
  element.setAttribute("popover", "manual");
  try {
    if (element.matches(":popover-open")) element.hidePopover();
    element.showPopover();
  } catch {}
};

const removeFromTopLayer = (element) => {
  if (!element || typeof element.hidePopover !== "function") return;
  try {
    if (element.matches(":popover-open")) element.hidePopover();
  } catch {}
};

export const runUiMotion = (element, keyframes, options = {}) => {
  if (!element || typeof element.animate !== "function" || reducedMotion()) return null;
  element.getAnimations?.().forEach((animation) => {
    if (animation.id?.startsWith("ui:")) animation.cancel();
  });
  const animation = element.animate(keyframes, {
    duration: 180,
    easing: "cubic-bezier(.2,.8,.2,1)",
    fill: "both",
    ...options,
  });
  animation.id = `ui:${options.id || "motion"}`;
  return animation;
};

export const revealUiElement = (element, delay = 0) => {
  if (!element || element.dataset.uiRevealed) return;
  element.dataset.uiRevealed = "true";
  const animation = runUiMotion(
    element,
    [
      { opacity: 0.01, transform: "translate3d(0, 16px, 0)" },
      { opacity: 1, transform: "translate3d(0, 0, 0)" },
    ],
    { id: "reveal", duration: 420, delay },
  );
  animation?.finished.then(() => animation.cancel()).catch(() => {});
};

const closeOpenSelection = (restoreFocus = false) => {
  openSelectionController?.close(restoreFocus);
};

const setSelectionScrollLock = (locked) => {
  const shouldLock = locked && window.matchMedia?.("(max-width: 620px)")?.matches;
  document.documentElement.classList.toggle("ui-selection-open", shouldLock);
  document.body.classList.toggle("ui-selection-open", shouldLock);
};

const positionPopover = (controller) => {
  const { anchor, popover } = controller;
  if (!anchor?.isConnected || !popover || popover.hidden) return;
  const rect = anchor.getBoundingClientRect();
  const viewportGap = 12;
  const width = Math.min(Math.max(rect.width, controller.minWidth || 180), window.innerWidth - viewportGap * 2);
  const maxHeight = Math.min(300, Math.max(160, window.innerHeight - viewportGap * 2));
  const measuredHeight = Math.min(popover.scrollHeight || maxHeight, maxHeight);
  const roomBelow = window.innerHeight - rect.bottom - viewportGap;
  const openAbove = roomBelow < Math.min(measuredHeight, 220) && rect.top > roomBelow;
  const left = Math.min(Math.max(viewportGap, rect.left), window.innerWidth - width - viewportGap);
  const top = openAbove
    ? Math.max(viewportGap, rect.top - measuredHeight - 8)
    : Math.min(window.innerHeight - measuredHeight - viewportGap, rect.bottom + 8);
  Object.assign(popover.style, {
    left: `${Math.round(left)}px`,
    top: `${Math.round(top)}px`,
    width: `${Math.round(width)}px`,
    maxHeight: `${Math.round(maxHeight)}px`,
  });
};

const bindSelectionGlobals = () => {
  if (selectionGlobalsBound) return;
  selectionGlobalsBound = true;
  document.addEventListener("pointerdown", (event) => {
    if (!openSelectionController) return;
    if (openSelectionController.contains(event.target)) return;
    const switchTarget = event.target instanceof Element && event.target.closest(".tg-select, .tg-combobox");
    const shouldSuppress = window.matchMedia?.("(max-width: 620px)")?.matches && !switchTarget;
    closeOpenSelection();
    if (shouldSuppress) {
      suppressSelectionOutsideClick = true;
      event.preventDefault();
      event.stopPropagation();
      window.setTimeout(() => {
        suppressSelectionOutsideClick = false;
      }, 700);
    }
  }, true);
  document.addEventListener("click", (event) => {
    if (!suppressSelectionOutsideClick) return;
    suppressSelectionOutsideClick = false;
    event.preventDefault();
    event.stopPropagation();
  }, true);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && openSelectionController) closeOpenSelection(true);
  });
  const schedulePosition = () => {
    if (selectionPositionFrame) return;
    selectionPositionFrame = window.requestAnimationFrame(() => {
      selectionPositionFrame = 0;
      if (openSelectionController) positionPopover(openSelectionController);
    });
  };
  window.addEventListener("resize", schedulePosition, { passive: true });
  document.addEventListener("scroll", schedulePosition, { passive: true, capture: true });
};

const optionData = (select) =>
  [...select.options].map((option, index) => ({
    index,
    value: option.value,
    label: option.textContent.trim(),
    disabled: option.disabled,
    placeholder: !option.value,
  }));

const selectOption = (controller, option) => {
  if (!option || option.disabled) return;
  controller.select.value = option.value;
  controller.select.dispatchEvent(new Event("change", { bubbles: true }));
  queueMicrotask(() => controller.refresh());
  controller.close(true);
};

const createSelectController = (select) => {
  const root = document.createElement("span");
  root.className = `tg-select${select.classList.contains("toolbar-select") ? " is-toolbar" : ""}`;
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "tg-select-trigger";
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.innerHTML = '<span class="tg-select-value"></span><span class="tg-select-chevron" aria-hidden="true"></span>';
  const popover = document.createElement("div");
  popover.className = "tg-popover tg-select-popover";
  popover.id = `tg-select-${++selectionId}`;
  popover.setAttribute("role", "listbox");
  popover.hidden = true;
  trigger.setAttribute("aria-controls", popover.id);
  trigger.setAttribute("aria-expanded", "false");

  select.before(root);
  root.append(select, trigger);
  document.body.append(popover);
  select.classList.add("tg-control-source");
  select.tabIndex = -1;

  const controller = {
    select,
    root,
    anchor: trigger,
    trigger,
    popover,
    minWidth: select.classList.contains("toolbar-select") ? 120 : 180,
    contains: (node) => root.contains(node) || popover.contains(node),
    open() {
      if (select.disabled) return;
      closeOpenSelection();
      openSelectionController = controller;
      root.classList.add("is-open");
      trigger.setAttribute("aria-expanded", "true");
      popover.hidden = false;
      setSelectionScrollLock(true);
      positionPopover(controller);
      runUiMotion(popover, [{ opacity: 0, transform: "translate3d(0,-6px,0) scale(.985)" }, { opacity: 1, transform: "none" }], { id: "popover", duration: 150 });
      const selected = popover.querySelector('[aria-selected="true"]');
      (selected || popover.querySelector("button:not(:disabled)"))?.focus({ preventScroll: true });
    },
    close(restoreFocus = false) {
      if (popover.hidden) return;
      popover.hidden = true;
      root.classList.remove("is-open");
      trigger.setAttribute("aria-expanded", "false");
      if (openSelectionController === controller) openSelectionController = null;
      setSelectionScrollLock(false);
      if (restoreFocus) trigger.focus({ preventScroll: true });
    },
    refresh() {
      const options = optionData(select);
      const selected = options.find((option) => option.value === select.value && !option.placeholder);
      const placeholder = options.find((option) => option.placeholder)?.label || select.getAttribute("aria-label") || "Select";
      trigger.querySelector(".tg-select-value").textContent = selected?.label || placeholder;
      trigger.classList.toggle("is-placeholder", !selected);
      trigger.disabled = select.disabled;
      trigger.setAttribute("aria-label", select.getAttribute("aria-label") || select.title || placeholder);
      popover.replaceChildren();
      options.filter((option) => !option.placeholder).forEach((option) => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "tg-option";
        item.setAttribute("role", "option");
        item.setAttribute("aria-selected", String(option.value === select.value));
        item.disabled = option.disabled;
        item.textContent = option.label;
        item.addEventListener("click", () => selectOption(controller, option));
        item.addEventListener("keydown", (event) => {
          const items = [...popover.querySelectorAll(".tg-option:not(:disabled)")];
          const index = items.indexOf(item);
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            items[(index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
          }
          if (event.key === "Home" || event.key === "End") {
            event.preventDefault();
            items[event.key === "Home" ? 0 : items.length - 1]?.focus();
          }
        });
        popover.append(item);
      });
    },
  };

  trigger.addEventListener("click", () => (popover.hidden ? controller.open() : controller.close()));
  trigger.addEventListener("keydown", (event) => {
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
      event.preventDefault();
      controller.open();
    }
  });
  new MutationObserver(() => controller.refresh()).observe(select, { childList: true, subtree: true, attributes: true });
  select.form?.addEventListener("reset", () => window.requestAnimationFrame(() => controller.refresh()));
  controller.refresh();
  return controller;
};

const createComboboxController = (select) => {
  const root = document.createElement("span");
  root.className = "tg-combobox";
  const input = document.createElement("input");
  input.className = "tg-combobox-input";
  input.type = "text";
  input.autocomplete = "off";
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "tg-combobox-trigger";
  trigger.setAttribute("aria-label", "\u6253\u5f00\u9009\u9879");
  trigger.innerHTML = '<span class="tg-select-chevron" aria-hidden="true"></span>';
  const popover = document.createElement("div");
  popover.className = "tg-popover tg-combobox-popover";
  popover.id = `tg-combobox-${++selectionId}`;
  popover.setAttribute("role", "listbox");
  popover.hidden = true;
  input.setAttribute("aria-controls", popover.id);
  input.setAttribute("aria-expanded", "false");

  select.before(root);
  root.append(select, input, trigger);
  document.body.append(popover);
  select.classList.add("tg-control-source");
  select.tabIndex = -1;

  let filteredOptions = [];
  let activeIndex = -1;
  const controller = {
    select,
    root,
    anchor: root,
    trigger,
    input,
    popover,
    minWidth: 260,
    contains: (node) => root.contains(node) || popover.contains(node),
    setActive(index) {
      if (!filteredOptions.length) return;
      activeIndex = (index + filteredOptions.length) % filteredOptions.length;
      popover.querySelectorAll(".tg-option").forEach((item, itemIndex) => item.classList.toggle("is-active", itemIndex === activeIndex));
      const active = popover.querySelectorAll(".tg-option")[activeIndex];
      input.setAttribute("aria-activedescendant", active?.id || "");
      active?.scrollIntoView({ block: "nearest" });
    },
    renderOptions(query = "") {
      const normalized = query.trim().toLocaleLowerCase();
      filteredOptions = optionData(select).filter((option) => !option.placeholder && !option.disabled && (!normalized || option.label.toLocaleLowerCase().includes(normalized)));
      popover.replaceChildren();
      if (!filteredOptions.length) {
        const empty = document.createElement("div");
        empty.className = "tg-combobox-empty";
        empty.textContent = "\u6ca1\u6709\u5339\u914d\u7ed3\u679c";
        popover.append(empty);
        activeIndex = -1;
        return;
      }
      filteredOptions.forEach((option, index) => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "tg-option";
        item.id = `${select.id || "combobox"}-option-${index}`;
        item.setAttribute("role", "option");
        item.setAttribute("aria-selected", String(option.value === select.value));
        item.textContent = option.label;
        item.addEventListener("pointerdown", (event) => event.preventDefault());
        item.addEventListener("click", () => selectOption(controller, option));
        popover.append(item);
      });
      controller.setActive(Math.max(0, filteredOptions.findIndex((option) => option.value === select.value)));
    },
    open() {
      if (select.disabled) return;
      closeOpenSelection();
      openSelectionController = controller;
      root.classList.add("is-open");
      input.setAttribute("aria-expanded", "true");
      popover.hidden = false;
      setSelectionScrollLock(true);
      controller.renderOptions(input.matches(":focus") ? input.value : "");
      positionPopover(controller);
      runUiMotion(popover, [{ opacity: 0, transform: "translate3d(0,-6px,0) scale(.985)" }, { opacity: 1, transform: "none" }], { id: "popover", duration: 150 });
    },
    close(restoreFocus = false) {
      if (popover.hidden) return;
      popover.hidden = true;
      root.classList.remove("is-open");
      input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-activedescendant");
      if (openSelectionController === controller) openSelectionController = null;
      setSelectionScrollLock(false);
      controller.refresh();
      if (restoreFocus) input.focus({ preventScroll: true });
    },
    refresh() {
      const selected = optionData(select).find((option) => option.value === select.value && !option.placeholder);
      input.value = selected?.label || "";
      input.placeholder = select.getAttribute("placeholder") || select.getAttribute("aria-label") || "Search options";
      input.disabled = select.disabled;
      trigger.disabled = select.disabled;
      input.setAttribute("aria-label", select.getAttribute("aria-label") || input.placeholder);
      controller.renderOptions();
    },
  };

  input.addEventListener("focus", () => controller.open());
  input.addEventListener("input", () => {
    if (popover.hidden) controller.open();
    controller.renderOptions(input.value);
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (popover.hidden) controller.open();
      controller.setActive(activeIndex + (event.key === "ArrowDown" ? 1 : -1));
    } else if (event.key === "Enter" && !popover.hidden && activeIndex >= 0) {
      event.preventDefault();
      selectOption(controller, filteredOptions[activeIndex]);
    }
  });
  trigger.addEventListener("click", () => {
    const wasOpen = !popover.hidden;
    if (wasOpen) {
      controller.close(true);
      return;
    }
    input.focus({ preventScroll: true });
    if (popover.hidden) controller.open();
  });
  new MutationObserver(() => controller.refresh()).observe(select, { childList: true, subtree: true, attributes: true });
  select.form?.addEventListener("reset", () => window.requestAnimationFrame(() => controller.refresh()));
  controller.refresh();
  return controller;
};

export const enhanceSelectionControl = (select) => {
  if (!select || selectionControllers.has(select)) return selectionControllers.get(select);
  bindSelectionGlobals();
  const controller = select.dataset.ui === "combobox" ? createComboboxController(select) : createSelectController(select);
  selectionControllers.set(select, controller);
  return controller;
};

export const refreshSelectionControl = (select) => selectionControllers.get(select)?.refresh();

export const enhanceOtpInput = (source, { label = "Verification code", hint = "" } = {}) => {
  if (!source || otpControllers.has(source)) return otpControllers.get(source);
  const length = Math.max(4, Number(source.maxLength) || 6);
  const root = document.createElement("div");
  root.className = "tg-otp";
  root.setAttribute("role", "group");
  root.setAttribute("aria-label", label);
  const cells = document.createElement("div");
  cells.className = "tg-otp-cells";
  source.before(root);
  root.append(source, cells);
  source.classList.add("tg-otp-source");
  source.tabIndex = -1;
  const digits = [];

  const sync = (value = digits.map((digit) => digit.value).join("")) => {
    const clean = String(value).replace(/\D/g, "").slice(0, length);
    digits.forEach((digit, index) => {
      digit.value = clean[index] || "";
    });
    source.value = clean;
    source.dispatchEvent(new Event("input", { bubbles: true }));
    root.classList.toggle("is-complete", clean.length === length);
  };

  for (let index = 0; index < length; index += 1) {
    if (length === 6 && index === 3) {
      const divider = document.createElement("span");
      divider.className = "tg-otp-divider";
      divider.setAttribute("aria-hidden", "true");
      cells.append(divider);
    }
    const digit = document.createElement("input");
    digit.type = "text";
    digit.inputMode = "numeric";
    digit.pattern = "[0-9]*";
    digit.maxLength = 1;
    digit.autocomplete = index === 0 ? "one-time-code" : "off";
    digit.className = "tg-otp-cell";
    digit.setAttribute("aria-label", `${label} ${index + 1}`);
    digit.addEventListener("input", (event) => {
      const value = event.target.value.replace(/\D/g, "");
      event.target.value = value.slice(-1);
      sync();
      if (event.target.value) digits[index + 1]?.focus();
    });
    digit.addEventListener("keydown", (event) => {
      if (event.key === "Backspace" && !digit.value && digits[index - 1]) {
        digits[index - 1].value = "";
        digits[index - 1].focus();
        sync();
      } else if (event.key === "ArrowLeft") digits[index - 1]?.focus();
      else if (event.key === "ArrowRight") digits[index + 1]?.focus();
    });
    digit.addEventListener("paste", (event) => {
      const pasted = event.clipboardData?.getData("text") || "";
      if (!/\d/.test(pasted)) return;
      event.preventDefault();
      sync(pasted);
      digits[Math.min(pasted.replace(/\D/g, "").length, length) - 1]?.focus();
    });
    digits.push(digit);
    cells.append(digit);
  }
  if (hint) {
    const hintNode = document.createElement("span");
    hintNode.className = "tg-otp-hint";
    hintNode.textContent = hint;
    root.append(hintNode);
  }
  sync(source.value);
  const controller = {
    root,
    source,
    digits,
    focus: () => (digits.find((digit) => !digit.value) || digits[0])?.focus(),
    setValue: (value) => sync(value),
  };
  otpControllers.set(source, controller);
  return controller;
};

export const focusOtpInput = (source) => otpControllers.get(source)?.focus() || source?.focus();
export const setOtpInputValue = (source, value = "") => {
  const controller = otpControllers.get(source);
  if (controller) return controller.setValue(value);
  if (source) source.value = value;
};

const toastVariant = (message, requested) => {
  if (requested) return requested;
  if (/(\u5931\u8d25|\u9519\u8bef|\u65e0\u6cd5|\u4e0d\u6b63\u786e|\u65e0\u6548|\u8bf7\u68c0\u67e5|\u53ea\u6709)/.test(message)) return "error";
  if (/(\u5df2|\u6210\u529f|\u5b8c\u6210|\u590d\u5236|\u4fdd\u5b58|\u66f4\u65b0|\u5f00\u542f|\u5173\u95ed)/.test(message)) return "success";
  return "info";
};

export const showUiToast = (toast, message, options = {}) => {
  if (!toast) return;
  const { copyText = "", duration = 3200, title = "" } = options;
  const variant = toastVariant(String(message), options.variant);
  const previousPositions = new Map([...toast.children].map((item) => [item, item.getBoundingClientRect().top]));
  toast.className = "toast tg-toast show";
  toast.setAttribute("role", "region");
  toast.setAttribute("aria-label", "Notifications");
  promoteToTopLayer(toast);

  const item = document.createElement("figure");
  item.className = `tg-toast-item is-${variant}`;
  item.setAttribute("role", variant === "error" ? "alert" : "status");

  const icon = document.createElement("span");
  icon.className = "tg-toast-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = variant === "success" ? "\u2713" : variant === "error" ? "!" : "i";
  const copy = document.createElement("div");
  copy.className = "tg-toast-copy";
  const heading = document.createElement("figcaption");
  const headingText = document.createElement("strong");
  headingText.textContent = title || (variant === "success" ? "\u64cd\u4f5c\u6210\u529f" : variant === "error" ? "\u9700\u8981\u6ce8\u610f" : "\u7cfb\u7edf\u63d0\u793a");
  const timestamp = document.createElement("small");
  timestamp.textContent = "\u00b7 \u521a\u521a";
  heading.append(headingText, timestamp);
  copy.append(heading);
  const description = document.createElement("span");
  description.textContent = String(message);
  copy.append(description);
  item.append(icon, copy);

  if (copyText) {
    const action = document.createElement("button");
    action.type = "button";
    action.className = "tg-toast-action";
    action.textContent = "\u590d\u5236";
    action.addEventListener("click", async () => {
      await navigator.clipboard?.writeText(copyText).catch(() => {});
      action.textContent = "\u5df2\u590d\u5236";
    });
    item.append(action);
  }
  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.className = "tg-toast-dismiss";
  dismiss.setAttribute("aria-label", "\u5173\u95ed\u63d0\u793a");
  dismiss.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17"/></svg>';
  item.append(dismiss);
  const progress = document.createElement("span");
  progress.className = "tg-toast-progress";
  item.append(progress);

  toast.prepend(item);
  [...toast.children].slice(4).forEach((extra) => extra.remove());
  previousPositions.forEach((top, existingItem) => {
    if (!existingItem.isConnected) return;
    const delta = top - existingItem.getBoundingClientRect().top;
    if (Math.abs(delta) > 1) {
      runUiMotion(existingItem, [{ transform: `translate3d(0,${delta}px,0)` }, { transform: "none" }], {
        id: "toast-layout",
        duration: 260,
      });
    }
  });

  let remaining = Math.max(800, duration);
  let startedAt = performance.now();
  let progressAnimation = null;
  const hide = () => {
    if (!item.isConnected || item.dataset.closing) return;
    item.dataset.closing = "true";
    window.clearTimeout(item._hideTimer);
    progressAnimation?.cancel();
    const animation = runUiMotion(item, [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translate3d(18px,0,0) scale(.84)" }], {
      id: "toast-out",
      duration: 180,
    });
    const remove = () => {
      item.remove();
      if (!toast.children.length) {
        toast.classList.remove("show");
        removeFromTopLayer(toast);
      }
    };
    if (animation) animation.finished.then(remove, remove);
    else remove();
  };
  const pause = () => {
    if (item.dataset.closing || item.dataset.paused === "true") return;
    item.dataset.paused = "true";
    remaining = Math.max(0, remaining - (performance.now() - startedAt));
    window.clearTimeout(item._hideTimer);
    progressAnimation?.pause();
  };
  const resume = () => {
    if (item.dataset.closing || item.dataset.paused !== "true") return;
    item.dataset.paused = "false";
    startedAt = performance.now();
    progressAnimation?.play();
    item._hideTimer = window.setTimeout(hide, remaining);
  };
  dismiss.addEventListener("click", hide);
  item.addEventListener("pointerenter", pause);
  item.addEventListener("pointerleave", resume);
  item.addEventListener("focusin", pause);
  item.addEventListener("focusout", (event) => {
    if (!item.contains(event.relatedTarget)) resume();
  });
  runUiMotion(item, [{ opacity: 0, transform: "translate3d(0,-12px,0) scale(.72)" }, { opacity: 1, transform: "none" }], {
    id: "toast-in",
    duration: 360,
    easing: "cubic-bezier(.16,1,.3,1)",
  });
  progressAnimation = runUiMotion(progress, [{ transform: "scaleX(1)" }, { transform: "scaleX(0)" }], {
    id: "toast-progress",
    duration: remaining,
    easing: "linear",
  });
  item._hideTimer = window.setTimeout(hide, remaining);
};

export const paginationRange = (currentPage, totalPages) => {
  const current = Math.max(1, Math.min(totalPages, currentPage));
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);
  const pages = new Set([1, totalPages, current - 1, current, current + 1]);
  const sorted = [...pages].filter((page) => page > 0 && page <= totalPages).sort((a, b) => a - b);
  const result = [];
  sorted.forEach((page, index) => {
    if (index && page - sorted[index - 1] > 1) result.push("ellipsis");
    result.push(page);
  });
  return result;
};

export const setupUiComponents = (root = document) => {
  root.querySelectorAll("select:not([data-ui-native])").forEach(enhanceSelectionControl);
  root.querySelectorAll("input[data-ui-otp]").forEach((input) =>
    enhanceOtpInput(input, {
      label: input.dataset.otpLabel || input.getAttribute("aria-label") || "Verification code",
      hint: input.dataset.otpHint || "",
    }),
  );
};
