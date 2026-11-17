package main

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"math/big"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func usage() {
	fmt.Println(`yukid — YukiChain node

  yukid init  -data DIR -keys DIR [-chain yuki-testnet-1]   create keys + genesis
  yukid run   -data DIR -keys DIR [-listen 127.0.0.1:7480]  run the validator node
  yukid keygen                                              new wallet (address + secret)
  yukid send  -key FILE -to ADDR|NAME -amount 1.5 [-memo ..] [-node URL]`)
	os.Exit(2)
}

func loadKey(path string) (ed25519.PrivateKey, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	b, err := hex.DecodeString(strings.TrimSpace(string(raw)))
	if err != nil {
		return nil, err
	}
	switch len(b) {
	case ed25519.SeedSize:
		return ed25519.NewKeyFromSeed(b), nil
	case ed25519.PrivateKeySize:
		return ed25519.PrivateKey(b), nil
	}
	return nil, fmt.Errorf("%s: bad key length", path)
}

func newKey(path string) ed25519.PrivateKey {
	if k, err := loadKey(path); err == nil {
		return k
	}
	_, k, _ := ed25519.GenerateKey(rand.Reader)
	if err := os.WriteFile(path, []byte(hex.EncodeToString(k.Seed())+"\n"), 0600); err != nil {
		log.Fatal(err)
	}
	return k
}

// parseYuki turns "1.5" into nanoyuki.
func parseYuki(s string) (uint64, error) {
	r, ok := new(big.Rat).SetString(s)
	if !ok || r.Sign() <= 0 {
		return 0, fmt.Errorf("bad amount %q", s)
	}
	r.Mul(r, new(big.Rat).SetUint64(Nano))
	if !r.IsInt() {
		return 0, fmt.Errorf("too many decimals in %q", s)
	}
	return r.Num().Uint64(), nil
}

func main() {
	if len(os.Args) < 2 {
		usage()
	}
	fs := flag.NewFlagSet(os.Args[1], flag.ExitOnError)
	data := fs.String("data", "data", "chain data dir")
	keys := fs.String("keys", "keys", "keys dir")
	chainID := fs.String("chain", "yuki-testnet-1", "chain id")
	listen := fs.String("listen", "127.0.0.1:7480", "http listen addr")
	keyFile := fs.String("key", "", "wallet key file (hex seed)")
	to := fs.String("to", "", "recipient address or name.yuki")
	amount := fs.String("amount", "", "amount in YUKI")
	memo := fs.String("memo", "", "memo")
	node := fs.String("node", "http://127.0.0.1:7480", "node url")
	fs.Parse(os.Args[2:])

	switch os.Args[1] {
	case "init":
		os.MkdirAll(*data, 0755)
		os.MkdirAll(*keys, 0700)
		if _, err := os.Stat(filepath.Join(*data, "genesis.json")); err == nil {
			log.Fatal("genesis.json already exists")
		}
		split := []struct {
			file, label string
			pct         uint64
		}{
			{"founder", "Founder", 30}, {"ecosystem", "Ecosystem Fund", 30}, {"validator", "Validator #1 · Yuki", 20},
			{"treasury", "Treasury", 15}, {"faucet", "Faucet", 5},
		}
		const total = 1_000_000_000 * Nano
		g := Genesis{ChainID: *chainID, Time: time.Now().UnixMilli()}
		for _, s := range split {
			k := newKey(filepath.Join(*keys, s.file+".key"))
			addr := AddressFromPub(k.Public().(ed25519.PublicKey))
			g.Alloc = append(g.Alloc, Alloc{addr, total / 100 * s.pct, s.label})
			if s.file == "validator" {
				g.Validator = addr
				g.ValidatorPub = hex.EncodeToString(k.Public().(ed25519.PublicKey))
			}
			fmt.Printf("%-10s %s  %d%%\n", s.file, addr, s.pct)
		}
		out, _ := json.MarshalIndent(g, "", "  ")
		if err := os.WriteFile(filepath.Join(*data, "genesis.json"), out, 0644); err != nil {
			log.Fatal(err)
		}
		fmt.Println("genesis written:", filepath.Join(*data, "genesis.json"))

	case "run":
		key, err := loadKey(filepath.Join(*keys, "validator.key"))
		if err != nil {
			log.Fatal("validator key: ", err)
		}
		c, err := LoadChain(*data, key)
		if err != nil {
			log.Fatal(err)
		}
		if AddressFromPub(key.Public().(ed25519.PublicKey)) != c.G.Validator {
			log.Fatal("validator key does not match genesis")
		}
		fk, _ := loadKey(filepath.Join(*keys, "faucet.key"))
		api := &API{c: c, faucetKey: fk, faucetLog: map[string]int64{}}
		log.Printf("YukiChain %s at height %d, listening on %s", c.G.ChainID, c.head().Height, *listen)
		go c.Run()
		log.Fatal(http.ListenAndServe(*listen, cors(api.Routes())))

	case "keygen":
		_, k, _ := ed25519.GenerateKey(rand.Reader)
		fmt.Println("address:", AddressFromPub(k.Public().(ed25519.PublicKey)))
		fmt.Println("secret: ", hex.EncodeToString(k.Seed()))

	case "send":
		key, err := loadKey(*keyFile)
		if err != nil {
			log.Fatal(err)
		}
		amt, err := parseYuki(*amount)
		if err != nil {
			log.Fatal(err)
		}
		from := AddressFromPub(key.Public().(ed25519.PublicKey))
		var st struct {
			ChainID string `json:"chain_id"`
		}
		var acc, dst struct {
			Address   string `json:"address"`
			NextNonce uint64 `json:"next_nonce"`
		}
		getJSON(*node+"/api/status", &st)
		getJSON(*node+"/api/account/"+from, &acc)
		getJSON(*node+"/api/account/"+*to, &dst)
		if dst.Address == "" {
			log.Fatal("unknown recipient ", *to)
		}
		t := &Tx{Type: "transfer", To: dst.Address, Amount: amt, Fee: MinFee, Nonce: acc.NextNonce, Memo: *memo}
		t.Sign(st.ChainID, key)
		body, _ := json.Marshal(t)
		resp, err := http.Post(*node+"/api/tx", "application/json", bytes.NewReader(body))
		if err != nil {
			log.Fatal(err)
		}
		out, _ := io.ReadAll(resp.Body)
		fmt.Println(string(out))

	default:
		usage()
	}
}

func getJSON(url string, v any) {
	resp, err := http.Get(url)
	if err != nil {
		log.Fatal(err)
	}
	defer resp.Body.Close()
	json.NewDecoder(resp.Body).Decode(v)
}
