# Credix PDV (desktop)

Caixa do Credix para Windows e macOS, focado em **venda** e **recebimento** no balcão.
Feito em [Tauri 2](https://tauri.app) + Svelte 5: instalador pequeno, abre rápido e usa o
navegador do próprio sistema. Consome a API do [Credix](https://github.com/lucyanpeixoto/credix).

## O que faz

**Venda** (`F1`)
- Leitor de código de barras (código exato) e busca por nome/SKU; `3*código` lança 3 unidades
- Grade de produtos por categoria, carrinho com quantidade, item avulso (`F6`), desconto em R$ ou % (`F7`)
- Com o cliente escolhido, mostra quanto ele deve e o vencido, com **Receber agora** (o carrinho fica guardado); no crediário, avisa se a venda passa do **limite de crédito** definido no web
- Cliente (`F4`), com **cadastro completo** se ainda não existir: nome, CPF, telefone, e-mail, observações e endereço (o CEP preenche rua, bairro, cidade e UF pelo ViaCEP)
- Pagamento (`F9`): dinheiro com troco, Pix, débito, crédito, **Pix com QR** (Mercado Pago, se a loja usa) e **crediário** (parcelas, intervalo, 1º vencimento, entrada)

**Receber** (`F2`)
- Busca o cliente e mostra as parcelas em aberto com juros/multa do dia
- Recebe um valor: abate das parcelas marcadas primeiro (a sobra vai para as mais antigas) ou, sem nada marcado, direto das mais antigas, com prévia parcela a parcela
- Atalhos de valor: só as vencidas, próxima parcela e quitar tudo
- Aceita o carnê lido ou digitado na busca (`1165/002-005`), sem trocar de aba
- Dispensar juros e desconto (conforme a permissão do usuário no Credix)
- Divide em várias formas, calcula troco, Pix com QR; copia a mensagem do WhatsApp

**Caixa** (opcional, ligado em Terminais PDV no web)
- Abertura com troco inicial, sangria e suprimento (com comprovante) e fechamento contando a gaveta: mostra o esperado por forma de pagamento e a diferença, e imprime o resumo
- É o mesmo caixa do Credix web: o dono pode abrir pelo web e o vendedor continua no desktop
- Caixa esquecido aberto de outro dia trava a venda até ser fechado. Com o horário da loja (Dados da loja, no web), o dia vira no fechamento: venda depois do horário pergunta se entra no caixa aberto ou se fecha e abre o do dia seguinte

**Conexão**
- Selo no topo (e na tela de PIN): **Online** ou **Sem conexão**, conferindo o servidor a cada 20 s. Sem conexão, vendas e recebimentos ficam pausados (ainda não há modo offline)

**Impressão** (`F12` → Configurações)
- Comprovante ESC/POS em impressora térmica **de rede** (IP:9100) ou **instalada no computador** (USB, modo RAW no Windows / CUPS no macOS)
- Bobina de 80 mm ou 58 mm e abertura de gaveta quando entra dinheiro. O comprovante sai pelo botão Imprimir (`P`) na tela de concluído; a impressão automática fica desligada e pode ser ligada no `F12`

**Tipo do comprovante e do carnê** (`F12` → Configurações)
- Comprovante: padrão da loja (definido no web), térmica ou meia folha A4 (abre no navegador)
- Carnê: folha A4 comum (2 vias, 4 parcelas por folha, abre no navegador já na janela de impressão), matricial LX-300 ou sem carnê

**Carnê na matricial (LX-300)** (`F12` → Configurações, tipo do carnê LX-300)
- Formulário contínuo pré-impresso de 215 × 76,5 mm, duas vias por folha, com o mesmo layout do "Carnê LX-300 calibrado" do web
- Vai direto para a impressora em ESC/P (modo RAW): sem janela de impressão e sem criar formulário no Windows
- Botão "Imprimir carnê" na venda concluída no crediário e na aba Vendas; sai uma folha por parcela em aberto
- Ajuste fino de posição em passos de 0,5 mm e página de teste, salvos neste computador

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
| `F8` | Caixa: conferência, sangria, suprimento e fechamento |
| `F11` | Trocar vendedor (bloqueia o caixa) |
| `Ctrl+Del` | Cancelar a venda em andamento |
| `F12` | Configurações |
| `1`–`6` | Forma de pagamento (na finalização); com o cursor num campo de valor, `Alt`+número |
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

Cada versão é publicada no repositório **público** `lucyanpeixoto/credix-desktop-releases`
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
| `RELEASES_TOKEN` | token do GitHub com permissão de escrita em `credix-desktop-releases` |

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
