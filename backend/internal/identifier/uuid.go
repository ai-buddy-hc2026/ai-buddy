package identifier

import (
	"crypto/rand"
	"encoding/hex"
	"strings"
)

func NewUUID() (string, error) {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		return "", err
	}
	value[6] = (value[6] & 0x0f) | 0x40
	value[8] = (value[8] & 0x3f) | 0x80
	hexValue := hex.EncodeToString(value[:])
	return hexValue[:8] + "-" + hexValue[8:12] + "-" + hexValue[12:16] + "-" + hexValue[16:20] + "-" + hexValue[20:], nil
}

// ValidUUID проверяет согласованный ненулевой UUID без ограничения версии.
func ValidUUID(value string) bool {
	if len(value) != 36 || value != strings.ToLower(value) || value == "00000000-0000-0000-0000-000000000000" ||
		value[8] != '-' || value[13] != '-' || value[18] != '-' || value[23] != '-' {
		return false
	}
	compact := strings.ReplaceAll(value, "-", "")
	_, err := hex.DecodeString(compact)
	return len(compact) == 32 && err == nil
}
