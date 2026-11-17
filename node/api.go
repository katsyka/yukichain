package main

import (
	"crypto/ed25519"
	"encoding/json"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

const FaucetAmount = 100 * Nano

type API struct {
	c         *Chain
	faucetKey ed25519.PrivateKey
	fmu       sync.Mutex
	faucetLog map[string]int64
}

func blockSummary(b *Block) map[string]any {
	return map[string]any{"height": b.Height, "time": b.Time, "hash": b.Hash, "txs": len(b.Txs),
		"reward": strconv.FormatUint(b.Reward, 10), "fees": strconv.FormatUint(b.Fees, 10), "proposer": b.Proposer}
}

func (c *Chain) statusLocked() map[string]any {
	h := c.head()
	staked := uint64(0)
	if a := c.accounts[c.G.Validator]; a != nil {
		staked = a.Balance
	}
	return map[string]any{
		"chain_id": c.G.ChainID, "height": h.Height, "head_hash": h.Hash, "head_time": h.Time,
		"genesis_time": c.G.Time, "supply": strconv.FormatUint(c.supply, 10), "burned": strconv.FormatUint(c.burned, 10),
		"staked": strconv.FormatUint(staked, 10), "accounts": len(c.accounts), "txs": c.txCount, "names": len(c.names),
		"mempool": len(c.mempool), "validators": 1, "validator": c.G.Validator, "inflation_pct": InflationPct,
		"block_ms": BlockMs, "min_fee": strconv.FormatUint(MinFee, 10),
	}
}

func (c *Chain) txView(hash string) map[string]any {
	ref, ok := c.txIndex[hash]
	if !ok {
		return nil
	}
	b := c.blocks[ref.Height]
	return map[string]any{"tx": b.Txs[ref.Idx], "height": b.Height, "time": b.Time, "block_hash": b.Hash}
}

func (c *Chain) nameView(n *Name) map[string]any {
	now := time.Now().UnixMilli()
	resolves := n.Target
	if resolves == "" {
		resolves = n.Owner
	}
	return map[string]any{"name": n.Name, "owner": n.Owner, "target": n.Target, "resolves": resolves,
		"registered": n.Registered, "expires": n.Expires, "active": n.Expires > now}
}

// resolve turns an address or "name"/"name.yuki" into an address.
func (c *Chain) resolve(q string) string {
	q = strings.ToLower(strings.TrimSpace(q))
	if ValidAddress(q) {
		return q
	}
	n := c.names[strings.TrimSuffix(q, ".yuki")]
	if n == nil || n.Expires <= time.Now().UnixMilli() {
		return ""
	}
	if n.Target != "" {
		return n.Target
	}
	return n.Owner
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}

func errJSON(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}

func qInt(r *http.Request, k string, def, max int) int {
	v, err := strconv.Atoi(r.URL.Query().Get(k))
	if err != nil || v <= 0 {
		return def
	}
	if v > max {
		return max
	}
	return v
}

var hexRe = regexp.MustCompile(`^[0-9a-f]{64}$`)

func (a *API) Routes() *http.ServeMux {
	c := a.c
	m := http.NewServeMux()

	m.HandleFunc("GET /api/status", func(w http.ResponseWriter, r *http.Request) {
		c.mu.RLock()
		defer c.mu.RUnlock()
		writeJSON(w, 200, c.statusLocked())
	})

	m.HandleFunc("GET /api/blocks", func(w http.ResponseWriter, r *http.Request) {
		c.mu.RLock()
		defer c.mu.RUnlock()
		limit := qInt(r, "limit", 20, 100)
		top := int(c.head().Height)
		if b, err := strconv.Atoi(r.URL.Query().Get("before")); err == nil && b-1 < top {
			top = b - 1
		}
		out := []any{}
		for h := top; h >= 0 && len(out) < limit; h-- {
			out = append(out, blockSummary(c.blocks[h]))
		}
		writeJSON(w, 200, out)
	})

	m.HandleFunc("GET /api/block/{id}", func(w http.ResponseWriter, r *http.Request) {
		c.mu.RLock()
		defer c.mu.RUnlock()
		id := r.PathValue("id")
		if h, err := strconv.Atoi(id); err == nil && h >= 0 && h < len(c.blocks) {
			writeJSON(w, 200, c.blocks[h])
			return
		}
		for i := len(c.blocks) - 1; i >= 0; i-- {
			if c.blocks[i].Hash == id {
				writeJSON(w, 200, c.blocks[i])
				return
			}
		}
		errJSON(w, 404, "block not found")
	})

	m.HandleFunc("GET /api/txs", func(w http.ResponseWriter, r *http.Request) {
		c.mu.RLock()
		defer c.mu.RUnlock()
		limit := qInt(r, "limit", 20, 100)
		out := []any{}
		for h := len(c.blocks) - 1; h > 0 && len(out) < limit; h-- {
			b := c.blocks[h]
			for i := len(b.Txs) - 1; i >= 0 && len(out) < limit; i-- {
				out = append(out, map[string]any{"tx": b.Txs[i], "height": b.Height, "time": b.Time})
			}
		}
		writeJSON(w, 200, out)
	})

	m.HandleFunc("GET /api/tx/{hash}", func(w http.ResponseWriter, r *http.Request) {
		c.mu.RLock()
		defer c.mu.RUnlock()
		hash := r.PathValue("hash")
		if v := c.txView(hash); v != nil {
			writeJSON(w, 200, v)
			return
		}
		for _, t := range c.mempool {
			if t.Hash == hash {
				writeJSON(w, 200, map[string]any{"tx": t, "pending": true})
				return
			}
		}
		errJSON(w, 404, "transaction not found")
	})

	m.HandleFunc("GET /api/account/{id}", func(w http.ResponseWriter, r *http.Request) {
		c.mu.RLock()
		defer c.mu.RUnlock()
		addr := c.resolve(r.PathValue("id"))
		if addr == "" {
			errJSON(w, 404, "unknown address or name")
			return
		}
		acc := c.accounts[addr]
		if acc == nil {
			acc = &Account{}
		}
		names := []any{}
		for _, n := range c.names {
			if n.Owner == addr {
				names = append(names, c.nameView(n))
			}
		}
		hashes := c.addrTxs[addr]
		offset := qInt(r, "offset", 0, 1<<30)
		limit := qInt(r, "limit", 25, 100)
		txs := []any{}
		for i := len(hashes) - 1 - offset; i >= 0 && len(txs) < limit; i-- {
			txs = append(txs, c.txView(hashes[i]))
		}
		var pending []*Tx
		for _, t := range c.mempool {
			if t.From == addr || t.To == addr {
				pending = append(pending, t)
			}
		}
		writeJSON(w, 200, map[string]any{
			"address": addr, "balance": strconv.FormatUint(acc.Balance, 10), "nonce": acc.Nonce,
			"next_nonce": c.nextNonce(addr), "label": c.labels[addr], "names": names,
			"tx_count": len(hashes), "txs": txs, "pending": pending, "is_validator": addr == c.G.Validator,
		})
	})

	m.HandleFunc("GET /api/top", func(w http.ResponseWriter, r *http.Request) {
		c.mu.RLock()
		defer c.mu.RUnlock()
		type row struct {
			Address string `json:"address"`
			Balance uint64 `json:"balance,string"`
			Label   string `json:"label"`
		}
		rows := make([]row, 0, len(c.accounts))
		for k, v := range c.accounts {
			rows = append(rows, row{k, v.Balance, c.labels[k]})
		}
		sort.Slice(rows, func(i, j int) bool { return rows[i].Balance > rows[j].Balance })
		if n := qInt(r, "limit", 50, 200); len(rows) > n {
			rows = rows[:n]
		}
		writeJSON(w, 200, rows)
	})

	m.HandleFunc("GET /api/names", func(w http.ResponseWriter, r *http.Request) {
		c.mu.RLock()
		defer c.mu.RUnlock()
		ns := make([]*Name, 0, len(c.names))
		for _, n := range c.names {
			ns = append(ns, n)
		}
		sort.Slice(ns, func(i, j int) bool { return ns[i].Registered > ns[j].Registered })
		out := []any{}
		for _, n := range ns {
			if len(out) >= qInt(r, "limit", 50, 200) {
				break
			}
			out = append(out, c.nameView(n))
		}
		writeJSON(w, 200, out)
	})

	m.HandleFunc("GET /api/name/{name}", func(w http.ResponseWriter, r *http.Request) {
		c.mu.RLock()
		defer c.mu.RUnlock()
		name := strings.TrimSuffix(strings.ToLower(r.PathValue("name")), ".yuki")
		if !ValidName(name) {
			errJSON(w, 400, "names are 3-32 chars: a-z, 0-9 and single dashes")
			return
		}
		price := strconv.FormatUint(NamePrice(name), 10)
		n := c.names[name]
		if n == nil || n.Expires <= time.Now().UnixMilli() {
			writeJSON(w, 200, map[string]any{"name": name, "available": true, "price": price})
			return
		}
		v := c.nameView(n)
		v["available"], v["price"] = false, price
		writeJSON(w, 200, v)
	})

	m.HandleFunc("GET /api/search", func(w http.ResponseWriter, r *http.Request) {
		c.mu.RLock()
		defer c.mu.RUnlock()
		q := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("q")))
		switch {
		case ValidAddress(q):
			writeJSON(w, 200, map[string]string{"kind": "account", "id": q})
		case hexRe.MatchString(q):
			if _, ok := c.txIndex[q]; ok {
				writeJSON(w, 200, map[string]string{"kind": "tx", "id": q})
				return
			}
			for i := len(c.blocks) - 1; i >= 0; i-- {
				if c.blocks[i].Hash == q {
					writeJSON(w, 200, map[string]string{"kind": "block", "id": strconv.Itoa(i)})
					return
				}
			}
			errJSON(w, 404, "nothing found")
		default:
			if h, err := strconv.Atoi(q); err == nil && h >= 0 && h < len(c.blocks) {
				writeJSON(w, 200, map[string]string{"kind": "block", "id": q})
				return
			}
			name := strings.TrimSuffix(q, ".yuki")
			if ValidName(name) {
				writeJSON(w, 200, map[string]string{"kind": "name", "id": name})
				return
			}
			errJSON(w, 404, "nothing found")
		}
	})

	m.HandleFunc("GET /api/stats/daily", func(w http.ResponseWriter, r *http.Request) {
		c.mu.RLock()
		defer c.mu.RUnlock()
		days := qInt(r, "days", 14, 60)
		dayMs := int64(86400000)
		today := time.Now().UnixMilli() / dayMs
		txs := make([]int, days)
		for h := len(c.blocks) - 1; h > 0; h-- {
			d := int(today - c.blocks[h].Time/dayMs)
			if d >= days {
				break
			}
			txs[days-1-d] += len(c.blocks[h].Txs)
		}
		writeJSON(w, 200, map[string]any{"start_day": (today - int64(days) + 1) * dayMs, "txs": txs})
	})

	m.HandleFunc("POST /api/tx", func(w http.ResponseWriter, r *http.Request) {
		var t Tx
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&t); err != nil {
			errJSON(w, 400, "bad json")
			return
		}
		if err := c.Submit(&t); err != nil {
			errJSON(w, 400, err.Error())
			return
		}
		writeJSON(w, 200, map[string]string{"hash": t.Hash})
	})

	m.HandleFunc("POST /api/faucet", func(w http.ResponseWriter, r *http.Request) {
		var req struct{ Address string }
		json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&req)
		c.mu.RLock()
		to := c.resolve(req.Address)
		c.mu.RUnlock()
		if to == "" || a.faucetKey == nil {
			errJSON(w, 400, "bad address")
			return
		}
		ip := r.Header.Get("X-Real-IP")
		now := time.Now().UnixMilli()
		a.fmu.Lock()
		if now-a.faucetLog["a:"+to] < 86400000 || (ip != "" && now-a.faucetLog["i:"+ip] < 86400000) {
			a.fmu.Unlock()
			errJSON(w, 429, "faucet already used in the last 24h")
			return
		}
		a.faucetLog["a:"+to], a.faucetLog["i:"+ip] = now, now
		a.fmu.Unlock()
		pub := a.faucetKey.Public().(ed25519.PublicKey)
		c.mu.RLock()
		nonce := c.nextNonce(AddressFromPub(pub))
		c.mu.RUnlock()
		t := &Tx{Type: "transfer", To: to, Amount: FaucetAmount, Fee: MinFee, Nonce: nonce, Memo: "faucet"}
		t.Sign(c.G.ChainID, a.faucetKey)
		if err := c.Submit(t); err != nil {
			errJSON(w, 500, err.Error())
			return
		}
		writeJSON(w, 200, map[string]string{"hash": t.Hash})
	})

	m.HandleFunc("GET /api/stream", func(w http.ResponseWriter, r *http.Request) {
		fl, ok := w.(http.Flusher)
		if !ok {
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("X-Accel-Buffering", "no")
		ch := make(chan []byte, 8)
		c.mu.Lock()
		c.subs[ch] = struct{}{}
		c.mu.Unlock()
		defer func() { c.mu.Lock(); delete(c.subs, ch); c.mu.Unlock() }()
		ping := time.NewTicker(25 * time.Second)
		defer ping.Stop()
		for {
			select {
			case msg := <-ch:
				w.Write([]byte("data: "))
				w.Write(msg)
				w.Write([]byte("\n\n"))
			case <-ping.C:
				w.Write([]byte(": ping\n\n"))
			case <-r.Context().Done():
				return
			}
			fl.Flush()
		}
	})
	return m
}

func cors(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == "OPTIONS" {
			return
		}
		h.ServeHTTP(w, r)
	})
}
