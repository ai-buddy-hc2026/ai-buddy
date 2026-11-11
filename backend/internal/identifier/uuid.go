package identifier

import (
	"encoding/hex"
	"strings"
)

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
