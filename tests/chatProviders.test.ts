import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_AI_SETTINGS,
  upgradeAISettings,
  type AISettings,
} from "../src/shared";
import {
  chatBase,
  chooseRecommendedModel,
  isChatConfigured,
  listChatModels,
  testChatInference,
  updateChatEndpoint,
} from "../src/services/chatProviders";
import { bridge } from "../src/services/bridge";
vi.mock("../src/services/bridge", () => ({ bridge: { request: vi.fn() } }));
beforeEach(() => vi.clearAllMocks());
describe("IA préconfigurée, modèles réels et vérification", () => {
  it("n’invente aucune clé et configure la validation et le raisonnement", () => {
    expect(DEFAULT_AI_SETTINGS.chat.apiKey).toBe("");
    expect(DEFAULT_AI_SETTINGS.chat.review).toBe(true);
    expect(DEFAULT_AI_SETTINGS.chat.reasoning).toBe("high");
  });
  it("nécessite une clé pour OpenAI mais pas pour Ollama", () => {
    expect(isChatConfigured(DEFAULT_AI_SETTINGS.chat)).toBe(false);
    expect(
      isChatConfigured({
        ...DEFAULT_AI_SETTINGS.chat,
        endpoint: "http://127.0.0.1:11434/v1",
      }),
    ).toBe(true);
  });
  it("normalise les URL du chat", () => {
    expect(chatBase("https://example.com/v1/chat/completions/")).toBe(
      "https://example.com/v1",
    );
    expect(() => chatBase("file:///tmp/test")).toThrow("HTTP");
  });
  it("choisit une version récente et non un modèle audio, image ou mini", () => {
    expect(
      chooseRecommendedModel(
        [
          "gpt-image-1",
          "gpt-4.1",
          "gpt-6-sol",
          "gpt-6-astra",
          "gpt-6.1-sol",
          "gpt-6.1-mini",
          "tts-1",
        ],
        "https://api.openai.com/v1",
      ),
    ).toBe("gpt-6.1-sol");
  });
  it("ne choisit jamais un modèle inaccessible ou absent de la liste", () => {
    expect(
      chooseRecommendedModel(
        ["gpt-5.4-mini", "gpt-4.1"],
        "https://api.openai.com/v1",
      ),
    ).toBe("gpt-5.4-mini");
    expect(
      chooseRecommendedModel(
        ["whisper-1", "text-embedding-3-large"],
        "https://api.openai.com/v1",
      ),
    ).toBeUndefined();
  });
  it("reconnaît les modèles locaux sans forcer un nom inexistant", () => {
    expect(
      chooseRecommendedModel(
        ["nomic-embed-text", "qwen3:8b", "qwen3:30b"],
        "http://localhost:11434/v1",
      ),
    ).toBe("qwen3:30b");
  });
  it("ne transfère pas une clé au changement d’origine, même pendant la saisie", () => {
    const chat = { ...DEFAULT_AI_SETTINGS.chat, apiKey: "cle-personnelle" };
    expect(updateChatEndpoint(chat, "http://localhost:11434/v1").apiKey).toBe(
      "",
    );
    expect(updateChatEndpoint(chat, "https://api.openai.com/v2").apiKey).toBe(
      "cle-personnelle",
    );
    expect(updateChatEndpoint(chat, "htt").apiKey).toBe("");
  });
  it("n’affiche pas comme configuré un protocole non HTTP", () => {
    expect(
      isChatConfigured({
        ...DEFAULT_AI_SETTINGS.chat,
        endpoint: "file:///tmp/model",
      }),
    ).toBe(false);
  });
  it("complète les configurations de la première version sans perdre la clé", () => {
    const {
      review: _r,
      vision: _v,
      reasoning: _depth,
      ...legacy
    } = DEFAULT_AI_SETTINGS.chat;
    const migrated = upgradeAISettings({
      image: DEFAULT_AI_SETTINGS.image,
      chat: { ...legacy, apiKey: "cle-personnelle", model: "personnel" },
    } as AISettings);
    expect(migrated.chat.apiKey).toBe("cle-personnelle");
    expect(migrated.chat.model).toBe("personnel");
    expect(migrated.chat.review).toBe(true);
  });
  it("extrait une liste de modèles réellement reçue et dédupliquée", async () => {
    vi.mocked(bridge.request).mockResolvedValue({
      status: 200,
      data: { data: [{ id: "qwen3:8b" }, { id: "qwen3:8b" }, { id: 7 }] },
    });
    expect(await listChatModels(DEFAULT_AI_SETTINGS)).toEqual(["qwen3:8b"]);
    expect(bridge.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        url: "https://api.openai.com/v1/models",
      }),
    );
  });
  it("ne déclare pas disponible un serveur sans modèle", async () => {
    vi.mocked(bridge.request).mockResolvedValue({
      status: 200,
      data: { data: [] },
    });
    await expect(listChatModels(DEFAULT_AI_SETTINGS)).rejects.toThrow(
      "aucun modèle",
    );
  });
  it("teste réellement une inférence JSON sans action de scène", async () => {
    vi.mocked(bridge.request).mockResolvedValue({
      status: 200,
      data: {
        choices: [
          {
            message: {
              content: '{"message":"Connexion établie","actions":[]}',
            },
          },
        ],
      },
    });
    await testChatInference(DEFAULT_AI_SETTINGS);
    expect(bridge.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        body: expect.objectContaining({
          model: DEFAULT_AI_SETTINGS.chat.model,
          max_completion_tokens: 1500,
        }),
      }),
    );
  });
  it("rejette un modèle qui ne respecte pas le contrat JSON", async () => {
    vi.mocked(bridge.request).mockResolvedValue({
      status: 200,
      data: { choices: [{ message: { content: "Bonjour" } }] },
    });
    await expect(testChatInference(DEFAULT_AI_SETTINGS)).rejects.toThrow(
      "format de commandes",
    );
  });
  it("rejette un test qui invente une action à appliquer", async () => {
    vi.mocked(bridge.request).mockResolvedValue({
      status: 200,
      data: {
        choices: [
          {
            message: {
              content: '{"message":"ok","actions":[{"type":"delete"}]}',
            },
          },
        ],
      },
    });
    await expect(testChatInference(DEFAULT_AI_SETTINGS)).rejects.toThrow(
      "format de commandes",
    );
  });
});
