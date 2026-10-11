import { bridge } from "./bridge";
import { abortable } from "./abort";
import type { AISettings } from "../shared";
export const CHAT_PRESETS = [
  {
    id: "openai",
    name: "OpenAI · capacité élevée",
    description:
      "Raisonnement approfondi et compréhension visuelle. Clé personnelle et crédits requis.",
    endpoint: "https://api.openai.com/v1",
    model: "gpt-6-sol",
    vision: true,
    jsonMode: true,
  },
  {
    id: "openai-fast",
    name: "OpenAI · rapide",
    description:
      "Réponses plus légères pour les modifications quotidiennes. Clé personnelle requise.",
    endpoint: "https://api.openai.com/v1",
    model: "gpt-5.4-mini",
    vision: true,
    jsonMode: true,
  },
  {
    id: "ollama",
    name: "Ollama · sur votre ordinateur",
    description:
      "Sans clé ni crédits. Ollama et un modèle doivent être installés ; la vitesse dépend de votre matériel.",
    endpoint: "http://127.0.0.1:11434/v1",
    model: "qwen3:8b",
    vision: false,
    jsonMode: true,
  },
  {
    id: "lmstudio",
    name: "LM Studio · sur votre ordinateur",
    description:
      "Activez le serveur local dans LM Studio, puis choisissez un modèle disponible.",
    endpoint: "http://127.0.0.1:1234/v1",
    model: "local-model",
    vision: false,
    jsonMode: false,
  },
] as const;
export function chatBase(endpoint: string): string {
  const url = new URL(endpoint);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error(
      "L’URL du chat doit être HTTP ou HTTPS, sans identifiants intégrés.",
    );
  return endpoint.replace(/\/+$/, "").replace(/\/chat\/completions$/, "");
}
/** Évite de réutiliser une clé de fournisseur lors d’un changement de serveur. */
export function updateChatEndpoint(
  chat: AISettings["chat"],
  endpoint: string,
): Partial<AISettings["chat"]> {
  let sameOrigin = false;
  try {
    sameOrigin = new URL(chat.endpoint).origin === new URL(endpoint).origin;
  } catch {
    /* Une URL en cours de saisie n’est pas une origine de confiance. */
  }
  return { endpoint, apiKey: sameOrigin ? chat.apiKey : "" };
}
export const isOfficialOpenAI = (endpoint: string) =>
  new URL(endpoint).hostname === "api.openai.com";
export function isChatConfigured(chat: AISettings["chat"]): boolean {
  try {
    chatBase(chat.endpoint);
    return (
      !!chat.model.trim() &&
      (!!chat.apiKey.trim() || !isOfficialOpenAI(chat.endpoint))
    );
  } catch {
    return false;
  }
}
export function chooseRecommendedModel(
  models: string[],
  endpoint: string,
): string | undefined {
  const official = isOfficialOpenAI(endpoint);
  const candidates = models.filter(
    (id) =>
      !/embedding|embed-|whisper|tts|audio|realtime|moderation|dall-e|image-|codex|search|transcrib/i.test(
        id,
      ),
  );
  const score = (id: string) => {
    if (official) {
      const version = id.match(/^gpt-(\d+)(?:\.(\d+))?/);
      if (!version && !/^o[134](?:[.-]|$)/.test(id)) return -1;
      const base = version
        ? Number(version[1]) * 1000 + Number(version[2] || 0) * 100
        : 4200;
      return (
        base +
        (/pro|astra|sol/.test(id) ? 25 : 0) -
        (/mini/.test(id) ? 150 : 0) -
        (/nano/.test(id) ? 300 : 0) -
        (/\d{4}-\d{2}-\d{2}/.test(id) ? 1 : 0)
      );
    }
    return (
      (/qwen3|deepseek-r1|llama3|gemma3/i.test(id) ? 100 : 0) +
      Number(id.match(/[: -](\d+(?:\.\d+)?)b/i)?.[1] || 0)
    );
  };
  return candidates
    .filter((id) => score(id) >= 0)
    .sort((a, b) => score(b) - score(a) || a.localeCompare(b))[0];
}
export async function listChatModels(
  settings: AISettings,
  signal?: AbortSignal,
): Promise<string[]> {
  const request = bridge.request({
    service: "chat",
    method: "GET",
    url: `${chatBase(settings.chat.endpoint)}/models`,
    timeoutMs: 15000,
  });
  const response = signal ? await abortable(request, signal) : await request;
  const data = response.data as { data?: { id?: unknown }[] };
  if (!Array.isArray(data?.data))
    throw new Error(
      "Le serveur n’a pas retourné une liste de modèles OpenAI-compatible.",
    );
  const models = [
    ...new Set(
      data.data.flatMap((m) =>
        typeof m.id === "string" && m.id.length <= 150 ? [m.id] : [],
      ),
    ),
  ].sort();
  if (!models.length)
    throw new Error(
      "Le serveur est disponible mais aucun modèle n’est installé ou accessible.",
    );
  return models;
}
export async function testChatInference(settings: AISettings): Promise<void> {
  const reasoning =
    isOfficialOpenAI(settings.chat.endpoint) &&
    /^(gpt-[5-9]|o[134])(?:[.-]|$)/.test(settings.chat.model);
  const response = await bridge.request({
    service: "chat",
    method: "POST",
    url: `${chatBase(settings.chat.endpoint)}/chat/completions`,
    timeoutMs: 90000,
    body: {
      model: settings.chat.model,
      ...(reasoning
        ? { max_completion_tokens: 1500, reasoning_effort: "low" }
        : { max_tokens: 150, temperature: 0 }),
      ...(settings.chat.jsonMode
        ? { response_format: { type: "json_object" } }
        : {}),
      messages: [
        {
          role: "user",
          content:
            'Test de connexion : réponds uniquement avec le JSON {"message":"Connexion établie","actions":[]}. N’ajoute aucune action.',
        },
      ],
    },
  });
  const data = response.data as {
    choices?: { message?: { content?: unknown; refusal?: string } }[];
  };
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim())
    throw new Error(
      "Le modèle a répondu sans texte utilisable. Vérifiez ses capacités de chat.",
    );
  try {
    const parsed = JSON.parse(
      content
        .trim()
        .replace(/^```(?:json)?\s*/, "")
        .replace(/\s*```$/, ""),
    );
    if (
      typeof parsed.message !== "string" ||
      !Array.isArray(parsed.actions) ||
      parsed.actions.length
    )
      throw new Error();
  } catch {
    throw new Error(
      "Le modèle répond, mais ne respecte pas le format de commandes de 3DMAKER. Activez le mode JSON ou choisissez un autre modèle.",
    );
  }
}
