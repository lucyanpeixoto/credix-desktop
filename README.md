# Credix PDV (desktop)

Caixa do Credix para Windows e macOS, focado em **venda** e **recebimento** no balcão.
Feito em [Tauri 2](https://tauri.app) + Svelte 5: instalador pequeno, abre rápido e usa o
navegador do próprio sistema. Consome a API do [Credix](https://github.com/lucyanpeixoto/credix).

## O que faz

**Venda** (`F1`)
- Leitor de código de barras (código exato) e busca por nome/SKU; `3*código` lança 3 unidades
- Carrinho com quantidade, item avulso (`F4`), desconto em R$ ou % (`F7`)
- Cliente (`F6`) e vendedor
- Pagamento (`F10`): dinheiro com troco, Pix, débito, crédito, **Pix com QR** (Mercado Pago, se a loja usa) e **crediário** (parcelas, intervalo, 1º vencimento, entrada)

**Receber** (`F2`)
- Busca o cliente e mostra as parcelas em aberto com juros/multa do dia
- Recebe um valor (abate das mais antigas) ou as parcelas marcadas, com prévia do abatimento
- Dispensar juros e desconto (conforme a permissão do usuário no Credix)
- Divide em várias formas, calcula troco, Pix com QR; copia a mensagem do WhatsApp

**Impressão** (`F12` → Configurações)
- Cupom ESC/POS em impressora térmica **de rede** (IP:9100) ou **instalada no computador** (USB, modo RAW no Windows / CUPS no macOS)
- Bobina de 80 mm ou 58 mm, impressão automática e abertura de gaveta quando entra dinheiro

Todas as regras (preço, estoque, parcelas, juros, permissões) continuam no servidor: o PDV só envia o pedido e mostra o resultado.

## Atalhos

| Tecla | Ação |
|---|---|
| `F1` / `F2` | Venda / Receber |
| `F3` | Foco na busca |
| `F4` | Item avulso |
| `F6` | Cliente |
| `F7` | Desconto |
| `F10` | Finalizar / confirmar |
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

O servidor padrão é `https://pdv.lucyan.dev`; dá para trocar na tela de login ou em Configurações.

## Instaladores

O GitHub Actions compila Windows e macOS a cada push na `main` (instaladores ficam nos
artefatos do build). Para publicar uma versão:

```bash
npm version 0.2.0 --no-git-tag-version   # e a mesma versão em src-tauri/tauri.conf.json
git tag v0.2.0 && git push --tags
```

Isso cria um release em rascunho com o `.exe`/`.msi` (Windows) e o `.dmg` (macOS universal).

> **macOS:** sem assinatura, o Gatekeeper bloqueia na primeira abertura (botão direito → Abrir).
> Para distribuir de verdade é preciso conta Apple Developer e configurar os secrets de assinatura.

## Estrutura

```
src/
  App.svelte               abas, atalhos globais
  lib/api.ts               cliente da API do Credix (token Sanctum)
  lib/session.svelte.ts    login, usuário e configurações
  lib/screens/             Login, Venda, Receber
  lib/components/          Checkout, Pix, cliente, configurações, modal
  lib/escpos.ts            monta o cupom (ESC/POS)
  lib/printer.ts           cupons de venda/recebimento e envio
src-tauri/src/printer.rs   envio cru para impressora (TCP, spooler do Windows, CUPS)
```

## Próximos passos

- Modo offline (fila de vendas em dinheiro/cartão) — precisa de chave de idempotência no `POST /api/sales` do Credix para não duplicar venda ao reenviar
- Ícone próprio (`npx tauri icon caminho/logo.png`)
- Atualização automática (`tauri-plugin-updater`)
- Abertura e fechamento de caixa
