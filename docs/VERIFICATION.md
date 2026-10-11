# Vérification de la version simplifiée

Date : **11 octobre 2026**. Environnement : Node.js 26.11.1, Linux, Chromium 153 avec rendu WebGL logiciel. Ces résultats ne constituent pas un test natif sous Windows ni un benchmark de performances GPU.

## Résultats constatés

- `npm run build` : **réussi**. Trois configurations TypeScript strictes, renderer Vite, workers géométriques, processus principal Electron et preload compilés.
- `npm test` : **107 tests réussis, 9 suites**. Géométrie (27), plans assistant (15), backend (12), fournisseurs chat (14), bibliothèque (16), import/export/projets (5), fonds (9), historique (5), services photo (4).
- `npm run test:browser` : **réussi**, aucune erreur JavaScript non interceptée.
- `npm run test:browser:simple` : **réussi**, aucune erreur JavaScript non interceptée.

### Parcours Expert

Huit primitives, transformations numériques et gizmos translation/rotation/échelle par vrais glissements souris, annulation/rétablissement et Escape, chanfrein, Spin raccordé, suppression d’un sommet, union CSG dans un worker, exports/réimports GLB/GLTF/STL/OBJ/FBX. Les modèles relus contiennent un maillage : 465 positions GLB/GLTF et 477 positions STL/OBJ/FBX.

Photo → création de tâche HTTP → suivi → téléchargement → modèle éditable normalisé → galerie persistante, chat OpenAI-compatible avec action réelle sur la scène, rechargement de galerie et capture PNG **1920 × 1080, 69 748 octets**.

### Parcours Simple

Ajout de forme, coordonnées, poser au sol et annulation ; palette Ctrl K, concentration F10 et Simple/Expert ; fonds unis, dégradés, photo PNG réellement importée et HDR ; bibliothèque de maillages ajoutée en une transaction, undo/redo.

Capture PNG transparente **640 × 480** inspectée pixel par pixel : **224 669 pixels entièrement transparents** et **77 381 pixels opaques**. L’un des coins appartient à un objet dans ce cadrage ; les trois autres sont transparents. Fond et grille sont rétablis après capture.

Découverte HTTP des modèles et sélection d’un nom retourné par le serveur ; vraie requête POST de test avec réponse JSON sans action ; envoi d’une capture JPEG au format multimodal ; préparation d’un plan sans mutation ; confirmation, changement réel du matériau et annulation ; refus d’application après modification de la scène.

### Contrôles unitaires additionnels

Les huit créations sont de vrais maillages validés. Placement à côté des objets existants sans modifier leurs données, mise au sol et centrage, paramètres bornés et refus atomique des commandes dangereuses. Préservation des anciens fonds unis, validation des données de fond, restauration du fond courant. Migration des paramètres IA, découverte de modèles, respect du contrat JSON et absence de transfert de clé au changement d’origine. Le probe Ollama a une URL fixe et n’envoie aucune clé cloud.

## Ce qui n’a pas été établi

- **Aucune inférence cloud facturée ni aucun LLM local installé n’a été testé.** Les scénarios réseau utilisent des fixtures HTTP uniquement dans les fichiers de test ; aucune réponse de remplacement n’existe dans l’application. Les tests unitaires réseau utilisent un transport mocké. La liste des noms de modèles n’établit ni accès, ni compatibilité d’inférence, ni qualité mesurée.
- **Aucun installateur Windows n’est livré.** Le téléchargement des binaires Electron a échoué dans l’environnement de réalisation ; l’installation, les dialogues natifs, le chiffrement système et l’exécution Windows restent à vérifier. La cible est `out/forge3d-setup.exe`, construite par `npm run dist` sur une machine connectée.
- Le rendu logiciel de test est lent. Il ne permet pas d’affirmer une performance sur le matériel de l’utilisateur.
- Les limites des formats de modèle, des opérations topologiques et des services IA sont décrites dans le README et le contrat API ; elles ne sont pas masquées par un succès artificiel.

## Reproduire

Avec Node.js 26.11.1 et les téléchargements autorisés :

```bash
npm install
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:browser
npm run test:browser:simple
```

Les scénarios créent des serveurs et des stockages temporaires isolés puis les ferment. Ils n’exigent aucune clé personnelle. `CHROMIUM_EXECUTABLE_PATH` et `CHROMIUM_ARGS_JSON` permettent de sélectionner un Chromium existant dans un environnement contraint.

Les captures `studio.png`, `library.png` et `background.png` sont prises dans l’interface réelle, avec des maillages locaux réellement rendus. Elles ne sont pas des illustrations ni des images générées par IA.
