package main

import (
	"errors"
	"strings"
)

// BIP-173 bech32, used for yuki1... addresses.

const charset = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"

var gen = [5]uint32{0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3}

func polymod(v []byte) uint32 {
	chk := uint32(1)
	for _, b := range v {
		top := chk >> 25
		chk = (chk&0x1ffffff)<<5 ^ uint32(b)
		for i := 0; i < 5; i++ {
			if (top>>uint(i))&1 == 1 {
				chk ^= gen[i]
			}
		}
	}
	return chk
}

func hrpExpand(hrp string) []byte {
	out := make([]byte, 0, len(hrp)*2+1)
	for _, c := range hrp {
		out = append(out, byte(c>>5))
	}
	out = append(out, 0)
	for _, c := range hrp {
		out = append(out, byte(c&31))
	}
	return out
}

func convertBits(data []byte, from, to uint, pad bool) ([]byte, error) {
	acc, bits := uint32(0), uint(0)
	maxv := uint32(1<<to) - 1
	var out []byte
	for _, b := range data {
		if uint32(b)>>from != 0 {
			return nil, errors.New("bad data")
		}
		acc = acc<<from | uint32(b)
		bits += from
		for bits >= to {
			bits -= to
			out = append(out, byte(acc>>bits&maxv))
		}
	}
	if pad {
		if bits > 0 {
			out = append(out, byte(acc<<(to-bits)&maxv))
		}
	} else if bits >= from || acc<<(to-bits)&maxv != 0 {
		return nil, errors.New("bad padding")
	}
	return out, nil
}

func bech32Encode(hrp string, data []byte) string {
	d, _ := convertBits(data, 8, 5, true)
	values := append(hrpExpand(hrp), d...)
	mod := polymod(append(values, 0, 0, 0, 0, 0, 0)) ^ 1
	var sb strings.Builder
	sb.WriteString(hrp + "1")
	for _, b := range d {
		sb.WriteByte(charset[b])
	}
	for i := 0; i < 6; i++ {
		sb.WriteByte(charset[(mod>>uint(5*(5-i)))&31])
	}
	return sb.String()
}

func bech32Decode(s string) (string, []byte, error) {
	if strings.ToLower(s) != s {
		return "", nil, errors.New("mixed case")
	}
	pos := strings.LastIndexByte(s, '1')
	if pos < 1 || pos+7 > len(s) || len(s) > 90 {
		return "", nil, errors.New("bad format")
	}
	hrp := s[:pos]
	var d []byte
	for _, c := range s[pos+1:] {
		i := strings.IndexRune(charset, c)
		if i < 0 {
			return "", nil, errors.New("bad char")
		}
		d = append(d, byte(i))
	}
	if polymod(append(hrpExpand(hrp), d...)) != 1 {
		return "", nil, errors.New("bad checksum")
	}
	data, err := convertBits(d[:len(d)-6], 5, 8, false)
	return hrp, data, err
}
