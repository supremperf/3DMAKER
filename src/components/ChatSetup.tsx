import { useState } from "react";
import {
  Check,
  Cpu,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import type { AISettings } from "../shared";
import {
  CHAT_PRESETS,
  chooseRecommendedModel,
  listChatModels,
  testChatInference,
  updateChatEndpoint,
} from "../services/chatProviders";
import { useAI } from "../store/ai";
import { Button, Section, Toggle } from "./common";
interface Props {
  draft: AISettings;
  onChange(value: AISettings): void;
  busy: boolean;
  setBusy(value: boolean): void;
  showKeys: boolean;
}
export function ChatSetup({ draft, onChange, busy, setBusy, showKeys }: Props) {
  const [models, setModels] = useState<string[]>([]),
    [error, setError] = useState(""),
    [result, setResult] = useState("");
  const [custom, setCustom] = useState(false);
  const exactPreset = CHAT_PRESETS.find(
    (p) => p.endpoint === draft.chat.endpoint && p.model === draft.chat.model,
  );
  const preset = custom
    ? undefined
    : exactPreset ||
      CHAT_PRESETS.find(
        (p) =>
          p.endpoint === draft.chat.endpoint &&
          (p.model === draft.chat.model ||
            (p.id !== "openai-fast" && p.id !== "lmstudio")),
      );
  const patch = (change: Partial<AISettings["chat"]>) => {
    setResult("");
    onChange({ ...draft, chat: { ...draft.chat, ...change } });
  };
  const selectPreset = (id: string) => {
    if (id === "custom") {
      setCustom(true);
      return;
    }
    setCustom(false);
    const selected = CHAT_PRESETS.find((p) => p.id === id);
    if (!selected) return;
    let sameOrigin = false;
    try {
      sameOrigin =
        new URL(selected.endpoint).origin ===
        new URL(draft.chat.endpoint).origin;
    } catch {
      /* Un brouillon d’URL incomplet ne bloque pas le choix d’un préréglage. */
    }
    patch({
      endpoint: selected.endpoint,
      model: selected.model,
      apiKey: sameOrigin ? draft.chat.apiKey : "",
      vision: selected.vision,
      jsonMode: selected.jsonMode,
    });
    setModels([]);
    setError("");
  };
  const discover = async () => {
    setBusy(true);
    setError("");
    setResult("");
    try {
      await useAI.getState().saveSettings(draft);
      const available = await listChatModels(draft);
      setModels(available);
      const recommended = chooseRecommendedModel(
        available,
        draft.chat.endpoint,
      );
      if (!available.includes(draft.chat.model) && recommended) {
        const next = { ...draft, chat: { ...draft.chat, model: recommended } };
        onChange(next);
        await useAI.getState().saveSettings(next);
      }
      setResult(
        `${available.length} modèle${available.length > 1 ? "s" : ""} disponible${available.length > 1 ? "s" : ""}. Testez l’IA pour vérifier une vraie réponse.`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const test = async () => {
    setBusy(true);
    setError("");
    setResult("");
    useAI.setState({ connection: "checking" });
    try {
      await useAI.getState().saveSettings(draft);
      useAI.setState({ connection: "checking" });
      await testChatInference(draft);
      useAI.setState({ connection: "ready" });
      setResult(
        "IA connectée : une vraie réponse au format de commandes a été reçue. Votre scène n’a pas été modifiée.",
      );
    } catch (e) {
      useAI.setState({ connection: "error" });
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="settings-fields chat-setup">
      <label className="stacked-field">
        <span>Choisir votre IA</span>
        <select
          aria-label="Service IA préconfiguré"
          value={preset?.id || "custom"}
          disabled={busy}
          onChange={(e) => selectPreset(e.target.value)}
        >
          {CHAT_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
          <option value="custom">Serveur personnalisé</option>
        </select>
        <small>
          {preset?.description ||
            "Tout endpoint compatible OpenAI peut être configuré ci-dessous."}
        </small>
      </label>
      {preset?.id === "ollama" && (
        <div className="local-ai-instructions">
          <Cpu size={17} />
          <div>
            <strong>Modèle local, sans abonnement</strong>
            <p>Installez Ollama sur la machine qui exécute 3DMAKER, puis :</p>
            <code>ollama pull qwen3:8b</code>
            <code>ollama serve</code>
            <p>
              Choisissez un modèle adapté à votre RAM/VRAM. Aucun modèle de
              langage n’est téléchargé ou embarqué silencieusement.
            </p>
          </div>
        </div>
      )}
      {(!preset || preset.id.startsWith("openai")) && (
        <label className="stacked-field">
          <span>Votre clé personnelle</span>
          <input
            type={showKeys ? "text" : "password"}
            aria-label="Clé API de chat"
            autoComplete="off"
            value={draft.chat.apiKey}
            disabled={busy}
            onChange={(e) => patch({ apiKey: e.target.value })}
            placeholder="Conservée uniquement sur cet appareil"
          />
          <small>
            Ne partagez pas votre clé dans une conversation ou sur GitHub.
          </small>
        </label>
      )}
      <div className="chat-model-select">
        <label className="stacked-field">
          <span>Modèle</span>
          <input
            aria-label="Nom du modèle de chat"
            list="chat-models"
            value={draft.chat.model}
            disabled={busy}
            onChange={(e) => patch({ model: e.target.value })}
          />
          <datalist id="chat-models">
            {models.map((m) => (
              <option value={m} key={m} />
            ))}
          </datalist>
        </label>
        <Button
          icon={busy ? LoaderCircle : RefreshCw}
          disabled={busy}
          onClick={() => void discover()}
        >
          Détecter
        </Button>
      </div>
      <Toggle
        label="Valider les plans avant application"
        value={draft.chat.review}
        onChange={(review) => patch({ review })}
        disabled={busy}
      />
      <Toggle
        label="Joindre une vue de la scène au modèle"
        value={draft.chat.vision}
        onChange={(vision) => patch({ vision })}
        disabled={busy}
      />
      {draft.chat.vision && (
        <p className="simple-hint">
          Une capture 896 × 672 est transmise au fournisseur à chaque demande.
          Activez cette option uniquement avec un modèle qui accepte les images.
        </p>
      )}
      <Section title="Réglages du serveur" defaultOpen={!preset}>
        <label className="stacked-field">
          <span>URL de base OpenAI-compatible</span>
          <input
            aria-label="URL du serveur de chat"
            value={draft.chat.endpoint}
            disabled={busy}
            spellCheck={false}
            onChange={(e) =>
              patch(updateChatEndpoint(draft.chat, e.target.value))
            }
          />
          <small>
            Changer l’origine du serveur efface la clé précédente. Le serveur
            doit autoriser ce modèle. Une URL locale désigne la machine
            exécutant 3DMAKER, pas le navigateur visiteur.
          </small>
        </label>
        {preset && !preset.id.startsWith("openai") && (
          <label className="stacked-field">
            <span>Clé de votre serveur, si nécessaire</span>
            <input
              aria-label="Clé API de chat"
              type={showKeys ? "text" : "password"}
              value={draft.chat.apiKey}
              autoComplete="off"
              disabled={busy}
              onChange={(e) => patch({ apiKey: e.target.value })}
            />
          </label>
        )}
        <Toggle
          label="Réponse JSON structurée"
          value={draft.chat.jsonMode}
          disabled={busy}
          onChange={(jsonMode) => patch({ jsonMode })}
        />
        <label className="stacked-field">
          <span>Raisonnement OpenAI</span>
          <select
            aria-label="Profondeur du raisonnement"
            value={draft.chat.reasoning}
            disabled={busy}
            onChange={(e) =>
              patch({
                reasoning: e.target.value as AISettings["chat"]["reasoning"],
              })
            }
          >
            <option value="high">Approfondi</option>
            <option value="medium">Équilibré</option>
            <option value="low">Rapide</option>
          </select>
          <small>
            Pour les modèles OpenAI de raisonnement. Les autres serveurs
            utilisent leur propre moteur.
          </small>
        </label>
      </Section>
      <Button
        variant="primary"
        icon={busy ? LoaderCircle : Check}
        disabled={
          busy ||
          (!draft.chat.apiKey && draft.chat.endpoint.includes("api.openai.com"))
        }
        onClick={() => void test()}
      >
        Tester l’IA
      </Button>
      <p className="simple-hint">
        Ce test envoie une petite requête réelle au modèle. Les crédits du
        fournisseur peuvent s’appliquer. Il ne modifie pas la scène.
      </p>
      {result && (
        <div className="success-card">
          <Check size={15} />
          <p>{result}</p>
        </div>
      )}
      {error && (
        <div className="error-card" role="alert">
          <TriangleAlert size={16} />
          <p>{error}</p>
        </div>
      )}
      <div className="information-card">
        <ShieldCheck size={18} />
        <p>
          Aucun code arbitraire n’est exécuté. Chaque plan est validé dans un
          worker et chaque changement est annulable.
        </p>
      </div>
    </div>
  );
}
