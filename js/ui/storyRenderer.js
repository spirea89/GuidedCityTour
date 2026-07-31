import { STATUS } from "../schemas/tourResponseSchema.js";
import { WEB_SEARCH_UNAVAILABLE_HINT } from "../config.js";

/**
 * Renders TourResult into the side panel (status, narration, citations, confirm).
 */
export class StoryRenderer {
  constructor(els) {
    this.els = els;
  }

  clear() {
    const e = this.els;
    if (e.storyBlock) e.storyBlock.classList.remove("visible");
    if (e.storyLoading) e.storyLoading.classList.remove("visible");
    if (e.storyError) {
      e.storyError.classList.remove("visible");
      e.storyError.textContent = "";
    }
    if (e.storyText) {
      e.storyText.hidden = true;
      e.storyText.innerHTML = "";
      e.storyText.textContent = "";
    }
    if (e.citationsBlock) {
      e.citationsBlock.hidden = true;
      e.citationsBlock.innerHTML = "";
    }
    if (e.confirmBlock) {
      e.confirmBlock.hidden = true;
      e.confirmBlock.innerHTML = "";
    }
    if (e.claimsMeta) {
      e.claimsMeta.hidden = true;
      e.claimsMeta.textContent = "";
    }
  }

  showLoading(msg) {
    const e = this.els;
    e.storyBlock.classList.add("visible");
    e.storyLoading.classList.add("visible");
    e.storyLoading.textContent =
      msg || "Identifying place and researching with source checks…";
    e.storyError.classList.remove("visible");
    e.storyError.textContent = "";
    e.storyText.hidden = true;
    e.storyText.innerHTML = "";
    if (e.citationsBlock) {
      e.citationsBlock.hidden = true;
      e.citationsBlock.innerHTML = "";
    }
    if (e.confirmBlock) {
      e.confirmBlock.hidden = true;
      e.confirmBlock.innerHTML = "";
    }
  }

  hideLoading() {
    this.els.storyLoading.classList.remove("visible");
  }

  /**
   * @param {object} result TourResult
   * @param {object} hooks { onConfirmCandidate(c), getSpeakText() }
   */
  render(result, hooks = {}) {
    const e = this.els;
    this.hideLoading();
    e.storyBlock.classList.add("visible");

    if (!result) {
      this.renderError(STATUS.ERROR, "No result");
      return { speakText: "" };
    }

    if (
      result.status === STATUS.NEEDS_CONFIRMATION ||
      result.status === STATUS.AMBIGUOUS_NAME
    ) {
      return this.renderConfirmation(result, hooks.onConfirmCandidate);
    }

    if (
      result.status === STATUS.UNIDENTIFIED ||
      result.status === STATUS.OFFLINE ||
      result.status === STATUS.ERROR
    ) {
      this.renderError(result.status, result.message || statusLabel(result.status));
      return { speakText: "" };
    }

    if (result.status === STATUS.WEB_SEARCH_UNAVAILABLE) {
      e.storyError.textContent =
        result.message || WEB_SEARCH_UNAVAILABLE_HINT;
      e.storyError.classList.add("visible");
    } else if (result.status === STATUS.SOURCE_CONFLICT) {
      e.storyError.textContent =
        result.message || "Sources conflict — treat claims carefully.";
      e.storyError.classList.add("visible");
    } else if (result.status === STATUS.NO_HISTORY) {
      e.storyError.textContent =
        result.message || "No verified history found for this place.";
      e.storyError.classList.add("visible");
    } else {
      e.storyError.classList.remove("visible");
      e.storyError.textContent = "";
    }

    const kidsMode = !!hooks.kidsMode;
    const adult = (result.narration && result.narration.adult) || "";
    const kids = (result.narration && result.narration.kids) || "";
    const body = kidsMode && kids ? kids : adult;

    const sections = (result.narration && result.narration.sections) || {};
    const sectionHtml = renderSections(sections);

    e.storyText.hidden = false;
    e.storyText.innerHTML = "";
    const main = document.createElement("div");
    main.className = "story-main";
    main.textContent = body;
    e.storyText.appendChild(main);
    if (sectionHtml) {
      const wrap = document.createElement("div");
      wrap.className = "story-sections";
      wrap.innerHTML = sectionHtml;
      e.storyText.appendChild(wrap);
    }

    if (e.claimsMeta) {
      const v = (result.claims && result.claims.verified) || [];
      const u = (result.claims && result.claims.uncertain) || [];
      const cached = result.meta && result.meta.cached ? " · cached" : "";
      e.claimsMeta.hidden = false;
      e.claimsMeta.textContent =
        v.length +
        " verified · " +
        u.length +
        " uncertain · status: " +
        result.status +
        cached;
    }

    this.renderCitations(result.citations || []);

    return {
      speakText: body,
    };
  }

