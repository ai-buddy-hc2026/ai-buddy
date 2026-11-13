package httpapi

import "testing"

func TestListQueryValidation(t *testing.T) {
	for _, tc := range []struct {
		raw            string
		interns, valid bool
	}{
		{"", true, true}, {"limit=1&cursor=opaque", true, true}, {"limit=100&status=failed", false, true},
		{"limit=0", false, false}, {"limit=101", false, false}, {"limit=1&limit=2", false, false}, {"cursor=", false, false},
		{"status=unknown", false, false}, {"status=failed", true, false}, {"conversation_id=bad", false, false},
		{"team_id=other", false, false}, {"actor_id=other", false, false}, {"limit=%", false, false},
	} {
		_, err := parseListQuery(tc.raw, tc.interns)
		if (err == nil) != tc.valid {
			t.Fatalf("%+v err=%v", tc, err)
		}
	}
}
