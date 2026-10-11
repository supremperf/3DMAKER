import { create } from "zustand";
import {
  DEFAULT_AI_SETTINGS,
  type AISettings,
  type GenerationSummary,
} from "../shared";
import { bridge } from "../services/bridge";
import {
  generateModel,
  modelNodes,
  generationRecord,
  prepareImage,
} from "../services/imageAI";
import { askAssistant } from "../services/assistant";
import { useEditor } from "./editor";
import { uid, type GenerationProgress, type ChatMessage } from "../types";
let imageController: AbortController | null = null;
let chatController: AbortController | null = null;
interface AIState {
  settings: AISettings;
  loaded: boolean;
  image: string | null;
  imageName: string;
  progress: GenerationProgress;
  generations: GenerationSummary[];
  messages: ChatMessage[];
  chatPending: boolean;
  chatError: string | null;
  lastPrompt: string;
  initialize(): Promise<void>;
  saveSettings(settings: AISettings): Promise<void>;
  setImage(file: File): Promise<void>;
  clearImage(): void;
  generate(): Promise<void>;
  cancelGeneration(): void;
  loadGeneration(record: GenerationSummary): Promise<void>;
  deleteGeneration(id: string): Promise<void>;
  sendMessage(input: string): Promise<void>;
  cancelChat(): void;
  clearChat(): void;
}
export const useAI = create<AIState>((set, get) => ({
  settings: structuredClone(DEFAULT_AI_SETTINGS),
  loaded: false,
  image: null,
  imageName: "",
  progress: { status: "idle", percent: 0, message: "" },
  generations: [],
  messages: [],
  chatPending: false,
  chatError: null,
  lastPrompt: "",
  async initialize() {
    try {
      const settings = await bridge.getSettings();
      set({ settings, loaded: true });
      const generations = await bridge.getGenerations();
      set({ generations });
    } catch (e) {
      set({ loaded: true });
      useEditor.getState().notify((e as Error).message, "error");
    }
  },
  async saveSettings(settings) {
    await bridge.saveSettings(settings);
    set({ settings: structuredClone(settings), loaded: true });
  },
  async setImage(file) {
    try {
      const image = await prepareImage(file);
      set({
        image,
        imageName: file.name.replace(/\.[^.]+$/, "").slice(0, 100),
        progress: { status: "idle", percent: 0, message: "" },
      });
    } catch (e) {
      useEditor.getState().notify((e as Error).message, "error");
    }
  },
  clearImage() {
    if (get().progress.status !== "running")
      set({
        image: null,
        imageName: "",
        progress: { status: "idle", percent: 0, message: "" },
      });
  },
  async generate() {
    const { image, imageName, settings, progress } = get();
    if (!image || progress.status === "running") return;
    imageController = new AbortController();
    const controller = imageController;
    try {
      set({
        progress: {
          status: "running",
          percent: 0,
          message: "Préparation de la photo…",
        },
      });
      const result = await generateModel(
        image,
        settings,
        controller.signal,
        (progress) => set({ progress }),
      );
      if (controller.signal.aborted) return;
      set({
        progress: {
          status: "running",
          percent: 97,
          message: "Chargement dans la scène…",
        },
      });
      const nodes = await modelNodes(result, imageName || "Modèle IA");
      if (controller.signal.aborted) return;
      useEditor.getState().addNodes(nodes, "Photo → 3D");
      useEditor.getState().focus("focus");
      const record = generationRecord(
        image,
        result,
        imageName || "Modèle IA",
        settings.image.provider,
      );
      try {
        await bridge.putGeneration(record);
        const { modelBase64: _model, ...summary } = record;
        set((s) => ({ generations: [summary, ...s.generations] }));
      } catch (e) {
        useEditor
          .getState()
          .notify(
            `Modèle chargé, mais l’historique n’a pas pu être enregistré : ${(e as Error).message}`,
            "error",
          );
      }
      set({
        progress: {
          status: "success",
          percent: 100,
          message: "Votre modèle est prêt et entièrement éditable.",
        },
      });
      useEditor.getState().notify("Modèle IA ajouté à la scène.", "success");
    } catch (e) {
      if ((e as Error).name === "AbortError")
        set({
          progress: {
            status: "idle",
            percent: 0,
            message:
              "Suivi annulé. La tâche peut continuer chez le fournisseur.",
          },
        });
      else
        set({
          progress: {
            status: "error",
            percent: 0,
            message: "Génération interrompue",
            error: (e as Error).message,
          },
        });
    } finally {
      if (imageController === controller) imageController = null;
    }
  },
  cancelGeneration() {
    imageController?.abort();
  },
  async loadGeneration(record) {
    try {
      useEditor.setState({
        busy: true,
        busyMessage: "Chargement de la génération…",
      });
      const stored = await bridge.getGeneration(record.id);
      const nodes = await modelNodes(
        {
          base64: stored.modelBase64,
          mime: record.mime,
          name: record.mime.includes("json") ? "modele.gltf" : "modele.glb",
        },
        record.name,
      );
      useEditor.getState().addNodes(nodes, "Recharger une génération");
      useEditor.getState().focus("focus");
      useEditor.getState().notify("Génération rechargée.", "success");
    } catch (e) {
      useEditor.getState().notify((e as Error).message, "error");
    } finally {
      useEditor.setState({ busy: false });
    }
  },
  async deleteGeneration(id) {
    try {
      await bridge.deleteGeneration(id);
      set((s) => ({ generations: s.generations.filter((r) => r.id !== id) }));
    } catch (e) {
      useEditor.getState().notify((e as Error).message, "error");
    }
  },
  async sendMessage(input) {
    if (get().chatPending || !input.trim()) return;
    const previous = get().messages;
    chatController = new AbortController();
    const controller = chatController;
    set({
      messages: [...previous, { id: uid(), role: "user", content: input }],
      chatPending: true,
      chatError: null,
      lastPrompt: input,
    });
    try {
      const response = await askAssistant(
        input,
        previous,
        get().settings,
        controller.signal,
      );
      set((s) => ({
        messages: [
          ...s.messages,
          {
            id: uid(),
            role: "assistant",
            content: response.message,
            actionCount: response.actionCount,
          },
        ],
      }));
    } catch (e) {
      set({
        chatError:
          (e as Error).name === "AbortError"
            ? "Demande annulée. Aucune action n’a été appliquée."
            : (e as Error).message,
      });
    } finally {
      set({ chatPending: false });
      if (chatController === controller) chatController = null;
    }
  },
  cancelChat() {
    chatController?.abort();
  },
  clearChat() {
    if (!get().chatPending)
      set({ messages: [], chatError: null, lastPrompt: "" });
  },
}));
