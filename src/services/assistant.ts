import { abortable } from "./abort";
import { bridge } from "./bridge";
import { useEditor } from "../store/editor";
import { runGeometryJob } from "../engine/jobs";
import type { AssistantJobResult } from "../engine/calculations";
import { parseAssistantPlan } from "./assistantPlan";
export { parseAssistantPlan, executePlan } from "./assistantPlan";
import type { ChatMessage } from "../types";
import type { AISettings } from "../shared";

const systemPrompt = `Tu es l’assistant du logiciel de modélisation 3DMAKER. Réponds exclusivement par un objet JSON {"message":"confirmation en français","actions":[...]}. Les actions sont exécutées dans une scène réelle. Ne retourne jamais de code JavaScript, de balises ou de commandes système. N’invente pas des capacités hors de la liste. Les distances sont en mètres, les rotations d’actions en degrés, Y est vertical. Un cube natif mesure 2 m par côté. Les noms doivent être uniques pour référencer les objets que tu crées. Tu peux exécuter jusqu’à 200 actions, utiliser array pour créer des répétitions et des primitives pour construire une composition détaillée (château, meuble, véhicule). Les nouveaux objets doivent toucher le sol à Y=0. Utilise les objets sélectionnés quand la demande porte sur « cet objet ».
Cibles : target est un id ou nom exact, "selection" (par défaut), "all", ou un tableau de ces valeurs. Les objets verrouillés ne sont pas modifiables. Une action sur un nom créé précédemment est valide.
Actions autorisées :
- {type:"create_primitive",primitive:"cube|sphere|cylinder|cone|torus|plane|tube|box",name,position:[x,y,z],rotation:[x,y,z],scale:[x,y,z],material:{color:"#rrggbb",roughness:0..1,metalness:0..1,emissive:"#rrggbb",emissiveIntensity:0..20,opacity:0..1,transmission:0..1,ior:1..2.333,thickness:0..10000,clearcoat:0..1,clearcoatRoughness:0..1,anisotropy:0..1,finish:"brushed|smooth",flatShading:boolean,doubleSided:boolean}}
- {type:"create_light",lightType:"ambient|directional|point|spot",name,position:[x,y,z],color:"#rrggbb",intensity:0..10000,distance:0..10000,angle:1..89,targetPoint:[x,y,z],castShadow:boolean}
- {type:"create_camera",name,position:[x,y,z],targetPoint:[x,y,z],fov:5..150}
- {type:"set_material",target,material:{champs de matériau ci-dessus}}
- {type:"transform",target,position?,rotation?,scale?,relative:boolean} : sans relative, remplace les champs fournis ; avec relative, additionne position/rotation et multiplie scale.
- {type:"rename",target,name} ; {type:"visibility",target,visible:boolean} ; {type:"delete",target} ; {type:"duplicate",target,offset:[x,y,z]}
- {type:"array",target,count:2..100,offset:[x,y,z],radial:boolean,angle:1..360} : count inclut l’objet original ; répétition circulaire autour de l’origine et de l’axe Y.
- {type:"boolean",targets:["id-ou-nom-A","id-ou-nom-B"],operation:"union|difference|intersection"} : remplace A et B, la différence retire B de A.
- {type:"merge",target} : fusionne au moins deux maillages.
- {type:"mesh_operation",target,operation:"extrude|bevel|subdivide|mirror|lathe|sweep|spin",amount:number,axis:"x|y|z",iterations:1..3,segments:8..128,angle:1..360,path:[[x,y,z],...],center:[x,y,z],faces?:[indices]}
- {type:"render",background:"#rrggbb",exposure:0.1..5,environment:"studio|sunset|night",shadows:boolean,wireframe:boolean}
La finition brushed crée une vraie normal map directionnelle et active l’anisotropie ; ajoute metalness:1, roughness:0.3 et la couleur souhaitée pour un acier brossé. Spin réalise une extrusion angulaire raccordée d’un profil plan ; une primitive plane utilise axis:"z" et center:[4,0,0]. Toutes les actions sont validées puis appliquées en une transaction annulable. Si tu ne peux pas réaliser la demande avec ces actions, explique pourquoi dans message et retourne actions:[] plutôt que promettre un résultat inexistant.`;
export async function askAssistant(
  input: string,
  messages: ChatMessage[],
  settings: AISettings,
  signal: AbortSignal,
): Promise<{ message: string; actionCount: number }> {
  if (!input.trim() || input.length > 8000)
    throw new Error("La demande doit contenir entre 1 et 8 000 caractères.");
  const before = useEditor.getState().document;
  const selection = [...useEditor.getState().selection];
  const editing = {
    mode: useEditor.getState().mode,
    components: [...useEditor.getState().components],
  };
  const context = JSON.stringify({
    editMode: useEditor.getState().mode,
    selectedComponents: useEditor.getState().components,
    selected: selection,
    objects: before.nodes
      .slice(0, 200)
      .map((n) => ({
        id: n.id,
        name: n.name,
        type: n.kind,
        locked: n.locked,
        transform: {
          ...n.transform,
          rotation: n.transform.rotation.map((v) => (v * 180) / Math.PI),
        },
        material: {
          color: n.material.color,
          roughness: n.material.roughness,
          metalness: n.material.metalness,
          transmission: n.material.transmission,
          anisotropy: n.material.anisotropy,
        },
        light: n.light,
      })),
  });
  const endpoint = `${settings.chat.endpoint.replace(/\/$/, "").replace(/\/chat\/completions$/, "")}/chat/completions`;
  const reasoning =
    new URL(settings.chat.endpoint).hostname === "api.openai.com" &&
    /^(gpt-[5-9]|o[134])(?:[.-]|$)/.test(settings.chat.model);
  const generationOptions = reasoning
    ? { max_completion_tokens: 12000 }
    : { temperature: settings.chat.temperature, max_tokens: 12000 };
  const response = await abortable(
    bridge.request({
      service: "chat",
      url: endpoint,
      method: "POST",
      timeoutMs: 180000,
      body: {
        model: settings.chat.model,
        ...generationOptions,
        ...(settings.chat.jsonMode
          ? { response_format: { type: "json_object" } }
          : {}),
        messages: [
          {
            role: "system",
            content: `${systemPrompt}\nScène actuelle : ${context}`,
          },
          ...messages
            .slice(-10)
            .map((m) => ({ role: m.role, content: m.content })),
          { role: "user", content: input },
        ],
      },
    }),
    signal,
  );
  if (signal.aborted) throw new DOMException("Demande annulée.", "AbortError");
  const data = response.data as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data?.choices?.[0]?.message?.content;
  if (!content || typeof content !== "string")
    throw new Error(
      "Le serveur de chat n’a retourné aucun message. Vérifiez le modèle et le format OpenAI-compatible.",
    );
  const plan = parseAssistantPlan(content);
  if (useEditor.getState().document !== before)
    throw new Error(
      "La scène a changé pendant la réponse. Relancez votre demande pour éviter d’appliquer des actions à un contexte obsolète.",
    );
  if (!plan.actions.length) return { message: plan.message, actionCount: 0 };
  const result = await runGeometryJob<AssistantJobResult>(
    { type: "assistant", document: before, selection, plan, context: editing },
    signal,
  );
  if (signal.aborted) throw new DOMException("Demande annulée.", "AbortError");
  if (useEditor.getState().document !== before)
    throw new Error(
      "La scène a changé pendant le calcul. Relancez votre demande.",
    );
  const original = new Map(before.nodes.map((n) => [n.id, n])),
    unchanged = new Set(result.unchangedIds),
    sameGeometry = new Set(result.sameGeometryIds);
  result.document.nodes = result.document.nodes.map((n) =>
    unchanged.has(n.id)
      ? original.get(n.id)!
      : sameGeometry.has(n.id)
        ? { ...n, geometry: original.get(n.id)?.geometry }
        : n,
  );
  if (JSON.stringify(result.document.render) === JSON.stringify(before.render))
    result.document.render = before.render;
  useEditor.getState().apply("Assistant IA", () => result.document);
  useEditor.setState({
    selection: result.selection,
    components: [],
    mode: "object",
  });
  if (
    plan.actions.some((a) => a.type.startsWith("create") || a.type === "array")
  )
    useEditor.getState().focus("all");
  return { message: plan.message, actionCount: plan.actions.length };
}
