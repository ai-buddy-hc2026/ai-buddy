package identifier

import "testing"

func TestUUIDContract(t *testing.T) {
	for _, value := range []string{"10000000-0000-0000-0000-000000000001", "243c9752-b7c0-5b8d-ac71-d924ba8e3a98"} {
		if !ValidUUID(value) {
			t.Fatalf("contract UUID rejected: %s", value)
		}
	}
	for _, value := range []string{"", "intern_anya", "00000000-0000-0000-0000-000000000000", "243C9752-b7c0-5b8d-ac71-d924ba8e3a98", "{243c9752-b7c0-5b8d-ac71-d924ba8e3a98}", "10000000-0000-0000-0000-00000000000g", "10000000-0000-0000-0000-000000000001 ", "10000000_0000-0000-0000-000000000001", "10000000-0000-0000-0000-00000000000-"} {
		if ValidUUID(value) {
			t.Fatalf("invalid UUID accepted: %q", value)
		}
	}
}

func TestNewUUID(t *testing.T) {
	value, err := NewUUID()
	if err != nil {
		t.Fatal(err)
	}
	if !ValidUUID(value) {
		t.Fatalf("NewUUID returned invalid UUID %q", value)
	}
	if value[14] != '4' {
		t.Fatalf("UUID version = %q, want 4", value[14])
	}
}
