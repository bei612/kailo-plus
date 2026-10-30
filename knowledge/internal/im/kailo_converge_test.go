package im

import (
	"errors"
	"testing"
)

// Kailo DD-163: in Kailo mode no IM channel starts — neither at boot nor on
// a later start request — and the boot loader never reads the channel table.
func TestKailoModeStartsNoIMChannel(t *testing.T) {
	s := &Service{kailoClosed: true}
	if err := s.LoadAndStartChannels(); err != nil {
		t.Fatalf("LoadAndStartChannels in Kailo mode = %v, want nil without touching the database", err)
	}
	err := s.StartChannel(&IMChannel{ID: "ch-1", Platform: "wecom", Mode: "websocket"})
	if !errors.Is(err, ErrIMClosedByKailo) {
		t.Fatalf("StartChannel in Kailo mode = %v, want ErrIMClosedByKailo", err)
	}
}
