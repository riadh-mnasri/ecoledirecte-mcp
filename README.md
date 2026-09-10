# EcoleDirecte MCP

Serveur MCP qui permet à Claude de lire les données d'un compte EcoleDirecte (notes, devoirs, absences, messages) directement en conversation, sans passer par le site.

## Un modèle à copier, pas un service

Ce projet n'est pas un service auquel tu te connectes : c'est un programme que **chaque famille installe et fait tourner chez elle**, avec ses propres identifiants EcoleDirecte. Aucun serveur central, aucune base de données, personne d'autre que toi ne voit jamais ton identifiant ou ton mot de passe : ils restent dans un fichier `.env` sur ta machine.

Concrètement, ça veut dire :
- Pas de compte à créer, pas d'inscription
- Pas de responsabilité de stockage de données d'autrui, de RGPD ou de sécurité côté "fournisseur" : il n'y a pas de fournisseur, juste un outil que tu copies
- Si tu veux l'adapter, l'améliorer ou le comprendre, le code est fait pour ça (voir "Architecture" plus bas)

C'est un point de départ technique à réutiliser pour ta propre famille, pas un produit à laquelle t'abonner.

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

### Le login exige une poignée de main GTK

`login.awp` refuse silencieusement des identifiants pourtant valides (`Identifiant et/ou mot de passe invalide !`) si l'appel ne reproduit pas exactement le protocole attendu :

1. `GET /v3/login.awp?gtk=1&v=<version>` renvoie deux `Set-Cookie`, dont un nommé `GTK=...`.
2. Le `POST` de login doit inclure le header `X-Gtk` avec cette valeur **et** renvoyer les cookies reçus à l'étape 1 dans un header `Cookie` classique — sans ce header `Cookie`, l'API répond `code: 200` côté navigateur mais rejette l'appel côté serveur pour la même requête, avec le même message trompeur qu'un mauvais mot de passe.

`ensureLoggedIn()` dans `src/infrastructure/ecoledirecte-client.ts` fait les deux. Si ce comportement disparaît après une évolution de l'API, revérifier ce flow avant de soupçonner les identifiants.

### Ce qui reste à vérifier

- La forme exacte du corps de réponse de `viescolaire.awp` et de `messages.awp` (URLs confirmées, schémas encore best-effort) : ces deux outils peuvent échouer au premier usage réel, il faudra alors ajuster `src/infrastructure/ecoledirecte-client.ts`.
- La forme des notes individuelles (par évaluation) une fois que des notes seront saisies dans le trimestre en cours.

## Stack

- Node.js + TypeScript, exécuté en local uniquement (pas de serveur HTTP, pas de déploiement)
- `@modelcontextprotocol/sdk`, transport stdio
- `zod` pour la validation des réponses API
- `vitest` pour les tests

## Installation rapide

```bash
npx ecoledirecte-mcp-init
```

Un assistant en ligne de commande demande l'identifiant et le mot de passe EcoleDirecte et écrit `~/.ecoledirecte-mcp/.env` (en dehors du dossier du projet, pour que ça reste stable même installé via `npx`).

## Installation manuelle (développement)

```bash
npm install
npm run build
node dist/cli/init.js
```

`.env.example` documente les deux variables attendues (`ECOLEDIRECTE_USERNAME`, `ECOLEDIRECTE_PASSWORD`) si tu préfères écrire `~/.ecoledirecte-mcp/.env` à la main. Ce fichier ne doit jamais être commité dans le projet lui-même.

### Premier login et double authentification

Au premier login depuis un appareil non reconnu, EcoleDirecte peut demander une question de sécurité. Ce cas est détecté (`SecurityChallengeError`) et remonté clairement par les outils : dans ce cas, se connecter une fois manuellement sur le site depuis cette machine pour lever le blocage, puis relancer.

## Développement

```bash
npm run dev    # lance le serveur MCP en stdio (tsx)
npm test       # tests vitest
npm run build  # compilation TypeScript vers dist/
```

Aucun port réseau : ce n'est pas une application web, le serveur communique uniquement via stdin/stdout.

## Connexion à Claude Code

```bash
claude mcp add ecoledirecte -- npx -y ecoledirecte-mcp
```

(en développement local, avant publication npm : `claude mcp add ecoledirecte -- node /chemin/vers/ecoledirecte-mcp/dist/index.js`)

## Connexion à Claude Desktop

Dans la config Claude Desktop (`~/Library/Application Support/Claude/claude_desktop_config.json`) :

```json
{
  "mcpServers": {
    "ecoledirecte": {
      "command": "npx",
      "args": ["-y", "ecoledirecte-mcp"]
    }
  }
}
```

Dans les deux cas, les identifiants sont lus depuis `~/.ecoledirecte-mcp/.env` (voir "Installation rapide"), pas besoin de les répéter dans la config.

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

## Licence

MIT, voir [LICENSE](LICENSE). Copie, adapte, réutilise pour ta propre famille.

---

© 2026 Riadh MNASRI
