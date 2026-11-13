package toolcontract

import (
	"encoding/json"
	"os"
	"reflect"
	"regexp"
	"testing"
)

func TestInputSchemas(t *testing.T) {
	for _, tc := range []struct {
		name  string
		value any
	}{
		{"EmptyInput", map[string]any{}}, {"GetPlanInput", map[string]any{}}, {"CreateAbsenceInput", map[string]any{"date": "2026-12-20", "type": "day_off"}},
	} {
		if err := Validate(tc.name, tc.value); err != nil {
			t.Fatalf("%s: %v", tc.name, err)
		}
	}
}

func TestCanonicalSchemas(t *testing.T) {
	source, err := os.ReadFile("../../../specs/mcp/schemas.json")
	if err != nil {
		t.Fatal(err)
	}
	doc, err := os.ReadFile("../../../docs/mcp.md")
	if err != nil {
		t.Fatal(err)
	}
	var canonical, embedded any
	if err := json.Unmarshal(source, &canonical); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal([]byte(schemaData), &embedded); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(canonical, embedded) {
		t.Fatal("run python specs/mcp/generate.py")
	}
	found := false
	for _, block := range regexp.MustCompile("(?s)```json\\s*(.*?)```").FindAllSubmatch(doc, -1) {
		var value any
		if json.Unmarshal(block[1], &value) == nil && reflect.DeepEqual(canonical, value) {
			found = true
		}
	}
	if !found {
		t.Fatal("schemas differ from original contract")
	}
}

func TestInvalidArguments(t *testing.T) {
	for _, tc := range []struct {
		name  string
		value any
	}{
		{"CreateAbsenceInput", map[string]any{"date": "2026-02-30", "type": "day_off"}},
		{"GetPlanInput", map[string]any{"intern_id": "00000000-0000-0000-0000-000000000000"}},
		{"EmptyInput", map[string]any{"employee_id": "10000000-0000-0000-0000-000000000001"}},
		{"ListAbsencesInput", map[string]any{"limit": 0}},
		{"UpdateStatusInput", map[string]any{"action_id": "10000000-0000-0000-0000-000000000001"}},
	} {
		if Validate(tc.name, tc.value) == nil {
			t.Errorf("accepted invalid %s", tc.name)
		}
	}
}
