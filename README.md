
# FASAEC v4.2 - Système de Gestion Officiel

Ce projet est prêt pour un déploiement sur **GitHub Pages**.

## Comment héberger sur GitHub :

1. Créez un nouveau dépôt sur GitHub nommé `fasaec`.
2. Initialisez votre dossier local et liez-le au dépôt :
   ```bash
   git init
   git add .
   git commit -m "Initial commit FASAEC v4.2"
   git remote add origin https://github.com/VOTRE_NOM/fasaec.git
   git push -u origin main
   ```
3. Sur GitHub, allez dans **Settings** > **Pages**.
4. Sous **Build and deployment**, choisissez la branche `main` et le dossier `/ (root)`.
5. Cliquez sur **Save**.

Votre application sera accessible à l'adresse : `https://VOTRE_NOM.github.io/fasaec/`

## Fonctionnalités incluses :
- **Mode Logiciel (EXE)** : Installable via le navigateur comme une application de bureau.
- **Audit IA** : Intégration Gemini 1.5 pour l'analyse des prestations.
- **Sécurité** : Filtrage des matricules non reconnus.
- **Impression** : Génération de fiches de paie conformes au format ministériel.
