# YukiChain

A layer-1 blockchain written from scratch in Go using only the standard library, with a web explorer, a browser wallet and a dApp connection protocol (YUKI Connect).

**Explorer:** [chain.yukichat.lol](https://chain.yukichat.lol) · **Docs:** [chain.yukichat.lol/docs](https://chain.yukichat.lol/docs)

## Overview

| | |
| --- | --- |
| Network | `yuki-testnet-1` |
| Consensus | Proof of Authority, single validator (multi-validator BFT planned) |
| Signatures | Ed25519 |
| Addresses | Bech32, `yuki1…` |
| Units | 1 YUKI = 10⁹ nano |
| Supply | 1,000,000,000 YUKI at genesis, 2% annual inflation paid to the block proposer |
| Block time | 5 s when there are pending transactions, 60 s when idle |
| Minimum fee | 0.001 YUKI |

**Genesis allocation:** founder 30%, ecosystem 30%, validator 20%, treasury 15%, faucet 5%.

### YukiDNS

Human-readable `.yuki` names, registered for one year. Prices are set by name length and the fee is burned:

| Length | 3 | 4 | 5 | 6 | 7 | 8 | 9–11 | 12+ |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| YUKI / year | 3000 | 1000 | 300 | 100 | 50 | 25 | 15 | 10 |

Names containing a digit cost half.

## Components

| Path | Description |
| --- | --- |
| `node/` | The node (`yukid`): consensus, state, mempool, REST API and server-sent event stream |
| `bridge/` | YUKI Connect relay: short-lived encrypted message relay between dApps and wallets |
| `web/` | Explorer, browser wallet, landing page and API docs |
| `web/sdk/yuki-connect.js` | Drop-in SDK for dApps to connect to a wallet and request signatures |

## Building

Requires Go 1.23+.

```sh
cd node && go build -o ../yukid .
cd ../bridge && go build -o ../yukibridge .
```

## Running

The node keeps its state in `data/` (`genesis.json` plus an append-only `blocks.jsonl`, replayed and verified on start) and its keys in `keys/`. Neither directory is included in this repository.

```sh
./yukid                     # starts the node, API on :7480
./yukid send -key keys/faucet.key -to yuki1... -amount 100
```

## Transaction signing

The bytes signed for a transaction are the following fields joined with `\n`:

```
chain, type, from, to, amount, fee, nonce, name, memo
```

`node/types.go` (`SignBytes`) and the web wallet both implement this; any new client must match it exactly.

## YUKI Connect

Wallets and dApps exchange `nacl.box`-encrypted messages through the bridge. The full protocol, REST reference and live demo are in the [docs](https://chain.yukichat.lol/docs).

## Roadmap

- Peer-to-peer networking and multi-validator BFT consensus
- Staking
- Custom tokens
- Smart contract VM
