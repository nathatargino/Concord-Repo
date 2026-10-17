# AGENTS.md — Concord Engineering & Verification Harness

> **Authoritative Specification & Operational Manual for AI Coding Agents**  
> Repositório: `nathatargino/Concord-Repo`  
> Plataforma: Comunicação em Tempo Real Descentralizada (Web, Desktop Windows, WebRTC, Socket.io, Supabase, Castlabs Electron com Widevine DRM).

---

## 1. Visão Geral & Filosofia do Repositório

O **Concord** é um monorepo baseado em **pnpm workspaces** que entrega simultaneamente:
1. **Cliente Web:** Aplicação SPA moderna em React 19 + TypeScript + Vite + Tailwind CSS 4.
2. **Cliente Desktop (Windows):** Aplicação nativa com Electron (Castlabs v43), Widevine CDM para DRM (Netflix/Prime Video), notificações nativas, System Tray e atualizador automático via GitHub Releases e Microsoft Store (MSIX).
3. **Servidor Backend & Sinalização:** Node.js + Express + Socket.io + WebRTC (Mesh/Hub) + sincronização persistente com Supabase.
4. **Website:** Landing page estática com links de download e documentação.
5. **Supabase:** Banco de dados relacional (PostgreSQL), autenticação, storage e canais em tempo real (Realtime WebSockets).

Qualquer agente que opere neste repositório **DEVE** manter a paridade funcional e a integridade de ambas as plataformas (Web e Desktop), respeitando a separação de responsabilidades.

---

## 2. Topologia do Monorepo

```text
Concord/
├── client/                           # Frontend React 19 + Electron Desktop
│   ├── build/                        # Assets do instalador (NSIS, MSIX/AppX, ícones, Widevine)
│   ├── electron/                     # Processo principal e preload do Electron
│   │   ├── main.ts                   # Janela principal, IPC, bandeja, autoUpdater, streaming
│   │   └── preload.ts                # Context bridge seguro (window.electronAPI)
│   ├── src/
│   │   ├── components/               # Componentes de UI (ChatPanel, ServerRail, Sidebar, etc.)
│   │   ├── hooks/                    # Hooks (useWebRTC, useSocket, useScreenShare, useYouTube)
│   │   ├── lib/                      # Supabase client, dmHelpers, socialRealtime
│   │   ├── stores/                   # Zustand (useAppStore, useAudioStore)
│   │   ├── config.ts                 # Resolução centralizada de URLs (SERVER_URL, SOCKET_URL)
│   │   └── types.ts                  # Definições de tipos do frontend
│   ├── tsconfig.json                 # Configuração TS da Web
│   ├── tsconfig.electron.json        # Configuração TS do processo Electron
│   └── vite.config.ts                # Build do Vite com suporte condicional a Electron
│
├── server/                           # Backend de Sinalização e Hub WebRTC
│   └── src/
│       ├── hub.ts                    # Gerenciamento de salas, presença, canais e mídias
│       ├── index.ts                  # Servidor Express, Socket.io, CORS e endpoints de upload
│       └── types.ts                  # Tipos compartilhados de eventos do Socket
│
├── website/                          # Landing page oficial e assets estáticos
├── supabase/                         # Schema SQL, migrações, RLS policies e triggers
├── .github/workflows/
│   └── electron.yml                  # CI/CD: compilação, VMP signing e release de .exe/.msix
├── package.json                      # Raiz do monorepo e scripts globais do harness
└── pnpm-workspace.yaml               # Configuração dos workspaces (client, server)
```

---

## 3. Comandos de Execução do Harness

Utilize `pnpm` (ou `npx pnpm` caso o binário global não esteja no PATH do ambiente Windows).

### 🛠️ Desenvolvimento Local

| Comando | Descrição |
| :--- | :--- |
| `pnpm dev` | Inicia o servidor backend e o cliente **Web** concorrentemente |
| `pnpm electron:dev` | Inicia o backend e o cliente **Desktop (Electron)** concorrentemente |
| `pnpm --filter client dev` | Inicia somente o cliente Web (Vite HMR em `localhost:5173`) |
| `pnpm --filter client electron:dev` | Inicia o cliente Vite no modo Electron (`cross-env ELECTRON=true`) |
| `pnpm --filter server dev` | Inicia o servidor backend com recarregamento via `tsx watch` |
| `pnpm start` | Inicia o servidor backend em modo de produção |

### 📦 Builds de Produção

| Comando | Descrição |
| :--- | :--- |
| `pnpm build:client` | Compila o cliente Web (`tsc -b && vite build`) para `client/dist/` |
| `pnpm build:server` | Compila o backend (`tsc`) para `server/dist/` |
| `pnpm build:all` | Compila tanto o cliente Web quanto o backend |
| `pnpm --filter client run electron:build` | Compila o bundle Electron e empacota instaladores locais |

---

## 4. O Pipeline de Verificação Obrigatório (Agent Quality Gate)

Antes de considerar qualquer alteração como concluída, o agente **DEVE OBRIGATORIAMENTE** executar o pipeline de verificação. Nenhuma modificação deve ser entregue com erros de compilação ou de tipagem.

### Comando Único de Verificação (Harness Completo):
```bash
pnpm harness:verify
```
*Esse comando executa sequencialmente:*
1. **Web Build & Typecheck:** `pnpm --filter client build` (`tsc -b && vite build`)
2. **Desktop Electron Typecheck:** `pnpm --filter client exec tsc -p tsconfig.electron.json --noEmit`
3. **Server Build & Typecheck:** `pnpm --filter server build` (`tsc`)

