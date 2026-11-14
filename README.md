# Credix PDV (desktop)

Caixa do Credix para Windows e macOS, focado em **venda** e **recebimento** no balcão.
Feito em [Tauri 2](https://tauri.app) + Svelte 5: instalador pequeno, abre rápido e usa o
navegador do próprio sistema. Consome a API do [Credix](https://github.com/lucyanpeixoto/credix).

## O que faz

**Venda** (`F1`)
- Leitor de código de barras (código exato) e busca por nome/SKU; `3*código` lança 3 unidades
- Grade de produtos por categoria, carrinho com quantidade, item avulso (`F6`), desconto em R$ ou % (`F7`)
- Cliente (`F4`), com **cadastro rápido** (nome, CPF, telefone) se ainda não existir
- Pagamento (`F9`): dinheiro com troco, Pix, débito, crédito, **Pix com QR** (Mercado Pago, se a loja usa) e **crediário** (parcelas, intervalo, 1º vencimento, entrada)

**Receber** (`F2`)
- Busca o cliente e mostra as parcelas em aberto com juros/multa do dia
- Recebe um valor (abate das mais antigas) ou as parcelas marcadas, com prévia do abatimento
- Dispensar juros e desconto (conforme a permissão do usuário no Credix)
- Divide em várias formas, calcula troco, Pix com QR; copia a mensagem do WhatsApp

**Caixa** (opcional, ligado em Terminais PDV no web)
- Abertura com troco inicial, sangria e suprimento (com comprovante) e fechamento contando a gaveta: mostra o esperado por forma de pagamento e a diferença, e imprime o resumo
- É o mesmo caixa do Credix web: o dono pode abrir pelo web e o vendedor continua no desktop

**Conexão**
- Selo no topo (e na tela de PIN): **Online** ou **Sem conexão**, conferindo o servidor a cada 20 s. Sem conexão, vendas e recebimentos ficam pausados (ainda não há modo offline)

**Impressão** (`F12` → Configurações)
- Cupom ESC/POS em impressora térmica **de rede** (IP:9100) ou **instalada no computador** (USB, modo RAW no Windows / CUPS no macOS)
- Bobina de 80 mm ou 58 mm, impressão automática e abertura de gaveta quando entra dinheiro

Todas as regras (preço, estoque, parcelas, juros, permissões) continuam no servidor: o PDV só envia o pedido e mostra o resultado.

## Conexão com a loja e PIN

1. No Credix web, o dono ou gerente vai em **Configurações › Terminais PDV**, cria o terminal (ex.: "Caixa 01") e recebe um código de 8 letras (vale 15 minutos, uma vez).
2. No computador do caixa, o Credix PDV pede esse código uma única vez. O computador fica conectado até alguém desconectar (no web, ou no desktop com PIN de dono/gerente).
3. Ao abrir o app, e depois de X minutos sem uso (definido por terminal no web), aparece a tela **Quem vai vender?**: escolhe o nome e digita o **PIN de 4 dígitos** (cadastrado em Usuários no web). Tudo o que fizer sai no nome dessa pessoa. `F11` troca de vendedor na hora.

Dono, gerente e vendedor aparecem todos na lista: no caixa, todo mundo vende. Desconto e dispensa de juros/multa ficam liberados no caixa.

O PDV usa a API `/api/pdv` do Credix (token do terminal + vendedor e PIN em cada chamada).

## Atalhos

| Tecla | Ação |
|---|---|
| `F1` / `F2` | Venda / Receber |
| `F3` | Foco na busca |
| `F5` | Vendas (consulta) |
| `F4` | Cliente |
| `F6` | Item avulso |
| `F7` | Desconto |
| `F9` | Finalizar / confirmar |
| `F11` | Trocar vendedor (bloqueia o caixa) |
| `Ctrl+Del` | Cancelar a venda em andamento |
| `F12` | Configurações |
| `1`–`6` | Forma de pagamento (na finalização) |
| `Enter` / `P` | Nova venda / reimprimir (na tela de concluído) |

## Desenvolvimento

Pré-requisitos: Node 22+, Rust (rustup) e
- **Windows:** Microsoft C++ Build Tools ("Desenvolvimento para desktop com C++")
- **macOS:** `xcode-select --install`

```bash
npm install
npm run app          # abre o app em modo desenvolvimento
npm run app:build    # gera o instalador em src-tauri/target/release/bundle
npm run check        # checagem de tipos
```

Só a interface no navegador (sem impressão): `npm run dev`.

O servidor padrão é `https://pdv.lucyan.dev`; dá para trocar na tela de conexão do caixa.

## Instaladores e atualização automática

Cada versão é publicada no repositório **público** `lucyanpeixoto/credix-pdv-releases`
(o código deste repo continua privado). O app instalado confere lá ao abrir e a cada 2 h,
baixa a versão nova em segundo plano e mostra o botão **"Atualizar para x.y.z"** no topo
e na tela de PIN; ao clicar, instala e reinicia. Com um Pix aguardando, não reinicia.

Para publicar uma versão:

```bash
# mesma versão em package.json, src-tauri/tauri.conf.json e src-tauri/Cargo.toml
git tag v0.2.0 && git push origin v0.2.0
```

O GitHub Actions compila Windows e macOS, assina as atualizações e publica a release
(já publicada, não rascunho). Pushes sem tag só guardam os instaladores nos artefatos do build.

**Segredos do repositório** (Settings › Secrets and variables › Actions):

| Segredo | O que é |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | conteúdo de `~/.tauri/credix-desktop.key` (gerada com `tauri signer generate`) |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | senha da chave (`~/.tauri/credix-desktop.password`) |
| `RELEASES_TOKEN` | token do GitHub com permissão de escrita em `credix-pdv-releases` |

A chave pública está em `src-tauri/tauri.conf.json` (`plugins.updater.pubkey`). **Perdendo a
chave privada, os caixas instalados não aceitam mais atualizações** e precisam reinstalar à mão:
guarde uma cópia dela num cofre de senhas.

> **macOS:** sem assinatura da Apple, o Gatekeeper bloqueia na primeira abertura
> (botão direito → Abrir). A atualização automática funciona assim mesmo.

## Estrutura

```
src/
  App.svelte               abas, atalhos globais
  lib/api.ts               cliente da API /api/pdv do Credix
  lib/session.svelte.ts    terminal pareado, vendedor do PIN, bloqueio e configurações
  lib/screens/             Conexão (pareamento), PIN, Venda, Receber
  lib/components/          Checkout, Pix, cliente, configurações, modal
  lib/escpos.ts            monta o cupom (ESC/POS)
  lib/printer.ts           cupons de venda/recebimento e envio
src-tauri/src/printer.rs   envio cru para impressora (TCP, spooler do Windows, CUPS)
```

## Próximos passos

- Modo offline (fila de vendas em dinheiro/cartão) — precisa de chave de idempotência no `POST /api/sales` do Credix para não duplicar venda ao reenviar
- Ícone próprio (`npx tauri icon caminho/logo.png`)
- Abertura e fechamento de caixa
- Guardar o token do terminal no cofre do sistema (Credential Manager / Keychain) em vez do armazenamento do app
