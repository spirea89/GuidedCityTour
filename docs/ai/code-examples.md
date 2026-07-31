# Code examples (every component)

Runnable sources: `js/`. Snippets below mirror public APIs.

## Place model

```js
import { createPlace, inferEntityType, ENTITY_TYPES } from "../models/place.js";

const entityType = inferEntityType(address, "house"); // → building|church|…
const place = createPlace({
  name: "Stephansdom",
  entityType: ENTITY_TYPES.CHURCH,
  lat: 48.2084,
  lng: 16.3731,
  identificationConfidence: 0.9,
  nearbyAllowList: [{ name: "Graben", dist_m: 120, type: "highway/pedestrian" }],
});
```

## CacheService

```js
import { CacheService } from "../services/CacheService.js";

const cache = new CacheService();
const key = cache.makeKey({
  lat: 48.2084,
  lng: 16.3731,
  focus: "house",
  categories: "history,architecture",
  kids: false,
  v: "2.0.0",
});
await cache.set(key, tourResult, 7 * 24 * 60 * 60 * 1000);
const hit = await cache.get(key);
await cache.invalidate("gct:v2:");
```

## OpenAIService

```js
import { OpenAIService } from "../services/OpenAIService.js";

const openai = new OpenAIService({ apiKey, model: "gpt-4o" });

// Preferred: Responses + web_search
const r = await openai.createResponse({
  instructions: systemAndDeveloper,
  input: userPayload,
  tools: [{ type: "web_search" }],
});

// Degraded: Chat Completions JSON
const c = await openai.createChatCompletion({
  messages: […],
  responseFormat: { type: "json_object" },
});
```

## PromptBuilder

```js
import { PromptBuilder } from "../services/PromptBuilder.js";

const pb = new PromptBuilder();
const system = pb.systemPrompt();
const developer = pb.developerPrompt("research"); // or degraded_no_search | narrate
const user = pb.userTourPrompt(place, {
  categories: ["history", "architecture"],
  kidsMode: false,
  researchMode: "web_search",
});
```

## PlaceIdentifier

```js
import { PlaceIdentifier } from "../services/PlaceIdentifier.js";

const id = new PlaceIdentifier();
const result = id.identify({
  lat, lng, address, displayName, focus, nearbyPlaces,
});
// result.status → ok | needs_confirmation | ambiguous_name | unidentified
```

## ResearchService

```js
import { ResearchService } from "../services/ResearchService.js";

const rs = new ResearchService({ openAi: openai });
const { ok, mode, packet } = await rs.research(place, {
  categories: ["history"],
  kidsMode: false,
});
// mode: web_search | degraded
```

## FactVerifier

```js
import { FactVerifier } from "../services/FactVerifier.js";

const fv = new FactVerifier();
const bundle = fv.extract(packet, place);
// bundle.claims.verified|uncertain|legends|unknown
// strips verified claims when research.mode === "degraded"
```

## NarrationGenerator

```js
import { NarrationGenerator } from "../services/NarrationGenerator.js";

const ng = new NarrationGenerator({ openAi: openai });
const narration = await ng.narrate(bundle, place, {
  categories: ["history", "today"],
  kidsMode: true,
});
```

## ResponseValidator

```js
import { ResponseValidator } from "../services/ResponseValidator.js";

const v = new ResponseValidator();
const parsed = v.parseJsonText(modelText);
const { ok, errors, normalized } = v.validate(parsed.value);
```

## TourPipeline

```js
import { TourPipeline } from "../services/TourPipeline.js";

const pipeline = new TourPipeline({ apiKey, model: "gpt-4o" });
const result = await pipeline.run(selection, {
  categories: ["history", "architecture", "interesting_facts"],
  kidsMode: false,
  confirmedCandidate: null,
});
```

## StoryRenderer

```js
import { StoryRenderer } from "../ui/storyRenderer.js";

const renderer = new StoryRenderer(els);
renderer.showLoading();
renderer.render(result, {
  kidsMode: false,
  onConfirmCandidate: (c) => pipeline.run(selection, { confirmedCandidate: c }),
});
```
