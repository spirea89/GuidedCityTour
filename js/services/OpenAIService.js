import { API, MODEL_QUALITY } from "../config.js";

/**
 * Thin OpenAI client. Prefers Responses API (+ web_search); falls back to
 * Chat Completions for degraded structured JSON (no fabrication path).
 *
 * When API.tourEndpoint is set, prefer calling the Worker instead (production).
 */
export class OpenAIService {
  constructor({ apiKey, model, baseUrl } = {}) {
    this.apiKey = apiKey || "";
    this.model = model || MODEL_QUALITY;
    this.baseUrl = (baseUrl || API.openAiBase).replace(/\/$/, "");
    this._responsesAvailable = null;
  }

  setApiKey(key) {
    this.apiKey = key || "";
  }

  setModel(model) {
    this.model = model || MODEL_QUALITY;
  }

  /**
   * Responses API with optional web_search tool.
   * @returns {{ ok: boolean, text?: string, raw?: object, error?: string, corsLikely?: boolean }}
   */
  async createResponse({
    instructions,
    input,
    tools = [],
    temperature = 0.3,
    maxOutputTokens = 2500,
  }) {
    if (!this.apiKey) {
      return { ok: false, error: "Missing API key" };
    }

    const body = {
      model: this.model,
      instructions: instructions || undefined,
      input: input,
      temperature,
      max_output_tokens: maxOutputTokens,
    };
    if (tools && tools.length) {
      body.tools = tools;
    }

    try {
      const res = await fetch(this.baseUrl + "/responses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + this.apiKey,
        },
        body: JSON.stringify(body),
      });

      let json = null;
      try {
        json = await res.json();
      } catch (_) {
        json = null;
      }

      if (!res.ok) {
        const msg =
          (json && json.error && json.error.message) ||
          statusToMessage(res.status);
        // Mark capability so pipeline can degrade without retry storms
        if (res.status === 404 || res.status === 403) {
          this._responsesAvailable = false;
        }
        return {
          ok: false,
          error: msg,
          raw: json,
          status: res.status,
        };
      }

      this._responsesAvailable = true;
      const text = extractResponsesText(json);
      return { ok: true, text, raw: json };
    } catch (err) {
      this._responsesAvailable = false;
      return {
        ok: false,
        error: (err && err.message) || "Network error calling Responses API",
        corsLikely: err && err.name === "TypeError",
      };
    }
  }

  /**
   * Chat Completions — used for structured degraded narration / extraction
   * when Responses is unavailable. Callers must not treat parametric memory
   * as verified history.
   */
  async createChatCompletion({
    messages,
    temperature = 0.4,
    maxTokens = 2000,
    responseFormat = null,
  }) {
    if (!this.apiKey) {
      return { ok: false, error: "Missing API key" };
    }

    const body = {
      model: this.model,
      temperature,
      max_tokens: maxTokens,
      messages,
    };
    if (responseFormat) {
      body.response_format = responseFormat;
    }

    try {
      const res = await fetch(this.baseUrl + "/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + this.apiKey,
        },
        body: JSON.stringify(body),
      });

      let json = null;
      try {
        json = await res.json();
      } catch (_) {
        json = null;
      }

      if (!res.ok) {
        return {
          ok: false,
          error:
            (json && json.error && json.error.message) ||
            statusToMessage(res.status),
          status: res.status,
          raw: json,
        };
      }

      const text =
        json &&
        json.choices &&
        json.choices[0] &&
        json.choices[0].message &&
        json.choices[0].message.content;

      if (!text) {
        return { ok: false, error: "Empty completion", raw: json };
      }
      return { ok: true, text: String(text), raw: json };
    } catch (err) {
      return {
        ok: false,
        error: (err && err.message) || "Network error calling Chat Completions",
        corsLikely: err && err.name === "TypeError",
      };
    }
  }

  /** POST to production Worker when configured. */
  async postTourEndpoint(endpoint, payload, authToken) {
    try {
      const headers = { "Content-Type": "application/json" };
      if (authToken) headers.Authorization = "Bearer " + authToken;
      const res = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        return {
          ok: false,
          error: (json && json.message) || "Tour endpoint error " + res.status,
          raw: json,
        };
      }
      return { ok: true, raw: json };
    } catch (err) {
      return {
        ok: false,
        error: (err && err.message) || "Tour endpoint network error",
        corsLikely: err && err.name === "TypeError",
      };
    }
  }
}

function statusToMessage(status) {
  if (status === 401) return "Invalid API key. Update it in settings and try again.";
  if (status === 429) return "Rate limit reached. Wait a moment and try again.";
  if (status === 403) return "Request blocked (403). Check OpenAI account access.";
  return "OpenAI request failed (" + status + ").";
}

function extractResponsesText(json) {
  if (!json) return "";
  if (typeof json.output_text === "string" && json.output_text.trim()) {
    return json.output_text.trim();
  }
  const parts = [];
  const output = json.output || json.data || [];
  if (Array.isArray(output)) {
    for (const item of output) {
      if (!item) continue;
      if (item.type === "message" && Array.isArray(item.content)) {
        for (const c of item.content) {
          if (c && (c.type === "output_text" || c.type === "text") && c.text) {
            parts.push(c.text);
          }
        }
      }
      if (typeof item.text === "string") parts.push(item.text);
    }
  }
  if (!parts.length && json.choices && json.choices[0]) {
    const m = json.choices[0].message;
    if (m && m.content) return String(m.content).trim();
  }
  return parts.join("\n").trim();
}
