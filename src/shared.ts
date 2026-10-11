export type AIProvider = "meshy" | "luma" | "stability" | "generic";
export interface AISettings {
  image: {
    provider: AIProvider;
    endpoint: string;
    apiKey: string;
    model: string;
    quality: "low" | "medium" | "high";
    targetPolygons: number;
    texture: boolean;
  };
  chat: {
    endpoint: string;
    apiKey: string;
    model: string;
    jsonMode: boolean;
    temperature: number;
  };
}
export const DEFAULT_AI_SETTINGS: AISettings = {
  image: {
    provider: "meshy",
    endpoint: "https://api.meshy.ai/openapi/v1/image-to-3d",
    apiKey: "",
    model: "meshy-6",
    quality: "high",
    targetPolygons: 30000,
    texture: true,
  },
  chat: {
    endpoint: "https://api.openai.com/v1",
    apiKey: "",
    model: "gpt-4.1-mini",
    jsonMode: true,
    temperature: 0.3,
  },
};
export interface ProxyRequest {
  service: "image" | "chat";
  url?: string;
  method: "GET" | "POST" | "DELETE";
  body?: unknown;
  form?: { name: string; value: string; filename?: string; mime?: string }[];
  responseType?: "json" | "binary";
  timeoutMs?: number;
}
export interface ProxyResponse {
  status: number;
  data?: unknown;
  base64?: string;
  mime?: string;
}
export interface GenerationRecord {
  id: string;
  name: string;
  date: string;
  image: string;
  modelBase64: string;
  mime: string;
  provider: string;
}
export type GenerationSummary = Omit<GenerationRecord, "modelBase64">;
export interface DesktopBridge {
  platform: string;
  getSettings(): Promise<AISettings>;
  saveSettings(settings: AISettings): Promise<void>;
  request(request: ProxyRequest): Promise<ProxyResponse>;
  fetchAsset(url: string): Promise<{ base64: string; mime: string }>;
  openFile(
    filters: { name: string; extensions: string[] }[],
  ): Promise<{ name: string; base64: string } | null>;
  saveFile(
    name: string,
    base64: string,
    filters?: { name: string; extensions: string[] }[],
  ): Promise<boolean>;
  saveBundle(
    name: string,
    files: { path: string; base64: string }[],
  ): Promise<boolean>;
  setDirty(dirty: boolean): void;
  getGenerations(): Promise<GenerationSummary[]>;
  getGeneration(id: string): Promise<GenerationRecord>;
  putGeneration(record: GenerationRecord): Promise<void>;
  deleteGeneration(id: string): Promise<void>;
  setFullscreen(): Promise<void>;
  windowAction(action: "minimize" | "maximize" | "close"): void;
}
