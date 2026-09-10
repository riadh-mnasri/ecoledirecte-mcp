# EcoleDirecte MCP

Serveur MCP privé qui permet à Claude de lire les données de mon compte EcoleDirecte (notes, devoirs, absences, messages) directement en conversation, sans passer par le site.

## Important : API non officielle

EcoleDirecte n'expose aucune API publique documentée. Ce serveur s'appuie sur l'API interne du site (`api.ecoledirecte.com`). Conséquences concrètes :

- Le format des réponses peut changer sans préavis. Chaque endpoint est validé par un schéma (`zod`) : en cas de changement, l'outil renvoie une erreur explicite plutôt que des données silencieusement fausses.
- En cas d'échec du live, chaque outil retombe automatiquement sur le dernier résultat mis en cache (dossier `.cache/`, jamais commité) en signalant qu'il s'agit de données potentiellement périmées.
- Ce serveur est une couche de confort, pas le seul accès aux données : en cas de panne, se reconnecter manuellement sur ecoledirecte.com reste toujours possible.

### Ce qui a été vérifié par capture réseau réelle (2026-09-10)

- `login.awp` : structure des comptes/élèves (`data.accounts[].profile.eleves[]`)
- `notes.awp` : moyennes par matière et par période (`data.periodes[].ensembleMatieres.disciplines[]`), sans note individuelle par évaluation observée cette année (aucune note encore saisie au moment du test)
- `cahierdetexte.awp` (liste) + `cahierdetexte/{date}.awp` (détail, contenu encodé en base64/HTML) pour les devoirs
- URL et paramètres de `viescolaire.awp` (absences/retards) et `familles/{id}/messages.awp` (messages)
- Version d'API réelle : `4.101.4`

### Ce qui reste à vérifier

- La forme exacte du corps de réponse de `viescolaire.awp` et de `messages.awp` (URLs confirmées, schémas encore best-effort) : ces deux outils peuvent échouer au premier usage réel, il faudra alors ajuster `src/infrastructure/ecoledirecte-client.ts`.
- La forme des notes individuelles (par évaluation) une fois que des notes seront saisies dans le trimestre en cours.

## Stack

- Node.js + TypeScript, exécuté en local uniquement (pas de serveur HTTP, pas de déploiement)
- `@modelcontextprotocol/sdk`, transport stdio
- `zod` pour la validation des réponses API
- `vitest` pour les tests

## Installation

```bash
npm install
cp .env.example .env
```

Remplir `.env` avec les identifiants EcoleDirecte (les mêmes que sur le site) :

```
ECOLEDIRECTE_USERNAME=...
ECOLEDIRECTE_PASSWORD=...
```

Ce fichier ne doit jamais être commité (il est dans `.gitignore`).

### Premier login et double authentification

Au premier login depuis un appareil non reconnu, EcoleDirecte peut demander une question de sécurité. Ce cas est détecté (`SecurityChallengeError`) et remonté clairement par les outils : dans ce cas, se connecter une fois manuellement sur le site depuis cette machine pour lever le blocage, puis relancer.

## Développement

```bash
npm run dev    # lance le serveur MCP en stdio (tsx)
npm test       # tests vitest
npm run build  # compilation TypeScript vers dist/
```

Aucun port réseau : ce n'est pas une application web, le serveur communique uniquement via stdin/stdout.

## Connexion à Claude Desktop

Dans la config Claude Desktop (`~/Library/Application Support/Claude/claude_desktop_config.json`) :

```json
{
  "mcpServers": {
    "ecoledirecte": {
      "command": "node",
      "args": ["/Users/riadh/IdeaProjects/ecoledirecte-mcp/dist/index.js"],
      "env": {
        "ECOLEDIRECTE_USERNAME": "...",
        "ECOLEDIRECTE_PASSWORD": "..."
      }
    }
  }
}
```

Penser à lancer `npm run build` avant, ou remplacer `command`/`args` par `npx tsx src/index.ts` en développement.

## Outils MCP exposés

| Outil | Description |
|---|---|
| `lister_eleves` | Liste les élèves rattachés au compte |
| `consulter_notes` | Notes d'un élève (`studentId`) |
| `consulter_devoirs` | Cahier de texte d'un élève (`studentId`) |
| `consulter_absences` | Absences, retards, sanctions d'un élève (`studentId`) |
| `consulter_messages` | Messages reçus dans la messagerie du compte |

## Architecture

- `src/domain/` : types métier et ports (interfaces), aucune dépendance à l'API EcoleDirecte
- `src/infrastructure/` : adapter HTTP EcoleDirecte + cache fichier, seul endroit qui parle le format brut de l'API
- `src/mcp/` : exposition des outils MCP, orchestre fetch live + fallback cache

Cette isolation permet de ne corriger que l'adapter le jour où EcoleDirecte change son API, sans toucher aux outils exposés à Claude.

---

© 2026 Riadh MNASRI
