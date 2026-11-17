package main

import (
	"bufio"
	"crypto/ed25519"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

type Alloc struct {
	Address string `json:"address"`
	Amount  uint64 `json:"amount,string"`
	Label   string `json:"label"`
}

type Genesis struct {
	ChainID      string  `json:"chain_id"`
	Time         int64   `json:"time"`
	Validator    string  `json:"validator"`
	ValidatorPub string  `json:"validator_pub"`
	Alloc        []Alloc `json:"alloc"`
}

type Account struct {
	Balance uint64 `json:"balance,string"`
	Nonce   uint64 `json:"nonce"`
}

type Name struct {
	Name       string `json:"name"`
	Owner      string `json:"owner"`
	Target     string `json:"target,omitempty"`
	Registered int64  `json:"registered"`
	Expires    int64  `json:"expires"`
}

type txRef struct {
	Height uint64
	Idx    int
}

type Chain struct {
	mu       sync.RWMutex
	G        Genesis
	accounts map[string]*Account
	names    map[string]*Name
	labels   map[string]string
	blocks   []*Block // blocks[0] is the genesis block
	txIndex  map[string]txRef
	addrTxs  map[string][]string
	supply   uint64
	burned   uint64
	txCount  uint64
	mempool  []*Tx
	key      ed25519.PrivateKey // nil on non-validator nodes
	file     *os.File
	subs     map[chan []byte]struct{}
}

func LoadChain(dir string, key ed25519.PrivateKey) (*Chain, error) {
	raw, err := os.ReadFile(filepath.Join(dir, "genesis.json"))
	if err != nil {
		return nil, err
	}
	c := &Chain{
		accounts: map[string]*Account{}, names: map[string]*Name{}, labels: map[string]string{},
		txIndex: map[string]txRef{}, addrTxs: map[string][]string{}, subs: map[chan []byte]struct{}{}, key: key,
	}
	if err := json.Unmarshal(raw, &c.G); err != nil {
		return nil, err
	}
	for _, a := range c.G.Alloc {
		c.acct(a.Address).Balance += a.Amount
		c.supply += a.Amount
		if a.Label != "" {
			c.labels[a.Address] = a.Label
		}
	}
	gb := &Block{Height: 0, Time: c.G.Time, Prev: sha(string(raw)), TxRoot: MerkleRoot(nil), Proposer: c.G.Validator}
	gb.StateRoot = c.stateRoot()
	gb.Hash = sha(string(gb.HeaderBytes(c.G.ChainID)))
	c.blocks = []*Block{gb}

	path := filepath.Join(dir, "blocks.jsonl")
	if f, err := os.Open(path); err == nil {
		sc := bufio.NewScanner(f)
		sc.Buffer(make([]byte, 64<<20), 64<<20)
		for sc.Scan() {
			var b Block
			if err := json.Unmarshal(sc.Bytes(), &b); err != nil {
				f.Close()
				return nil, fmt.Errorf("block %d: %w", len(c.blocks), err)
			}
			if err := c.applyBlock(&b); err != nil {
				f.Close()
				return nil, fmt.Errorf("replay block %d: %w", b.Height, err)
			}
		}
		f.Close()
	}
	c.file, err = os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0644)
	return c, err
}

func (c *Chain) acct(a string) *Account {
	ac := c.accounts[a]
	if ac == nil {
		ac = &Account{}
		c.accounts[a] = ac
	}
	return ac
}

func (c *Chain) head() *Block { return c.blocks[len(c.blocks)-1] }

