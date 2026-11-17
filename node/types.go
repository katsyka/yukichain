package main

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"regexp"
	"strings"
)

const (
	Nano         = uint64(1_000_000_000) // 1 YUKI = 1e9 nanoyuki
	MinFee       = uint64(1_000_000)     // 0.001 YUKI
	InflationPct = 2                     // yearly, minted to the block proposer
	YearMs       = int64(365 * 24 * 3600 * 1000)
	BlockMs      = 5000  // block time when there are pending txs
	IdleBlockMs  = 60000 // heartbeat block when idle
	MaxBlockTxs  = 2000
	MaxMemo      = 140
)

type Tx struct {
	Type   string `json:"type"` // transfer | name_register | name_transfer | name_target
	From   string `json:"from"`
	PubKey string `json:"pubkey"`
	To     string `json:"to,omitempty"`
	Amount uint64 `json:"amount,string"`
	Fee    uint64 `json:"fee,string"`
	Nonce  uint64 `json:"nonce"`
	Name   string `json:"name,omitempty"`
	Memo   string `json:"memo,omitempty"`
	Sig    string `json:"sig"`
	Hash   string `json:"hash"`
}

type Block struct {
	Height    uint64 `json:"height"`
	Time      int64  `json:"time"`
	Prev      string `json:"prev"`
	TxRoot    string `json:"tx_root"`
	StateRoot string `json:"state_root"`
	Proposer  string `json:"proposer"`
	Reward    uint64 `json:"reward,string"`
	Fees      uint64 `json:"fees,string"`
	Hash      string `json:"hash"`
	Sig       string `json:"sig"`
	Txs       []*Tx  `json:"txs"`
}

func sha(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])
}

func AddressFromPub(pub []byte) string {
	h := sha256.Sum256(pub)
	return bech32Encode("yuki", h[:20])
}

func ValidAddress(a string) bool {
	hrp, data, err := bech32Decode(a)
	return err == nil && hrp == "yuki" && len(data) == 20
}

var nameRe = regexp.MustCompile(`^[a-z0-9]([a-z0-9-]{1,30})[a-z0-9]$`)

func ValidName(n string) bool { return nameRe.MatchString(n) && !strings.Contains(n, "--") }

// NamePrice in nanoyuki for one year, burned on registration/renewal.
// Shorter names cost more (like TON DNS); names containing a digit cost half.
var namePriceByLen = map[int]uint64{3: 3000, 4: 1000, 5: 300, 6: 100, 7: 50, 8: 25}

func NamePrice(n string) uint64 {
	p, ok := namePriceByLen[len(n)]
	if !ok {
		p = 10
		if len(n) <= 11 {
			p = 15
		}
	}
	price := p * Nano
	if strings.ContainsAny(n, "0123456789") {
		price /= 2
	}
	return price
}

func (t *Tx) SignBytes(chainID string) []byte {
	return []byte(fmt.Sprintf("%s\n%s\n%s\n%s\n%d\n%d\n%d\n%s\n%s",
		chainID, t.Type, t.From, t.To, t.Amount, t.Fee, t.Nonce, t.Name, t.Memo))
}

func (t *Tx) ComputeHash(chainID string) string {
	return sha(string(t.SignBytes(chainID)) + "\n" + t.Sig)
}

func (t *Tx) Sign(chainID string, key ed25519.PrivateKey) {
	pub := key.Public().(ed25519.PublicKey)
	t.PubKey = hex.EncodeToString(pub)
	t.From = AddressFromPub(pub)
	t.Sig = hex.EncodeToString(ed25519.Sign(key, t.SignBytes(chainID)))
	t.Hash = t.ComputeHash(chainID)
}

// VerifySig checks shape and signature, not state.
func (t *Tx) VerifySig(chainID string) error {
	switch t.Type {
	case "transfer", "name_register", "name_transfer", "name_target":
	default:
		return errors.New("unknown tx type")
	}
	if len(t.Memo) > MaxMemo || strings.ContainsAny(t.Memo, "\n\r") {
		return errors.New("memo too long or has newlines")
	}
	pub, err := hex.DecodeString(t.PubKey)
	if err != nil || len(pub) != ed25519.PublicKeySize {
		return errors.New("bad pubkey")
	}
	if AddressFromPub(pub) != t.From {
		return errors.New("pubkey does not match sender")
	}
	sig, err := hex.DecodeString(t.Sig)
	if err != nil || !ed25519.Verify(pub, t.SignBytes(chainID), sig) {
		return errors.New("bad signature")
	}
	if t.Fee < MinFee {
		return fmt.Errorf("fee below minimum %d", MinFee)
	}
	t.Hash = t.ComputeHash(chainID)
	return nil
}

func (b *Block) HeaderBytes(chainID string) []byte {
	return []byte(fmt.Sprintf("%s|%d|%d|%s|%s|%s|%s|%d|%d",
		chainID, b.Height, b.Time, b.Prev, b.TxRoot, b.StateRoot, b.Proposer, b.Reward, b.Fees))
}

func MerkleRoot(txs []*Tx) string {
	if len(txs) == 0 {
		return sha("")
	}
	level := make([]string, len(txs))
	for i, t := range txs {
		level[i] = t.Hash
	}
	for len(level) > 1 {
		var next []string
		for i := 0; i < len(level); i += 2 {
			if i+1 < len(level) {
				next = append(next, sha(level[i]+level[i+1]))
			} else {
				next = append(next, sha(level[i]+level[i]))
			}
		}
		level = next
	}
	return level[0]
}
