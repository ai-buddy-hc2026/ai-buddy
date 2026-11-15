package policy

import "testing"

func TestReadEmployeesDoesNotGrantCrossTeamAccess(t *testing.T) {
	for _, role := range []string{"intern", "buddy", "lead"} {
		actor := Actor{ID: "actor", TeamID: "team", Role: role}
		if reason := Check(actor, ReadEmployees, Resource{TeamID: "team"}); reason != "" {
			t.Fatalf("%s: %s", role, reason)
		}
		if reason := Check(actor, ReadEmployees, Resource{TeamID: "other"}); reason != "team_denied" {
			t.Fatalf("%s: %s", role, reason)
		}
	}
	if reason := Check(Actor{ID: "actor", TeamID: "team", Role: "hr"}, ReadEmployees, Resource{TeamID: "team"}); reason != "role_denied" {
		t.Fatal(reason)
	}
}
