# WhatsApp AI Bot — Assistente Virtual

Bot de atendimento automatizado para WhatsApp usando IA (OpenAI GPT-4) com integração via Z-API.

## Funcionalidades

- **Atendimento automático** — Responde mensagens de clientes 24/7 com IA
- **Handoff para humano** — Transfere automaticamente quando detecta gatilhos configuráveis
- **Painel de monitoramento** — Interface web para visualizar conversas e gerenciar o bot
- **Múltiplos gatilhos** — Suporta vários gatilhos de transferência separados por `|`
- **Persistência** — Histórico de conversas salvo em arquivo com limpeza automática
- **Docker** — Pronto para deploy com Docker Compose

## Requisitos

- Node.js 20+
- Conta na [Z-API](https://z-api.io) (instância conectada ao WhatsApp)
- Chave da API [OpenAI](https://platform.openai.com)

## Instalação

```bash
# Clonar o repositório
git clone https://github.com/Tritecnologias/assistente-virtual.git
cd assistente-virtual

# Instalar dependências
npm install

# Configurar variáveis de ambiente
cp .env.example .env
# Edite o .env com suas credenciais
```

## Configuração

Copie `.env.example` para `.env` e preencha:

| Variável | Obrigatória | Descrição |
|---|---|---|
| `OPENAI_API_KEY` | Sim | Chave da API OpenAI |
| `ZAPI_INSTANCE_ID` | Sim | ID da instância Z-API |
| `ZAPI_TOKEN` | Sim | Token da instância Z-API |
| `ZAPI_CLIENT_TOKEN` | Sim | Token de segurança da conta Z-API |
| `HANDOFF_TRIGGER` | Sim | Gatilhos de transferência (separados por `\|`) |
| `PORT` | Não | Porta HTTP (default: 3000) |
| `SYSTEM_PROMPT` | Não | Prompt de comportamento da IA |
| `RETENTION_HOURS` | Não | Horas de retenção do histórico (default: 24) |

## Executar

**Desenvolvimento:**
```bash
node src/server.js
```

**Produção (Docker):**
```bash
docker-compose up -d
```

## Configurar Webhook na Z-API

No painel da Z-API, configure o webhook "Ao receber":
```
http://SEU-SERVIDOR:3000/webhook
```

## Endpoints

| Método | Rota | Descrição |
|---|---|---|
| POST | `/webhook` | Recebe mensagens da Z-API |
| GET | `/health` | Status do servidor |
| GET | `/api/conversations` | Lista conversas ativas |
| POST | `/api/conversations/:phone/pause` | Pausa IA para uma conversa |
| POST | `/api/conversations/:phone/resume` | Retoma IA para uma conversa |
| GET | `/` | Painel de monitoramento |

## Testes

```bash
npm test
```

## Estrutura do Projeto

```
src/
├── config/             # Carregamento e validação de configuração
├── controllers/        # Webhook, Handoff e Dashboard
├── services/           # AI Engine e Message Dispatcher
├── repository/         # State Repository (persistência)
├── public/             # Dashboard (HTML/CSS/JS)
└── server.js           # Entry point
tests/
├── unit/               # Testes unitários
├── properties/         # Testes de propriedade (fast-check)
└── integration/        # Testes de integração
```

## Licença

Privado — Todos os direitos reservados.
