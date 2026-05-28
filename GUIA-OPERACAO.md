# Guia de Operação — Lara (WhatsApp AI Bot)

## O que é

A Lara é uma assistente virtual que responde automaticamente as mensagens do WhatsApp da Tenda Sex. Ela atende clientes 24/7, tira dúvidas sobre produtos, entrega e pagamento, e transfere para um humano quando necessário.

---

## Como funciona

1. Cliente manda mensagem no WhatsApp
2. A Lara responde automaticamente (modo IA)
3. Se o cliente pedir atendimento humano, o bot pausa e a equipe assume
4. Quando a equipe terminar, retoma o bot pelo painel

---

## Painel de Monitoramento

Acesse: `http://SEU-SERVIDOR:3000`

No painel você vê:
- Todas as conversas ativas
- Quais estão com a IA (verde) e quais com humano (amarelo)
- Botão **"Pausar IA"** — para o bot parar de responder naquela conversa
- Botão **"Retomar IA"** — para o bot voltar a responder

---

## Gatilhos de Transferência para Humano

Quando o cliente enviar uma mensagem contendo qualquer uma dessas frases, o bot pausa automaticamente:

- "falar com atendente"
- "quero falar com alguém"
- "tem humano"
- "meu pedido não chegou"
- "quero cancelar"
- "problema com pagamento"
- "quero trocar"
- "reclamação"

Quando o bot pausa, ele envia ao cliente: *"Um atendente humano vai continuar essa conversa. Aguarde um momento! 😊"*

A equipe então responde normalmente pelo WhatsApp (celular ou WhatsApp Web).

---

## Como retomar o bot após atendimento humano

1. Acesse o painel (`http://SEU-SERVIDOR:3000`)
2. Encontre a conversa (estará em amarelo, modo "Humano")
3. Clique em **"Retomar IA"**
4. O bot volta a responder e envia ao cliente: *"A Lara voltou! Como posso te ajudar? 💜"*

---

## Como pausar o bot manualmente

Se quiser pausar o bot para uma conversa específica (sem o cliente pedir):

1. Acesse o painel
2. Encontre a conversa (estará em verde, modo "IA")
3. Clique em **"Pausar IA"**

---

## Como reiniciar o bot

Se o bot parar de funcionar ou precisar reiniciar:

**Com Docker (produção):**
```bash
# Parar
docker-compose down

# Iniciar novamente
docker-compose up -d
```

**Sem Docker (desenvolvimento):**
```bash
# Parar: Ctrl+C no terminal

# Iniciar novamente
node src/server.js
```

---

## Como alterar as chaves da API

As configurações ficam no arquivo `.env` na raiz do projeto.

### Trocar chave da OpenAI
```
OPENAI_API_KEY=sua-nova-chave-aqui
```

### Trocar credenciais da Z-API
```
ZAPI_INSTANCE_ID=novo-id-da-instancia
ZAPI_TOKEN=novo-token
ZAPI_CLIENT_TOKEN=novo-client-token
```

### Trocar os gatilhos de transferência
```
HANDOFF_TRIGGER=palavra1|palavra2|palavra3
```
Separe por `|` (pipe). Cada palavra deve ter entre 2 e 50 caracteres.

### Trocar o comportamento da Lara (System Prompt)
```
SYSTEM_PROMPT=Novo texto descrevendo como a Lara deve se comportar...
```

**Após qualquer alteração no `.env`, reinicie o bot.**

---

## Como verificar se o bot está online

Acesse no navegador: `http://SEU-SERVIDOR:3000/health`

Se retornar `{"status":"ok","envLoaded":true}`, está funcionando.

---

## Estrutura de arquivos importantes

```
.env                    → Configurações e credenciais (NUNCA compartilhe)
src/server.js           → Arquivo principal do bot
src/public/index.html   → Painel de monitoramento
data/state.json         → Histórico de conversas (gerado automaticamente)
docker-compose.yml      → Configuração para rodar com Docker
```

---

## Perguntas frequentes

**O bot responde mensagens de grupo?**
Não. Ele ignora mensagens de grupos automaticamente.

**O bot responde áudios, imagens ou figurinhas?**
Não. Ele só processa mensagens de texto. Outros tipos são ignorados silenciosamente.

**O que acontece se a OpenAI estiver fora do ar?**
O bot envia uma mensagem de fallback: "Estou temporariamente indisponível. Um atendente humano vai te ajudar em breve."

**As conversas são salvas?**
Sim, por 24 horas (configurável). Após esse período, são apagadas automaticamente.

**Posso ter mais de um número conectado?**
Cada instância da Z-API conecta um número. Para múltiplos números, precisa de múltiplas instâncias.

---

## Suporte técnico

Em caso de problemas, verifique:
1. O bot está rodando? (`/health` retorna ok?)
2. O WhatsApp está conectado na Z-API? (painel da Z-API mostra "Conectado"?)
3. O webhook está configurado? (aba "Webhooks" na Z-API)
4. As credenciais estão corretas no `.env`?

Se nada resolver, reinicie o bot e verifique os logs no terminal.
