import { PromptBuilder } from "./PromptBuilder.js";
import { ResponseValidator } from "./ResponseValidator.js";
import { emptyNarration } from "../models/tourResult.js";
import { STATUS } from "../schemas/tourResponseSchema.js";
import { PIPELINE_VERSION } from "../config.js";

/**
 * Builds adult / kids narration strictly from verified (+ labeled legends).
 * If research packet already includes narration and status is ok, reuse after scrub.
 */
export class NarrationGenerator {
  constructor({ openAi, promptBuilder, validator } = {}) {
    this.openAi = openAi;
    this.prompts = promptBuilder || new PromptBuilder();
    this.validator = validator || new ResponseValidator();
  }

  async narrate(verifiedBundle, place, options = {}) {
    const claims = verifiedBundle.claims;
    const status = verifiedBundle.status;
    const kidsMode = !!options.kidsMode;
    const categories = options.categories || ["history"];

    // Degraded / no verified: do not call model to invent — use honest template
    if (
      status === STATUS.WEB_SEARCH_UNAVAILABLE ||
      status === STATUS.OFFLINE
    ) {
      return finalizeNarration(
        verifiedBundle.narrationSeed || buildUnavailableNarration(place),
        claims,
        kidsMode
      );
    }

    if (status === STATUS.NO_HISTORY || !claims.verified.length) {
      const n = emptyNarration();
      n.adult =
        "Standing here at “" +
        (place.name || "this location") +
        "”, I do not yet have well-sourced historical claims to share. " +
        "Map data identifies the place, but authoritative sources did not yield " +
        "verified history for this exact pin. I will not invent one.";
      if (kidsMode) {
        n.kids =
          "We know where we are on the map, but we could not find trusted history " +
          "for this exact spot yet — so we will not make a story up.";
      }
      return n;
    }

    // Prefer model-provided narration if present and non-empty
    const seed = verifiedBundle.narrationSeed;
    if (seed && String(seed.adult || "").trim()) {
      return finalizeNarration(seed, claims, kidsMode);
    }

    // Generate from claims only
    const messages = [
      { role: "system", content: this.prompts.systemPrompt() },
      {
        role: "system",
        content: this.prompts.developerPrompt("narrate"),
      },
      {
        role: "user",
        content:
          "Write narration JSON fields only from these claims. Do not add facts.\n\n" +
          JSON.stringify(
            {
              place: { name: place.name, entity_type: place.entityType },
              claims,
              categories,
              kids_mode: kidsMode,
            },
            null,
            2
          ),
      },
    ];

    const chat = await this.openAi.createChatCompletion({
      messages,
      temperature: 0.55,
      maxTokens: 1600,
      responseFormat: { type: "json_object" },
    });

    if (!chat.ok) {
      return finalizeNarration(
        buildFallbackFromClaims(claims, place, kidsMode),
        claims,
        kidsMode
      );
    }

    const parsed = this.validator.parseJsonText(chat.text);
    if (!parsed.ok) {
      return finalizeNarration(
        buildFallbackFromClaims(claims, place, kidsMode),
        claims,
        kidsMode
      );
    }

    const narration =
      parsed.value.narration ||
      parsed.value ||
      emptyNarration();
    return finalizeNarration(narration, claims, kidsMode);
  }
}

function finalizeNarration(seed, claims, kidsMode) {
  const n = emptyNarration();
  const src = seed || {};
  n.adult = String(src.adult || "").trim();
  n.kids = String(src.kids || "").trim();
  const sec = src.sections || {};
  for (const k of Object.keys(n.sections)) {
    n.sections[k] = String(sec[k] || "").trim();
  }

  if (claims.legends && claims.legends.length && n.adult) {
    const alreadyLabeled = /legends?\s*&?\s*local/i.test(n.adult);
    if (!alreadyLabeled) {
      n.adult +=
        "\n\nLegends & local stories (not verified history):\n" +
        claims.legends.map((c) => "• " + c.text).join("\n");
    }
  }

  if (kidsMode && !n.kids && claims.verified.length) {
    n.kids = buildKidsFromVerified(claims.verified, "");
  }
  if (!kidsMode) {
    // keep kids if present for toggle later; OK
  }

  if (!n.adult && claims.verified.length) {
    n.adult = buildFallbackFromClaims(claims, { name: "" }, false).adult;
  }

  return n;
}

function buildUnavailableNarration(place) {
  const n = emptyNarration();
  n.adult =
    "Map identity: “" +
    (place.name || "unnamed location") +
    "”. Web research was unavailable, so no verified historical narration is offered.";
  n.kids =
    "We can see this place on the map, but we could not check real history online — so no made-up story.";
  return n;
}

function buildFallbackFromClaims(claims, place, kidsMode) {
  const n = emptyNarration();
  const name = place.name || "This place";
  const lines = (claims.verified || []).map((c) => c.text);
  n.adult =
    name +
    " — what sources support:\n\n" +
    lines.map((t) => "• " + t).join("\n");
  if (claims.legends && claims.legends.length) {
    n.adult +=
      "\n\nLegends & local stories (not verified history):\n" +
      claims.legends.map((c) => "• " + c.text).join("\n");
  }
  if (kidsMode) {
    n.kids = buildKidsFromVerified(claims.verified, name);
  }
  return n;
}

function buildKidsFromVerified(verified, name) {
  const bits = (verified || []).slice(0, 3).map((c) => c.text);
  const head = name ? "About " + name + ": " : "";
  return (
    head +
    bits.join(" ") +
    (bits.length ? "" : "We only share facts we can check — nothing made up.")
  ).slice(0, 600);
}

export { PIPELINE_VERSION };
