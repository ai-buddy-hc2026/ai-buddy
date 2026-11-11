package policy

import "testing"

func TestAccessMatrix(t *testing.T) {
	for _, role := range []string{"intern", "buddy", "lead", "admin", ""} {
		for _, operation := range []Operation{GetPlan, UpdateStatus, CreateChat, ReadChat, "unknown"} {
			for _, sameTeam := range []bool{true, false} {
				for _, owner := range []bool{true, false} {
					for _, assigned := range []bool{true, false} {
						for _, assignee := range []bool{true, false} {
							actor := Actor{ID: "actor", TeamID: "team", Role: role}
							resource := Resource{TeamID: "other", OwnerID: "other"}
							if sameTeam {
								resource.TeamID = actor.TeamID
							}
							if owner {
								resource.OwnerID = actor.ID
							}
							if assigned {
								resource.BuddyID = actor.ID
							}
							if assignee {
								resource.AssigneeID = actor.ID
							}
							want := false
							if sameTeam {
								switch role {
								case "intern":
									want = owner && (operation == GetPlan || operation == UpdateStatus && assignee || operation == CreateChat || operation == ReadChat)
								case "buddy":
									want = assigned && (operation == GetPlan || operation == UpdateStatus && assignee) || owner && (operation == CreateChat || operation == ReadChat)
								case "lead":
									want = operation == GetPlan || operation == UpdateStatus && assignee || owner && (operation == CreateChat || operation == ReadChat)
								}
							}
							if got := Check(actor, operation, resource); (got == "") != want {
								t.Fatalf("role=%q op=%q team=%v owner=%v buddy=%v assignee=%v: reason=%q want allow=%v", role, operation, sameTeam, owner, assigned, assignee, got, want)
							}
						}
					}
				}
			}
		}
	}
}

func TestCorporateToolsAccess(t *testing.T) {
	for _, role := range []string{"intern", "buddy", "lead", "admin", ""} {
		for _, op := range []Operation{GetManager, GetAbsencePolicy, ListAbsences, CreateAbsence} {
			for _, team := range []string{"team", "other", ""} {
				for _, owner := range []string{"actor", "other"} {
					want := (role == "intern" || role == "buddy" || role == "lead") && team == "team" && (op == GetAbsencePolicy || owner == "actor")
					resource := Resource{TeamID: team, OwnerID: owner, BuddyID: "actor"}
					if op == ListAbsences {
						want = (role == "buddy" || role == "lead") && team == "team"
					}
					got := Check(Actor{ID: "actor", TeamID: "team", Role: role}, op, resource)
					if (got == "") != want {
						t.Fatalf("role=%q op=%q team=%q owner=%q reason=%q", role, op, team, owner, got)
					}
				}
			}
		}
	}
}

func TestEscalationAndListingRoles(t *testing.T) {
	for _, role := range []string{"intern", "buddy", "lead", "admin", ""} {
		actor := Actor{ID: "actor", TeamID: "team", Role: role}
		for _, sameTeam := range []bool{true, false} {
			resource := Resource{TeamID: "other", OwnerID: "actor", BuddyID: "actor"}
			if sameTeam {
				resource.TeamID = "team"
			}
			for _, tc := range []struct {
				op    Operation
				allow bool
			}{
				{CreateEscalation, role == "intern" && sameTeam},
				{ListBuddyInterns, role == "buddy" && sameTeam},
				{ListActions, (role == "intern" || role == "buddy" || role == "lead") && sameTeam},
			} {
				if got := Check(actor, tc.op, resource); (got == "") != tc.allow {
					t.Fatalf("role=%s op=%s team=%v reason=%s", role, tc.op, sameTeam, got)
				}
			}
		}
	}
	if Check(Actor{ID: "buddy", Role: "buddy", TeamID: "team"}, ListBuddyInterns, Resource{TeamID: "team", BuddyID: "other"}) != "assignment_denied" {
		t.Fatal("wrong assignment allowed")
	}
}

func TestMissingIdentityDenied(t *testing.T) {
	for _, actor := range []Actor{{}, {ID: "actor", Role: "intern"}, {TeamID: "team", Role: "lead"}} {
		if Check(actor, GetPlan, Resource{TeamID: "team", OwnerID: "actor"}) != "invalid_actor" {
			t.Fatal("missing identity allowed", actor)
		}
	}
	if Check(Actor{ID: "actor", TeamID: "team", Role: "lead"}, GetPlan, Resource{}) != "team_denied" {
		t.Fatal("missing resource team allowed")
	}
}