### Verificações Complementares:
- **Linter de Alta Performance:**
  ```bash
  pnpm lint
  # ou: pnpm --filter client lint (oxlint)
  ```
- **Higiene do Repositório:**
  ```bash
  git status
  ```
  *Certifique-se de não deixar arquivos temporários, logs soltos ou artefatos de build não ignorados.*

---

## 5. Invariantes Arquiteturais e Regras Críticas de Código

### ⚠️ Invariante 1: Código Isomórfico (Web vs. Electron)
- O código em `client/src/` é compartilhado entre a versão Web (navegador comum) e a versão Desktop (Electron).
- **NUNCA** chame APIs do Electron (`window.electronAPI.*`, `ipcRenderer`) diretamente sem checagem de existência.
- **Padrão Obrigatório:**
  ```typescript
  if (typeof window !== 'undefined' && window.electronAPI) {
    window.electronAPI.minimizeWindow();
  }
  ```
- **NUNCA** faça `import` de módulos nativos do Node (`fs`, `path`, `crypto`, `child_process`) dentro de `client/src/`. Esses módulos pertencem exclusivamente a `client/electron/` ou `server/src/`.

### 🌐 Invariante 2: Resolução Centralizada de Endpoints
- **NUNCA** faça hardcode de URLs como `http://localhost:3001` nos componentes do frontend.
- Utilize sempre as constantes exportadas de [`client/src/config.ts`](file:///client/src/config.ts):
  ```typescript
  import { SERVER_URL, SOCKET_URL } from '../config';
  ```
- Em produção (`import.meta.env.PROD`), o cliente se conecta automaticamente ao backend hospedado na nuvem (Railway). Em desenvolvimento local, conecta-se a `localhost:3001`.

### ⚡ Invariante 3: Arquitetura de Comunicação Híbrida (Socket.io + Supabase Realtime)
- **Socket.io (Tempo Real Efêmero):** Usado para sinalização WebRTC de voz/vídeo, estados de sala em tempo real, Watch Party e sincronização rápida de players.
- **Supabase Realtime (Persistência & Relações):** Usado para persistência duradoura de mensagens, histórico de canais, perfil de usuário, pedidos de amizade e DMs.
- **Envio Otimista (Optimistic UI):** No chat e DMs, insira a mensagem imediatamente na interface do usuário com um ID provisório (`opt-...`) e envie para o backend/Supabase em segundo plano, garantindo percepção instantânea de envio.

### 🛡️ Invariante 4: DRM Widevine e Castlabs Electron
- O Desktop utiliza uma versão customizada do Electron (`https://github.com/castlabs/electron-releases#v43.5.0+wvcus`) com biblioteca Widevine CDM embarcada.
- O streaming protegido (Netflix, Prime Video) é instanciado via `WebContentsView` controlada pelo processo principal (`client/electron/main.ts`).
- Não altere as permissões de `webSecurity` ou headers de streaming sem compreender os impactos de CORS e VMP (Verified Media Path).

### 🎨 Invariante 5: Design System & Padrões Visuais
- **Identidade Visual:** Inspirada no visual moderno e escuro do Discord, com paleta própria:
  - Fundo principal: `#1e1f22`, `#2b2d31`, `#313338`
  - Destaques / Acentos: `#5865f2` (Blurple Concord), `#23a55a` (Online/Verde), `#f23f43` (Erro/Offline)
- **Estilos:** Combine utilitários do Tailwind CSS 4 com CSS Modules (`.module.css`) para componentes complexos com estados dinâmicos e micro-animações.

---

## 6. Fluxo de Branches (Git), Versionamento e Releases

1. **Branch Obrigatória de Testes (`develop`):**
   - **TODA E QUALQUER ALTERAÇÃO** deve ser realizada, commitada e enviada (`git push origin develop`) primeiramente na branch **`develop`** para testes e homologação.
   - **NUNCA** envie alterações diretamente para a branch `main` sem antes validar na `develop`. A `main` recebe código exclusivamente após aprovação dos testes na `develop`.
2. **Sincronização de Versões:**
   Ao lançar uma nova versão, a versão deve ser idêntica em ambos os arquivos:
   - [`package.json`](file:///package.json) (raiz)
   - [`client/package.json`](file:///client/package.json)
3. **Formato das Tags:**
   - As tags Git seguem o padrão SemVer com prefixo `v`: `v1.0.108`, `v1.0.109`, etc.
4. **CI/CD Automático:**
   - O disparo de uma tag `v*` no GitHub ativa o workflow [`.github/workflows/electron.yml`](file:///.github/workflows/electron.yml).
   - O workflow compila no ambiente Windows, assina o binário Widevine com Castlabs EVS e publica os instaladores `.exe` e `.msix` na GitHub Release correspondente.

---

## 7. Checklist de Validação do Agente

Antes de responder ao usuário ou finalizar qualquer tarefa, confirme:

- [ ] A branch ativa do repositório é a **`develop`** (`git branch --show-current`) e nunca a `main` diretamente.
- [ ] A alteração atende aos requisitos solicitados sem regredir funcionalidades existentes.
- [ ] A paridade Web vs. Desktop foi preservada (sem erros no navegador padrão).
- [ ] O comando `pnpm harness:verify` foi executado e retornou código **0** (sem erros de compilação ou de tipo).
- [ ] Os comentários e a documentação existente foram mantidos.
- [ ] O `git status` está limpo e contém apenas os arquivos intencionalmente modificados.