func (c *Chain) stateRoot() string {
	keys := make([]string, 0, len(c.accounts))
	for k := range c.accounts {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var sb strings.Builder
	for _, k := range keys {
		a := c.accounts[k]
		fmt.Fprintf(&sb, "a:%s:%d:%d\n", k, a.Balance, a.Nonce)
	}
	nk := make([]string, 0, len(c.names))
	for k := range c.names {
		nk = append(nk, k)
	}
	sort.Strings(nk)
	for _, k := range nk {
		n := c.names[k]
		fmt.Fprintf(&sb, "n:%s:%s:%s:%d\n", k, n.Owner, n.Target, n.Expires)
	}
	fmt.Fprintf(&sb, "s:%d:%d", c.supply, c.burned)
	return sha(sb.String())
}

// blockReward mints InflationPct%/year of supply, pro rata to elapsed time.
func (c *Chain) blockReward(dtMs int64) uint64 {
	if dtMs <= 0 {
		return 0
	}
	r := new(big.Int).SetUint64(c.supply)
	r.Mul(r, big.NewInt(InflationPct*dtMs))
	r.Div(r, big.NewInt(100*YearMs))
	return r.Uint64()
}

// txCost is what the sender pays in total.
func txCost(t *Tx) uint64 {
	switch t.Type {
	case "transfer":
		return t.Amount + t.Fee
	case "name_register":
		return NamePrice(t.Name) + t.Fee
	}
	return t.Fee
}

// applyTx validates against current state, then mutates it. No mutation on error.
func (c *Chain) applyTx(t *Tx, now int64) error {
	from := c.accounts[t.From]
	if from == nil {
		return errors.New("insufficient balance")
	}
	if t.Nonce != from.Nonce {
		return fmt.Errorf("bad nonce: want %d", from.Nonce)
	}
	if t.Amount > 1<<62 || t.Fee > 1<<62 {
		return errors.New("amount too large")
	}
	cost := txCost(t)
	if from.Balance < cost {
		return errors.New("insufficient balance")
	}
	switch t.Type {
	case "transfer":
		if !ValidAddress(t.To) {
			return errors.New("bad recipient address")
		}
		if t.Amount == 0 {
			return errors.New("zero amount")
		}
	case "name_register":
		if !ValidName(t.Name) {
			return errors.New("bad name: 3-32 chars, a-z 0-9 and -")
		}
		if n := c.names[t.Name]; n != nil && n.Expires > now && n.Owner != t.From {
			return errors.New("name is taken")
		}
	case "name_transfer", "name_target":
		n := c.names[t.Name]
		if n == nil || n.Owner != t.From || n.Expires <= now {
			return errors.New("you do not own this name")
		}
		if t.Type == "name_transfer" && !ValidAddress(t.To) {
			return errors.New("bad new owner address")
		}
		if t.Type == "name_target" && t.To != "" && !ValidAddress(t.To) {
			return errors.New("bad target address")
		}
	}

	from.Balance -= cost
	from.Nonce++
	switch t.Type {
	case "transfer":
		c.acct(t.To).Balance += t.Amount
	case "name_register":
		price := NamePrice(t.Name)
		c.supply -= price
		c.burned += price
		n := c.names[t.Name]
		if n != nil && n.Owner == t.From && n.Expires > now {
			n.Expires += YearMs
		} else {
			c.names[t.Name] = &Name{Name: t.Name, Owner: t.From, Registered: now, Expires: now + YearMs}
		}
	case "name_transfer":
		n := c.names[t.Name]
		n.Owner, n.Target = t.To, ""
		c.acct(t.To)
	case "name_target":
		c.names[t.Name].Target = t.To
	}
	return nil
}

// applyBlock verifies a stored/received block and applies it.
func (c *Chain) applyBlock(b *Block) error {
	prev := c.head()
	if b.Height != prev.Height+1 || b.Prev != prev.Hash || b.Time <= prev.Time {
		return errors.New("does not extend head")
	}
	if b.Proposer != c.G.Validator {
		return errors.New("unknown proposer")
	}
	pub, _ := hex.DecodeString(c.G.ValidatorPub)
	sig, _ := hex.DecodeString(b.Sig)
	if sha(string(b.HeaderBytes(c.G.ChainID))) != b.Hash || len(pub) != ed25519.PublicKeySize ||
		!ed25519.Verify(pub, []byte(b.Hash), sig) {
		return errors.New("bad block signature")
	}
	if MerkleRoot(b.Txs) != b.TxRoot {
		return errors.New("bad tx root")
	}
	var fees uint64
	for _, t := range b.Txs {
		if err := t.VerifySig(c.G.ChainID); err != nil {
			return fmt.Errorf("tx %s: %w", t.Hash, err)
		}
		if err := c.applyTx(t, b.Time); err != nil {
			return fmt.Errorf("tx %s: %w", t.Hash, err)
		}
		fees += t.Fee
	}
	reward := c.blockReward(b.Time - prev.Time)
	if reward != b.Reward || fees != b.Fees {
		return errors.New("bad reward or fees")
	}
	c.acct(b.Proposer).Balance += reward + fees
	c.supply += reward
	if c.stateRoot() != b.StateRoot {
		return errors.New("state root mismatch")
	}
	c.index(b)
	return nil
}

func (c *Chain) index(b *Block) {
	c.blocks = append(c.blocks, b)
	for i, t := range b.Txs {
		c.txIndex[t.Hash] = txRef{b.Height, i}
		c.addrTxs[t.From] = append(c.addrTxs[t.From], t.Hash)
		if t.To != "" && t.To != t.From {
			c.addrTxs[t.To] = append(c.addrTxs[t.To], t.Hash)
		}
		c.txCount++
	}
}

// Produce builds, signs, stores and broadcasts the next block.
func (c *Chain) Produce() (*Block, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	prev := c.head()
	now := time.Now().UnixMilli()
	if now <= prev.Time {
		now = prev.Time + 1
	}
	b := &Block{Height: prev.Height + 1, Time: now, Prev: prev.Hash, Proposer: c.G.Validator, Txs: []*Tx{}}
	var rest []*Tx
	for _, t := range c.mempool {
		if len(b.Txs) >= MaxBlockTxs {
			rest = append(rest, t)
			continue
		}
		if err := c.applyTx(t, now); err == nil {
			b.Txs = append(b.Txs, t)
			b.Fees += t.Fee
		}
	}
	c.mempool = rest
	b.Reward = c.blockReward(now - prev.Time)
	c.acct(b.Proposer).Balance += b.Reward + b.Fees
	c.supply += b.Reward
	b.TxRoot = MerkleRoot(b.Txs)
	b.StateRoot = c.stateRoot()
	b.Hash = sha(string(b.HeaderBytes(c.G.ChainID)))
	b.Sig = hex.EncodeToString(ed25519.Sign(c.key, []byte(b.Hash)))
	line, _ := json.Marshal(b)
	if _, err := c.file.Write(append(line, '\n')); err != nil {
		return nil, err // state already mutated; crash rather than diverge
	}
	c.index(b)
	msg, _ := json.Marshal(map[string]any{"block": blockSummary(b), "status": c.statusLocked()})
	for ch := range c.subs {
		select {
		case ch <- msg:
		default:
		}
	}
	return b, nil
}

func (c *Chain) nextNonce(addr string) uint64 {
	n := uint64(0)
	if a := c.accounts[addr]; a != nil {
		n = a.Nonce
	}
	for _, t := range c.mempool {
		if t.From == addr {
			n++
		}
	}
	return n
}

// Submit validates a signed tx against state + pending txs and queues it.
func (c *Chain) Submit(t *Tx) error {
	if err := t.VerifySig(c.G.ChainID); err != nil {
		return err
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if _, ok := c.txIndex[t.Hash]; ok {
		return errors.New("already included")
	}
	if len(c.mempool) > 20000 {
		return errors.New("mempool full")
	}
	if want := c.nextNonce(t.From); t.Nonce != want {
		return fmt.Errorf("bad nonce: want %d", want)
	}
	pending := txCost(t)
	for _, p := range c.mempool {
		if p.From == t.From {
			pending += txCost(p)
		}
	}
	if a := c.accounts[t.From]; a == nil || a.Balance < pending {
		return errors.New("insufficient balance")
	}
	// dry-run on a copy of the sender-relevant state is overkill; full checks run at block time
	if t.Type == "transfer" && (!ValidAddress(t.To) || t.Amount == 0) {
		return errors.New("bad recipient or zero amount")
	}
	if strings.HasPrefix(t.Type, "name_") && !ValidName(t.Name) {
		return errors.New("bad name")
	}
	if t.Type == "name_register" {
		if n := c.names[t.Name]; n != nil && n.Expires > time.Now().UnixMilli() && n.Owner != t.From {
			return errors.New("name is taken")
		}
	}
	c.mempool = append(c.mempool, t)
	return nil
}

func (c *Chain) Run() {
	tick := time.NewTicker(500 * time.Millisecond)
	for range tick.C {
		c.mu.RLock()
		since := time.Now().UnixMilli() - c.head().Time
		pending := len(c.mempool)
		c.mu.RUnlock()
		if (pending > 0 && since >= BlockMs) || since >= IdleBlockMs {
			if _, err := c.Produce(); err != nil {
				fmt.Fprintln(os.Stderr, "produce:", err)
				os.Exit(1)
			}
		}
	}
}
