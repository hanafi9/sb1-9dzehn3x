# Détection d'anomalie d'impression — workflow n8n

Surveille l'impression en cours via la webcam, fait analyser l'image par
GPT-4o-mini, et met l'imprimante en pause + notifie sur Telegram si un défaut
net est détecté.

Fichier : `n8n-detection-anomalie.json` — à importer dans n8n
(*Workflows → ⋯ → Import from File*).

---

## Chaîne des nœuds

```
Toutes les 5 min
  └─ Etat impression          GET  /printer/objects/query?print_stats
      └─ Impression en cours ?    garde : state == "printing"
          └─ Snapshot camera      GET  /webcam/?action=snapshot   (binaire "data")
              └─ Analyse GPT-4o Vision   POST api.openai.com/v1/chat/completions
                  └─ Lire le verdict     parse le JSON du modèle
                      └─ Anomalie confirmee ?   anomalie == true ET confiance >= 0.8
                          └─ Pause Klipper      POST /printer/print/pause
                              └─ Notification Telegram   sendPhoto
```

---

## Credentials à créer dans n8n

Les credentials sont stockés **séparément** des workflows : après l'import, les
deux nœuds concernés afficheront « credential non défini ». C'est normal — c'est
précisément pour ça qu'aucune clé n'est écrite dans le JSON.

Menu de gauche → **Credentials** → *Add credential*.

| Nœud | Type de credential | Où obtenir la valeur |
|---|---|---|
| Analyse GPT-4o Vision | **OpenAI** | platform.openai.com → *API keys* → *Create new secret key* |
| Notification Telegram | **Telegram** | Telegram → **@BotFather** → `/mybots` → ton bot → *API Token* |

⚠️ **La clé OpenAI ne s'affiche qu'une seule fois à sa création.** Si elle est
perdue, elle est irrécupérable : il faut en créer une nouvelle et supprimer
l'ancienne. Vérifier aussi que la facturation est active sur le compte OpenAI.

Le token Telegram, lui, se réaffiche via BotFather (`/revoke` pour le renouveler).

Les appels à Moonraker (état, snapshot, pause) ne demandent **aucun credential** :
c'est du HTTP local.

### Chat ID Telegram

Celui configuré est `894962403`. Pour le retrouver : envoyer un message au bot
puis ouvrir `https://api.telegram.org/bot<TOKEN>/getUpdates` et lire
`"chat":{"id":...}`.

---

## Tester sans lancer d'impression

Le workflow s'arrête volontairement à « Impression en cours ? » quand rien
n'imprime — c'est la garde qui évite de gaspiller des appels GPT. Pour valider
toute la chaîne malgré tout :

1. Sélectionner **« Impression en cours ? »** sur le canvas → touche **D**
   (nœud désactivé = il laisse passer les données)
2. Faire pareil sur **« Anomalie confirmee ? »**
3. Cliquer **Execute Workflow** (bouton du bas — *pas* « Execute step », qui
   n'exécute qu'un nœud isolé et échoue faute de données amont)
4. Réappuyer sur **D** sur les deux nœuds pour les réactiver

Pendant ce test, « Pause Klipper » s'exécute : sans impression en cours,
Moonraker renvoie simplement une erreur, sans conséquence.

---

## Réglages

| Paramètre | Où | Défaut | Effet |
|---|---|---|---|
| Intervalle | nœud *Toutes les 5 min* | 5 min | 288 appels GPT/jour |
| Seuil de confiance | nœud *Anomalie confirmee ?* | `0.8` | Plus haut = moins de fausses pauses |
| Modèle | nœud *Analyse GPT-4o Vision* | `gpt-4o-mini` | `gpt-4o` = plus fin, plus cher |
| Détail image | idem, champ `detail` | `low` | `high` = plus précis, plus de tokens |
| IP imprimante | 3 nœuds HTTP | `192.168.1.41` | À changer si l'IP bouge |

---

## Choix de conception

- **Garde « impression en cours »** — n'analyse que pendant une impression
  réelle, sinon chaque cycle coûterait un appel API pour rien.
- **Sortie JSON stricte du modèle** — la première version testait
  `contains "anomalie"` sur du texte libre : la réponse « **aucune** anomalie »
  contient le mot et déclenchait une pause à **chaque** image saine.
- **Image en base64** — l'image ne peut pas être passée par URL : `192.168.1.41`
  est une adresse du réseau local, inatteignable depuis les serveurs d'OpenAI.
- **Fail-safe** — si la réponse du modèle est illisible, le workflow conclut
  « pas d'anomalie ». Mieux vaut rater une détection que stopper une impression
  correcte.
- **Seuil de confiance** — le modèle doit être sûr à 80 % avant toute pause.
