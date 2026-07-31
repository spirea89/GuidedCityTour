import { PromptBuilder } from "./PromptBuilder.js";
import { ResponseValidator } from "./ResponseValidator.js";
import { STATUS } from "../schemas/tourResponseSchema.js";
import { WEB_SEARCH_UNAVAILABLE_HINT, PIPELINE_VERSION } from "../config.js";

/**
 * Research via OpenAI Responses API + web_search when possible.
 * On CORS / API failure → degraded packet that forbids verified fabrication.
 */
export class ResearchService {
  constructor({ openAi, promptBuilder, validator } = {}) {
    this.openAi = openAi;
    this.prompts = promptBuilder || new PromptBuilder();
    this.validator = validator || new ResponseValidator();
  }

  /**
   * @returns {Promise<{ ok: boolean, mode: string, packet?: object, error?: string, corsLikely?: boolean }>}
   */
  async research(place, options = {}) {
    const categories = options.categories || ["history"];
    const kidsMode = !!options.kidsMode;
    const queries = this.prompts.researchQueries(place, categories);

    // Prefer Responses + web_search
    const instructions =
      this.prompts.systemPrompt() +
      "\n\n" +
      this.prompts.developerPrompt("research");
    const input = this.prompts.userTourPrompt(place, {
      categories,
      kidsMode,
      researchMode: "web_search",
    });

    const responsesResult = await this.openAi.createResponse({
      instructions,
      input,
      tools: [{ type: "web_search" }],
      temperature: 0.25,
      maxOutputTokens: 3500,
    });

    if (responsesResult.ok && responsesResult.text) {
      const parsed = this.validator.parseJsonText(responsesResult.text);
      if (parsed.ok) {
        const packet = parsed.value;
        if (!packet.research) packet.research = {};
        packet.research.mode = "web_search";
        packet.research.queries = queries;
        if (!packet.meta) packet.meta = {};
        packet.meta.research_available = true;
        packet.meta.pipeline_version = PIPELINE_VERSION;
        packet.meta.model = this.openAi.model;
        return { ok: true, mode: "web_search", packet };
      }
      // JSON failed but we had search - try chat to structure (still grounded by text)
      const structured = await this._structureFromText(
        responsesResult.text,
        place,
        { categories, kidsMode }
      );
      if (structured.ok) return structured;
    }

    // Degraded path - Chat Completions, explicit no fabrication
    const degraded = await this._degradedNoSearch(place, {
      categories,
      kidsMode,
      priorError: responsesResult.error,
      corsLikely: responsesResult.corsLikely,
    });
    return degraded;
  }

  async _structureFromText(researchText, place, options) {
    const messages = [
      { role: "system", content: this.prompts.systemPrompt() },
      {
        role: "developer",
        content: this.prompts.developerPrompt("research"),
      },
      {
        role: "user",
        content:
          "Turn the following web-research notes into TourResponse JSON. " +
          "Only mark claims as verified if the notes support them with sources.\n\n" +
          "NOTES:\n" +
          researchText.slice(0, 12000) +
          "\n\n" +
          this.prompts.userTourPrompt(place, {
            ...options,
            researchMode: "web_search",
          }),
      },
    ];
    // Some models reject "developer" - map to system if needed
    const safeMessages = messages.map((m) =>
      m.role === "developer"
        ? { role: "system", content: m.content }
        : m
    );

    const chat = await this.openAi.createChatCompletion({
      messages: safeMessages,
      temperature: 0.2,
      maxTokens: 3000,
      responseFormat: { type: "json_object" },
    });
    if (!chat.ok) {
      return { ok: false, mode: "none", error: chat.error };
    }
    const parsed = this.validator.parseJsonText(chat.text);
    if (!parsed.ok) {
      return { ok: false, mode: "none", error: parsed.error };
    }
    const packet = parsed.value;
    if (!packet.research) packet.research = {};
    packet.research.mode = "web_search";
    if (!packet.meta) packet.meta = {};
    packet.meta.research_available = true;
    packet.meta.model = this.openAi.model;
    packet.meta.pipeline_version = PIPELINE_VERSION;
    return { ok: true, mode: "web_search", packet };
  }

  async _degradedNoSearch(place, options = {}) {
    const messages = [
      { role: "system", content: this.prompts.systemPrompt() },
      {
        role: "system",
        content: this.prompts.developerPrompt("degraded_no_search"),
      },
      {
        role: "user",
        content: this.prompts.userTourPrompt(place, {
          categories: options.categories,
          kidsMode: options.kidsMode,
          researchMode: "degraded",
        }),
      },
    ];

    const chat = await this.openAi.createChatCompletion({
      messages,
      temperature: 0.2,
      maxTokens: 1200,
      responseFormat: { type: "json_object" },
    });

    if (!chat.ok) {
      const offline =
        chat.corsLikely ||
        /network|fetch|failed/i.test(String(chat.error || ""));
      return {
        ok: false,
        mode: "degraded",
        error: chat.error || WEB_SEARCH_UNAVAILABLE_HINT,
        corsLikely: chat.corsLikely,
        status: offline && !this.openAi.apiKey ? STATUS.OFFLINE : STATUS.WEB_SEARCH_UNAVAILABLE,
      };
    }

    const parsed = this.validator.parseJsonText(chat.text);
    let packet;
    if (parsed.ok) {
      packet = parsed.value;
    } else {
      packet = {
        status: STATUS.WEB_SEARCH_UNAVAILABLE,
        message: WEB_SEARCH_UNAVAILABLE_HINT,
        place: {
          name: place.name,
          entity_type: place.entityType,
          lat: place.lat,
          lng: place.lng,
          identification_confidence: place.identificationConfidence,
          nearby_allow_list: place.nearbyAllowList,
        },
        research: { mode: "degraded", queries: [], sources_consulted: [] },
        claims: {
          verified: [],
          uncertain: [],
          legends: [],
          unknown: [
            "Historical claims were not researched because web search was unavailable.",
          ],
        },
        narration: {
          adult:
            "I can see this place on the map as "" +
            (place.name || "an unnamed location") +
            "", but I could not run web research from this browser, so I will not invent a history for it. " +
            WEB_SEARCH_UNAVAILABLE_HINT,
          kids:
            "We found this place on the map, but we could not safely check real history online right now - so we will not make a story up.",
          sections: {},
        },
        citations: [],
        errors: [options.priorError || "web_search unavailable"].filter(Boolean),
        meta: {
          pipeline_version: PIPELINE_VERSION,
          model: this.openAi.model,
          research_available: false,
        },
      };
    }

    packet.status = STATUS.WEB_SEARCH_UNAVAILABLE;
    if (!packet.research) packet.research = {};
    packet.research.mode = "degraded";
    // Hard strip any verified claims in degraded mode
    if (!packet.claims) packet.claims = {};
    packet.claims.verified = [];
    if (!packet.meta) packet.meta = {};
    packet.meta.research_available = false;
    packet.meta.model = this.openAi.model;
    packet.meta.pipeline_version = PIPELINE_VERSION;
    if (!packet.message) packet.message = WEB_SEARCH_UNAVAILABLE_HINT;

    return {
      ok: true,
      mode: "degraded",
      packet,
      corsLikely: options.corsLikely,
      priorError: options.priorError,
    };
  }
}
