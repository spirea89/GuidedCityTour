import { PIPELINE_VERSION } from "../config.js";

export function emptyClaims() {
  return {
    verified: [],
    uncertain: [],
    legends: [],
    unknown: [],
  };
}

export function emptyNarration() {
  return {
    adult: "",
    kids: "",
    sections: {
      history: "",
      architecture: "",
      famous_people: "",
      interesting_facts: "",
      today: "",
    },
  };
}

export function createTourResult(partial = {}) {
  return {
    status: partial.status || "error",
    message: partial.message || "",
    place: partial.place || null,
    research: partial.research || {
      mode: "none",
      queries: [],
      sources_consulted: [],
    },
    claims: partial.claims || emptyClaims(),
    narration: partial.narration || emptyNarration(),
    citations: Array.isArray(partial.citations) ? partial.citations : [],
    errors: Array.isArray(partial.errors) ? partial.errors : [],
    meta: {
      pipeline_version: PIPELINE_VERSION,
      model: "",
      cached: false,
      generated_at: new Date().toISOString(),
      research_available: false,
      ...(partial.meta || {}),
    },
  };
}
