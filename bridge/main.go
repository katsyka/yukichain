// yukibridge: YUKI Connect relay. Wallets and dApps exchange end-to-end encrypted
// messages (nacl box) addressed by session public keys; the bridge only stores and
// forwards opaque base64 blobs for a short TTL.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	maxBody    = 64 << 10
	maxTTL     = 300
	maxQueue   = 100
	maxClients = 100
)

var idRe = regexp.MustCompile(`^[0-9a-f]{64}$`)

type msg struct {
	ID      uint64
	From    string
	Message string
	Expires time.Time
}

type bridge struct {
	mu    sync.Mutex
	seq   uint64
	queue map[string][]*msg            // recipient -> buffered messages
	subs  map[string]map[chan *msg]bool // recipient -> live listeners
}

func (b *bridge) post(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	from, to := q.Get("client_id"), q.Get("to")
	if !idRe.MatchString(from) || !idRe.MatchString(to) {
		jsonErr(w, 400, "client_id and to must be 32-byte hex session keys")
		return
	}
	ttl, _ := strconv.Atoi(q.Get("ttl"))
	if ttl <= 0 || ttl > maxTTL {
		ttl = maxTTL
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxBody))
	if err != nil || len(body) == 0 {
		jsonErr(w, 400, "empty or too large body")
		return
	}
	b.mu.Lock()
	b.seq++
	m := &msg{ID: b.seq, From: from, Message: strings.TrimSpace(string(body)), Expires: time.Now().Add(time.Duration(ttl) * time.Second)}
	qu := append(b.queue[to], m)
	if len(qu) > maxQueue {
		qu = qu[len(qu)-maxQueue:]
	}
	b.queue[to] = qu
	for ch := range b.subs[to] {
		select {
		case ch <- m:
		default:
		}
	}
	b.mu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	fmt.Fprintf(w, `{"ok":true,"id":%d}`, m.ID)
}

func (b *bridge) events(w http.ResponseWriter, r *http.Request) {
	fl, ok := w.(http.Flusher)
	if !ok {
		return
	}
	var ids []string
	for _, id := range strings.Split(r.URL.Query().Get("client_id"), ",") {
		if idRe.MatchString(id) {
			ids = append(ids, id)
		}
	}
	if len(ids) == 0 || len(ids) > maxClients {
		jsonErr(w, 400, "client_id: 1-100 comma separated session keys")
		return
	}
	last, _ := strconv.ParseUint(r.URL.Query().Get("last_event_id"), 10, 64)
	if v := r.Header.Get("Last-Event-ID"); v != "" {
		last, _ = strconv.ParseUint(v, 10, 64)
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no")

	ch := make(chan *msg, 32)
	b.mu.Lock()
	var backlog []*msg
	now := time.Now()
	for _, id := range ids {
		if b.subs[id] == nil {
			b.subs[id] = map[chan *msg]bool{}
		}
		b.subs[id][ch] = true
		for _, m := range b.queue[id] {
			if m.ID > last && m.Expires.After(now) {
				backlog = append(backlog, m)
			}
		}
	}
	b.mu.Unlock()
	defer func() {
		b.mu.Lock()
		for _, id := range ids {
			delete(b.subs[id], ch)
			if len(b.subs[id]) == 0 {
				delete(b.subs, id)
			}
		}
		b.mu.Unlock()
	}()

	send := func(m *msg) {
		data, _ := json.Marshal(map[string]string{"from": m.From, "message": m.Message})
		fmt.Fprintf(w, "id: %d\nevent: message\ndata: %s\n\n", m.ID, data)
	}
	io.WriteString(w, "event: heartbeat\ndata: open\n\n")
	for _, m := range backlog {
		send(m)
	}
	fl.Flush()
	ping := time.NewTicker(15 * time.Second)
	defer ping.Stop()
	for {
		select {
		case m := <-ch:
			send(m)
		case <-ping.C:
			io.WriteString(w, "event: heartbeat\ndata: ping\n\n")
		case <-r.Context().Done():
			return
		}
		fl.Flush()
	}
}

func (b *bridge) gc() {
	for range time.Tick(30 * time.Second) {
		now := time.Now()
		b.mu.Lock()
		for id, qu := range b.queue {
			keep := qu[:0]
			for _, m := range qu {
				if m.Expires.After(now) {
					keep = append(keep, m)
				}
			}
			if len(keep) == 0 {
				delete(b.queue, id)
			} else {
				b.queue[id] = keep
			}
		}
		b.mu.Unlock()
	}
}

func jsonErr(w http.ResponseWriter, code int, m string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": m})
}

func main() {
	listen := flag.String("listen", "127.0.0.1:7481", "address")
	flag.Parse()
	b := &bridge{queue: map[string][]*msg{}, subs: map[string]map[chan *msg]bool{}}
	go b.gc()
	m := http.NewServeMux()
	m.HandleFunc("POST /bridge/message", b.post)
	m.HandleFunc("GET /bridge/events", b.events)
	h := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Last-Event-ID")
		if r.Method == "OPTIONS" {
			return
		}
		m.ServeHTTP(w, r)
	})
	log.Printf("yukibridge on %s", *listen)
	log.Fatal(http.ListenAndServe(*listen, h))
}
