const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

export const setupInlineDetails = () => {
  const transitions = new WeakMap();
  document.addEventListener("click", (event) => {
    const summary = event.target.closest?.("details.inline-details > summary");
    if (!summary || event.target.closest("a,button,input,select,textarea")) return;
    event.preventDefault();
    const details = summary.parentElement;
    const previous = transitions.get(details);
    const expand = !(previous ? previous.expand : details.open);
    const from = details.getBoundingClientRect().height;
    previous?.animation.cancel();
    transitions.delete(details);
    if (reducedMotion()) {
      details.open = expand;
      return;
    }
    details.open = false;
    const closedHeight = details.getBoundingClientRect().height;
    details.open = true;
    const to = expand ? details.getBoundingClientRect().height : closedHeight;
    const animation = details.animate(
      [{ height: `${from}px`, overflow: "clip" }, { height: `${to}px`, overflow: "clip" }],
      { duration: 260, easing: "cubic-bezier(.22,1,.36,1)", fill: "both" },
    );
    transitions.set(details, { animation, expand });
    animation.finished.then(() => {
      if (transitions.get(details)?.animation !== animation) return;
      details.open = expand;
      transitions.delete(details);
      animation.cancel();
    }).catch(() => {});
  });
};

// Split a paragraph before inserting a block, avoiding invalid nested <p> markup.
export const insertBlockAtRange = (editor, range, node) => {
  range.deleteContents();
  const element = range.startContainer.nodeType === Node.ELEMENT_NODE
    ? range.startContainer : range.startContainer.parentElement;
  const paragraph = element.closest?.("p");
  const last = node.nodeType === Node.DOCUMENT_FRAGMENT_NODE ? node.lastChild : node;
  if (paragraph && editor.contains(paragraph)) {
    const tail = range.cloneRange();
    tail.setEnd(paragraph, paragraph.childNodes.length);
    const remainder = paragraph.cloneNode(false);
    remainder.append(tail.extractContents());
    paragraph.after(node);
    if (remainder.hasChildNodes()) last.after(remainder);
    if (!paragraph.hasChildNodes()) paragraph.remove();
  } else {
    range.insertNode(node);
  }
  range.setStartAfter(last);
  range.collapse(true);
  return range;
};

export const wrapEditorSelection = (editor, range, kind) => {
  const wrapper = document.createElement(kind === "details" ? "details" : "blockquote");
  wrapper.className = kind === "details" ? "inline-details" : "inline-quote";
  if (kind === "details") {
    wrapper.open = true;
    const summary = document.createElement("summary");
    summary.textContent = "\u70b9\u51fb\u5c55\u5f00";
    wrapper.append(summary);
  }
  if (range.collapsed) {
    const paragraph = document.createElement("p");
    paragraph.textContent = kind === "details" ? "\u6298\u53e0\u5185\u5bb9" : "\u5f15\u7528\u5185\u5bb9";
    wrapper.append(paragraph);
  } else {
    wrapper.append(range.extractContents());
  }
  insertBlockAtRange(editor, range, wrapper);
  const content = kind === "details" ? wrapper.children[1] || wrapper : wrapper;
  range.selectNodeContents(content);
  range.collapse(false);
  return range;
};

export const setupVideoResize = (editor, saveSelection, sizeStyle) => {
  const overlay = document.createElement("div");
  overlay.className = "editor-video-resize";
  overlay.hidden = true;
  (editor.closest("dialog") || document.body).append(overlay);
  let media = null;
  let drag = null;
  let frame = 0;
  const position = () => {
    frame = 0;
    const rect = media?.getBoundingClientRect();
    const bounds = editor.getBoundingClientRect();
    overlay.hidden = !media?.isConnected || !rect?.width || !rect?.height
      || rect.bottom < bounds.top || rect.top > bounds.bottom
      || Boolean(media.closest("details:not([open])"));
    if (overlay.hidden) return;
    Object.assign(overlay.style, {
      left: `${rect.left}px`, top: `${rect.top}px`,
      width: `${rect.width}px`, height: `${rect.height}px`,
    });
  };
  const schedulePosition = () => {
    if (!frame) frame = requestAnimationFrame(position);
  };
  const selectMedia = () => {
    const range = document.createRange();
    range.selectNode(media);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    saveSelection();
  };
  const resize = (width, height) => {
    const available = media.parentElement.getBoundingClientRect().width;
    const size = {
      width: Math.round(Math.min(1600, available, Math.max(120, width))),
      height: Math.round(Math.min(1200, Math.max(90, height))),
    };
    media.style.cssText = sizeStyle(size);
    media.width = String(size.width);
    media.height = String(size.height);
    position();
  };
  const finish = () => {
    if (!drag) return;
    drag = null;
    document.body.classList.remove("is-resizing-video");
    editor.dispatchEvent(new Event("input", { bubbles: true }));
  };
  ["n", "ne", "e", "se", "s", "sw", "w", "nw"].forEach((edge) => {
    const handle = document.createElement("button");
    handle.type = "button";
    handle.className = `video-resize-handle edge-${edge}`;
    handle.setAttribute("aria-label", `\u8c03\u6574\u89c6\u9891\u5927\u5c0f ${edge}`);
    handle.title = "\u62d6\u52a8\u8c03\u6574\u5927\u5c0f";
    overlay.append(handle);
    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      selectMedia();
      const rect = media.getBoundingClientRect();
      drag = { x: event.clientX, y: event.clientY, width: rect.width, height: rect.height };
      handle.setPointerCapture(event.pointerId);
      document.body.classList.add("is-resizing-video");
    });
    handle.addEventListener("pointermove", (event) => {
      if (!drag) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      resize(drag.width + (edge.includes("e") ? dx : edge.includes("w") ? -dx : 0),
        drag.height + (edge.includes("s") ? dy : edge.includes("n") ? -dy : 0));
    });
    ["pointerup", "pointercancel", "lostpointercapture"].forEach((name) => handle.addEventListener(name, finish));
    handle.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
      event.preventDefault();
      const rect = media.getBoundingClientRect();
      resize(rect.width + (event.key === "ArrowRight" ? 10 : event.key === "ArrowLeft" ? -10 : 0),
        rect.height + (event.key === "ArrowDown" ? 10 : event.key === "ArrowUp" ? -10 : 0));
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    });
  });
  editor.addEventListener("pointerover", (event) => {
    if (event.target.tagName !== "IFRAME" || drag) return;
    media = event.target;
    position();
  });
  document.addEventListener("pointerdown", (event) => {
    if (overlay.contains(event.target) || event.target === media || event.target.closest(".editor-toolbar")) return;
    media = null;
    position();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      finish();
      media = null;
      position();
    }
  });
  document.addEventListener("toggle", schedulePosition, true);
  window.addEventListener("scroll", schedulePosition, true);
  window.addEventListener("resize", schedulePosition);
  new ResizeObserver(schedulePosition).observe(editor);
  new MutationObserver(schedulePosition).observe(editor, { childList: true, subtree: true });
};
