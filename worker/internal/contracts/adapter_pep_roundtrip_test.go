package contracts

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"

	"apps/worker/internal/contracts/generated"
)

func TestAdapterPepResourceRoundtrip(t *testing.T) {
	raw, err := os.ReadFile("../../../contracts/samples/adapter-pep-resource.sample.json")
	if err != nil {
		t.Fatal(err)
	}
	var typed []generated.AdapterPepCheckResponse
	if err := json.Unmarshal(raw, &typed); err != nil {
		t.Fatal(err)
	}
	back, err := json.Marshal(typed)
	if err != nil {
		t.Fatal(err)
	}
	var expected, actual any
	if err := json.Unmarshal(raw, &expected); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(back, &actual); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(actual, expected) {
		t.Fatal("PEP resource identity or legacy absence changed")
	}
}
