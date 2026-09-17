const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

export const setupInlineDetails = () => {
  const transitions = new WeakMap();
  document.addEventListener("click", (event) => {
    const summary = event.target.closest?.("details.inline-details > summary, details.profile-setting > summary");
    if (!summary || event.target.closest("a,button,input,select,textarea")) return;
    const titleEditor = event.target.closest(".rich-editor .inline-details-title");
    if (titleEditor && event.clientX > summary.getBoundingClientRect().left + 14) {
      event.preventDefault();
      return;
    }
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
    const style = getComputedStyle(details);
    const closedHeight = summary.getBoundingClientRect().height
      + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom)
      + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
    details.open = true;
    const to = expand ? details.getBoundingClientRect().height : closedHeight;
    const animation = details.animate(
      [{ height: `${from}px`, overflow: "clip" }, { height: `${to}px`, overflow: "clip" }],
      { id: "details-toggle", duration: 260, easing: "cubic-bezier(.22,1,.36,1)", fill: "both" },
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

const focusEditable = (element, atEnd = false) => {
  element.focus({ preventScroll: true });
  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(!atEnd);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
};

export const setupEditorDetails = (editor) => {
  const normalize = () => {
    editor.querySelectorAll("details.inline-details").forEach((details) => {
      if (details.dataset.editableDetails === "true") return;
      details.dataset.editableDetails = "true";
      details.contentEditable = "false";
      let summary = details.querySelector(":scope > summary");
      if (!summary) {
        summary = document.createElement("summary");
        summary.textContent = "\u70b9\u51fb\u5c55\u5f00";
        details.prepend(summary);
      }
      const oldTitle = summary.querySelector(":scope > .inline-details-title");
      if (oldTitle) oldTitle.replaceWith(...oldTitle.childNodes);
      const title = summary;
      title.classList.add("inline-details-title");
      title.contentEditable = "true";
      title.tabIndex = 0;
      title.setAttribute("role", "textbox");
      title.setAttribute("aria-label", "\u6298\u53e0\u6807\u9898");
      if (!title.hasChildNodes()) title.append(document.createElement("br"));
      let body = details.querySelector(":scope > .inline-details-body");
      if (!body) {
        body = document.createElement("div");
        body.className = "inline-details-body";
        body.append(...[...details.childNodes].filter((node) => node !== summary));
        details.append(body);
      }
      body.contentEditable = "true";
      body.tabIndex = 0;
      body.setAttribute("role", "textbox");
      body.setAttribute("aria-label", "\u6298\u53e0\u5185\u5bb9");
      body.setAttribute("aria-multiline", "true");
      if (!body.hasChildNodes()) body.append(document.createElement("br"));
    });
  };
  normalize();
  new MutationObserver(normalize).observe(editor, { childList: true, subtree: true });
  editor.addEventListener("keydown", (event) => {
    const region = event.target.closest(".inline-details-title, .inline-details-body");
    if (region && (event.ctrlKey || event.metaKey) && ["Home", "End"].includes(event.key)) {
      event.preventDefault();
      focusEditable(region, event.key === "End");
      return;
    }
    const title = event.target.closest(".inline-details-title");
    if (title && event.key === "Enter") {
      event.preventDefault();
      const details = title.closest("details");
      details.open = true;
      focusEditable(details.querySelector(":scope > .inline-details-body"));
    }
    if (title && event.key === " ") {
      // Summary activation must not consume a space typed in its title editor.
      event.preventDefault();
      event.stopPropagation();
      document.execCommand("insertText", false, " ");
      const selection = window.getSelection();
      const range = selection.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
      if (range) {
        selection.removeAllRanges();
        selection.addRange(range);
      }
      title.focus({ preventScroll: true });
    }
  });
  editor.addEventListener("beforeinput", (event) => {
    if (!["deleteContentBackward", "deleteContentForward"].includes(event.inputType)) return;
    const region = event.target.closest(".inline-details-title, .inline-details-body");
    const selection = window.getSelection();
    if (!region || !selection.rangeCount || !selection.isCollapsed) return;
    const range = selection.getRangeAt(0);
    if (!region.contains(range.startContainer)) return;
    const edge = range.cloneRange();
    edge.selectNodeContents(region);
    if (event.inputType === "deleteContentBackward") edge.setEnd(range.startContainer, range.startOffset);
    else edge.setStart(range.endContainer, range.endOffset);
    const fragment = edge.cloneContents();
    if (!fragment.textContent && !fragment.querySelector("iframe,img,details,table")) event.preventDefault();
  });
};

export const editorContentHtml = (editor) => {
  const copy = editor.cloneNode(true);
  copy.querySelectorAll("[contenteditable], [data-editable-details]").forEach((node) => {
    node.removeAttribute("contenteditable");
    node.removeAttribute("data-editable-details");
  });
  copy.querySelectorAll(".inline-details-title, .inline-details-body").forEach((node) => {
    ["role", "aria-label", "aria-multiline", "tabindex"].forEach((attribute) => node.removeAttribute(attribute));
  });
  return copy.innerHTML.trim();
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
  let content = wrapper;
  if (kind === "details") {
    wrapper.open = true;
    const summary = document.createElement("summary");
    summary.textContent = "\u70b9\u51fb\u5c55\u5f00";
    wrapper.append(summary);
    content = document.createElement("div");
    content.className = "inline-details-body";
    wrapper.append(content);
  }
  if (range.collapsed) {
    const paragraph = document.createElement("p");
    paragraph.textContent = kind === "details" ? "\u6298\u53e0\u5185\u5bb9" : "\u5f15\u7528\u5185\u5bb9";
    content.append(paragraph);
  } else {
    content.append(range.extractContents());
  }
  insertBlockAtRange(editor, range, wrapper);
  range.selectNode(wrapper);
  return range;
};

export const setupVideoResize = (editor, saveSelection, sizeStyle) => {
  const overlay = document.createElement("div");
  overlay.className = "editor-video-resize";
  overlay.hidden = true;
  overlay.setAttribute("popover", "manual");
  (editor.closest("dialog") || document.body).append(overlay);
  let media = null;
  let drag = null;
  let frame = 0;
  const position = () => {
    frame = 0;
    const rect = media?.getBoundingClientRect();
    const bounds = editor.getBoundingClientRect();
    overlay.hidden = !media?.isConnected || !editor.getClientRects().length || !rect?.width || !rect?.height
      || rect.bottom < bounds.top || rect.top > bounds.bottom
      || Boolean(media.closest("details:not([open])"));
    if (overlay.hidden) {
      if (overlay.matches(":popover-open")) overlay.hidePopover();
      return;
    }
    if (overlay.showPopover && !overlay.matches(":popover-open")) overlay.showPopover();
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
      editor.focus({ preventScroll: true });
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
  document.addEventListener("pointerdown", (event) => {
    if (overlay.contains(event.target)) return;
    finish();
    media = editor.contains(event.target) ? [...editor.querySelectorAll("iframe")].find((iframe) => {
      const rect = iframe.getBoundingClientRect();
      return rect.width && rect.height && event.clientX >= rect.left - 8 && event.clientX <= rect.right + 8
        && event.clientY >= rect.top - 8 && event.clientY <= rect.bottom + 8;
    }) || null : null;
    if (media) {
      event.preventDefault();
      selectMedia();
    }
    position();
  });
  // Cross-origin iframe clicks do not bubble; focus moving into the frame selects it.
  window.addEventListener("blur", () => {
    window.setTimeout(() => {
      const active = document.activeElement;
      if (active?.tagName === "IFRAME" && editor.contains(active)) {
        media = active;
        selectMedia();
        position();
      }
    }, 0);
  });
  document.addEventListener("focusin", (event) => {
    if (overlay.contains(event.target) || event.target === media) return;
    if (event.target !== editor) {
      finish();
      media = null;
      position();
    }
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
  new MutationObserver(schedulePosition).observe(editor, { childList: true, subtree: true, attributes: true, attributeFilter: ["width", "height", "style"] });
};