  renderConfirmation(result, onConfirm) {
    const e = this.els;
    e.storyError.textContent =
      result.message || "Confirm which place you mean before research.";
    e.storyError.classList.add("visible");
    e.storyText.hidden = true;

    if (!e.confirmBlock) return { speakText: "" };
    e.confirmBlock.hidden = false;
    e.confirmBlock.innerHTML = "";
    const title = document.createElement("p");
    title.className = "confirm-title";
    title.textContent = "Confirm place";
    e.confirmBlock.appendChild(title);

    const candidates =
      (result.place && result.place.candidates) || [];
    candidates.forEach((c, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-secondary confirm-candidate";
      btn.textContent =
        c.name +
        (typeof c.confidence === "number"
          ? " (" + Math.round(c.confidence * 100) + "%)"
          : "");
      btn.addEventListener("click", () => {
        if (typeof onConfirm === "function") onConfirm(c);
      });
      e.confirmBlock.appendChild(btn);
      if (i === 0) btn.classList.add("btn");
    });

    return { speakText: "" };
  }

  renderCitations(citations) {
    const e = this.els;
    if (!e.citationsBlock) return;
    e.citationsBlock.innerHTML = "";
    if (!citations || !citations.length) {
      e.citationsBlock.hidden = true;
      return;
    }
    e.citationsBlock.hidden = false;
    const h = document.createElement("h3");
    h.className = "citations-heading";
    h.textContent = "Sources";
    e.citationsBlock.appendChild(h);
    const ul = document.createElement("ul");
    ul.className = "citations-list";
    citations.forEach((c) => {
      const li = document.createElement("li");
      if (c.url) {
        const a = document.createElement("a");
        a.href = c.url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = c.title || c.url;
        li.appendChild(a);
      } else {
        li.textContent = c.title || "Source";
      }
      if (c.publisher || c.tier) {
        const meta = document.createElement("span");
        meta.className = "citation-meta";
        meta.textContent =
          " — " +
          [c.publisher, c.tier].filter(Boolean).join(" · ");
        li.appendChild(meta);
      }
      ul.appendChild(li);
    });
    e.citationsBlock.appendChild(ul);
  }

  renderError(status, message) {
    const e = this.els;
    e.storyBlock.classList.add("visible");
    this.hideLoading();
    e.storyText.hidden = true;
    e.storyError.textContent = message || statusLabel(status);
    e.storyError.classList.add("visible");
    if (e.citationsBlock) e.citationsBlock.hidden = true;
    if (e.confirmBlock) e.confirmBlock.hidden = true;
  }
}

function statusLabel(status) {
  switch (status) {
    case STATUS.UNIDENTIFIED:
      return "Could not identify this place.";
    case STATUS.OFFLINE:
      return "You appear to be offline.";
    case STATUS.WEB_SEARCH_UNAVAILABLE:
      return WEB_SEARCH_UNAVAILABLE_HINT;
    case STATUS.NO_HISTORY:
      return "No verified history found.";
    case STATUS.SOURCE_CONFLICT:
      return "Sources conflict.";
    default:
      return "Something went wrong generating the tour.";
  }
}

function renderSections(sections) {
  const labels = {
    history: "History",
    architecture: "Architecture",
    famous_people: "Famous people",
    interesting_facts: "Interesting facts",
    today: "Today",
  };
  const parts = [];
  for (const key of Object.keys(labels)) {
    const text = sections[key];
    if (text && String(text).trim()) {
      parts.push(
        '<div class="story-section"><div class="story-section-label">' +
          escapeHtml(labels[key]) +
          "</div><div class=\"story-section-body\">" +
          escapeHtml(String(text).trim()) +
          "</div></div>"
      );
    }
  }
  return parts.join("");
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
